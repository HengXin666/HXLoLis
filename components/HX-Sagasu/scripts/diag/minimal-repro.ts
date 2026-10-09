#!/usr/bin/env node
/**
 * HX-Sagasu 命令行入口  让这套能力**可以被直接跑一次**。
 *
 * ## 为什么需要它
 *
 * 到 2026-09-17，本组件有 179 项测试全绿、14 个源模块，**但没有任何可执行入口**：
 * 没有 `package.json`、没有 bin、没有 HTTP server。于是出现一种尴尬处境 
 * 每个模块都被测试证明了"能用"，而**没有人能真的用它一次**。
 *
 * 这不是小事。它导致过至少两次误判（`resolve.ts` 的核心场景坏了 16 轮没人发现，
 * 因为测试验证的是各部件而不是完整路径）。**一个能被跑起来的入口本身就是一种验证。**
 *
 * ## 设计取舍
 *
 * - **零依赖、零构建**：与全组件一致（Node 内置 + 原生 TS type-stripping）。
 *   不引 commander/yargs  参数解析用最朴素的 argv 扫描，够用且不会引入安装步骤。
 * - **不隐藏失败**：失败来源照原样打在 stderr，退出码非 0。这是全组件的失败契约
 *   （fetcher 抛错，绝不把失败伪装成空结果）。
 * - **只读**：默认不写账本。要沉淀必须显式加 `--sink`，因为账本是**只追加**的，
 *   写错了擦不掉。副作用由调用方显式发起。
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { planFetchers, adapterFetchers } from '../../src/fetchers.ts'
import { authoritativeFetchers } from '../../src/authoritative.ts'
import { makeBilibiliAdapter } from '../../src/adapters/bilibili.ts'
import { makeTelegramAdapter } from '../../src/adapters/telegram.ts'
// 副作用导入: 注册作用域探测（让 ctx.scope 有生产者）
import '../src/adapters/scope-probes.ts'
import { argoFetchers, openArgoSession } from '../../src/argo-source.ts'
import { recall, SOURCES, type Tier } from '../../src/recall.ts'
import { createHash } from 'node:crypto'
import { EvidenceLedger, openLedger } from '../../src/ledger.ts'
import { MIN_QUOTE_CHARS, sinkDigest, sinkHits, sinkThread } from '../../src/sink.ts'
import { buildIndex, deserializeIndex, loadOrRebuild, query as queryIndex, serializeIndex } from '../../src/index-store.ts'
import { normalizeThread } from '../../src/thread.ts'
import { resolve, relevantFloors } from '../../src/resolve.ts'
import { buildReplyTree, renderTree } from '../../src/reply-tree.ts'
import type { RawThreadInput } from '../../src/types-text.ts'
import { checkUrl } from '../../src/url-safety.ts'
import { extractReadability } from '../../src/readability.ts'

/** argo 运行时坐标。与 DSH profile patch 里配的是同一组  那条路已实测可用
 *  (2026-09-16: 绕过插件直连 mcp_server.py, v2.8.6, 中文查询返回真实结果)。 */
const ARGO_PY = process.env['HX_SAGASU_ARGO_PY'] ?? '/usr/bin/python3'
/**
 * 把 argo 超时缩到"193 行 + 一个目录名"  根因仍未闭合但已可分析
 * .agents/notes/implemented/architecture/2026-09-18-minimal-repro.md
 * argo 并发失败的复现与**一条被推翻的结论**
 * .agents/notes/implemented/architecture/2026-09-19-conclusion-overturned.md
 */
const ARGO_SERVER = process.env['HX_SAGASU_ARGO_SERVER'] ?? [process.env['HOME'] ?? '', '.local/share/hx-sagasu/argo/scripts/mcp_server.py'].join('/')

const argv = process.argv.slice(2)
const flagOf = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name: string): boolean => argv.includes(name)

function buildFetchers(ctx: Ctx): ReturnType<typeof planFetchers> {
  // argo 走子进程会话；起不来就**如实报缺**，而不是假装没有这个来源
  try {
    ctx.session = openArgoSession(spawn, ARGO_PY, [...ARGO_SERVER]) as unknown as Ctx['session']
  } catch {
    ctx.session = undefined
  }
  const available: Record<string, unknown> = {
    authoritative: authoritativeFetchers(),
    adapter: adapterFetchers({
      bilibili: makeBilibiliAdapter(),
      'telegram-public': makeTelegramAdapter(),
    }),
  }
  if (ctx.session !== undefined) {
    available['argo'] = argoFetchers(ctx.session as never)
  }
  return planFetchers({ available: available as never })
}

async function cmdSearch(): Promise<number> {
  const q = argv[1]
  if (q === undefined || q.startsWith('--')) {
    process.stderr.write('缺少查询。用法: sagasu search <查询>\n')
    return 2
  }
  const scope = flagOf('--scope')
  const tier = Number(flagOf('--tier') ?? '2') as Tier
  const limit = Number(flagOf('--limit') ?? '3')
  const minHits = Number(flagOf('--min-hits') ?? '5')
  const asJson = has('--json')
  const sinkPath = flagOf('--sink')
  const indexPath = flagOf('--index')

  const ctx: Ctx = {}
  const { fetchers, missing } = buildFetchers(ctx)

  // 采集时间线（仅 --explain 时；默认零开销）
  const explain = has('--explain')
  const t0 = Date.now()
  const started = new Map<string, number>()
  const timeline: TimelineEntry[] = []
  const observer = explain
    ? (e: { kind: string; tier?: number; sourceId?: string; at?: number; elapsedMs?: number; hits?: number; failure?: { message?: string } }) => {
        if (e.kind === 'source-started' && e.sourceId !== undefined && e.at !== undefined) started.set(e.sourceId, e.at)
        else if (e.kind === 'source-settled' && e.sourceId !== undefined) {
          const st = started.get(e.sourceId) ?? t0
          timeline.push({ tier: e.tier ?? 0, sourceId: e.sourceId, startedAt: st, settledAt: Date.now(),
            totalMs: Date.now() - st, elapsedMs: e.elapsedMs ?? 0, hits: e.hits ?? 0,
            ...(e.failure !== undefined ? { failure: String(e.failure.message ?? '').slice(0, 60) } : {}) })
        }
      }
    : undefined
  // 未接线的来源必须**响亮**：否则"没接上"永远伪装成"没搜到"
  if (missing.length > 0) {
    process.stderr.write('未接线的来源: ' + missing.join(', ') + '\n')
  }

  const recallCtx: Record<string, unknown> = { query: q, minHits, perSourceLimit: limit, minSources: 1, maxTier: tier }
  if (scope !== undefined) recallCtx['scope'] = [scope]
  if (observer !== undefined) recallCtx['observer'] = observer

  let result
  try {
    result = await recall(q, fetchers, recallCtx as never)
  } finally {
    try { ctx.session?.close() } catch { /* 关不掉不影响结果 */ }
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else {
    process.stdout.write('查询: ' + q + (scope !== undefined ? '  作用域: ' + scope : '') + '\n\n')
    for (const t of result.tiers) {
      const layer = '第 ' + t.tier + ' 层'
      const state = t.ran ? t.hits + ' 条' : '未运行'
      process.stdout.write(layer + ': ' + state + (t.skippedReason ? '  (' + t.skippedReason + ')' : '') + '\n')
      for (const f of t.failures) {
        // not-applicable 用不同前缀  它不是故障，不该和真故障混在一起看
        const mark = f.kind === 'not-applicable' ? '  · 不适用' : '  ✖ 失败'
        process.stdout.write(mark + ' ' + f.sourceId + (f.message ? ': ' + String(f.message).slice(0, 100) : '') + '\n')
      }
    }
    process.stdout.write('\n命中 ' + result.hits.length + ' 条\n')
    for (const h of result.hits.slice(0, 20)) {
      process.stdout.write('  [' + h.sourceId + '] ' + String(h.title).slice(0, 70) + '\n')
      process.stdout.write('       ' + String(h.url).slice(0, 96) + '\n')
    }
  }

  // **时间线在结果之后单独渲染**（--explain）: 它是诊断视图，不是结果的一部分。
  if (explain) {
    process.stdout.write(chr10 + '执行时间线（进入→落定，横条长度 = 相对时刻）:' + chr10)
    const sorted = [...timeline].sort((x, y) => x.startedAt - y.startedAt)
    for (const line of renderTimeline(sorted, t0)) process.stdout.write(line + chr10)
    // **排队时间必须单独报**  那是 `elapsedMs` 单独看时最容易误读的部分
    const queued = sorted.filter(e => e.totalMs > 3000 && !(e.failure ?? '').includes('超时'))
    if (queued.length > 0) {
      process.stdout.write(chr10 + '排队超过 3 秒的来源（它们本身不慢，是在闸门后面等）:' + chr10)
      for (const e of queued) process.stdout.write('  ' + e.sourceId.padEnd(15) + ' 总 ' + e.totalMs + 'ms / recall 报 ' + e.elapsedMs + 'ms' + chr10)
    }
  }

  if (sinkPath !== undefined) {
    const ledger = existsSync(sinkPath) ? openLedger(readFileSync(sinkPath, 'utf8')) : new EvidenceLedger()
    // 按层沉淀: 每条命中属于哪一层是权威性的一部分，不能混
    // 注意: TierOutcome.hits 是**条数**(number), 不是数组  命中都在 result.hits 里。
    // 我此前把它当数组遍历: 那条路会**静默不沉淀任何东西**(循环体一次都不执行)。
    // 层归属由 SOURCES 的登记决定  一条命中属于哪一层是权威性的一部分, 不能靠猜。
    const tierOf = new Map(SOURCES.map(s => [s.id, s.tier as Tier]))
    let appended = 0
    let skipped = 0
    for (const tier of [0, 1, 2] as Tier[]) {
      const inTier = result.hits.filter(h => tierOf.get(h.sourceId) === tier)
      if (inTier.length === 0) continue
      const r = sinkHits(ledger, inTier, { tier, fetchedBy: 'sagasu-cli' })
      appended += r.appended
      skipped += r.skippedNoQuote
    }
    // 账本是 JSONL，每条一行。此前这里写的是 `chr(10)`  那是 **Python 语法**，
    // 在 JS 里会抛 ReferenceError，于是 `search --sink` 在运行期是坏的，
    // 而 217 项测试全绿（测试不跑 CLI）。**又一个只有真跑一次才看得见的缺陷。**
    writeFileSync(sinkPath, ledger.toJSONL() + (ledger.size > 0 ? '\n' : ''), 'utf8')
    process.stdout.write('\n账本 ' + sinkPath + ': ' + sinkDigest({ appended, skippedNoQuote: skipped }, result.hits.length) + '\n')
    if (indexPath !== undefined) {
      writeFileSync(indexPath, serializeIndex(buildIndex(ledger)), 'utf8')
      process.stdout.write('索引 ' + indexPath + ': ' + ledger.size + ' 张卡\n')
    }
  }
  return 0
}


const sub = argv[0]
let code = 2
if (sub === 'search') code = await cmdSearch()
else usage()
process.exit(code)
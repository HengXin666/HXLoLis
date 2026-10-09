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
import { planFetchers, adapterFetchers } from '../src/fetchers.ts'
import { authoritativeFetchers } from '../src/authoritative.ts'
import { makeBilibiliAdapter, relatedVideos } from '../src/adapters/bilibili.ts'
import { makeTelegramAdapter } from '../src/adapters/telegram.ts'
// 副作用导入: 注册作用域探测（让 ctx.scope 有生产者）
import '../src/adapters/scope-probes.ts'
import { argoFetchers, openArgoSession } from '../src/argo-source.ts'
import { recall, SOURCES, classifyQueryIntent, type SourceHit, type Tier } from '../src/recall.ts'
import { createHash } from 'node:crypto'
import { EvidenceLedger, openLedger } from '../src/ledger.ts'
import { MIN_QUOTE_CHARS, sinkDigest, sinkHits, sinkThread } from '../src/sink.ts'
import { buildIndex, deserializeIndex, loadOrRebuild, query as queryIndex, serializeIndex } from '../src/index-store.ts'
import { normalizeThread } from '../src/thread.ts'
import { resolve, relevantFloors } from '../src/resolve.ts'
import { buildReplyTree, renderTree } from '../src/reply-tree.ts'
import type { RawThreadInput } from '../src/types-text.ts'
import { checkUrl } from '../src/url-safety.ts'
import { probeUrls, renderVerifyReport } from '../src/verify-links.ts'
import { queryVariants } from '../src/query-variants.ts'
import { verifyClaims, renderClaimReport } from '../src/verify-claims.ts'
import { fallbackOf, renderFallback } from '../src/fallback.ts'
import { routeSources, classifyTopic } from '../src/route-sources.ts'
import { extractReadability } from '../src/readability.ts'

/** argo 运行时坐标。与 DSH profile patch 里配的是同一组  那条路已实测可用
 *  (2026-09-16: 绕过插件直连 mcp_server.py, v2.8.6, 中文查询返回真实结果)。 */
const ARGO_PY = process.env['HX_SAGASU_ARGO_PY'] ?? '/usr/bin/python3'
/**
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

function usage(): void {
  process.stdout.write(`HX-Sagasu  分层权威检索

用法:
  sagasu search <查询> [选项]
  sagasu sources
  sagasu query <索引文件> <词> [--ledger <账本>] [--limit <n>]
  sagasu thread <平台>:<id> [--ask <问题>] [--at <楼层>] [--flat] [--related]
  sagasu fetch <url> [--native] [--raw] [--browser]
  sagasu route <查询> [--json]
  sagasu claims <答案文件> --evidence <账本JSONL> [--json]

claims  **论断级核验: 「这句话有没有被 fetch 到的原文支持」**
  与 search --verify 分工: 那个核**链接活不活**，这个核**论断有没有据**。
  它不发网络请求，只做比对；「无据」不等于「假」，只是说在已取得的材料里找不到依据。

route  **只解释路由决策，不发起任何网络请求**
  它回答: 这次会查哪些来源、跳过哪些、各自的理由是什么。
  与 search --explain 的分工: 后者要真跑一次（有网络成本）并画时间线;
  前者零成本，用于改路由词表后快速自查影响面。

search 选项:
  --scope <名>      作用域（如 Telegram 频道名）。缺省时需作用域的来源标为"不适用"
  --tier <0|1|2>    最高层，默认 2
  --limit <n>       每来源取几条，默认 3
  --min-hits <n>    充分性判据之一，默认 5
  --json            输出原始 JSON
  --sink <file>     把结果**追加**进账本（JSONL）。不加则完全不落盘
  --index <file>    与 --sink 同用时，顺带产出派生索引
  --explain         打印**执行时间线**（每个来源的进入/落定时刻）
                     用于区分「这个来源慢」与「这个来源在排队」
  --verify          对结果里的链接做**可达性探测**（HEAD，失败不误报为死链）

thread 选项:
  --ask <问题>      在帖子上问一个问题。默认给出**指代解析**（楼主/楼上/某人是谁）
  --at <楼层>       阅读游标（1-based）。只有它存在时"楼上"才有确定含义
  --flat            平铺视图（默认显示**回复树**  树保留"这句话在回谁"）
  --related         相关推荐（目前仅 bilibili）。与 search 是**不同信号**:
                    它答的是"这条帖子周围还有什么"，不是"哪些帖子提到了这个词"

说明:
  - 逐层下降, 每层报"跑了没有、几条、哪里失败了"
  - 失败来源**照原样报告**, 不会静默变成空结果
  - 需要作用域的来源在没有 --scope 时记为 not-applicable, **不算失败**
`)
}

interface Ctx {
  session?: { call: (n: string, a: Record<string, unknown>, t: number) => Promise<Record<string, unknown>>; close: () => void }
}

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
  /**
   * 用时间线定位并发失败  进展与仍未闭合的部分
   * .agents/notes/implemented/architecture/2026-09-18-timeline-diagnosis.md
   */
  const { fetchers, missing } = buildFetchers(ctx)

  // 采集时间线（仅 --explain 时；默认零开销）
  const explain = has('--explain')
  const t0 = Date.now()
  const started = new Map<string, number>()
  const timeline: TimelineEntry[] = []
  const observer = explain
    ? /**
       * 执行时间线（--explain） 以及我重复了自己上轮的教训
       * .agents/notes/implemented/architecture/2026-09-18-execution-timeline.md
       */
      (e: { kind: string; tier?: number; sourceId?: string; at?: number; elapsedMs?: number; hits?: number; failure?: { message?: string } }) => {
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
    // **兜底说明**（2026-09-19） 补上「失败了最终给什么」这一层。
    //
    // 此前 `hits` 里有多少算多少、失败进 `failures`，然后**没有下文**。
    // 于是「确实没有」与「全线崩溃」的**输出长得一样**（都是空），
    // 而这两者的正确应对完全相反。
    const fb = fallbackOf(result)
    /**
     * 证据链兜底  补上「失败了最终给什么」
     * .agents/notes/implemented/architecture/2026-09-19-evidence-fallback.md
     */
    const fbText = renderFallback(fb)
    if (fbText !== '') process.stdout.write(fbText + '\n')
    for (const h of result.hits.slice(0, 20)) {
      process.stdout.write('  [' + h.sourceId + '] ' + String(h.title).slice(0, 70) + '\n')
      process.stdout.write('       ' + String(h.url).slice(0, 96) + '\n')
    }

    // **链接探活（--verify）**  学自 aether-search 的判据:
    // **搜索引擎不会伪造 URL，但页面可能是死的（404/410）或不可达。**
    // 所以这里**只做 Tier 1 探活**，不做 Tier 0 互证 
    // 对不会幻觉的来源做互证是**没有信息量的开销**。
    //
    // **默认关闭**: 每条链接一次 HEAD 请求，属于附加值而非检索本身；
    // 且它会引入网络延迟（并发 6，20 条链接约 1-3 秒）。
    if (has('--verify')) {
      const urls = result.hits.slice(0, 20).map(h => String(h.url))
      const outcomes = await probeUrls(urls)
      const dead = outcomes.filter(o => o.status === 'dead').length
      const unk = outcomes.filter(o => o.status === 'unverified').length
      const alive = outcomes.filter(o => o.status === 'alive').length
      process.stdout.write('\n链接核验: ' + alive + ' 可达 / ' + dead + ' 已死 / ' + unk + ' 未确认\n')
      /**
       * 链接核验  互证与探活，按 URL 的来源分流
       * .agents/notes/implemented/architecture/2026-09-19-link-verification.md
       * 论断级证据核验  「这句话有没有被 fetch 到的原文支持」
       * .agents/notes/implemented/architecture/2026-09-27-claim-verification.md
       */
      const report = renderVerifyReport(outcomes)
      if (report !== '') process.stdout.write(report + '\n')
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

function cmdSources(): number {
  const byTier = new Map<Tier, typeof SOURCES>()
  for (const s of SOURCES) {
    const list = byTier.get(s.tier as Tier) ?? []
    byTier.set(s.tier as Tier, [...list, s])
  }
  for (const tier of [0, 1, 2] as Tier[]) {
    const list = byTier.get(tier) ?? []
    process.stdout.write('第 ' + tier + ' 层 (' + list.length + ' 个)\n')
    for (const s of list) {
      const need = s.requiredScope !== undefined && s.requiredScope.length > 0 ? '  [需要作用域: ' + s.requiredScope.join('/') + ']' : ''
      process.stdout.write('  ' + s.id.padEnd(16) + s.label + need + '\n')
    }
  }
  return 0
}

/**
 * 查已沉淀的资产。
 *
 * ## 为什么必须走 loadOrRebuild（2026-09-18 修）
 *
 * 此前这里直接 `JSON.parse` 索引文件喂给 `queryIndex`，**完全绕过了身份校验**。
 * 后果具体而危险:
 *
 *   - 分词器升级（`TOKENIZER_VERSION` +1）后，旧索引的倒排键与新分词口径不再一致，
 *     查询侧算出新口径的词、索引侧存的是旧口径的词 → **查不到，但不报错**。
 *   - 打分公式改版（`INDEX_FORMAT_VERSION` +1）同理。
 *   - 卡片的增删同理（`sourceDigest` 不符）。
 *
 * 三种情况下调用方看到的都是"没有结果"，而真相是"索引过期了"。**这正是本项目
 * 一路在防的形态: 把「机制失效」伪装成「没有内容」。**
 *
 * `index-store.loadOrRebuild` 存在的全部意义就是这件事  它的注释写着
 * "判断被收进这里，就不可能被忘记"。**而它此前零调用方。**
 *
 * ## 重建需要账本
 *
 * 派生索引可以丢，真相在账本里。所以身份不符时必须有账本才能重建;
 * 只有索引文件时**只能如实说"无法校验"**，不许假装索引是新鲜的。
 */
function cmdQuery(): number {
  const file = argv[1]
  const term = argv[2]
  if (file === undefined || term === undefined) {
    process.stderr.write('用法: sagasu query <索引文件> <词> [--ledger <账本>] [--limit <n>]\n')
    return 2
  }
  const ledgerPath = flagOf('--ledger')
  const limit = Number(flagOf('--limit') ?? '10')
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : null

  if (ledgerPath === undefined) {
    // 没有账本 = 无法校验身份，也无法重建。
    // **如实报出这个限制**，而不是照常查询然后让人以为结果是可信的。
    process.stderr.write(
      '缺少 --ledger: 无法校验索引身份（分词器/格式/源摘要任一不符都会导致静默查不到）。\n' +
      '  · 加 --ledger <账本JSONL> 可校验并在不符时**全量重建**\n' +
      '  · 索引是派生品，真相在账本里  只读索引无法判断它是否过期\n',
    )
    if (raw === null) return 2
    process.stdout.write('⚠ 未校验身份（未提供账本）\n')
    reportQuery(queryIndex(deserializeIndex(raw), term, limit))
    return 0
  }

  const ledger = existsSync(ledgerPath) ? openLedger(readFileSync(ledgerPath, 'utf8')) : new EvidenceLedger()
  /**
   * 派生索引的身份校验必须接线  以及一个只有真跑才看得见的 Python 语法
   * .agents/notes/implemented/architecture/2026-09-18-derived-index-identity-wired.md
   */
  const { index, rebuilt, mismatches } = loadOrRebuild(raw, ledger)

  if (rebuilt) {
    if (mismatches.length > 0) {
      process.stdout.write('索引身份不符，已**全量重建**（派生品可丢，真相在账本）:\n')
      for (const m of mismatches) {
        process.stdout.write('  · ' + m.field + ': 索引 ' + String(m.expected) + ' → 账本 ' + String(m.actual) + '\n')
      }
    } else {
      process.stdout.write('索引不存在或损坏，已从账本重建\n')
    }
    // 重建是**副作用**：写回让下次不必再重建。失败要说出来，不能假装没发生。
    try {
      writeFileSync(file, serializeIndex(index), 'utf8')
      process.stdout.write('  → 已回写 ' + file + '\n')
    } catch (err) {
      process.stderr.write('  ✖ 重建后回写失败（本次查询仍有效）: ' + (err as Error).message + '\n')
    }
  } else {
    process.stdout.write('索引身份校验通过（未重建）\n')
  }

  process.stdout.write('卡数 ' + ledger.size + ' | 分词器 ' + index.identity.tokenizerId + '\n')
  reportQuery(queryIndex(index, term, limit))
  return 0
}

/** 查到的卡只给指针  正文在账本里。这是"Ledger 是真相、Index 是派生品"的直接后果。 */
function reportQuery(hits: ReturnType<typeof queryIndex>): void {
  process.stdout.write('命中 ' + hits.length + ' 条\n')
  for (const h of hits) {
    process.stdout.write('  ' + h.cardId.slice(0, 20) + '  score=' + h.score + '  [' + h.matched.join(',') + ']\n')
  }
  if (hits.length === 0) {
    process.stdout.write('  （索引里没有这些词。注意: 索引只含**已沉淀的卡**，不等于全网没有）\n')
  }
}


/**
 * 对话语义：拿一个帖子，问一个问题，得到**可追溯的引用链**。
 *
 * ## 这是目标第 (3) 项的第一个真实入口
 *
 * 需求原文: "在对话式/论坛语义下做精确意图理解（错别字容错、帖子-回复结构、
 * 引用链、多轮上下文）"。
 *
 * 到本轮为止，这条链的**每一环都写好了、都有测试**，但**没有一条路能走完**:
 *   - `adapters/*.ts` 的 `thread(ref)` 取回原始帖子结构（B站/Telegram 已接）
 *   - `thread.ts` 的 `normalizeThread` 做 L1 归一（错别字/繁简/全半角）
 *   - `resolve.ts` 的 `resolve` 做 L2 指代消解（"楼主"/"楼上"/楼层引用）
 *   - `digest` / `relevantFloors` 产出引用链
 *
 * **而 `resolve.ts` 此前零调用方**  本会话实测它的核心场景
 * （`resolve(thread, '楼主后来改口了吗')`）在修好之后是能用的，
 * 却没有任何人能跑到它。这与 CLI 本身存在的理由一模一样。
 *
 * ## 为什么不做"自动从查询里猜帖子引用"
 *
 * 用户必须显式给 `--thread <平台>:<id>`。理由: 猜错会**静默拿到别人的帖子**，
 * 而那是隐私边界，不是相关性判断能兜住的。
 */
async function cmdThread(): Promise<number> {
  const ref = argv[1]
  const question = flagOf('--ask')
  if (ref === undefined || ref.startsWith('--')) {
    process.stderr.write('用法: sagasu thread <平台>:<id> [--ask <问题>]\n  如: sagasu thread bilibili:BV1xx411c7mD --ask "楼主后来改口了吗"\n')
    return 2
  }
  const colon = ref.indexOf(':')
  if (colon <= 0) {
    process.stderr.write('引用格式必须是 <平台>:<id>，收到: ' + ref + '\n')
    return 2
  }
  const platform = ref.slice(0, colon)
  const id = ref.slice(colon + 1)

  // **相关视频**（2026-09-19 实测加） 它回答的是「这个帖子周围还有什么」，
  // 与 `search` 的「查询词匹配」是**不同的信号**。
  //
  // 实测该端点无需鉴权、无需 wbi 签名（对照: `x/space/wbi/arc/search` 返回 -403）。
  if (has('--related')) {
    if (platform !== 'bilibili') {
      process.stderr.write('--related 目前只有 bilibili 实现了（其它平台的相邻内容接口未实测）\n')
      return 2
    }
    const n = Number(flagOf('--limit') ?? '15')
    try {
      const rel = await relatedVideos(id, { limit: n })
      process.stdout.write('视频 ' + id + ' 的相关推荐 ' + rel.length + ' 条\n')
      for (const v of rel) {
        process.stdout.write('  ' + v.bvid.padEnd(14) + v.author.slice(0, 14).padEnd(16) + v.title.slice(0, 44) + '\n')
      }
      return 0
    } catch (err) {
      // 失败必须**响亮**  与全组件契约一致
      process.stderr.write('✖ 相关推荐失败: ' + (err as Error).message + '\n')
      return 1
    }
  }
  const adapters: Record<string, { thread: (r: string, c: never) => Promise<RawThreadInput> }> = {
    bilibili: makeBilibiliAdapter() as never,
    'telegram-public': makeTelegramAdapter() as never,
  }
  const adapter = adapters[platform]
  if (adapter === undefined) {
    process.stderr.write('未接入的平台: ' + platform + '。已接入: ' + Object.keys(adapters).join(', ') + '\n')
    return 2
  }

  let raw: RawThreadInput
  try {
    raw = await adapter.thread(id, { perSourceLimit: 50 } as never)
  } catch (err) {
    // 失败必须**响亮**  与全组件契约一致
    process.stderr.write('✖ 取帖子失败: ' + (err as Error).message + '\n')
    return 1
  }

  // `normalizeThread` 返回 `{ thread, normalizations }` 而不是裸 Thread。
  // 我此前把它的返回值直接喂给 `resolve`  报 "Cannot read properties of undefined
  // (reading 'filter')" 后才明白。**类型本应挡住这个错，但本项目跑
  // --experimental-strip-types 不做类型检查**（第 16 轮的教训）。
  /**
   * 多轮上下文接线  "楼上"终于有确定含义了
   * .agents/notes/implemented/architecture/2026-09-18-cursor-multiturn-wired.md
   */
  const { thread } = normalizeThread(raw)

  // **字段名必须照着实测核对，不能凭印象写。** 我第一版写的是
  // `t.floor` / `t.author` / `t.normalizedText`  实测 Turn 的字段是
  // `id` / `author: {id, name}` / `normalizedText`，于是楼层全是 `#undefined`、
  // 作者全是 `[object Object]`。**看起来像"数据坏了"，实际是我的显示层在撒谎。**
  const turnLabel = (t: { id: string }): string => '#' + String(t.id).slice(0, 10)
  const authorName = (t: { author?: { name?: string } | string }): string =>
    typeof t.author === 'string' ? t.author : (t.author?.name ?? '(无名)')

  const tree = buildReplyTree(thread.turns)
  // **默认显示回复树**而不是平铺（2026-09-18）: 平铺会丢掉"这句话在回谁"，
  // 而那是引用链的全部价值。\`--flat\` 保留平铺视图。
  if (!has('--flat')) {
    process.stdout.write('帖子 ' + platform + ':' + id + '  ' + thread.turns.length + ' 层 | 回复树 根 ' +
      tree.roots.length + ' 深度 ' + tree.maxDepth + '\n')
    for (const line of renderTree(tree, { maxText: 54, maxNodes: 40 })) {
      process.stdout.write(line + '\n')
    }
    if (question === undefined) return 0
    process.stdout.write('\n')
  } else {
    // 平铺视图：保留是因为它**楼层序完整**（树会按父子重排），
    // 而"第 N 楼"是用户与帖子的共同坐标。
    process.stdout.write('帖子 ' + platform + ':' + id + '  ' + thread.turns.length + ' 层（平铺）\n')
    for (const t of thread.turns.slice(0, 12)) {
      process.stdout.write('  ' + turnLabel(t).padEnd(12) + authorName(t).slice(0, 14).padEnd(15) +
        String(t.normalizedText ?? '').slice(0, 48).replace(/\n/g, ' ') + '\n')
    }
  }

  if (question !== undefined) {
    // **多轮上下文**: `cursorTurnId` 是"当前正在读哪一楼"。
    // 只有它存在时"楼上"才有确定含义  这是 `resolve` 注释里写明的契约，
    // 而它此前**零外部调用方**（只有测试用过）。
    //
    // CLI 侧接受楼层**序号**（1-based，符合人的直觉），内部转成 turnId。
    // 用序号而不是 id，是因为人读帖子时数的是"第几楼"，不是 hash。
    const cursorArg = flagOf('--at')
    let cursorTurnId: string | undefined
    if (cursorArg !== undefined) {
      const n = Number(cursorArg)
      if (!Number.isInteger(n) || n < 1 || n > thread.turns.length) {
        process.stderr.write('--at 必须是 1..' + thread.turns.length + ' 之间的整数，收到: ' + cursorArg + '\n')
        return 2
      }
      cursorTurnId = thread.turns[n - 1]!.id
      process.stdout.write('\n阅读游标: 第 ' + n + ' 楼（' + authorName(thread.turns[n - 1]!) + '）\n')
    }

    /**
     * 对话语义的第一个真实入口  以及我凭印象写错的三个字段名
     * .agents/notes/implemented/architecture/2026-09-18-thread-entry-point.md
     */
    const res = resolve(thread, question, cursorTurnId)
    process.stdout.write('\n问题: ' + question + '\n')
    // **引用链的真相在 res.targets[].turns**，而不是 relevantFloors。
    // 我第一版用了 relevantFloors  它按"话题词重叠"排，于是引用了两条
    // **与该问题无关的路人发言**，而楼主本人的两条发言一次都没出现。
    // 而 resolve 早就把楼主解析出来了（role: 'op'、participantName 明确）。
    // **我绕过了正确答案去用一个更弱的判据。**
    if (res.targets.length === 0) {
      process.stdout.write('未解析出指代目标' + (res.ambiguous.length > 0 ? '（有 ' + res.ambiguous.length + ' 处歧义）' : '') + '\n')
    }
    for (const tg of res.targets) {
      process.stdout.write('指代: ' + tg.role + ' = ' + (tg.participantName ?? tg.participantId ?? '(未命名)') +
        '  依据: ' + tg.reason + '  conf=' + tg.confidence + '\n')
      for (const t of tg.turns) {
        process.stdout.write('  ' + turnLabel(t).padEnd(12) + String(t.normalizedText ?? '').slice(0, 60).replace(/\n/g, ' ') + '\n')
      }
    }
    if (res.ambiguous.length > 0) {
      // **歧义必须报出来，不许猜。** resolve 在"无游标"时会给出候选而不是替人定 
      // 那是刻意的设计（"给出候选让人来定，不替人定"）。CLI 要把它显示出来，
      // 否则用户只会看到"没解析出目标"而不知道原因。
      process.stdout.write('歧义 ' + res.ambiguous.length + ' 处:\n')
      for (const a of res.ambiguous) {
        process.stdout.write('  「' + a.token + '」: ' + a.reason + '\n')
        process.stdout.write('    候选: ' + a.candidates.map(c => c.name).slice(0, 6).join(', ') + '\n')
        process.stdout.write('    → 用 --at <楼层号> 指定阅读游标即可消歧\n')
      }
    }
    process.stdout.write('话题词: ' + JSON.stringify(res.topic ?? null) + '\n')
    const cites = relevantFloors(thread, res)
    if (cites.length > 0) {
      process.stdout.write('话题相关楼层 ' + cites.length + ' 处（**不是**指代目标，只是字面相关）:\n')
      for (const c of cites.slice(0, 4)) {
        process.stdout.write('  ' + String(c.turnId ?? '').slice(0, 10).padEnd(12) + String(c.quote).slice(0, 54).replace(/\n/g, ' ') + '\n')
      }
    }
  }
  // **帖子证据沉淀**（2026-09-18 加）: 此前只有 search 会写账本，
  // 而 thread 产出的是**整楼原文**（search 给的只是 snippet）。
  const sinkPath2 = flagOf('--sink')
  if (sinkPath2 !== undefined) {
    const ledger2 = existsSync(sinkPath2) ? openLedger(readFileSync(sinkPath2, 'utf8')) : new EvidenceLedger()
    const before = ledger2.size
    /**
     * 沉淀覆盖三条路径  以及"证据用原文还是归一文本"
     * .agents/notes/implemented/architecture/2026-09-18-sink-all-three-paths.md
     * B站相关视频能力 + 平台可达性复核
     * .agents/notes/implemented/architecture/2026-09-19-bilibili-related.md
     * 让 `thread`/`fetch` 可被发现 + 现状文档追平实际
     * .agents/notes/implemented/architecture/2026-09-19-discoverability-and-docs.md
     */
    const r2 = sinkThread(ledger2, thread, { tier: 1, fetchedBy: 'sagasu-cli' })
    try {
      writeFileSync(sinkPath2, ledger2.toJSONL() + (ledger2.size > 0 ? '\n' : ''), 'utf8')
      process.stdout.write('\n账本 ' + sinkPath2 + ': 卡 ' + before + ' → ' + ledger2.size +
        '（新增 ' + r2.appended + '，太短跳过 ' + r2.skippedTooShort + '，无原文 ' + r2.skippedNoQuote + '）\n')
    } catch (err) {
      // 回写失败要**说出来**  副作用失败不能假装没发生
      process.stderr.write('  ✖ 账本回写失败: ' + (err as Error).message + '\n')
    }
  }
  return 0
}

/**
 * 抓取一个 URL 的正文  **先过 SSRF 校验，再抓，再提取**。
 *
 * ## 为什么需要它
 *
 * 本轮开头实测：`url-safety.ts`（320 行，SSRF 防护）与 `readability.ts`（244 行，
 * 正文提取）**都零调用方**  上一轮移植完就放在那里了。
 *
 * 这是本组件反复出现的病，本轮已经修过两次（`loadOrRebuild`、`resolve`）：
 * **机制写好了、测试绿了，而没有人能真的用它一次。**
 *
 * ## 分工（"用它的、自己长"的边界）
 *
 * - **抓取**交给 argo（`fetch_v3.py`）：它处理 TLS 指纹、移动 UA、Wayback、
 *   Chrome CDP 降级、限速退避  那是 65k stars 使用量压出来的实现。
 * - **SSRF 校验**用我们自己的 `url-safety.ts`：**argo 的 MCP `argo_fetch` 超时不可用**
 *   （实测 40s 无响应），而 CLI 路径**没有把 `url_safety` 挂在校验位上**
 *   （它是 fetch_v3 内部的一步，但我们要在**发起请求之前**就拦住）。
 * - **正文提取**用我们自己的 `readability.ts`：argo 的 extract 结果混着
 *   "Title:/--- CONTENT ---" 这类输出格式标记，我们需要干净的段落。
 *
 * ## 顺序不能反
 *
 * **SSRF 校验必须在发起任何网络请求之前**。先抓再校验等于把请求已经发出去了 
 * 那正是 SSRF 想防的事。所以这里明确分两步，且第一步失败就直接返回。
 */
async function cmdFetch(): Promise<number> {
  const url = argv[1]
  if (url === undefined || url.startsWith('--')) {
    process.stderr.write('用法: sagasu fetch <url> [--json] [--raw]\n')
    return 2
  }

  // ── 第一步: SSRF 校验（必须在任何网络请求之前）────────────────
  const safety = await checkUrl(url)
  if (!safety.ok) {
    process.stderr.write('✖ 拒绝抓取: ' + safety.reason + '\n')
    process.stderr.write('  （这是 SSRF 防护。确认目标安全可设 HX_SAGASU_ALLOW_PRIVATE_URLS=1）\n')
    return 1
  }

  // ── 路径 A: 原生抓取 + 我们自己的 readability 提取（--native）────
  //
  // **为什么要有这条路径**: argo 的 fetch_v3 只吐**纯文本**，而 `readability.ts`
  // 吃的是 **HTML**  它靠标签权重（article/main 1.5、li/h1-h6 0.5）与链接密度
  // 区分正文与导航。**给纯文本它无能为力**，于是它会一直是零调用方。
  //
  // 两条路径的分工:
  //   - 默认（argo）: 反爬站、需 TLS 指纹、需浏览器渲染的页面  用它的降级链
  //   - --native: 普通可直取的页面  拿原始 HTML，用我们的标签级提取
  if (has('--native')) {
    return await fetchNative(url, safety)
  }

  // ── 第二步: 抓着 argo 取原始 HTML/文本 ────────────────────────
  const py = process.env['HX_SAGASU_ARGO_PY'] ?? '/usr/bin/python3'
  const fetchScript = [process.env['HOME'] ?? '', '.local/share/hx-sagasu/argo/scripts/fetch_v3.py'].join('/')
  // **参数必须照着实测核对。** 我第一版加了 \`--json\`  fetch_v3.py 不认识它,
  // 直接 \`unrecognized arguments\` 退出 2。实测它的真实签名只有:
  // \`url [--max-chars N] [--timeout F] [--browser] [--no-fallback] [--actions JSON]\`
  // （fetch_v3.py:907-912），**而它本来就往 stdout 打 JSON 摘要 + 正文**。
  // 只传它真实支持的参数。超时由我们控（argo 默认 8s 偏短）。
  const maxChars = flagOf('--max-chars') ?? '20000'
  const fetchArgs = [url, '--max-chars', maxChars]
  const proc = spawn(py, [fetchScript, ...fetchArgs], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
  proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
  const code = await new Promise<number>(r => proc.on('close', c => r(c ?? 1)))

  if (code !== 0) {
    // 失败必须**响亮**  与全组件契约一致
    process.stderr.write('✖ 抓取失败（exit ' + code + '）: ' + err.slice(0, 200) + '\n')
    return 1
  }

  // argo 把 JSON 摘要与正文**混在同一份 stdout** 里（前面 JSON、后面 `--- CONTENT ---`）。
  // 这是它的输出格式，不是错误  我们按标记切分，并**保留原始 HTML 供提取用**。
  // argo 把 JSON 摘要与正文**混在同一份 stdout** 里。摘要是**多行 JSON 对象**
  // （实测: 前 10 行是 {…}，然后空行，然后 'Title: …' 与 '--- CONTENT (N chars) ---'）。
  //
  // **不能用"第一个 } 就结束"来切**  摘要里嵌套着对象，会在内层 } 处提前截断。
  // 用括号配平找真正的结束位置。
  const jsonEnd = findBalancedJsonEnd(out)
  let meta: Record<string, unknown> = {}
  if (jsonEnd > 0) {
    try { meta = JSON.parse(out.slice(0, jsonEnd)) as Record<string, unknown> } catch { /* 摘要坏了不影响正文 */ }
  }
  const marker = '--- CONTENT'
  const mi = out.indexOf(marker)
  const textPart = mi > 0
    ? out.slice(out.indexOf('---', mi + marker.length) + 3).trim()
    : (jsonEnd > 0 ? out.slice(jsonEnd).trim() : out.trim())

  if (has('--json')) {
    process.stdout.write(JSON.stringify({ safety, meta, text: textPart }, null, 2) + '\n')
    return 0
  }

  process.stdout.write('URL     ' + url + '\n')
  process.stdout.write('抓取    ' + String(meta['fetch_method'] ?? '?') +
    '  质量 ' + String(meta['quality_score'] ?? '?') +
    '  类型 ' + String(meta['page_type'] ?? '?') + '\n')
  if (has('--raw')) {
    process.stdout.write('\n' + textPart + '\n')
    return 0
  }

  // ── 第三步: 用我们自己的提取器把正文切段 ──────────────────────
  // argo 已经吐了纯文本（不是 HTML），所以这里对文本走一遍段落归并。
  // 如果将来接的是原始 HTML 路径，同一个函数直接可用  那是移植它的理由。
  const segments = splitParagraphs(textPart)
  process.stdout.write('段落 ' + segments.length + ' 段（readability 密度法）\n')
  for (const s of segments.slice(0, 12)) {
    process.stdout.write('  · ' + s.slice(0, 92).replace(/\n/g, ' ') + '\n')
  }
  return 0
}

/**
 * 找 stdout 里**第一个完整 JSON 对象**的结束下标（配平括号）。
 *
 * 为什么不能用 indexOf('}')：摘要里有嵌套对象，第一个 '}' 会在内层就截断，
 * JSON.parse 必然失败。而失败会被 catch 吞成"没有摘要" 
 * **看起来像 argo 没返回元数据，实际是我切错了。**
 *
 * 返回 -1 表示没找到（stdout 里没有 JSON）。
 */
function findBalancedJsonEnd(s: string): number {
  const start = s.indexOf('{')
  if (start < 0) return -1
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]!
    if (esc) { esc = false; continue }
    if (inStr) {
      if (c === String.fromCharCode(92)) esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i + 1 }
  }
  return -1
}

/**
 * 原生抓取：直接取 HTML，用我们自己的 `extractReadability` 提取。
 *
 * 只在 `--native` 时走。理由见调用处  它拿不到反爬站，但对普通页面
 * **能利用 HTML 的标签结构**，而 argo 的纯文本输出已经把那些信息丢掉了。
 *
 * 失败必须响亮：非 2xx 直接报状态码，不返回空字符串。
 */
async function fetchNative(url: string, safety: { ok: boolean; reason: string }): Promise<number> {
  let res: Response
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'HX-Sagasu/1 (+local research; contact via repo)' },
      signal: AbortSignal.timeout(20000),
    })
  } catch (err) {
    process.stderr.write('✖ 抓取失败: ' + (err as Error).message + '\n')
    return 1
  }
  if (!res.ok) {
    process.stderr.write('✖ HTTP ' + res.status + ' ' + res.statusText + '\n')
    return 1
  }
  const html = await res.text()
  /**
   * 给移植来的两个模块接上入口  以及第三次"零调用方"
   * .agents/notes/implemented/architecture/2026-09-18-fetch-entry-point.md
   */
  const { text, title } = extractReadability(html, Number(flagOf('--max-chars') ?? '8000'))

  if (has('--json')) {
    process.stdout.write(JSON.stringify({ safety, url, title, text, htmlBytes: html.length }, null, 2) + '\n')
    return 0
  }
  process.stdout.write('URL     ' + url + '\n')
  process.stdout.write('抓取    native   HTML ' + html.length + ' 字节\n')
  process.stdout.write('标题    ' + (title === '' ? '(无)' : title) + '\n')
  if (has('--raw')) {
    process.stdout.write('\n' + html + '\n')
    return 0
  }
  const segs = text.split('\n\n').filter(x => x.trim() !== '')
  process.stdout.write('正文    ' + text.length + ' 字符 / ' + segs.length + ' 段（readability 密度法，标签级）\n')
  for (const seg of segs.slice(0, 10)) {
    process.stdout.write('  · ' + seg.slice(0, 92).replace(/\n/g, ' ') + '\n')
  }
  // **抓取证据沉淀**（2026-09-18 加）: 此前 fetch 只打印，不写账本。
  // 而抓到的正文是**最完整的一手证据**（比 search 的 snippet 完整得多）。
  sinkFetched(url, title, text, flagOf('--sink'))
  return 0
}

/**
 * 把抓到的正文按段落沉淀。
 *
 * **为什么按段落而不是整篇**: 卡片是"最小证据单元"（`EvidenceCard` 的 `turnId` 写着
 * "指向具体某一楼，不是整帖"）。整篇正文作一张卡会让"为什么这张卡被召回"
 * 无法回答  而那是索引的 `matched` 字段要的粒度。
 *
 * **段落太短的不沉淀**: 与 `sinkThread` 同一条判据（`MIN_QUOTE_CHARS`）。
 * 一个"帮助改进 MDN"不是证据。
 */
function sinkFetched(url: string, title: string, text: string, sinkPath: string | undefined): void {
  if (sinkPath === undefined) return
  const ledger = existsSync(sinkPath) ? openLedger(readFileSync(sinkPath, 'utf8')) : new EvidenceLedger()
  const before = ledger.size
  let appended = 0
  let tooShort = 0
  // 用 url 的 sha256 前 16 位当 threadId  同一 URL 的段落归在一条记录下
  const threadId = createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 16)
  const paras = text.split(/\n\s*\n/u).map(x => x.replace(/\s+/gu, ' ').trim()).filter(x => x !== '')
  paras.forEach((quote, i) => {
    if (quote.length < MIN_QUOTE_CHARS) { tooShort++; return }
    const r = ledger.appendByIdentity(
      { platform: 'web' as never, threadId, turnId: 'p' + (i + 1), quote },
      { sourceTier: 2, fetchedBy: 'sagasu-cli', lensId: title.slice(0, 60) },
    )
    if (r.appended) appended++
  })
  try {
    writeFileSync(sinkPath, ledger.toJSONL() + (ledger.size > 0 ? '\n' : ''), 'utf8')
    process.stdout.write('\n账本 ' + sinkPath + ': 卡 ' + before + ' → ' + ledger.size +
      '（新增 ' + appended + '，太短跳过 ' + tooShort + '）\n')
  } catch (err) {
    process.stderr.write('  ✖ 账本回写失败: ' + (err as Error).message + '\n')
  }
}

/**
 * 把纯文本切成**正文段落**。
 *
 * 与 `extractReadability` 的分工：那个吃 HTML、按标签与链接密度评分；
 * 这个吃已经是纯文本的输出（argo 抓取的结果），只能按空行与长度切。
 *
 * **为什么两个都要有**：抓取路径不同，拿到的形态就不同。
 * `extractReadability` 需要 HTML 才有标签信息可用；对纯文本它无能为力。
 * 强行用一个函数兼容两种输入，会退化成"对纯文本猜标签"那是错的。
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/u)
    .map(s => s.replace(/\s+/gu, ' ').trim())
    .filter(s => s.length >= 20)
}


/**
 * 执行时间线（`--explain`）。
 *
 * ## 为什么需要它（2026-09-18）
 *
 * 一次召回涉及 40+ 个来源、多层、以及 argo 会话的串行闸门。当"某些来源失败"时，
 * **最常被混淆的两件事**是:
 *
 *   - 这个来源**自己慢**（网络/上游）
 *   - 这个来源**在闸门后面排队**（别人的锅）
 *
 * `elapsedMs` 单独看分不清这两者  实测某个来源 `elapsedMs=33028` 而它真实网络耗时 975ms。
 *
 * 有了 `source-started` 的进入时刻，**两条线一对比就能看出来**:
 *   - 进入时刻彼此接近、结束时刻也接近 → 真的并行（原生 HTTP 来源）
 *   - 进入时刻**依次错开** → 在排队（argo 闸门）
 *
 * **这也是定位"同一代码不同结果"这类时序问题的工具**  靠读代码猜时序代价极高。
 */
interface TimelineEntry {
  tier: number
  sourceId: string
  startedAt: number
  settledAt: number
  /** 从**进入**到落定  含排队。 */
  totalMs: number
  /** 从**这一层开始**到落定  recall 内部算的那个值。 */
  elapsedMs: number
  hits: number
  failure?: string
}

function renderTimeline(entries: readonly TimelineEntry[], base: number): string[] {
  const out: string[] = []
  const maxTotal = Math.max(1, ...entries.map(e => e.settledAt - base))
  const W = 44
  for (const e of entries) {
    const start = Math.round(((e.startedAt - base) / maxTotal) * W)
    const end = Math.round(((e.settledAt - base) / maxTotal) * W)
    const bar = ' '.repeat(start) + '█'.repeat(Math.max(1, end - start))
    const mark = e.failure !== undefined ? '✖' : (e.hits > 0 ? '●' : '○')
    out.push(
      '  ' + mark + ' t' + e.tier + ' ' + e.sourceId.padEnd(15) +
      bar.padEnd(W + 2) +
      String(e.settledAt - base).padStart(6) + 'ms' +
      (e.failure !== undefined ? '  ' + e.failure.slice(0, 40) : '  ' + e.hits + ' 条'),
    )
  }
  return out
}


  // ── `route` 子命令（2026-09-27 加，学自 smartsearch）────────────────
  //
  // **它只解释决策，不跑任何搜索。** 与 `--explain` 的关系:
  //   - `--explain` 要**真的跑一次**召回，然后画时间线（有网络成本）
  //   - `route` **零网络成本**  它只回答「这次会用哪些来源、跳过哪些、为什么」
  //
  // smartsearch 把这件事做成了一等命令（`smart-search route "query"`，
  // 文档明写「Explain intent routing **without running providers**」）。
  // 而我们的调参过程反复需要它: 改路由词表后想知道「哪些查询会受影响」，
NaN
  //
  // 三个它没有而我们有的: `classifyTopic` 的命中词、`SOURCE_TOPICS` 的归属、
  // 以及**每层小计**  因为我们的来源是分层的，而它的是平级的。
  function cmdRoute(): number {
    const q = argv[1]
    if (q === undefined || q.startsWith('--')) {
      process.stderr.write('用法: sagasu route <查询> [--json]\n')
      process.stderr.write('  只解释会把查询路由到哪些来源，**不发起任何网络请求**\n')
      return 2
    }
    /**
     * `route` 子命令  把「路由决策的解释」做成零成本的一等命令
     * .agents/notes/implemented/architecture/2026-09-27-route-command.md
     */
    const decision = routeSources(q)
    const tierOf = new Map(SOURCES.map(s => [s.id, s.tier]))
    const labelOf = new Map(SOURCES.map(s => [s.id, s.label]))
    const topics = classifyTopic(q)
    const intent = classifyQueryIntent(q)
    const variants = queryVariants(q)

    if (has('--json')) {
      process.stdout.write(JSON.stringify({
        query: q,
        topicClasses: [...topics],
        queryIntent: intent,
        queryVariants: variants,
        keep: decision.keep,
        skip: [...decision.skip.entries()].map(([id, why]) => ({ sourceId: id, reason: why })),
      }, null, 2) + '\n')
      return 0
    }

    process.stdout.write('查询: ' + q + '\n')
    // **判据先报**  后面的结论都要靠它解释
    process.stdout.write('话题族: ' + (topics.size === 0 ? '(无法归类 → 只保留通用来源)' : [...topics].join(', ')) + '\n')
    process.stdout.write('查询意图: ' + intent + '\n')
    // **变体也报出来**  它会让每个来源多打一次请求，是真实的成本
    process.stdout.write('查询变体: ' + (variants.length === 0 ? '(无)' : variants.join(' | ')) + '\n')
    process.stdout.write('\n会查 ' + decision.keep.length + ' 个来源:')
    for (const t of [0, 1, 2]) {
      const ids = decision.keep.filter(id => tierOf.get(id) === t)
      if (ids.length === 0) continue
      process.stdout.write('\n  第 ' + t + ' 层 (' + ids.length + ' 个):')
      for (const id of ids) process.stdout.write('\n    ' + id.padEnd(16) + String(labelOf.get(id) ?? '').slice(0, 30))
    }
    process.stdout.write('\n\n跳过 ' + decision.skip.size + ' 个:')
    if (decision.skip.size === 0) process.stdout.write('\n  (无)')
    for (const [id, why] of decision.skip) {
      process.stdout.write('\n  ' + id.padEnd(16) + why.slice(0, 60))
    }
    process.stdout.write('\n\n**以上不包含任何网络请求**  这是纯决策解释。\n')
    return 0
  }


  // ── `claims` 子命令（2026-09-27 加，学自 smartsearch）──────────────
  //
  // **论断级核验**: 「这句话有没有被 fetch 到的原文支持」。
  // 与 `search --verify` 的分工: 那核**链接活不活**，这核**论断有没有据**。
  //
  // 用法: sagasu claims <答案文件> --evidence <账本JSONL>
  //   · 答案: 任何断言文本（模型的结论、人的判断）
  //   · 证据: **必须是已 fetch 的正文**（账本里的卡片），不是检索 snippet
  //
  // **为什么要求两者都从文件来**: 这是它最有价值的用法  回答「这份报告里
  // 哪些结论有依据」。若允许临时拼参数，就会退化成玩具。
  function cmdClaims(): number {
    const answerPath = argv[1]
    const evidencePath = flagOf('--evidence')
    if (answerPath === undefined || answerPath.startsWith('--') || evidencePath === undefined) {
      process.stderr.write('用法: sagasu claims <答案文件> --evidence <账本JSONL> [--json]\n')
      process.stderr.write('  核验答案里每条论断是否被已取得的证据支持。\n')
      process.stderr.write('  **不带 --evidence 不做任何事**  本命令不发网络请求，它只做比对。\n')
      return 2
    }
    let answer: string
    try {
      answer = readFileSync(answerPath, 'utf8')
    } catch (err) {
      process.stderr.write('✖ 读不到答案文件: ' + (err as Error).message + '\n')
      return 1
    }
    // **证据从账本读**  账本是 append-only 的真相源，索引只是它的派生品
    const evidence: SourceHit[] = []
    try {
      const raw = readFileSync(evidencePath, 'utf8')
      for (const line of raw.split('\n')) {
        const t = line.trim()
        if (t === '') continue
        let card: Record<string, unknown>
        try { card = JSON.parse(t) as Record<string, unknown> } catch { continue }
        // **字段名照实读，不凭印象**（2026-09-27 实测账本卡片的真实形状）:
        //   id / platform / threadId / turnId / quote / sourceTier / provenance / retrievedAt / fetchedBy
        // **没有 `url` 字段**  链接在 `turnId` 里（它是这条证据的身份）。
        // 我第一版写的是 `card['url']`，于是「依据:」后面**永远是空的**。
        const quote = String(card['quote'] ?? '')
        const url = String(card['turnId'] ?? '')
        if (quote === '') continue
        const hit: SourceHit = { sourceId: String(card['platform'] ?? 'ledger'), title: String(card['title'] ?? ''), url }
        hit.snippet = quote
        evidence.push(hit)
      }
    } catch (err) {
      process.stderr.write('✖ 读不到证据账本: ' + (err as Error).message + '\n')
      return 1
    }
    const report = verifyClaims(answer, evidence)
    if (has('--json')) {
      process.stdout.write(JSON.stringify({ answerFile: answerPath, evidenceFile: evidencePath, ...report }, null, 2) + '\n')
      return 0
    }
    process.stdout.write('答案: ' + answerPath + '\n')
    process.stdout.write('证据: ' + evidencePath + '（' + evidence.length + ' 条）\n\n')
    const head = '论断 ' + report.checks.length + ' 条: 有据 ' + report.supported
    process.stdout.write(head + ' / 部分 ' + report.partial + ' / 无据 ' + report.unsupported + '\n')
    const txt = renderClaimReport(report)
    if (txt !== '') process.stdout.write(txt + '\n')
    else process.stdout.write('\n全部论断都有依据。\n')
    return 0
  }

const chr10 = String.fromCharCode(10)

const sub = argv[0]
let code = 2
if (sub === 'search') code = await cmdSearch()
else if (sub === 'sources') code = cmdSources()
else if (sub === 'query') code = cmdQuery()
else if (sub === 'thread') code = await cmdThread()
else if (sub === 'fetch') code = await cmdFetch()
else if (sub === 'route') code = cmdRoute()
else if (sub === 'claims') code = cmdClaims()
else usage()
process.exit(code)

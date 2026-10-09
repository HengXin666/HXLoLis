/**
 * 把引擎真值表的探测结果沉淀进 Evidence Ledger（M1 → M5 的连接）。
 *
 * 为什么值得做: `engine-status/*.json` 是**每次发布刷新**的可观测数据，此前它只是
 * 一个躺在目录里的 JSON  下一次会话不会知道"小红书在 2026-09-16 是依赖缺失而非无内容"，
 * 于是同一件事会被重新踩一遍。沉淀成证据卡之后，它可以被 index-store 检索到。
 *
 * 用法:
 *   node scripts/ingest-truth.ts <真值表.json> [--out <ledger.jsonl>]
 *   node scripts/ingest-truth.ts <真值表.json> --index <index.json>   # 顺带重建索引
 *
 * 设计要点:
 *  - 每个**非 ok** 的引擎各建一张卡：ok 是常态、没有记录价值；异常态才是要记住的。
 *  - 卡片的 quote 是**人可读的一句话**，而不是 JSON  证据要能被引用、被检索、
 *    在下一次会话里被读懂。原始 JSON 留在 engine-status/ 里做审计。
 *  - platform 用 'web'：引擎健康属于基础设施事实，不是某个社区平台的发言。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { EvidenceLedger, cardId, openLedger, type CardIdentity } from '../src/ledger.ts'
import { buildIndex, serializeIndex, loadOrRebuild } from '../src/index-store.ts'
import type { PlatformId } from '../src/types.ts'

interface TruthRow {
  label: string
  engine: string
  query: string
  final: 'ok' | 'empty' | 'anomaly' | 'unavailable'
  n?: number
  reason?: string
  detail?: string
  deps?: Array<{ kind: string; ref: string; ok: boolean; note: string }>
}

interface TruthPayload {
  generatedAt: number
  argo: string
  argoVersion?: string
  summary: Record<string, number>
  rows: TruthRow[]
}

const STATE_CN: Record<TruthRow['final'], string> = {
  ok: '可用',
  empty: '真跑过但无内容',
  anomaly: '数据在管线里丢了',
  unavailable: '拿不到（依赖缺失或不可用）',
}

/** 把一行探测结果写成人可读的一句话。引用要能脱离 JSON 被读懂。 */
function sentence(row: TruthRow, generatedAt: number, argoVersion: string): string {
  const day = new Date(generatedAt).toISOString().slice(0, 10)
  const parts = [
    `引擎健康存档 ${day}（argo ${argoVersion}）：${row.label}（${row.engine}）判定为「${STATE_CN[row.final]}」。`,
  ]
  if (row.final === 'ok') parts.push(`探测查询「${row.query}」返回 ${row.n ?? 0} 条。`)
  if (row.reason !== undefined) parts.push(`原因：${row.reason}。`)
  if (row.detail !== undefined) parts.push(`细节：${row.detail}。`)
  const broken = (row.deps ?? []).filter(d => !d.ok)
  if (broken.length > 0) {
    parts.push(`缺失依赖：${broken.map(d => `${d.ref}（${d.kind}）`).join('、')}。`)
  }
  return parts.join('')
}

function main(): number {
  const args = process.argv.slice(2)
  const input = args[0]
  if (input === undefined) {
    console.error('用法: node scripts/ingest-truth.ts <真值表.json> [--out <ledger.jsonl>] [--index <index.json>]')
    return 2
  }
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }

  const payload = JSON.parse(readFileSync(input, 'utf8')) as TruthPayload
  const out = flag('--out') ?? 'engine-status/ledger.jsonl'
  const indexPath = flag('--index')

  // 已有 Ledger 就追加（只追加语义: 同内容重放是 no-op，不会重复）
  const ledger = existsSync(out) ? openLedger(readFileSync(out, 'utf8')) : new EvidenceLedger()
  const before = ledger.size

  const argoVersion = payload.argoVersion ?? 'unknown'
  let appended = 0
  for (const row of payload.rows) {
    // 只记**异常态**与 ok 的首次出现不值得记  ok 是常态，记它只会淹没异常
    if (row.final === 'ok') continue
    const quote = sentence(row, payload.generatedAt, argoVersion)
    const identity: CardIdentity = {
      platform: 'web' as PlatformId,
      threadId: `engine-truth/${row.engine}`,
      turnId: new Date(payload.generatedAt).toISOString().slice(0, 10),
      quote,
    }
    const res = ledger.append({
      id: cardId(identity),
      ...identity,
      sourceTier: 0, // 基础设施事实，属一手
      provenance: { kind: 'metasearch', engine: 'hx-sagasu-engine-truth' },
      retrievedAt: payload.generatedAt,
      fetchedBy: 'engine_truth.py',
      lensId: 'engine-health',
    })
    if (res.appended) appended++
  }

  writeFileSync(out, ledger.toJSONL() + (ledger.size > 0 ? '\n' : ''), 'utf8')
  console.log(`[ingest-truth] Ledger ${before} → ${ledger.size}（新增 ${appended} 张，重放 ${payload.rows.length - appended} 行）→ ${out}`)

  if (indexPath !== undefined) {
    const raw = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
    /**
     * 沉淀层以「只追加账本 + 可全量重建索引」为唯一形态
     * .agents/notes/implemented/architecture/2026-09-16-sediment-append-only-ledger.md
     */
    const { index, rebuilt, mismatches } = loadOrRebuild(raw, ledger)
    writeFileSync(indexPath, serializeIndex(index), 'utf8')
    console.log(`[ingest-truth] 索引 ${rebuilt ? '重建' : '命中缓存'}（${mismatches.length} 项身份不符）→ ${indexPath}`)
    console.log(`[ingest-truth] 身份: ${JSON.stringify(index.identity)}`)
  }
  return 0
}

process.exit(main())

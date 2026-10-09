/**
 * Derived Index  沉淀层的第二层: **派生品**。
 *
 * 核心契约（对齐已确认规则「派生索引必须可全量重建，带版本身份，不符即重建」）:
 *
 *   身份 = { indexFormatVersion, tokenizerId, embedderId, sourceDigest }
 *   打开索引时逐项比对，**任一不符即整体重建**，绝不做增量修补。
 *
 * 为什么必须"重建而不是补丁": 派生索引是**可丢的**，真相在 Ledger 里。一旦允许
 * 增量修补，索引就会长期偏离真相而无人察觉存量里混着旧分词口径的条目，
 * 查不到东西却不报错。全量重建的代价是可接受的（本地千级卡毫秒级）。
 *
 * sourceDigest 刻意由**全部卡的 id 排序拼接**算出，而不是文件 mtime 或条数:
 *  - mtime 会在只读挂载/复制时丢失；
 *  - 条数相同但内容不同（一进一出）时条数察觉不到。
 */

import { createHash } from 'node:crypto'
import { tokenSet, TOKENIZER_VERSION, weightedTerms } from './tokenize.ts'
import type { EvidenceCard } from './ledger.ts'
import type { EvidenceLedger } from './ledger.ts'

/** 索引**结构**版本。改了倒排表形状/打分公式就 +1。与 TOKENIZER_VERSION 独立。 */
export const INDEX_FORMAT_VERSION = 1

/** 语义向量端口。默认无实现（null） 对齐「语义能力抽象为端口，换实现不改业务代码」。 */
export interface Embedder {
  /** 身份: 实现名 + 维度。进索引身份，换了就要重建。 */
  readonly id: string
  readonly dim: number
  embed(text: string): number[]
}

export interface IndexIdentity {
  indexFormatVersion: number
  tokenizerId: string
  /** 无 embedder 时为 null。 */
  embedderId: string | null
  /** sha256(全部卡 id 排序拼接)。 */
  sourceDigest: string
  /** 构建时刻；**不参与**身份比对（重建后必然变）。 */
  builtAt: number
}

export function tokenizerId(): string {
  return `hx-sagasu-zh-v${TOKENIZER_VERSION}`
}

/** 源摘要: 只有卡 id 参与  卡片内容改了 id 必然改（内容寻址）。 */
export function sourceDigest(cards: readonly EvidenceCard[]): string {
  const ids = cards.map(c => c.id).slice().sort()
  return createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex')
}

export interface Posting {
  cardId: string
  /** 命中词 → 该词在此卡里的权重（词流 2 / bigram 1）。 */
  score: number
}

export interface DerivedIndex {
  identity: IndexIdentity
  /** 词 → 倒排表（按 weight 降序，同分按 cardId 稳定排序）。 */
  postings: Map<string, Posting[]>
  /** lemma（原始词）→ 实际参与索引的词。用于同义归一。 */
  synonyms: Map<string, string[]>
  /** 卡 id 集合，用于一致性校验。 */
  cardIds: string[]
}

export interface BuildOptions {
  /** 语义向量端口；不给则不建向量、identity.embedderId 为 null。 */
  embedder?: Embedder | null
  /** 同义词表（规则 → 目标）。索引与查询共用同一张表，否则归一不对称。 */
  synonyms?: ReadonlyArray<readonly [string, string]>
  /** 注入时钟，便于测试固定 builtAt。 */
  now?: () => number
}

/** 内建同义词表。只收**检索意图明显相同**的写法；有疑问的一律不收。 */
export const DEFAULT_SYNONYMS: ReadonlyArray<readonly [string, string]> = [
  ['b站', '哔哩哔哩'],
  ['bilibili', '哔哩哔哩'],
  ['x', '推特'],
  ['twitter', '推特'],
  ['xhs', '小红书'],
  ['rednote', '小红书'],
  ['黑盒', '小黑盒'],
]

/**
 * 全量重建。**这是唯一的构建入口**  不存在"增量更新"这条路径（见文件头）。
 */
export function buildIndex(ledger: EvidenceLedger, options: BuildOptions = {}): DerivedIndex {
  const cards = ledger.all()
  const synonyms = new Map<string, string[]>()
  for (const [from, to] of options.synonyms ?? DEFAULT_SYNONYMS) {
    const key = from.toLowerCase()
    const list = synonyms.get(key) ?? []
    list.push(to.toLowerCase())
    synonyms.set(key, list)
  }

  const postings = new Map<string, Posting[]>()
  const embedder = options.embedder ?? null

  for (const card of cards) {
    // 索引文本 = 原文 + 展开后的同义写法。同义展开只影响召回，不改证据。
    const terms = weightedTerms(card.quote)
    for (const [from, tos] of synonyms) {
      if (!card.quote.toLowerCase().includes(from)) continue
      for (const to of tos) for (const [t, w] of weightedTerms(to)) terms.set(t, Math.max(terms.get(t) ?? 0, w))
    }
    for (const [term, weight] of terms) {
      const list = postings.get(term) ?? []
      list.push({ cardId: card.id, score: weight })
      postings.set(term, list)
    }
  }

  for (const [term, list] of postings) {
    list.sort((a, b) => (b.score - a.score) || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0))
    postings.set(term, list)
  }

  return {
    identity: {
      indexFormatVersion: INDEX_FORMAT_VERSION,
      tokenizerId: tokenizerId(),
      embedderId: embedder === null ? null : `${embedder.id}/d${embedder.dim}`,
      sourceDigest: sourceDigest(cards),
      builtAt: (options.now ?? Date.now)(),
    },
    postings,
    synonyms,
    cardIds: cards.map(c => c.id),
  }
}

export interface IdentityMismatch {
  field: keyof Omit<IndexIdentity, 'builtAt'>
  expected: string | number | null
  actual: string | number | null
}

/** 逐项比对身份。返回空数组表示索引新鲜可用。 */
export function checkIdentity(expected: IndexIdentity, actual: IndexIdentity): IdentityMismatch[] {
  const fields: Array<keyof Omit<IndexIdentity, 'builtAt'>> = [
    'indexFormatVersion', 'tokenizerId', 'embedderId', 'sourceDigest',
  ]
  const out: IdentityMismatch[] = []
  for (const f of fields) {
    if (expected[f] !== actual[f]) out.push({ field: f, expected: expected[f], actual: actual[f] })
  }
  return out
}

/**
 * 落盘形态: 身份 + 倒排表。**派生品**，随时可丢。
 * 刻意存成可读 JSON  "可丢"的前提是"能看懂里面是什么"。
 */
export function serializeIndex(index: DerivedIndex): string {
  return JSON.stringify({
    identity: index.identity,
    postings: [...index.postings.entries()].map(([term, list]) => [term, list]),
    synonyms: [...index.synonyms.entries()],
    cardIds: index.cardIds,
  })
}

export function deserializeIndex(raw: string): DerivedIndex {
  const parsed = JSON.parse(raw) as {
    identity: IndexIdentity
    postings: Array<[string, Posting[]]>
    synonyms: Array<[string, string[]]>
    cardIds: string[]
  }
  return {
    identity: parsed.identity,
    postings: new Map(parsed.postings),
    synonyms: new Map(parsed.synonyms),
    cardIds: parsed.cardIds,
  }
}

export interface LoadResult {
  index: DerivedIndex
  /** true = 身份不符，已在本次调用内重建。 */
  rebuilt: boolean
  mismatches: IdentityMismatch[]
}

/**
 * 打开索引: 身份不符就重建。
 *
 * 这是本模块存在的**全部意义**  调用方永远拿到一个与 Ledger 一致的索引，
 * 不需要自己判断"要不要重建"。判断被收进这里，就不可能被忘记。
 */
export function loadOrRebuild(
  raw: string | null,
  ledger: EvidenceLedger,
  options: BuildOptions = {},
): LoadResult {
  if (raw !== null) {
    let parsed: DerivedIndex | null = null
    try {
      parsed = deserializeIndex(raw)
    } catch {
      parsed = null // 索引损坏 = 派生品丢失, 直接重建 (真相在 Ledger, 没有损失)
    }
    if (parsed !== null) {
      const fresh = buildIndex(ledger, options).identity
      const mismatches = checkIdentity(parsed.identity, fresh)
      if (mismatches.length === 0) return { index: parsed, rebuilt: false, mismatches: [] }
      return { index: buildIndex(ledger, options), rebuilt: true, mismatches }
    }
  }
  return { index: buildIndex(ledger, options), rebuilt: true, mismatches: [] }
}

export interface QueryResult {
  cardId: string
  score: number
  /** 命中了哪些词（可审计：为什么这张卡被召回）。 */
  matched: string[]
}

/** 检索。索引侧与查询侧都走 `tokenSet`/`weightedTerms`，口径同源。 
 * .agents/notes/implemented/architecture/2026-09-18-derived-index-identity-wired.md
 */
export function query(index: DerivedIndex, text: string, limit = 10): QueryResult[] {
  const terms = weightedTerms(text)
  const acc = new Map<string, { score: number; matched: string[] }>()
  for (const [term] of terms) {
    const list = index.postings.get(term)
    if (list === undefined) continue
    for (const p of list) {
      const cur = acc.get(p.cardId) ?? { score: 0, matched: [] }
      cur.score += p.score
      cur.matched.push(term)
      acc.set(p.cardId, cur)
    }
    // 同义展开: 查询侧也归一，与索引侧对称
    for (const to of index.synonyms.get(term) ?? []) {
      for (const [t2] of weightedTerms(to)) {
        for (const p of index.postings.get(t2) ?? []) {
          const cur = acc.get(p.cardId) ?? { score: 0, matched: [] }
          cur.score += p.score
          cur.matched.push(t2)
          acc.set(p.cardId, cur)
        }
      }
    }
  }
  return [...acc.entries()]
    .map(([cardId, v]) => ({ cardId, score: v.score, matched: [...new Set(v.matched)] }))
    .sort((a, b) => (b.score - a.score) || (a.cardId < b.cardId ? -1 : 1))
    .slice(0, limit)
}

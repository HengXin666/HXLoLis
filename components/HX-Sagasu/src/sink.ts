/**
 * 检索结果 → 证据卡：把 L3 的产出沉淀成 L5 的资产。
 *
 * ## 为什么需要它
 *
 * 第 (4) 项需求是"把检索结果沉淀为可复用、可全量重建、带版本身份的数据资产"。两侧都
 * 已经建好，**但中间没有桥**（2026-09-17 实测确认）：
 *
 *   `recall()`  → `SourceHit[]`      （检索结果，内存里，会话结束即丢）
 *   `EvidenceLedger`                  （只追加账本，内容寻址）
 *   `cardsFromThread()`               （Thread → 卡，但那是**读线程**那条路）
 *
 * `ingest-truth.ts` 只处理**引擎真值**（哪个引擎坏了），不处理召回结果。
 * 于是"搜到的东西"从来没有进过账本第 (4) 项需求缺的就是这一段。
 *
 * ## 一条不能含糊的契约: quote 必须是**可在源站核对的原文**
 *
 * `EvidenceCard.quote` 的定义是"原文字面引用，**不是**归一化后的文本  证据必须能
 * 在源站核对得上"。检索结果里满足这个条件的只有两个字段:
 *
 *   `snippet`  来源给出的**原文片段**（实测: GitHub 仓库描述、Wikipedia 正文、MDN 正文）
 *   `title`    来源给出的**原样标题**（实测: 仓库全名、条目名、页面标题）
 *
 * 而下面这些**不许**进 quote:
 *   - `url`  它是坐标不是内容。放进 quote 会让"证据"变成"一条链接"，而链接本身不主张任何事
 *   - 任何我们**生成**的文本（摘要、翻译、拼接、归一化） 那就不再是引用了
 *
 * 因此 `quote` 取 `snippet` 与 `title` 的**可核对原文**，并在两者都空时**拒绝造卡**。
 *
 * ## 为什么 title 与 snippet 要合成一个 quote 而不是两张卡
 *
 * 它们描述的是**同一个东西**（一条命中）。拆成两张卡会让同一份证据在账本里出现两次，
 * 而 `sourceDigest` 与去重都按卡计重复会污染"来源多样性"这类判据。
 */

import { createHash } from 'node:crypto'
import { cardId, EvidenceLedger, type CardIdentity, type EvidenceCard } from './ledger.ts'
import type { PlatformId, Provenance } from './types.ts'
import type { SourceHit, Tier } from './recall.ts'
import type { Thread } from './thread.ts'

export interface SinkOptions {
  /** 这批命中来自哪一层。必须显式给出它决定卡的 sourceTier，而层级是权威性的一部分。 */
  tier: Tier
  /** 抓取者标识（哪个 agent/会话）。审计用。 */
  fetchedBy?: string
  lensId?: string
  /** 注入时钟，便于测试与重放。 */
  now?: () => number
}

/**
 * 一次检索的**查询坐标**  卡的身份里必须带上它。
 *
 * 为什么不能像 `cardsFromThread` 那样只用 `{platform, threadId, turnId}`:
 * 那条路来自"读了一个线程"，身份天然是"哪个帖的哪一楼"。
 * 而检索结果没有楼层同一条 URL 在两次不同查询下被搜到，是**同一份内容**，
 * 所以 threadId/turnId 必须由 **URL** 决定（内容的位置），**不含 query**
 * （否则同一份内容会因为问法不同而变成多张卡，账本里全是重复）。
 
 * .agents/notes/implemented/architecture/2026-09-17-hits-to-ledger-bridge.md
 */
export function hitIdentity(sourceId: string, hit: SourceHit, quote: string): CardIdentity {
  return {
    // 来源 id 不是 PlatformId 联合类型里的成员（它可能是 crossref/mdn 这类接口名）。
    // 这里**不做映射**，直接当作平台标识用  映射会丢失"这条来自哪个具体接口"的信息。
    platform: sourceId as PlatformId,
    threadId: sourceId,
    turnId: hit.url,
    quote,
  }
}

/**
 * 把一条命中变成 quote。
 *
 * 优先 `snippet`（它是正文片段，信息量更大），没有则退回 `title`。
 * 两者都空 → 返回空串，由调用方**拒绝造卡**。宁可少一张卡，也不要一张无法核对的卡。
 */
export function quoteOf(hit: SourceHit): string {
  const snippet = String(hit.snippet ?? '').trim()
  if (snippet !== '') return snippet
  return String(hit.title ?? '').trim()
}

export interface SinkResult {
  appended: number
  /** 因为**没有可核对原文**而被跳过的命中。这是数据质量问题，必须能被看见。 */
  skippedNoQuote: number
}

/**
 * 把一次召回的全部命中追加进账本。
 *
 * 幂等: 同一份内容重复沉淀是 no-op（`cardId` 内容寻址），所以**重复调用安全**
 * 这是"可全量重建"的前提: 只要能重新取到同样的内容，账本就会收敛到同一个状态。
 */
export function sinkHits(
  ledger: EvidenceLedger,
  hits: readonly SourceHit[],
  opts: SinkOptions,
): SinkResult {
  const now = opts.now ?? Date.now
  let appended = 0
  let skippedNoQuote = 0
  for (const hit of hits) {
    const quote = quoteOf(hit)
    // **拒绝造一张无法核对的卡**。这与全项目的失败契约同源:
    // 一张 quote 为空的"证据"会让下游引用一段不存在的话，比少一张卡严重得多。
    if (quote === '') {
      skippedNoQuote++
      continue
    }
    const identity = hitIdentity(hit.sourceId, hit, quote)
    const provenance = provenanceOf(hit)
    const card: EvidenceCard = {
      id: cardId(identity),
      ...identity,
      quote: quote.normalize('NFKC').trim(),
      sourceTier: opts.tier,
      provenance,
      retrievedAt: now(),
    }
    if (opts.fetchedBy !== undefined) card.fetchedBy = opts.fetchedBy
    if (opts.lensId !== undefined) card.lensId = opts.lensId
    if (ledger.append(card).appended) appended++
  }
  return { appended, skippedNoQuote }
}

/**
 * 命中的**来源类型**  它决定这条证据该怎么被信任。
 *
 * 如实记录"怎么拿到的": 直连平台接口是 `api`，argo 元搜索是 `metasearch`。
 * 这两者的可信度不同（前者是一手，后者经过了第三方引擎），而 `Provenance` 类型
 * 存在的原因正是"内容怎么拿到的决定它该被赋多高的信任度"。
 */
function provenanceOf(hit: SourceHit): Provenance {
  if (hit.sourceId.startsWith('argo:')) {
    return { kind: 'metasearch', engine: hit.sourceId.slice('argo:'.length) }
  }
  return { kind: 'api', endpoint: hit.sourceId }
}

/** 批次摘要  让"这次沉淀发生了什么"可复查，而不是只返回一个数字。 */
export function sinkDigest(result: SinkResult, total: number): string {
  const parts = [`${result.appended}/${total} 新增`]
  if (result.skippedNoQuote > 0) {
    parts.push(`${result.skippedNoQuote} 条无可核对原文被跳过`)
  }
  return parts.join('，')
}

/**
 * 把**对话帖子**沉淀进账本。
 *
 * ## 为什么需要它（2026-09-18）
 *
 * `EvidenceCard` 的字段（`threadId` / `turnId` / `quote`）本来就是**为对话证据设计的**
 *  卡片 doc 写着"指向具体某一楼，不是整帖"、"**原文字面引用。不是归一化后的文本
 *  证据必须能在源站核对得上**"。
 *
 * **而此前只有 `search` 会沉淀**：`thread` 与 `fetch` 都不写账本。
 * 而它们产出的恰恰是**含原文的最优质证据**  search 给的是 snippet（可能被截断），
 * thread 给的是整楼原文。
 *
 * ## 一个必须做对的地方: quote 用**原文**而不是归一文本
 *
 * 卡片的 `quote` **必须是能在源站核对得上的字面引用**。而我们在 L1 归一里
 * 改了错别字、繁简、全半角（`normalize.ts`） 那些改动**让文本更好检索，
 * 却让它不再是源站上的原文**。
 *
 * 所以这里取 `t.text`（原文）而**不是** `t.normalizedText`。
 * **归一文本是索引用的，原文才是证据。** 两者混用会让"证据可核对"这条契约失效。
 *
 * ## 沉淀什么: 只沉淀**有实质内容的楼层**
 *
 * 太短的楼层（"沙发"、"顶"、"确实"）不是证据  它们无法支撑任何结论。
 * 但它们**也不是噪声**（它们构成对话结构），所以**只跳过沉淀，不改变帖子本身**。
 */
export interface ThreadSinkResult {
  appended: number
  /** 因为**太短而不构成证据**被跳过的楼层数。 */
  skippedTooShort: number
  /** 因为**没有原文**被跳过的楼层数（异常数据）。 */
  skippedNoQuote: number
}

/** 楼层的**最短证据长度**。低于它的楼层不沉淀。 */
export const MIN_QUOTE_CHARS = 12

/**
 * 沉淀覆盖三条路径  以及"证据用原文还是归一文本"
 * .agents/notes/implemented/architecture/2026-09-18-sink-all-three-paths.md
 */
export function sinkThread(
  ledger: EvidenceLedger,
  thread: Thread,
  opts: { tier: 0 | 1 | 2; fetchedBy?: string; lensId?: string },
): ThreadSinkResult {
  let appended = 0
  let skippedTooShort = 0
  let skippedNoQuote = 0
  for (const t of thread.turns) {
    // **原文**，不是 normalizedText  见文件头
    const quote = String(t.text ?? '').trim()
    if (quote === '') { skippedNoQuote++; continue }
    if (quote.length < MIN_QUOTE_CHARS) { skippedTooShort++; continue }
    const r = ledger.appendByIdentity(
      { platform: thread.platform as PlatformId, threadId: thread.id, turnId: t.id, quote },
      { sourceTier: opts.tier, ...(opts.fetchedBy !== undefined ? { fetchedBy: opts.fetchedBy } : {}), ...(opts.lensId !== undefined ? { lensId: opts.lensId } : {}) },
    )
    if (r.appended) appended++
  }
  return { appended, skippedTooShort, skippedNoQuote }
}

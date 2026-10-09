/**
 * **论断级证据核验**  「这句话有没有被 fetch 到的原文支持」。
 *
 * ## 与 `verify-links.ts` 的分工（**这是两个层次，不能混淆**）
 *
 * | 模块 | 核验对象 | 问的问题 |
 * |---|---|---|
 * | `verify-links.ts` | **URL** | 「这个链接还活着吗」 |
 * | **本模块** | **论断** | 「这句话的依据在不在已取得的正文里」 |
 *
 * 一个链接可以**活着而完全不能支持那句论断**  前者只证明「页面存在」。
 *
 * ## 为什么需要它（2026-09-27，学自 smartsearch）
 *
 * smartsearch 的文档写着这条策略（`evidence_policy="fetch_before_claim"`）:
 *
 * > Discovery snippets are **candidates only**; citations are produced **only from
 * > fetched/read evidence**. If fallback cannot close a gap, research **finishes
 * > degraded and lists unsupported gaps instead of inventing evidence.**
 *
 * 以及四步流程的最后一步:
 *
 * > Unsupported key claims **must be fetched or downgraded** to unverified candidates.
 *
 * **我们此前只有前两层**: 检索引擎给的 snippet（候选）与链接核验（活着吗）。
 * **缺的是「论断 → 原文」这一步**  于是模型（或人）写的每句结论，
 * 没有任何东西检查它的依据是否真的在已取得的材料里。
 *
 * ## 判据: 词项覆盖率，不是语义相似度
 *
 * **为什么不用语义**: 本组件零依赖，没有 embedder。而且**覆盖率有一个语义做不到的性质** 
 * 它**可解释**: 「这句话的 5 个实词里有 4 个出现在第 3 条证据里，所以判它被支持」。
 * 语义分数给不出这个解释，而**证据核验的结论必须能被反驳**。
 *
 * **它必然会说错话**: 同义改写的论断会被判 unsupported（词不同）。
 * 所以本模块的产出**不是「真/假」，而是「有据/无据」**  一个可复核的事实。
 * **无据 ≠ 假**，它只是说「在已取得的材料里找不到依据」。
 */

import { termStreams } from './tokenize.ts'
import type { SourceHit } from './recall.ts'

/** 一条论断的核验结论。 */
export type ClaimVerdict = 'supported' | 'partial' | 'unsupported'

/** 单条论断的核验结果。 */
export interface ClaimCheck {
  /** 论断原文。**保留原样**，便于人工复核。 */
  readonly claim: string
  readonly verdict: ClaimVerdict
  /** 覆盖率（0..1）。**必须报出来**  否则结论不可复核。 */
  readonly coverage: number
  /** 该论断里参与比对的实词数。 */
  readonly terms: number
  /** 命中的实词。**这是「为什么判它有据」的原始依据。** */
  readonly matched: readonly string[]
  /** 支持它的证据（url + 命中的证据词）。**无据时为空数组。** */
  readonly supports: readonly { url: string; matched: readonly string[] }[]
}

/** 核验总览。 */
export interface ClaimReport {
  readonly checks: readonly ClaimCheck[]
  readonly supported: number
  readonly partial: number
  readonly unsupported: number
}

/**
 * 从文本里切出**可独立核验的论断**。
 *
 * 判据: 按句号/问号/换行切，**丢掉过短的**片段（它们通常是标题或过渡词，
 * 没有可核验的实质内容）。**阈值 12 字**  与 `sink.ts` 的 `MIN_QUOTE_CHARS` 同源，
 * 那里也是用长度把「有实质内容的引用」与「标题碎片」分开。
 *
 * **不切分句内**: 逗号分隔的是同一论断的组成部分，拆开会让每一半都显得「无据」。
 */
const MIN_CLAIM_CHARS = 12

export function extractClaims(text: string): string[] {
  const raw = text
    // 中英句末标点 + 换行都算边界
    .split(/[。！？!?\n]+/u)
    .map(s => s.trim())
    // 去掉 markdown 列表符与引用符  它们是排版，不是论断的一部分
    .map(s => s.replace(/^[-*•\d.、)\]]+\s*/u, ''))
    .filter(s => s.length >= MIN_CLAIM_CHARS)
  return raw
}

/**
 * 一条论断覆盖了多少证据词。
 *
 * **只比对实词**（长度为 1 的 CJK 词与停用词都丢掉） 与全组件的分词纪律一致。
 */
function claimTerms(claim: string): Set<string> {
  const terms = new Set<string>()
  for (const w of termStreams(claim).words) {
    // 单字不成词: 它们会制造大量虚假命中（「的」「是」「在」）
    if (w.length < 2) continue
    terms.add(w)
  }
  return terms
}

/**
 * 核验一组论断是否被一批证据支持。
 *
 * @param answer 待核验的文本（模型的答案、人的结论、任何断言）
 * @param evidence 已取得的证据（**必须是 fetch 到的正文**，而不是检索 snippet）
 */
export function verifyClaims(
  answer: string,
  evidence: readonly SourceHit[],
  options: { minCoverage?: number } = {},
): ClaimReport {
  // **阈值取 0.5**: 一半实词有据即算 supported。
  // 为什么不取更高: 论断通常比原文**精简**（原文含背景、限定、举例），
  // 要求 0.8 会把「有充分依据但表述更简短」的论断全判无据。
  // 为什么取 partial 中间态: 「一半」本来就模糊，硬二分会制造假精确。
  const minCoverage = options.minCoverage ?? 0.5
  const checks: ClaimCheck[] = []

  // 证据词表**算一次**（不是每条论断重算） 证据通常比论断多，这是一处真实的省算
  const evidenceTerms = evidence.map(hit => {
    const terms = new Set<string>()
    for (const w of termStreams(hit.title + ' ' + (hit.snippet ?? '')).words) {
      if (w.length >= 2) terms.add(w)
    }
    return { url: hit.url, terms }
  })

  for (const claim of extractClaims(answer)) {
    const terms = claimTerms(claim)
    if (terms.size === 0) {
      checks.push({ claim, verdict: 'unsupported', coverage: 0, terms: 0, matched: [], supports: [] })
      continue
    }
    const matched = new Set<string>()
    const supports: Array<{ url: string; matched: string[] }> = []
    for (const ev of evidenceTerms) {
      const hit: string[] = []
      for (const t of terms) if (ev.terms.has(t)) { hit.push(t); matched.add(t) }
      if (hit.length > 0) supports.push({ url: ev.url, matched: hit })
    }
    const coverage = matched.size / terms.size
    const verdict: ClaimVerdict =
      coverage >= minCoverage ? 'supported' : coverage > 0 ? 'partial' : 'unsupported'
    checks.push({
      claim, verdict, coverage: Math.round(coverage * 100) / 100,
      terms: terms.size, matched: [...matched], supports,
    })
  }

  return {
    checks,
    supported: checks.filter(c => c.verdict === 'supported').length,
    partial: checks.filter(c => c.verdict === 'partial').length,
    unsupported: checks.filter(c => c.verdict === 'unsupported').length,
  }
}

/**
 * 渲染核验报告。
 *
 * **只列 `unsupported` 与 `partial`**  有据的是好消息，逐条列会淹没重点。
 * 全都有据时返回空串（调用方据此判断「不用提示」）。
 
 * .agents/notes/implemented/architecture/2026-09-27-claim-verification.md
 */
export function renderClaimReport(report: ClaimReport): string {
  const bad = report.checks.filter(c => c.verdict !== 'supported')
  if (bad.length === 0) return ''
  const lines = ['', '论断核验（仅列**无据/部分有据**项）:']
  for (const c of bad) {
    const tag = c.verdict === 'unsupported' ? '⚠ 无据' : '? 部分有据'
    lines.push('  ' + tag + ' (' + c.coverage + ', ' + c.matched.length + '/' + c.terms + ' 词) ' + c.claim.slice(0, 60))
    if (c.supports.length > 0) lines.push('      依据: ' + c.supports[0]!.url.slice(0, 70))
  }
  lines.push('')
  lines.push('  **「无据」不等于「假」**  它说的是「在已取得的材料里找不到依据」。')
  lines.push('  补救: 补取证据，或把该论断**降级为未核实**。')
  return lines.join('\n')
}

/**
 * 失败时的**兜底装配**  学自 aether-search 的「证据链接兜底」。
 *
 * ## 它补的是哪个缺口
 *
 * 本组件的失败契约是：**取数函数失败必须抛**（`[]` 只表示"真的跑了但没有内容"），
 * 且失败要**响亮**（`failures` 逐条上报）。**这些都成立、也都对。**
 *
 * 但它们只回答了"失败了怎么办"的一半  **失败了，最终给用户什么？**
 *
 * 此前是：`hits` 里有多少算多少，失败进了 `failures`，然后**没有下文**。
 * 于是两种很不同的处境输出长得一样:
 *
 * | 处境 | 表现 | 用户看到的 |
 * |---|---|---|
 * | **确实是空**（跑通了，就是没有） | `hits=[]`, `failures=[]` | 空 |
 * | **全线崩溃**（网络断/会话坏/来源全挂） | `hits=[]`, `failures=[12 条]` | **也是空** |
 *
 * **两者的正确应对完全相反**: 前者该如实说"没有"，后者该说"没搜到，但这是故障不是结论"。
 *
 * aether-search 的做法是分三级降级: **Grok → agent → 证据链接**  它把
 * "降级到什么"**想清楚了**，而不是只把失败报出来。
 *
 * ## 本模块的三档产出
 *
 * ```
 *   'answer'    hits 够用  正常返回（不碰这个模块）
 *   'partial'   有证据但不够 / 有失败  **证据 + 明确标注它是局部的**
 *   'degraded'  一条证据都没有且确实有失败  **明说这是降级，不是空结果**
 * ```
 *
 * **判据只看"有没有真实证据"与"有没有失败"**，不看数量阈值 
 * 阈值属于充分性判断（`SufficiencyVerdict` 已经在管），这里只管**装配**。
 */

import type { RecallResult, SourceHit, TierOutcome } from './recall.ts'

/** 兜底等级。 */
export type FallbackLevel = 'answer' | 'partial' | 'degraded'

/** 兜底结论  供展示层直接渲染。 */
export interface FallbackOutcome {
  readonly level: FallbackLevel
  /** 一句话说明当前处境（给用户看）。 */
  readonly headline: string
  /** 补充说明（可选）。 */
  readonly detail?: string
  /** 失败来源数  供展示层决定要不要展开细节。 */
  readonly failures: number
  /** 跑了但从源上说不出话的层（可选）。 */
  readonly degradedTiers: readonly number[]
}

/**
 * 从一次召回的结果判定兜底等级。
 *
 * **纯函数**: 只读 `RecallResult`，不碰网络  于是它可被单测穷举。
 
 * .agents/notes/implemented/architecture/2026-09-19-evidence-fallback.md
 */
export function fallbackOf(result: RecallResult): FallbackOutcome {
  const failures = result.tiers.reduce((n, t) => n + t.failures.length, 0)
  const ranTiers = result.tiers.filter((t: TierOutcome) => t.ran)
  const degradedTiers = ranTiers.filter(t => t.hits === 0 && t.failures.length > 0).map(t => t.tier)
  const hasEvidence = result.hits.length > 0

  // **判据只有两条**: 有没有证据、有没有失败。数量阈值不在这里管。
  if (hasEvidence && failures === 0) {
    return { level: 'answer', headline: '', failures: 0, degradedTiers }
  }

  if (hasEvidence) {
    // **有证据但有失败**  必须标注它是局部的，否则用户会把"部分"当"全部"。
    return {
      level: 'partial',
      headline: `结果不完整：${failures} 个来源失败，以下是**已取到的部分证据**`,
      detail: degradedTiers.length > 0
        ? `第 ${degradedTiers.join('、')} 层整层无产出（该层来源多数失败）`
        : undefined,
      failures,
      degradedTiers,
    }
  }

  // **一条证据都没有。** 这里必须区分两种处境  那是本模块存在的全部理由。
  if (failures === 0) {
    return {
      level: 'answer',
      headline: '没有命中  这是"确实没有"，不是故障',
      detail: '全部来源都正常回答了，只是没有相关内容。可以换个说法再问。',
      failures: 0,
      degradedTiers,
    }
  }

  return {
    level: 'degraded',
    headline: `**降级**：${failures} 个来源失败，且没有取到任何证据`,
    detail:
      '这不是"搜不到"是**这次检索本身出了问题**。' +
      '请检查网络/argo 会话，或稍后重试。**不要把空结果当成结论。**',
    failures,
    degradedTiers,
  }
}

/**
 * 渲染兜底说明（供 CLI 直接打印）。
 *
 * `level === 'answer'` 且 headline 非空时也输出  因为**"确实没有"值得明说**
 * （否则用户分不清它和故障）。
 */
export function renderFallback(o: FallbackOutcome): string {
  if (o.headline === '') return ''
  const lines = ['', o.headline]
  if (o.detail !== undefined) lines.push('  ' + o.detail)
  return lines.join('\n')
}

/** 兜底是否意味着"结果不可信"。供调用方决定要不要继续用这批证据。 */
export function isDegraded(o: FallbackOutcome): boolean {
  return o.level === 'degraded'
}

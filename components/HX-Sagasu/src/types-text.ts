/** 文本归一化的结果类型（单独一个文件，避免 types.ts 依赖实现细节）。 */

export interface TextEdit {
  rule: 'self-correction' | 'homophone' | 'filler'
  from: string
  to: string
  /** `from` 在**改动前**文本中的起始索引；整段替换类规则记 0。 */
  index: number
}

export interface NormalizedText {
  /** 原文，保真。 */
  original: string
  /** 归一后（仅供检索/索引）。 */
  normalized: string
  /** 逐条可审计的改动记录。 */
  edits: TextEdit[]
  /** 0..1；改动越多越低。低置信度意味着"可能是归一器在猜"。 */
  confidence: number
  /** 检索时应**并列搜索**的写法。归一会猜错，用集合兜底。 */
  variants: string[]
}

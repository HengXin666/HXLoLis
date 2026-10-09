/**
 * 错别字 / 同音字 / 口语句读归一（L2）。
 *
 * 为什么需要（已确认的跨项目约束）: 用户用语音输入法输入，文本里会有错别字、同音字、
 * 口语句读与自我更正。做意图判定与检索时必须先做容错归一，**不能按字面当权威文本**；
 * 也不能因为一个错字就判定"不相关"。
 *
 * 两条设计约束，都是为了防止"归一化"变成"篡改":
 *  1. 归一只产出 `normalized`，**不改原文**；原文与归一后的文本都保留。
 *  2. 归一是**无损记录**的：每一处改动都带规则名与位置，可逐条审计。
 *
 * 另产出 `variants`: 检索时应当**并列搜索**的写法。归一是可能猜错的，用变体集兜底
 * 比赌单一改写安全  这正是"不能因为一个错字就判定不相关"的落地方式。
 */

import type { TextEdit, NormalizedText } from './types-text.ts'

/** 高置信度的**词级**同音/形近混淆。只收多字词  单字改写歧义太大，收益不抵风险。 */
const CONFUSIONS: ReadonlyArray<readonly [string, string]> = [
  ['绘话', '会话'],
  ['视屏', '视频'],
  ['模版', '模板'],
  ['帐户', '账户'],
  ['帐号', '账号'],
  ['须求', '需求'],
  ['需球', '需求'],
  ['带码', '代码'],
  ['函树', '函数'],
  ['编成', '编程'],
  ['线成', '线程'],
  ['进成', '进程'],
  ['内寸', '内存'],
  ['缓村', '缓存'],
  ['锁引', '索引'],
  ['检所', '检索'],
  ['舆请', '舆情'],
  ['贴把', '贴吧'],
  ['小黑合', '小黑盒'],
  ['晓红书', '小红书'],
  ['知呼', '知乎'],
  ['微薄', '微博'],
  ['壁哩壁哩', '哔哩哔哩'],
]

/** 自我更正标记: 命中后**取其后半段**后半段才是说话人的最终意图。 */
const SELF_CORRECTION = /(?:不对|不是|我是说|应该是|准确说|更正一下|说错了)[，,、]?\s*(?:是|我说的是|我想说)?\s*(.+)$/u

/** 口头填充：叠词与语气词。检索时无信息量，还会污染 n-gram。 */
const FILLERS = /(?:那个){2,}|(?:就是){2,}|(?:然后){2,}|呃+|嗯+|啊+/gu

/**
 * 句首话语标记。刻意**只**剥离开头  句中的 "就是"（"A就是B"）与 "那个"
 * （指代词）都承载语义，无条件删除会破坏查询意图。这是本条正则唯一的约束，
 * 以后想放宽它必须先找到反例。
 */
const LEADING_DISCOURSE = /^(?:(?:就是|那个|然后|所以说?|嗯|呃|啊)+[，,、]?\s*)+/u

// 刻意**没有**"叠字折叠"规则。
//
// 曾写过 `/([\u4e00-\u9fa5])\1(?=[\u4e00-\u9fa5])/u` 想把"非非常"折成"非常"，
// 它同时把"人人"折成"人"、"天天"折成"天"  字符层面这两类**无法区分**
// （"非非"与"人人"都是同一汉字相邻），要区分就必须有词典。
// 测试 `口头填充…不误伤正常叠词` 抓到了这个误伤。判据: 误伤正常叠词会静默改变
// 查询语义，代价高于"非非常"没被折叠。真要做得对，需要一份叠词词表，属未来工作。

export interface NormalizeOptions {
  /** 命中自我更正标记时是否截断到后半段。默认 true。 */
  applySelfCorrection?: boolean
  /** 最多容忍多少处改动；超过则降低置信度（可能是归一器误伤，不是输入错）。 */
  editBudget?: number
}

export function normalize(text: string, options: NormalizeOptions = {}): NormalizedText {
  const applySelfCorrection = options.applySelfCorrection !== false
  const editBudget = options.editBudget ?? 6
  const edits: TextEdit[] = []
  let out = text

  if (applySelfCorrection) {
    const m = SELF_CORRECTION.exec(out)
    if (m && m[1] && m[1].trim() !== '') {
      const from = out
      out = m[1].trim()
      edits.push({ rule: 'self-correction', from, to: out, index: 0 })
    }
  }

  // 混淆词：逐个词替换，位置用**替换前**的索引记录
  for (const [wrong, right] of CONFUSIONS) {
    let idx = out.indexOf(wrong)
    while (idx >= 0) {
      out = out.slice(0, idx) + right + out.slice(idx + wrong.length)
      edits.push({ rule: 'homophone', from: wrong, to: right, index: idx })
      idx = out.indexOf(wrong, idx + right.length)
    }
  }

  const beforeFillers = out
  out = out.replace(FILLERS, '').replace(LEADING_DISCOURSE, '')
  if (out !== beforeFillers) {
    edits.push({ rule: 'filler', from: beforeFillers, to: out, index: 0 })
  }
  out = out.replace(/\s{2,}/g, ' ').trim()

  // 置信度: 改动越多越可能是归一器在瞎猜, 而不是输入有错
  const confidence = edits.length === 0 ? 1 : Math.max(0.3, 1 - edits.length / (editBudget * 2))

  return { original: text, normalized: out, edits, confidence, variants: buildVariants(text, out, edits) }
}

/**
 * 检索变体集: 原文 + 归一后 + 每个高置信混淆的**反向**写法。
 * 归一是可能猜错的, 所以检索侧并列搜多种写法, 而不是赌一种。
 */
function buildVariants(original: string, normalized: string, edits: TextEdit[]): string[] {
  const set = new Set<string>([original.trim(), normalized])
  for (const e of edits) {
    if (e.rule !== 'homophone') continue
    // 反向变体: 把归一后的正确词换回原错词, 用于兜底命中按错字写的标题
    if (normalized.includes(e.to)) set.add(normalized.replace(e.to, e.from))
  }
  set.delete('')
  return [...set]
}

/**
 * 字符 bigram 重叠系数（重叠系数, **不是** Jaccard）。
 *
 * 对齐已确认的实测结论: 短文本上 Jaccard 会系统性高估差异  一个 3 字追问与
 * 一个 30 字长帖的 Jaccard 天然很低, 但它们可能完全同话题。重叠系数除以
 * min(|A|,|B|) 才是"短文本是否被包含"的正确度量。
 */
export function bigrams(text: string): Set<string> {
  const t = text.replace(/\s+/gu, '')
  const out = new Set<string>()
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2))
  return out
}

export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const g of a) if (b.has(g)) hit++
  return hit / Math.min(a.size, b.size)
}

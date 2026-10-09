/**
 * 指代消解与楼层定位（L2）。
 *
 * 解决的问题: 论坛语义里的提问是**对话式**的  "楼主后来改口了吗"、"楼上说的那个
 * 方案"。脱离线程结构，这些指代无解；而通用搜索聚合器只有 query 字符串。
 *
 * 本模块的边界（刻意划清）:
 *  - 它做**结构性**工作: 把"楼主/楼上/他"解析到具体参与者与具体楼层，并取出原文。
 *  - 它**不**判断"到底改没改口"  那是语义判断，归上层 Agent。模块只保证
 *    "把该看的原文按时间顺序摆好，并给出可引用的出处"。
 *  这条边界对齐 argo 自己的立场: "判断稿、结论始终由 Agent 负责"。
 */

import { bigrams, overlapCoefficient } from './normalize.ts'
import type { Thread, Turn, Participant } from './types.ts'

/** 角色词表。命中即解析，不做模糊匹配  指代解析错了比解析不出来更糟。 */
const OP_WORDS = ['楼主', 'op', '原po', '原帖作者', '发帖人']
const REPLY_WORDS = ['楼上', '楼上那位', '上一位', '前一位']
const THIRD_PERSON = ['他', '她', 'ta', '这个人', '那个人', '该用户']

export interface ReferentTarget {
  /** 解析出的角色。`ambiguous` 表示有多个同样合理的候选  此时**不许**猜。 */
  role: 'op' | 'reply' | 'third-person'
  participantId?: string
  participantName?: string
  /** 该参与者在楼里的全部发言，按时间排序。 */
  turns: Turn[]
  /** 为什么这么解析（可审计）。 */
  reason: string
  confidence: number
}

export interface Resolution {
  question: string
  targets: ReferentTarget[]
  /** 指代不明确时的候选（例如没有游标定位的"楼上"）。有值即表示需要澄清。 */
  ambiguous: Array<{ token: string; candidates: Participant[]; reason: string }>
  /** 从提问里提取的话题词，用于在目标发言里做相关性排序。 */
  topic?: string
}

/**
 * 解析提问。`cursorTurnId` 是"当前正在读哪一楼"，只有它存在时"楼上"才有确定含义
 *  没有游标就说"楼上"是无解的，此时返回候选并标记 ambiguous，而不是随便挑一个。
 
 * .agents/notes/implemented/architecture/2026-09-18-cursor-multiturn-wired.md
 */
export function resolve(thread: Thread, question: string, cursorTurnId?: string): Resolution {
  const q = question.toLowerCase()
  const targets: ReferentTarget[] = []
  const ambiguous: Resolution['ambiguous'] = []

  const opTurnIds = new Set(thread.participants.filter(p => p.isOp).map(p => p.id))
  const turnsOf = (pid: string) => thread.turns.filter(t => t.author.id === pid)

  if (OP_WORDS.some(w => q.includes(w))) {
    const op = thread.participants.find(p => p.isOp)
    if (op !== undefined) {
      targets.push({
        role: 'op', participantId: op.id, participantName: op.name, turns: turnsOf(op.id),
        reason: '提问含楼主类角色词，且该线程有 isOp 标记的参与者', confidence: 1,
      })
    } else {
      // 没有 OP 标记: 用**首楼作者**兜底，并降置信度
      const first = thread.turns[0]
      if (first !== undefined) {
        targets.push({
          role: 'op', participantId: first.author.id, participantName: first.author.name,
          turns: turnsOf(first.author.id),
          reason: '提问含楼主类角色词，但线程无 isOp 标记；回退到首楼作者（结构上通常是 OP）',
          confidence: 0.6,
        })
      }
    }
  }

  if (REPLY_WORDS.some(w => q.includes(w))) {
    if (cursorTurnId === undefined) {
      // 无游标 → 无解。给出候选让人来定，不替人定。
      ambiguous.push({
        token: REPLY_WORDS.find(w => q.includes(w))!,
        candidates: thread.participants,
        reason: '「楼上」只在有阅读游标时才有确定含义；本次调用未提供 cursorTurnId',
      })
    } else {
      const idx = thread.turns.findIndex(t => t.id === cursorTurnId)
      const above = idx > 0 ? thread.turns[idx - 1] : undefined
      if (above !== undefined) {
        targets.push({
          role: 'reply', participantId: above.author.id, participantName: above.author.name,
          turns: turnsOf(above.author.id).filter(t => t.id !== above.id),
          reason: `游标在第 ${idx + 1} 楼，其上一楼作者为 ${above.author.name}`, confidence: 0.9,
        })
      }
    }
  }

  if (THIRD_PERSON.some(w => q.includes(w))) {
    // 第三人称: 取"最近被提到/被引用"的参与者  用引用入度而非出现顺序，
    // 因为被引用说明其发言是当前话题的中心。
    const indeg = new Map<string, number>()
    for (const t of thread.turns) {
      if (t.quotedTurnId === undefined) continue
      const src = thread.turns.find(x => x.id === t.quotedTurnId)
      if (src === undefined) continue
      indeg.set(src.author.id, (indeg.get(src.author.id) ?? 0) + 1)
    }
    const ranked = [...indeg.entries()].sort((a, b) => b[1] - a[1])
    const top = ranked[0]
    if (top !== undefined) {
      const p = thread.participants.find(x => x.id === top[0])
      if (p !== undefined) {
        targets.push({
          role: 'third-person', participantId: p.id, participantName: p.name, turns: turnsOf(p.id),
          reason: `第三人称指代；解析到被引用最多的参与者（引用入度 ${top[1]}）`,
          confidence: 0.7,
        })
      }
    }
  }

  const res: Resolution = { question, targets, ambiguous }
  /**
   * 全链路端到端验收  以及一次被实测否决的话题词修法
   * .agents/notes/implemented/architecture/2026-09-19-e2e-acceptance.md
   */
  const topic = extractTopic(question)
  if (topic !== undefined) res.topic = topic
  return res
}

/**
 * 从提问里剥掉角色词与疑问词，剩下的当话题词。
 *
 * ## **这个函数有一个已知缺陷，且两次修法都被实测否决**（2026-09-19 记）
 *
 * 缺陷: 最后一层是**逐字**替换（`的`/`说`/`吗` 是单字），于是
 * `楼上的说法对吗` 被拆成 `楼上 [空] [空] 法 [空] 对 [空]`，
 * **两个不相邻的残字被拼成一个词**  实测输出 `话题词: "法对"`。
 * 它既不是原词，也不是任何有意义的片段。
 *
 * **修法一（已否决）**: 改成**按原词边界**切分（`split(/\s+/)`）后再整词判停用词。
 * 实测: 中文提问**没有空格**，于是整句被当成**一个 token**，停用词表一个都不命中 
 * `话题词` 变成整句，`relevantFloors('楼上的说法对吗')` 从有值变成 **0**。
 * **那是净负面改动，已回滚。**
 *
 * **教训**: 中文的「词边界」不是空格。要么用真正的分词器（本组件有 `tokenize.ts`），
 * 要么保留逐字替换并接受它的碎片  **半吊子的「按词切」比原来的碎片更糟**。
 *
 * **为什么没有直接改用 `tokenize.ts`**: 那是**索引侧**的分词（词流 + CJK bigram），
 * 用它剥停用词会引入另一套口径，而 `resolve` 的 `topic` 只用于**排序**、
 * 不影响证据是否返回（见 `extractTopic 是提问动作时也不影响证据返回` 那条测试）。
 * **收益不足以为它换一套分词口径。**
 */
function extractTopic(question: string): string | undefined {
  const stripped = question
    .replace(/[?？。，,！!]/gu, ' ')
    .replace(new RegExp([...OP_WORDS, ...REPLY_WORDS, ...THIRD_PERSON].join('|'), 'giu'), ' ')
    .replace(/(后来|之后|有没有|是不是|怎么|如何|为什么|吗|呢|的|说|讲|提)/gu, ' ')
    .trim()
  return stripped.length >= 2 ? stripped : undefined
}

export interface Citation {
  turnId: string
  /** 原文字面引用  引用必须是原文，不许是归一化后的文本。 */
  quote: string
  timestamp?: number
  authorName: string
  /** 该楼在序列中的序号（1-based），回答"哪一楼"时必须给出。 */
  floor: number
}

export interface TargetDigest {
  target: ReferentTarget
  /** 按时间顺序的全部发言引用  这是"改口了吗"这类问题所需的原材料。 */
  citations: Citation[]
}

/**
 * 把解析结果整理成"可引用的原文序列"。
 *
 * 注意 ordering: 按**楼层顺序**而不是相关度排序  "后来改口了吗"这类问题
 * 问的是**随时间的变化**，打乱顺序会让变化不可见。
 */
export function digest(thread: Thread, resolution: Resolution): TargetDigest[] {
  return resolution.targets.map(target => ({
    target,
    citations: target.turns.map(t => {
      const c: Citation = {
        turnId: t.id,
        quote: t.text,                     // 原文，不是 normalizedText
        authorName: t.author.name,
        floor: thread.turns.findIndex(x => x.id === t.id) + 1,
      }
      if (t.timestamp !== undefined) c.timestamp = t.timestamp
      return c
    }),
  }))
}

/** 目标发言里与话题相关的那些  用于把长线程收窄到要看的几楼。 */
/**
 * 取出"该看的原文楼层"。
 *
 * ## 这里是**重排**，不是过滤（2026-09-16 实测纠正）
 *
 * 此前实现是 `all.filter(c => overlap(topic, quote) > 0)`  用话题做**硬过滤**。
 * 实测它把核心场景整个打死:
 *
 *   `resolve(thread, '楼主后来改口了吗')` → topic = **"改口了"**
 *   → 没有任何一楼含"改口了" → **relevantFloors 返回 0 条**
 *
 * 而"楼主后来改口了吗"**正是本项目第 (3) 项需求点名的判据**（§5.2 验收判据 1）。
 * 它失败的原因不是解析错了`楼主` 被正确解析到楼层 1 和 3而是**话题词提取
 * 把提问动作（"改口了"）当成了内容话题**，再拿它去筛证据。
 *
 * 根子上的错误是**用过滤表达相关性**：过滤会丢掉"不含该词但正是答案"的楼层，
 * 而这类问题问的是**随时间的变化**，答案往往恰恰不含问题里的字面词
 * （楼主改口后说的是"编译期约束"，不是"改口"）。
 *
 * 现在改为: 与话题有重叠的楼层**排在前面**，无重叠的**保留在后面**。
 * 排序不改变集合，因此不会因为一次错误的话题提取而丢掉证据。
 
 * .agents/notes/implemented/architecture/2026-09-17-filtering-is-not-relevance.md
 */
export function relevantFloors(thread: Thread, resolution: Resolution): Citation[] {
  const topic = resolution.topic
  const all = digest(thread, resolution).flatMap(d => d.citations)
  if (topic === undefined) return all
  const tg = bigrams(topic)
  const score = (c: Citation) => overlapCoefficient(tg, bigrams(c.quote))
  // 稳定排序: 同分保持楼层顺序（原顺序表达"随时间的变化"，不能被排序打乱）
  return [...all].sort((a, b) => score(b) - score(a))
}

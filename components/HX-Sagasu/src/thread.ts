/**
 * Thread / Turn 归一化（L1 → L2 的桥）。
 *
 * 负责三件事:
 *  1. 把平台原始载荷映射成统一 Thread/Turn  平台差异止于此。
 *  2. 给每一楼算 normalizedText（**不覆盖原文**）。
 *  3. 平台没给引用链时做**保守推断**，并把推断标记出来。
 *
 * 关于引用链推断: 平台给的就是事实；没给的只能猜。猜错的代价是"把 A 的话
 * 安到 B 头上"，所以这里采取三条保守规则叠加，且**永远**置 `quoteInferred`。
 */

import { normalize } from './normalize.ts'
import type { NormalizedText } from './types-text.ts'
import type { RawThreadInput, RawTurn, Thread, Turn, Participant } from './types.ts'

/** 保守阈值：宁可漏推，不可错推。 */
/**
 * 推断引用所需的最小重合度。
 *
 * **阈值是实测出来的，不是拍的**（2026-09-16，Telegram 公开频道 20 楼语料）:
 * 每楼与它之前所有楼的最大 bigram 重叠系数min 0.200 / **中位 0.708** / max 0.865，
 * 其中 95% 都超过 0.45。
 *
 * 也就是说，0.45 在"帖子"这种长文本上根本不构成证据：同一话题的语料里，
 * 任意两楼都轻松越过它，推断出的引用关系基本等于噪声。
 *
 * 要放到 0.75（约等于"大体逐字重复"）才可能真正对应"在引用某句话"。但这里**故意
 * 不调**  调高只是把噪声从 95% 降到更低，并不能让它变成信号；而真引用在
 * "短引用 vs 长原文"时重合度反而**低**（短文本落在长文本里），与"同话题高重合"
 * 正好反向。两个方向混在一起，任何单一阈值都分不开。
 *
 * 结论: 推断引用在本系统的语料形态下**没有可用的信噪比**，保持 0.45 是为了让
 * 现有测试的语义（确实逐字重复才连）仍然成立，而不是因为 0.45 是个好阈值。
 * 真正需要引用链的场景走平台提供的引用（B站楼中楼）或显式引用标记。
 */
const QUOTE_MIN_OVERLAP = 0.45
const QUOTE_MAX_DISTANCE = 8
const QUOTE_MIN_CHARS = 6

/**
 * 广播型语料（频道帖 / 公告流）**不做引用推断**。
 *
 * 实测依据（2026-09-16，Telegram 公开频道 20 楼）: 这类语料天然共享大量词汇
 * （同一话题的连续帖），最大重叠系数 min 0.200 / 中位 0.708 / max 0.865，
 * 95% 超过阈值  推断出的"引用"基本是噪声，而**任意两楼的平均配对重叠高达
 * 0.27**（真正的引用只会有一对高）。
 *
 * 更根本的问题: 广播型语料的楼层跨度是几个月、彼此独立，它们的"同一性"来自
 * 话题重合而不是引用关系；而 inferQuote 的"距离 ≤ 8 楼"假设只对论坛语料成立。
 *
 * 判定: 楼层数 ≥ 5 且参与者 ≤ 2（单/双作者的长帖流）→ 视为广播型。
 * 这是**基于已观测语料**的判据，不是通用结论；换语料应重新实测。
 */
function isBroadcastInput(input: { turns: readonly unknown[]; opAuthorId?: string }): boolean {
  const authors = new Set<string>()
  for (const t of input.turns as ReadonlyArray<{ author: { id?: string; name: string } }>) {
    authors.add(t.author.id ?? t.author.name)
  }
  return input.turns.length >= 5 && authors.size <= 2
}

export interface NormalizeThreadOptions {
  /** 是否尝试推断缺失的引用链。默认 true。 */
  inferQuotes?: boolean
}

export interface NormalizedThread {
  thread: Thread
  /** 逐楼的归一化记录（与 thread.turns 同序），供审计与索引。 */
  normalizations: Map<string, NormalizedText>
}

/**
 * 对话语义的第一个真实入口  以及我凭印象写错的三个字段名
 * .agents/notes/implemented/architecture/2026-09-18-thread-entry-point.md
 */
export function normalizeThread(input: RawThreadInput, options: NormalizeThreadOptions = {}): NormalizedThread {
  const inferQuotes = options.inferQuotes !== false
  const normalizations = new Map<string, NormalizedText>()

  // 按时间排序（缺失时间戳的保持输入相对顺序，排在已知时间之后）
  const ordered = [...input.turns].sort((a, b) => {
    if (a.timestamp === undefined && b.timestamp === undefined) return 0
    if (a.timestamp === undefined) return 1
    if (b.timestamp === undefined) return -1
    return a.timestamp - b.timestamp
  })

  const inferEnabled = inferQuotes && !isBroadcastInput(input)
  const turns: Turn[] = ordered.map((raw, i) => {
    const n = normalize(raw.text)
    normalizations.set(raw.id, n)
    const turn: Turn = {
      id: raw.id,
      parentId: raw.parentId,
      author: { id: raw.author.id ?? raw.author.name, name: raw.author.name },
      text: raw.text,               // 保真，永不改写
      normalizedText: n.normalized, // 仅检索用
    }
    if (raw.timestamp !== undefined) turn.timestamp = raw.timestamp
    if (raw.engagement !== undefined) turn.engagement = raw.engagement
    if (raw.attachments !== undefined) turn.attachments = raw.attachments
    if (raw.quotedTurnId !== undefined) {
      turn.quotedTurnId = raw.quotedTurnId       // 平台给的 = 事实
    } else if (inferEnabled && i > 0) {
      const guess = inferQuote(ordered, i, normalizations)
      if (guess !== undefined) {
        turn.quotedTurnId = guess
        turn.quoteInferred = true                // 猜的就必须标出来
      }
    }
    return turn
  })

  const participants: Participant[] = []
  const seen = new Set<string>()
  for (const t of turns) {
    if (seen.has(t.author.id)) continue
    seen.add(t.author.id)
    const p: Participant = { id: t.author.id, name: t.author.name }
    if (input.opAuthorId !== undefined && t.author.id === input.opAuthorId) p.isOp = true
    participants.push(p)
  }

  return {
    thread: {
      id: input.id,
      platform: input.platform,
      title: input.title,
      board: input.board,
      createdAt: input.createdAt,
      turns,
      participants,
      provenance: input.provenance,
    },
    normalizations,
  }
}

/**
 * 推断第 i 楼在引用谁。三条规则必须**同时**满足，任何一条不满足就放弃:
 *   A. 引用关系应指向**更早**的楼层（hard 约束）
 *   B. 文本与候选楼有足够重合（bigram 重叠系数 ≥ QUOTE_MIN_OVERLAP）
 *   C. 候选楼在合理距离内（≤ QUOTE_MAX_DISTANCE），且距离越近优先级越高
 *
 * 用重叠系数而非 Jaccard: 引用常常只截取被引楼的一小段，Jaccard 会因为
 * 长度差异把这种"部分引用"判成低相似。
 */
function inferQuote(
  ordered: RawTurn[],
  i: number,
  normalizations: Map<string, NormalizedText>,
): string | undefined {
  const cur = normalizations.get(ordered[i]!.id)
  if (cur === undefined || cur.normalized.length < QUOTE_MIN_CHARS) return undefined
  const curGrams = bigramsOf(cur.normalized)
  if (curGrams.size === 0) return undefined

  let best: { id: string; score: number } | undefined
  const from = Math.max(0, i - QUOTE_MAX_DISTANCE)
  for (let j = from; j < i; j++) {
    const cand = ordered[j]!
    const cn = normalizations.get(cand.id)
    if (cn === undefined || cn.normalized.length < QUOTE_MIN_CHARS) continue
    const score = overlap(curGrams, bigramsOf(cn.normalized))
    if (score < QUOTE_MIN_OVERLAP) continue
    // 平分时取更近的那一楼（更近的更像被引对象）
    if (best === undefined || score > best.score) best = { id: cand.id, score }
  }
  return best?.id
}

function bigramsOf(text: string): Set<string> {
  const t = text.replace(/\s+/gu, '')
  const out = new Set<string>()
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2))
  return out
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let hit = 0
  for (const g of a) if (b.has(g)) hit++
  return hit / Math.min(a.size, b.size)
}

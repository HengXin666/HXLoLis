/**
 * Evidence Ledger  沉淀层的第一层: **真相**。
 *
 * 分层（对齐已确认规则「派生索引必须可全量重建，带版本身份，不符即重建」）:
 *   Raw run 归档（argo --archive，已有）→ 不可变快照，审计用
 *   Evidence Ledger（本文件）          → 只追加的证据卡，内容寻址，**真相**
 *   Derived Index（index-store.ts）    → 可丢可重建的派生品
 *
 * Ledger 的三条不可退让的性质:
 *  1. **只追加**。同 id 写入是 no-op，不是覆盖。要改内容只能作为新卡追加  已发布的
 *     引用必须永远指向同一段原文，否则引用链断裂。
 *  2. **内容寻址**。id = sha256(规范化后的身份字段)，所以同一张卡在两个数据源里
 *     天然同 id，去重不需要额外状态。
 *  3. **可 JSONL 序列化**。落盘格式是每行一张卡的 JSONL，可 diff、可 grep、可手工
 *     审计  不引入不可读的二进制格式。
 */

import { createHash } from 'node:crypto'
import type { PlatformId, Provenance } from './types.ts'

export interface EvidenceCard {
  /** 内容寻址: sha256(platform|threadId|turnId|quote)。同内容必然同 id。
   *  刻意**不含** retrievedAt/fetchedBy  同一段原文被两个 agent 各抓一次仍是同一张卡。 */
  id: string
  platform: PlatformId
  threadId: string
  /** 指向具体某一楼，不是整帖。 */
  turnId: string
  /** 原文字面引用。**不是**归一化后的文本  证据必须能在源站核对得上。 */
  quote: string
  /** 分层召回里的层级（0=权威平台, 1=垂直社区, 2=通用搜索引擎）。 */
  sourceTier: 0 | 1 | 2
  provenance: Provenance
  retrievedAt: number
  /** 抓取者标识（哪个 agent/会话）。审计用。 */
  fetchedBy?: string
  /** 所属 issue 视角；同一张卡可以服务多个视角，但主视角只有一个。 */
  lensId?: string
}

/** 卡的**身份字段**。改这里会改变所有卡的 id，等于让整个 Ledger 失忆  不要改。 */
export interface CardIdentity {
  platform: PlatformId
  threadId: string
  turnId: string
  quote: string
}

function norm(s: string): string {
  return s.normalize('NFKC').trim()
}

export function cardId(identity: CardIdentity): string {
  const payload = [identity.platform, identity.threadId, identity.turnId, norm(identity.quote)].join('\u0000')
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/** 去重键：与 id 同源，暴露出来是为了让调用方能在构造整张卡之前判重。 */
export function dedupeKey(identity: CardIdentity): string {
  return cardId(identity)
}

export interface AppendResult {
  card: EvidenceCard
  /** true = 本次真的写入了；false = 同 id 已存在（no-op，不是覆盖）。 */
  appended: boolean
}

/**
 * 只追加的 Ledger。内存实现是**规范**，落盘只是它的序列化 
 * 因此文件加载与内存追加走同一套不变量（见 openLedger）。
 */
export class EvidenceLedger {
  private readonly cards = new Map<string, EvidenceCard>()

  /** 追加一张卡。同 id 是 no-op  **不覆盖**。 */
  append(card: EvidenceCard): AppendResult {
    const existing = this.cards.get(card.id)
    if (existing !== undefined) return { card: existing, appended: false }
    this.cards.set(card.id, card)
    return { card, appended: true }
  }

  /** 从身份字段构造并追加。id 由身份算出，调用方不需要自己算。 */
  appendByIdentity(
    identity: CardIdentity,
    meta: Omit<EvidenceCard, 'id' | keyof CardIdentity>,
  ): AppendResult {
    return this.append({ id: cardId(identity), ...identity, quote: norm(identity.quote), ...meta })
  }

  get(id: string): EvidenceCard | undefined {
    return this.cards.get(id)
  }

  has(id: string): boolean {
    return this.cards.has(id)
  }

  /** 全部卡，按 id 排序  排序保证序列化结果稳定（sourceDigest 依赖这个）。 */
  all(): EvidenceCard[] {
    return [...this.cards.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  get size(): number {
    return this.cards.size
  }

  filterByLens(lensId: string): EvidenceCard[] {
    return this.all().filter(c => c.lensId === lensId)
  }

  filterByTier(tier: 0 | 1 | 2): EvidenceCard[] {
    return this.all().filter(c => c.sourceTier === tier)
  }

  toJSONL(): string {
    return this.all().map(c => JSON.stringify(c)).join('\n')
  }
}

/** 从 JSONL 打开。**坏行不吞**  静默跳过坏行等于悄悄丢证据。 */
export function openLedger(jsonl: string): EvidenceLedger {
  const ledger = new EvidenceLedger()
  const lines = jsonl.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line === '') continue
    let card: EvidenceCard
    try {
      card = JSON.parse(line) as EvidenceCard
    } catch (err) {
      throw new Error(`Evidence Ledger 第 ${i + 1} 行不是合法 JSON: ${(err as Error).message}`)
    }
    // 结构自校验: JSON 合法不等于卡片合法  缺字段的卡必须在**这里**被抓住,
    // 否则它会带着 undefined 一路流到引用/索引, 在那里以更难定位的方式炸。
    for (const f of ['id', 'platform', 'threadId', 'turnId', 'quote'] as const) {
      if (typeof (card as Record<string, unknown>)[f] !== 'string') {
        throw new Error(`Evidence Ledger 第 ${i + 1} 行缺字段或类型不对: ${f}`)
      }
    }
    // 内容寻址自校验: 落盘后被人手改过 quote 会被这里抓住
    const expect = cardId({ platform: card.platform, threadId: card.threadId, turnId: card.turnId, quote: card.quote })
    if (expect !== card.id) {
      throw new Error(`Evidence Ledger 第 ${i + 1} 行 id 与内容不符（内容被改过？）: 期望 ${expect}, 实际 ${card.id}`)
    }
    ledger.append(card)
  }
  return ledger
}

/**
 * 从 Thread 生成证据卡。
 *
 * 只对**指定楼层**建卡，不是整帖  证据卡指向具体某一楼，这样引用才能落到原文。
 */
export function cardsFromThread(
  thread: { id: string; platform: PlatformId; provenance: Provenance },
  turns: Array<{ id: string; text: string }>,
  opts: { sourceTier: 0 | 1 | 2; fetchedBy?: string; lensId?: string; retrievedAt?: number },
): EvidenceCard[] {
  /**
   * 沉淀层以「只追加账本 + 可全量重建索引」为唯一形态
   * .agents/notes/implemented/architecture/2026-09-16-sediment-append-only-ledger.md
   */
  const retrievedAt = opts.retrievedAt ?? Date.now()
  return turns.map(t => {
    const identity: CardIdentity = {
      platform: thread.platform,
      threadId: thread.id,
      turnId: t.id,
      quote: t.text,
    }
    const card: EvidenceCard = {
      id: cardId(identity),
      ...identity,
      quote: norm(t.text),
      sourceTier: opts.sourceTier,
      provenance: thread.provenance,
      retrievedAt,
    }
    if (opts.fetchedBy !== undefined) card.fetchedBy = opts.fetchedBy
    if (opts.lensId !== undefined) card.lensId = opts.lensId
    return card
  })
}

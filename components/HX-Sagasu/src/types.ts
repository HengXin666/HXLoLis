/**
 * HX-Sagasu 核心类型  L1 归一化层的产出契约。
 *
 * 设计铁律（写进类型注释，因为这几条最容易被后来的"顺手简化"掉）:
 *  1. `Turn.text` 是**证据**，`Turn.normalizedText` 是**索引**。两者绝不互相覆盖 
 *     证据被归一化后再引用就不可核查了。
 *  2. 推断出来的链接必须带 `inferred` 标记。系统可以猜，但不许把猜测冒充事实。
 *  3. 平台差异止于本层：L2 以上只看见这些类型。
 */

export type PlatformId =
  | 'x' | 'xiaohongshu' | 'heybox' | 'tieba' | 'bilibili' | 'youtube'
  | 'telegram' | 'discord' | 'zhihu' | 'weibo' | 'v2ex'
  | 'hackernews' | 'reddit' | 'web'

/** 内容怎么拿到的  决定它该被赋多高的信任度，也是合规审计的凭据。 */
export type Provenance =
  | { kind: 'api'; endpoint: string }
  | { kind: 'browser'; session: 'user-own' | 'anonymous'; url: string }
  | { kind: 'third_party'; vendor: string }
  | { kind: 'metasearch'; engine: string }

export interface Participant {
  id: string
  name: string
  isOp?: boolean
}

export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'link'
  url: string
}

export interface Engagement {
  likes?: number
  replies?: number
  views?: number
  shares?: number
}

/**
 * 对话语义层以「原文保真 + 推断必标记」为不可退让的契约
 * .agents/notes/implemented/architecture/2026-09-16-conversation-semantics-contract.md
 */
export interface Turn {
  id: string
  /** 回复树；顶层帖为 undefined。 */
  parentId?: string
  /** 引用链。平台提供就是事实，推断出来就必须同时置 `quoteInferred`。 */
  quotedTurnId?: string
  quoteInferred?: boolean
  author: Participant
  /** 原文，保真，永不改写。 */
  text: string
  /** 归一化后（仅检索用）。等于 text 表示无需归一。 */
  normalizedText: string
  timestamp?: number
  engagement?: Engagement
  attachments?: Attachment[]
}

export interface Thread {
  id: string
  platform: PlatformId
  title?: string
  board?: string
  createdAt: number
  turns: Turn[]
  participants: Participant[]
  provenance: Provenance
}

/** 各平台原始载荷的最小公共形状；适配器负责把平台字段映射到这里。 */
export interface RawTurn {
  id: string
  parentId?: string
  quotedTurnId?: string
  author: { id?: string; name: string }
  text: string
  timestamp?: number
  engagement?: Engagement
  attachments?: Attachment[]
}

export interface RawThreadInput {
  id: string
  platform: PlatformId
  title?: string
  board?: string
  createdAt: number
  opAuthorId?: string
  provenance: Provenance
  turns: RawTurn[]
}

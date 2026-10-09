/**
 * Telegram 公开频道适配器（L0）。
 *
 * **能力边界（写死在类型与注释里，防止以后被"顺手放宽"）**: 只读**公开频道**的
 * 网页预览（`t.me/s/<channel>`）。私聊、私密群、需要登录的频道一律不做 
 * 那需要 MTProto 用户会话，属于凭证边界之外。
 *
 * 数据路径（2026-09-16 实测）: `https://t.me/s/<channel>` 返回服务端渲染的 HTML，
 * 每条消息在 `[data-post]` 块里，正文在 `.tgme_widget_message_text`，
 * 时间为 `datetime` 属性。**无需登录、无需 API key。**
 *
 * ## 搜索能力: 频道内搜索**存在**，全站搜索**不存在**（2026-09-16 实测更正）
 *
 * 本文件此前把 `search` 写死为 `false`，理由是"公开频道页没有搜索能力"。
 * 那个理由是**未实测的假设，而且是错的**。实测:
 *
 *   `t.me/s/durov?q=telegram`        → 200，20 条，**20/20 正文都含 telegram**
 *   `t.me/s/durov?q=cryptocurrency`  → 200，6 条（其中 3 条正文含该词）
 *   `t.me/s/durov?q=zzzznotfoundterm`→ 200，**0 条**
 *   `t.me/s/durov`（不带 q）          → 200，20 条，post id 与带 q 的**不同**
 *
 * `?` 确实是**服务端过滤**，不是"忽略参数返回全部"。但它的边界必须写清:
 *
 * - **只有频道内搜索**: 必须先有频道名。`t.me/s/?q=` 返回 302，`t.me/search?q=` 是空壳
 *   （9583 字节、0 条消息） **没有全站搜索**。
 * - 因此 `search()` 的查询语法必须是 `<频道名> <关键词>`: 不支持纯关键词跨频道搜索。
 *   这不是能力缺陷的掩饰，而是**把平台真实的边界如实暴露给调用方**。
 * - 0 条命中仍保留 widget 结构（18710 字节、含 `tgme_widget_message`），
 *   与"频道不存在"（9743 字节、含 `tgme_page_icon`）**可区分**  所以
 *   "搜了、真的没有"能诚实地返回 `[]`，而"频道不存在"必须抛错。
 *
 * 依赖: 用正则解析 HTML。Telegram 这个页面结构多年稳定（它同时是搜索引擎的抓取面），
 * 但正则解析终究是脆的  一旦结构变化，`parse` 类错误会**响亮抛出**而不是静默
 * 返回空（见 adapter.ts 的失败契约）。
 */

import { adapterError, type AdapterContext, type SearchHit, type ThreadAdapter } from './adapter.ts'
import type { PlatformId, RawThreadInput, RawTurn } from '../types.ts'

const BASE = 'https://t.me'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'

export interface TgFetcher {
  (url: string): Promise<{ ok: boolean; status: number; text(): Promise<string> }>
}

export const realFetch: TgFetcher = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  return { ok: res.ok, status: res.status, text: () => res.text() }
}

/**
 * 去除 HTML 标签并还原常见实体。Telegram 的正文是嵌套 HTML（含 <br>、<a>、加粗、
 * <tg-emoji>）。标题/正文里带表情与内联格式，不清理就无法作为证据引用。
 */
export function stripHtml(html: string): string {
  const stripped = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

  // 截断的 HTML 会留下未闭合的尾部标签残片（"…文字<tg-emoji emoji-id=\"1\""）。
  // 我们会对超长正文做截断，所以这不是假想情况  残片混进正文就会成为"证据"。
  const lastOpen = stripped.lastIndexOf('<')
  const cleaned = lastOpen !== -1 && stripped.indexOf('>', lastOpen) === -1
    ? stripped.slice(0, lastOpen)
    : stripped

  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

export interface ParsedTgMessage {
  /** "channel/123" 形式，平台内稳定 id。 */
  post: string
  datetime?: string
  text: string
}

/**
 * 解析公开频道页面。
 *
 * **必须区分两种情况**（这是与 argo 那套"吞成空"最重要的差别）:
 *   - 页面是频道但**没有消息** → 返回 []
 *   - 页面**不是频道页**（404 / 被限制）→ 抛错
 * 只看"有没有消息"是分不清这两者的。
 */
export function parseChannelPage(html: string, channel: string): ParsedTgMessage[] {
  if (!/tgme_widget_message|tgme_channel_info/.test(html)) {
    if (/tgme_page_icon|tgme_page_title/.test(html)) {
      // 是 Telegram 的"频道/用户不存在"页面
      throw adapterError('telegram', 'api', `频道 @${channel} 不存在或不可公开访问`)
    }
    throw adapterError('telegram', 'parse', `页面不含预期结构，Telegram 可能改了 HTML（频道 @${channel}）`)
  }
  const out: ParsedTgMessage[] = []
  const blocks = html.split('data-post="').slice(1)
  for (const block of blocks) {
    const post = block.slice(0, block.indexOf('"'))
    const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block)
    if (textMatch === null) continue
    const dt = /datetime="([^"]+)"/.exec(block)
    const msg: ParsedTgMessage = { post, text: stripHtml(textMatch[1] ?? '') }
    if (dt !== null) msg.datetime = dt[1]
    out.push(msg)
  }
  return out
}

export interface TelegramAdapterOptions {
  fetch?: TgFetcher
  maxTurns?: number
}

/**
 * 能力声明必须指向实测  Telegram 搜索与第 1、2 层的实现归属
 * .agents/notes/implemented/architecture/2026-09-16-capability-claims-need-evidence.md
 */
export function makeTelegramAdapter(options: TelegramAdapterOptions = {}): ThreadAdapter {
  const doFetch = options.fetch ?? realFetch
  const maxTurns = options.maxTurns ?? 50
  const platform: PlatformId = 'telegram'

  async function page(channel: string): Promise<string> {
    let res
    try {
      res = await doFetch(`${BASE}/s/${encodeURIComponent(channel)}`)
    } catch (err) {
      throw adapterError(platform, 'network', `频道 @${channel} 请求失败: ${(err as Error).message}`)
    }
    if (res.status === 404) throw adapterError(platform, 'api', `频道 @${channel} 不存在`)
    if (!res.ok) throw adapterError(platform, 'http', `频道 @${channel} HTTP ${res.status}`)
    return res.text()
  }

  function toThread(channel: string, messages: ParsedTgMessage[]): RawThreadInput {
    // 频道帖子无回复树 → 每层都是顶层，时间戳来自 datetime
    const turns: RawTurn[] = messages.slice(0, maxTurns).map(m => {
      const t: RawTurn = {
        id: m.post,
        author: { id: channel, name: channel },
        text: m.text,
      }
      if (m.datetime !== undefined) t.timestamp = Date.parse(m.datetime)
      return t
    })
    return {
      id: channel,
      platform,
      title: channel,
      createdAt: turns[0]?.timestamp ?? Date.now(),
      provenance: { kind: 'browser', session: 'anonymous', url: `${BASE}/s/${channel}` },
      turns,
    }
  }

  /**
   * 把 `<频道名> <关键词>` 拆成两段。
   *
   * 为什么必须带频道名: Telegram 只有**频道内**搜索（见文件头）。这个语法不是
   * 我们发明的抽象，而是平台边界的直接映射  调用方写 `durov telegram`，
   * 拿到的是 durov 频道里含 telegram 的帖子。
   */
  function splitScopeQuery(raw: string): { channel: string; keyword: string } {
    // 频道名按 **Telegram 自己的规则** 收: 5-32 字符、只含字母数字下划线。
    // 这个长度下限不是凑出来的  它正是"Rust 所有权"能被正确拒绝的原因:
    // 用 {4,} 时 `Rust` 会被当成频道名，于是纯关键词查询被静默接受，
    // 再去请求一个不存在的频道。**用平台的真实约束做校验，别用宽松的近似**。
    const m = /^\s*(?:@|https?:\/\/t\.me\/s\/|t\.me\/s\/)?([A-Za-z0-9_]{5,32})\s+([\s\S]+)$/.exec(raw)
    if (m === null) {
      throw adapterError(
        platform,
        'unsupported',
        `Telegram 只有频道内搜索，查询必须写成「<频道名> <关键词>」。收到: ${JSON.stringify(raw.slice(0, 60))}。` +
          '纯关键词的跨频道搜索在 Telegram 网页面上不存在（t.me/s/?q= 返回 302）',
      )
    }
    return { channel: m[1]!, keyword: m[2]!.trim() }
  }

  return {
    platform,
    // `searchScope: 'channel'` **不是**可选的元数据  它让召回层能在调用**之前**
    // 判断"这次查询用得上它吗"。没有它，裸查询会让这个来源每次召回都报一次失败，
    // 而 failures 的语义是"哪里坏了"。不适用与失败必须分开。
    capabilities: { search: true, searchScope: 'channel', thread: true, requiresAuth: false, politeHeaders: false },

    async search(query: string, ctx: AdapterContext): Promise<SearchHit[]> {
      const { channel, keyword } = splitScopeQuery(query)
      const url = `${BASE}/s/${encodeURIComponent(channel)}?q=${encodeURIComponent(keyword)}`
      let res
      try {
        res = await doFetch(url)
      } catch (err) {
        throw adapterError(platform, 'network', `频道 @${channel} 搜索请求失败: ${(err as Error).message}`)
      }
      if (res.status === 404) throw adapterError(platform, 'api', `频道 @${channel} 不存在`)
      if (!res.ok) throw adapterError(platform, 'http', `频道 @${channel} 搜索 HTTP ${res.status}`)
      const messages = parseChannelPage(await res.text(), channel)
      const limit = ctx.limit ?? 20
      // 每条消息本身就是一条命中: 频道帖没有"标题"，用正文首行做标题
      return messages.slice(0, limit).map(m => ({
        platform,
        id: m.post,
        title: m.text.split('\n')[0]!.slice(0, 120),
        url: `${BASE}/${m.post}`,
        ...(m.datetime !== undefined ? { createdAt: Date.parse(m.datetime) } : {}),
      }))
    },

    async thread(ref: string, _ctx: AdapterContext): Promise<RawThreadInput> {
      const channel = ref.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '').replace(/\/.*$/, '')
      if (channel === '') throw adapterError(platform, 'api', '频道名不能为空')
      return toThread(channel, parseChannelPage(await page(channel), channel))
    },
  }
}

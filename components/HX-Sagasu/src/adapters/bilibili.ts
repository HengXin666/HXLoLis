/**
 * B站 适配器（L0）。
 *
 * 为什么先做它: B站 是八个目标平台里**唯一**已实测可用的（其余 7 个要么返回 0 要么
 * 根本没有引擎）。argo 只给视频元数据，而 HX-Sagasu 要的是**评论区的对话现场** 
 * 那才是"对话式（论坛）语义"在 B站 的具体形态。
 *
 * 数据路径（2026-09-16 实测）:
 *   - 搜索: `/x/web-interface/search/all/v2`（**不是** `search/type`，后者 412）
 *   - 详情: `/x/web-interface/view`，bvid → aid
 *   - 评论: `/x/v2/reply`，返回**两层**结构：顶层评论 + 楼中楼 `replies`
 *
 * 反爬现实: 实测 `search/type` 直连 412，`all/v2` + 桌面 UA + Referer 可用。
 * 因此 UA/Referer 是**必需参数**不是装饰；失败必须抛错，不许返回 [] 让调用方
 * 以为"这个视频没有评论"。
 */

import { adapterError, type AdapterContext, type ThreadAdapter } from './adapter.ts'
import type { PlatformId, RawThreadInput, RawTurn } from '../types.ts'

const API = 'https://api.bilibili.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

export interface BiliReply {
  rpid: number | string
  mid: number | string
  root?: number | string
  parent?: number | string
  ctime?: number
  like?: number
  rcount?: number
  content?: { message?: string }
  member?: { uname?: string }
  replies?: BiliReply[]
}

export interface FetchedResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type BiliFetcher = (url: string) => Promise<FetchedResponse>

/** 生产实现：带桌面 UA + Referer（实测不带会被风控 412）。 */
export const realFetch: BiliFetcher = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com' } })
  return { ok: res.ok, status: res.status, json: () => res.json() }
}

/**
 * 把 B站 的两层评论展平成 Turn[]。
 *
 * 楼中楼是关键: `parent` 指向楼内被回复的那条，`root` 指向顶层。
 * 平台给了就**直接当事实**（不置 quoteInferred） 这正是 L2 需要的引用链，
 * 而且比任何推断都可靠。
 */
export function flattenReplies(replies: readonly BiliReply[], expandNested: boolean): RawTurn[] {
  const out: RawTurn[] = []
  for (const top of replies) {
    const topId = `r${String(top.rpid)}`
    const topTurn: RawTurn = {
      id: topId,
      author: { id: `u${String(top.mid)}`, name: top.member?.uname ?? '匿名' },
      text: top.content?.message ?? '',
    }
    if (top.ctime !== undefined) topTurn.timestamp = top.ctime * 1000
    if (top.like !== undefined) topTurn.engagement = { likes: top.like }
    out.push(topTurn)

    if (!expandNested) continue
    for (const sub of top.replies ?? []) {
      const parentRaw = sub.parent === undefined ? '0' : String(sub.parent)
      const subTurn: RawTurn = {
        id: `r${String(sub.rpid)}`,
        parentId: topId,
        // 平台给的引用关系 = 事实；parent=0 表示直接回复顶层
        quotedTurnId: parentRaw === '0' ? topId : `r${parentRaw}`,
        author: { id: `u${String(sub.mid)}`, name: sub.member?.uname ?? '匿名' },
        text: sub.content?.message ?? '',
      }
      if (sub.ctime !== undefined) subTurn.timestamp = sub.ctime * 1000
      out.push(subTurn)
    }
  }
  return out
}

export interface BilibiliAdapterOptions {
  fetch?: BiliFetcher
  /** 最多取多少楼（顶层 + 楼中楼共用一个上限）。 */
  maxTurns?: number
  /** 是否展开楼中楼。默认 true  对话就发生在那里。 */
  expandNested?: boolean
}

export function makeBilibiliAdapter(options: BilibiliAdapterOptions = {}): ThreadAdapter {
  const doFetch = options.fetch ?? realFetch
  const maxTurns = options.maxTurns ?? 50
  const expandNested = options.expandNested !== false
  const platform: PlatformId = 'bilibili'

  async function getJson(url: string, what: string): Promise<Record<string, unknown>> {
    /**
     * B站相关视频能力 + 平台可达性复核
     * .agents/notes/implemented/architecture/2026-09-19-bilibili-related.md
     */
    let res: FetchedResponse
    try {
      res = await doFetch(url)
    } catch (err) {
      throw adapterError(platform, 'network', `${what} 请求失败: ${(err as Error).message}`)
    }
    if (!res.ok) throw adapterError(platform, 'http', `${what} HTTP ${res.status}`)
    let body: { code?: number; message?: string }
    try {
      body = (await res.json()) as { code?: number; message?: string }
    } catch (err) {
      throw adapterError(platform, 'parse', `${what} 响应不是 JSON: ${(err as Error).message}`)
    }
    if (body.code !== undefined && body.code !== 0) {
      // -412 / -352 是 B站 的风控码
      const kind = body.code === -412 || body.code === -352 ? 'blocked' : 'api'
      throw adapterError(platform, kind, `${what} 返回 code=${body.code}: ${body.message ?? ''}`)
    }
    return body as Record<string, unknown>
  }

  async function resolveAid(bvid: string): Promise<string> {
    const body = await getJson(`${API}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, '视频详情')
    const data = body.data as { aid?: number } | undefined
    if (data?.aid === undefined) throw adapterError(platform, 'api', `无法解析 bvid=${bvid} 的 aid`)
    return String(data.aid)
  }

  return {
    platform,
    capabilities: { search: true, thread: true, requiresAuth: false, politeHeaders: true },

    async search(query, ctx: AdapterContext) {
      const limit = ctx.limit ?? 5
      const url = `${API}/x/web-interface/search/all/v2?keyword=${encodeURIComponent(query)}&page=1&pagesize=${limit}`
      const body = await getJson(url, '搜索')
      const data = body.data as
        | { result?: Array<{ result_type?: string; data?: Array<Record<string, unknown>> }> }
        | undefined
      const videos = data?.result?.find(r => r.result_type === 'video')?.data ?? []
      return videos.slice(0, limit).map(v => {
        const hit = {
          platform,
          id: String(v.bvid ?? ''),
          title: String(v.title ?? '').replace(/<[^>]+>/g, ''),
          url: `https://www.bilibili.com/video/${String(v.bvid ?? '')}`,
        }
        return v.pubdate !== undefined ? { ...hit, createdAt: Number(v.pubdate) * 1000 } : hit
      })
    },

    async thread(ref: string, _ctx: AdapterContext): Promise<RawThreadInput> {
      const aid = /^\d+$/.test(ref) ? ref : await resolveAid(ref)
      const ps = Math.min(maxTurns, 20)
      const body = await getJson(`${API}/x/v2/reply?type=1&oid=${aid}&pn=1&ps=${ps}&sort=2`, '评论')
      const data = body.data as { replies?: BiliReply[] } | undefined
      const turns = flattenReplies(data?.replies ?? [], expandNested).slice(0, maxTurns)
      const input: RawThreadInput = {
        id: ref,                        // bvid 作为线程身份（用户可见、稳定）
        platform,
        createdAt: turns[0]?.timestamp ?? Date.now(),
        provenance: { kind: 'api', endpoint: `${API}/x/v2/reply` },
        turns,
      }
      const op = turns[0]?.author.id
      if (op !== undefined) input.opAuthorId = op
      return input
    },
  }
}

export interface RelatedVideo {
  bvid: string
  title: string
  author: string
}

/**
 * **相关视频**（2026-09-19 实测加）。
 *
 * 实测: `x/web-interface/archive/related?bvid=` 返回 **40 条**含 bvid/标题/UP主，
 * 无需鉴权、无需 wbi 签名（对照: `x/space/wbi/arc/search` 返回 `code=-403`  wbi 签名墙）。
 *
 * **为什么值得单列而不是混进 search**：相关推荐反映的是**这条视频在 B站的语境**
 * （同题材、同 UP、算法认为相关），而 search 反映的是**查询词匹配**。
 * 两者是不同的信号  在 `thread` 场景里前者更有用（"楼主这个帖子周围还有什么"）。
 */
export async function relatedVideos(
  bvid: string,
  options: { fetcher?: BiliFetcher; limit?: number } = {},
): Promise<RelatedVideo[]> {
  const doFetch = options.fetcher ?? realFetch
  const limit = options.limit ?? 20
  const res = await doFetch(`${API}/x/web-interface/archive/related?bvid=${encodeURIComponent(bvid)}`)
  if (res.status !== 200) {
    throw new Error('相关视频请求失败: HTTP ' + res.status)
  }
  // **`FetchedResponse` 的契约是 `json()` 方法，不是 `body` 字符串** 
  // 我第一版按后者写，于是运行时报 `"undefined" is not valid JSON`。
  // 契约在同一个文件里（`interface FetchedResponse`），**读一眼就能避免**。
  let body: { code?: number; data?: Array<{ bvid?: string; title?: string; owner?: { name?: string } }> }
  try {
    body = (await res.json()) as typeof body
  } catch (err) {
    throw new Error('相关视频响应不是 JSON: ' + (err as Error).message)
  }
  // **code !== 0 必须抛**  与全组件契约一致，不许静默变成空数组
  if (body.code !== 0) {
    throw new Error('相关视频接口返回 code=' + String(body.code))
  }
  const list = body.data ?? []
  return list
    .slice(0, limit)
    .filter(v => typeof v.bvid === 'string' && v.bvid !== '')
    .map(v => ({
      bvid: v.bvid as string,
      title: String(v.title ?? '').trim(),
      author: String(v.owner?.name ?? '').trim(),
    }))
}
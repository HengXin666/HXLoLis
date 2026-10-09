/**
 * 扩展权威来源：**技术一手规范**与**中文合规/技术语料**。
 *
 * 为什么需要这一批（实测依据）: 第 0 层原有的 7 个来源里 4 个是学术类
 * （crossref/arxiv/pubmed/openalex），对**工程问题**的相关性明显偏弱 
 * 实测查询 "Rust 所有权" 的首条是 Crossref 上一篇中文自然资源论文。
 * 权威性是"取得到 + 内容对得上问题"两件事，缺一样，充分性判断就会在
 * 无关内容上提前停止，从而**挡掉真正有用的社区来源**。
 *
 * 新增来源的权威性依据（都是"可被反驳的判断"，不是"它是大站"）:
 *   - MDN: 浏览器厂商共同维护（Mozilla/Microsoft/Google）的 Web 平台规范解释
 *   - IETF Datatracker: RFC 的第一方发布系统，文档名就是稳定标识符
 *   - npm registry: 包的唯一发布方记录，name@version 是全球唯一坐标
 *   - Stack Exchange: 有投票与接受答案机制的问答存档，question_id 稳定
 *   - 掘金: 中文技术社区，文章 id 稳定；有编辑推荐但**无同行评审**
 *
 * 全部无需凭证（2026-09-16 实测 200）。
 */

import { adapterError, type AdapterContext } from './adapters/adapter.ts'
import type { SourceHit } from './recall.ts'
import type { AuthoritativeHit, HttpFetch } from './authoritative.ts'
import { realFetch } from './authoritative.ts'

async function getText(doFetch: HttpFetch, url: string, what: string): Promise<string> {
  let res
  try {
    res = await doFetch(url)
  } catch (err) {
    throw adapterError('web', 'network', `${what} 请求失败: ${(err as Error).message}`)
  }
  if (!res.ok) throw adapterError('web', 'http', `${what} HTTP ${res.status}`)
  return res.text()
}

async function getJson(doFetch: HttpFetch, url: string, what: string): Promise<Record<string, unknown>> {
  const text = await getText(doFetch, url, what)
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch (err) {
    throw adapterError('web', 'parse', `${what} 响应不是 JSON: ${(err as Error).message}`)
  }
}

// ── MDN ────────────────────────────────────────────────────────

export function mdnSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=zh-CN&size=${limit}`
    const body = await getJson(doFetch, url, 'MDN 检索')
    const docs = (body.documents as Array<Record<string, unknown>> | undefined) ?? []
    return docs.map(d => {
      const slug = String(d.mdn_url ?? '')
      const h: AuthoritativeHit = {
        sourceId: 'mdn',
        title: String(d.title ?? ''),
        url: `https://developer.mozilla.org${slug}`,
        snippet: String(d.summary ?? '').slice(0, 300),
        publisher: 'MDN (MDN contributors)',
      }
      if (slug !== '') h.identity = `mdn:${slug}`
      return h
    })
  }
}

// ── IETF: RFC 编号精确查找 + 标题检索 ──────────────────────────

const RFC_TOKEN = /\brfc[\s-]?(\d{3,5})\b/gi

/** 从查询里抽出 RFC 编号。实测依据: 「RFC 9110 是什么」送到 title__icontains 返回 0 条  标题里没有"是什么"。 */
export function extractRfcNumbers(query: string): string[] {
  const out = new Set<string>()
  for (const m of query.matchAll(RFC_TOKEN)) out.add(m[1]!)
  return [...out]
}

/**
 * 去掉 RFC 编号与**疑问词**后剩下的检索词；只剩空白则返回空串（此时不做标题检索）。
 *
 * 注意这里用的是**词组**（`(?:...)`）而不是字符类 `[...]`  字符类会把
 * "行为""因为""认为"里的单个字也删掉，把好好的检索词改坏。疑问词只删**整词**。
 */
const QUESTION_WORDS = /(?:是什么|什么是|是什么样|怎么|怎样|如何|为什么|什么意思|的含义|的介绍)/g

export function stripRfcNumbers(query: string): string {
  return query.replace(RFC_TOKEN, ' ').replace(QUESTION_WORDS, ' ').replace(/\s+/g, ' ').trim()
}

interface RfcDoc {
  doc_id?: string
  title?: string
  pub_status?: string
  page_count?: string
  "abstract"?: string
  pub_date?: string
  doi?: string
}

/**
 * 按编号精确取一份 RFC。**这是"持久标识符"最纯粹的用法**: 编号就是坐标，
 * 不需要检索，也就没有"检索引擎把别的文档排前面"这回事。
 *
 * 404 的处理是刻意的: 对**具体文档**的 404 是"这个编号不存在"（合理的空结果），
 * 不是"接口坏了"。其它状态码一律响亮报错  区分这两者是本项目的铁律。
 */
async function fetchRfc(doFetch: HttpFetch, num: string): Promise<AuthoritativeHit | null> {
  let res
  try {
    res = await doFetch(`https://www.rfc-editor.org/rfc/rfc${num}.json`)
  } catch (err) {
    throw adapterError('web', 'network', `取 RFC ${num} 失败: ${(err as Error).message}`)
  }
  if (res.status === 404) return null
  if (!res.ok) throw adapterError('web', 'http', `取 RFC ${num} HTTP ${res.status}`)
  let doc: RfcDoc
  try {
    doc = JSON.parse(await res.text()) as RfcDoc
  } catch (err) {
    throw adapterError('web', 'parse', `RFC ${num} 响应不是 JSON: ${(err as Error).message}`)
  }
  const h: AuthoritativeHit = {
    sourceId: 'ietf',
    title: `RFC ${num}: ${String(doc.title ?? '')}`,
    url: `https://www.rfc-editor.org/rfc/rfc${num}.html`,
    snippet: [doc.pub_status, doc.pub_date !== undefined ? String(doc.pub_date).slice(0, 10) : '', doc.doi ?? '']
      .filter(s => s !== '')
      .join(' · '),
    publisher: 'RFC Editor',
    identity: `ietf:rfc${num}`,
  }
  if (doc.pub_date !== undefined) h.publishedAt = String(doc.pub_date)
  return h
}

export function ietfSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const exact: AuthoritativeHit[] = []
    for (const num of extractRfcNumbers(query).slice(0, 3)) {
      const hit = await fetchRfc(doFetch, num)
      if (hit !== null) exact.push(hit)
    }
    const rest = stripRfcNumbers(query)
    if (rest === '') return exact
    const url = `https://datatracker.ietf.org/api/v1/doc/document/?title__icontains=${encodeURIComponent(rest)}&limit=${limit}&format=json`
    const body = await getJson(doFetch, url, 'IETF 检索')
    const objects = (body.objects as Array<Record<string, unknown>> | undefined) ?? []
    // 精确命中**前置**  编号是坐标, 检索结果只是候选, 顺序不能反
    return [...exact, ...objects
      .filter(o => String(o.title ?? '') !== '')
      .map(o => {
        const name = String(o.name ?? '')
        // rev=00 且无 rfc 的草稿是工作文档；有 rfc 编号的才是正式标准
        const rfc = o.rfc === null || o.rfc === undefined ? undefined : String(o.rfc)
        const h: AuthoritativeHit = {
          sourceId: 'ietf',
          title: String(o.title),
          url: rfc !== undefined
            ? `https://www.rfc-editor.org/rfc/rfc${rfc}.html`
            : `https://datatracker.ietf.org/doc/${name}/`,
          snippet: `${rfc !== undefined ? `RFC ${rfc}` : `Internet-Draft ${name}`}${
            o.std_level ? ` · ${String(o.std_level)}` : ''}`,
          publisher: 'IETF',
          identity: `ietf:${name}`,
        }
        if (o.time !== undefined) h.publishedAt = String(o.time)
        return h
      })]
  }
}

// ── npm ────────────────────────────────────────────────────────

export function npmSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`
    const body = await getJson(doFetch, url, 'npm 检索')
    const objects = (body.objects as Array<Record<string, unknown>> | undefined) ?? []
    return objects.map(o => {
      const pkg = (o.package ?? {}) as Record<string, unknown>
      const name = String(pkg.name ?? '')
      const version = String(pkg.version ?? '')
      const links = (pkg.links ?? {}) as Record<string, unknown>
      const h: AuthoritativeHit = {
        sourceId: 'npm',
        title: name,
        url: String(links.npm ?? `https://www.npmjs.com/package/${name}`),
        snippet: String(pkg.description ?? '').slice(0, 300),
        publisher: 'npm registry',
      }
      if (name !== '' && version !== '') h.identity = `npm:${name}@${version}`
      if (pkg.date !== undefined) h.publishedAt = String(pkg.date)
      return h
    })
  }
}

// ── Stack Exchange ─────────────────────────────────────────────

export function stackexchangeSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${limit}&filter=default`
    const body = await getJson(doFetch, url, 'Stack Exchange 检索')
    const items = (body.items as Array<Record<string, unknown>> | undefined) ?? []
    return items.map(it => {
      const qid = String(it.question_id ?? '')
      const h: AuthoritativeHit = {
        sourceId: 'stackexchange',
        title: String(it.title ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
        url: String(it.link ?? ''),
        // 有接受答案 ≠ 正确；把这两个信号原样给出，判断留给上层
        snippet: `${String(it.answer_count ?? 0)} 个回答 · ${String(it.score ?? 0)} 分 · ${
          it.is_answered === true ? '有接受答案' : '无接受答案'}`,
        publisher: 'Stack Overflow',
        identity: `so:${qid}`,
      }
      if (it.creation_date !== undefined) h.publishedAt = new Date(Number(it.creation_date) * 1000).toISOString()
      return h
    })
  }
}

// ── 掘金 ───────────────────────────────────────────────────────

export function juejinSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `https://api.juejin.cn/search_api/v1/search?query=${encodeURIComponent(query)}&limit=${limit}`
    const body = await getJson(doFetch, url, '掘金检索')
    if (body.err_no !== undefined && body.err_no !== 0) {
      throw adapterError('web', 'api', `掘金检索返回 err_no=${String(body.err_no)}: ${String(body.err_msg ?? '')}`)
    }
    const items = (body.data as Array<Record<string, unknown>> | undefined) ?? []
    return items.flatMap(it => {
      const model = (it.result_model ?? {}) as Record<string, unknown>
      const info = (model.article_info ?? {}) as Record<string, unknown>
      const id = String(info.article_id ?? '')
      if (id === '' || info.title === undefined) return []
      const h: AuthoritativeHit = {
        sourceId: 'juejin',
        title: String(info.title),
        url: `https://juejin.cn/post/${id}`,
        snippet: String(info.brief_content ?? '').slice(0, 300),
        publisher: '掘金',
        identity: `juejin:${id}`,
      }
      return [h]
    })
  }
}

/**
 * 扩展来源的登记。**注意 MDN/IETF/npm/Stack Exchange 归第 0 层（权威公域），
 * 掘金归第 1 层（垂直社区）**  分层归属由取数函数表与 `recall.SOURCES` 两处共同决定，
 * 新增来源必须同时登记，否则测试会报"登记了却没有实现"。
 */
export function extendedSources(
  doFetch: HttpFetch = realFetch,
): Record<string, (query: string, limit: number) => Promise<AuthoritativeHit[]>> {
  // 注意是**调用**工厂而不是把工厂本身放进表里  放工厂会让 recall 用
  // (query, limit) 去调它，得到的是一个函数而不是数组（实测: got.slice is not a function）。
  return {
    mdn: mdnSearch(doFetch),
    ietf: ietfSearch(doFetch),
    npm: npmSearch(doFetch),
    stackexchange: stackexchangeSearch(doFetch),
    juejin: juejinSearch(doFetch),
  }
}

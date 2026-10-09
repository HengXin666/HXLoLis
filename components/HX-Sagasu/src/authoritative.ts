/**
 * L3 第 0 层来源: **权威公域开放数据**。
 *
 * 为什么单独一层: 用户明确要求"先聚合各大权威平台，然后才是搜索引擎"。这一层是
 * 它的落点  这些接口背后是机构（Crossref/PubMed/Wikipedia）、学术出版体系
 * （arXiv）、代码事实（GitHub）与原始讨论存档（Hacker News），它们的**权威性来自
 * 机构责任与可追溯的标识符（DOI/PMID/arXiv ID）**，而不是来自搜索排名。
 *
 * 与"搜到某个官网"的根本差别: 搜索引警返回的是一个**URL**，谁都能声称自己是官网；
 * 这一层返回的是**带持久标识符的实体**（DOI 可解析到出版方、PMID 可查、GitHub 仓库
 * 有 owner 与 commit 历史）。证据的**同一性**由标识符保证，不由页面内容保证。
 *
 * 全部为**公开开放接口**，无需凭证（2026-09-16 实测，见 registry 的 evidence 字段）：
 *   crossref 200 / arxiv 200 / github 200 / wikipedia 200 / pubmed 200 / hackernews 200
 *   openalex **需带 mailto**；但实测表明 mailto 只是降低而没有消除 429  连续调用仍会
 *     命中限流（2026-09-16 同一次会话里既见 200 也见 429）。因此**不能**把 OpenAlex
 *     当稳定供给，上线前需评估退避或换用带 API key 的额度。
 *   semanticscholar 429（需申请 key）/ v2ex 403（Cloudflare 挑战） 两者均未登记
 *
 * 失败契约与其余适配器一致: 取不到就抛错，**不返回空数组冒充"没有内容"**。
 */

import { adapterError, type AdapterContext } from './adapters/adapter.ts'
import { extendedSources } from './authoritative-tech.ts'
import type { PlatformId, RawThreadInput, RawTurn } from './types.ts'
import type { SourceHit } from './recall.ts'

const UA = 'HX-Sagasu/0.1 (research agent; mailto:research@example.invalid)'

export interface HttpFetch {
  (url: string): Promise<{ ok: boolean; status: number; text(): Promise<string> }>
}

export const realFetch: HttpFetch = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } })
  return { ok: res.ok, status: res.status, text: () => res.text() }
}

/** 第 0 层的统一元数据。`identity` 是这一层的核心  持久标识符。 */
export interface AuthoritativeHit extends SourceHit {
  /** 持久标识符（DOI / PMID / arXiv id / repo full_name）。无标识符时为 undefined。 */
  identity?: string
  /** 出版方/机构。 */
  publisher?: string
  /** 发布日期（ISO）。 */
  publishedAt?: string
}

async function getText(doFetch: HttpFetch, url: string, what: string, platform: PlatformId): Promise<string> {
  let res
  try {
    res = await doFetch(url)
  } catch (err) {
    throw adapterError(platform, 'network', `${what} 请求失败: ${(err as Error).message}`)
  }
  if (!res.ok) {
    // **限流不是故障**（2026-09-18 读 argo 的配额感知后加）。
    //
    // 实测: GitHub 未认证配额 10 次/分。连续检索几轮就会打满，返回 403/429。
    // 此前它和"服务器坏了"一样报 `http`  但这两件事对用户的意义**完全不同**:
    //   - 服务器坏了 → 等它修好，或者换个源
    //   - 配额用完了 → **再等一会儿就好，而且是我自己用完的**
    //
    // argo 用 `_quota_ratio` 在**路由阶段**就降低即将耗尽的引擎权重（`tfidf_router.py:272`），
    // 从而根本不发那个注定失败的请求。我们还没有配额账本，但**至少要把话说清楚**。
    //
    // 保留 `code: 'http'` 不变（下游 switch 依赖它，改码是跨文件契约变更），
    // 在 message 里带上可辨识的前缀 + 状态码，让人和界面都能认出来。
    const rateLimited = res.status === 429 || res.status === 403
    const hint = rateLimited
      ? '（配额/限流  不是服务故障，稍后重试即可）'
      : ''
    throw adapterError(platform, 'http', `${what} HTTP ${res.status}${hint}`)
  }
  try {
    return await res.text()
  } catch (err) {
    throw adapterError(platform, 'parse', `${what} 响应读取失败: ${(err as Error).message}`)
  }
}

async function getJson(doFetch: HttpFetch, url: string, what: string, platform: PlatformId): Promise<Record<string, unknown>> {
  const text = await getText(doFetch, url, what, platform)
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch (err) {
    throw adapterError(platform, 'parse', `${what} 响应不是 JSON: ${(err as Error).message}`)
  }
}

// ── Crossref（出版体系，DOI 权威） ──────────────────────────────

interface CrossrefItem {
  title?: string[]
  DOI?: string
  URL?: string
  'container-title'?: string[]
  issued?: { 'date-parts'?: number[][] }
  author?: Array<{ family?: string; given?: string }>
}

export function crossrefSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=title,DOI,URL,container-title,issued,author`
    const body = await getJson(doFetch, url, 'Crossref 检索', 'web')
    const items = ((body.message as { items?: CrossrefItem[] } | undefined)?.items) ?? []
    return items.map(it => {
      const year = it.issued?.['date-parts']?.[0]?.[0]
      const authors = (it.author ?? []).slice(0, 3).map(a => `${a.given ?? ''} ${a.family ?? ''}`.trim()).filter(Boolean)
      const h: AuthoritativeHit = {
        sourceId: 'crossref',
        title: (it.title?.[0] ?? '').trim(),
        url: it.URL ?? `https://doi.org/${it.DOI ?? ''}`,
        snippet: [authors.join(', '), it['container-title']?.[0]].filter(Boolean).join(' · '),
      }
      if (it.DOI !== undefined) h.identity = `doi:${it.DOI}`
      if (it['container-title']?.[0] !== undefined) h.publisher = it['container-title'][0]
      if (year !== undefined) h.publishedAt = `${year}`
      return h
    })
  }
}

// ── PubMed（生物医学，PMID 权威） ──────────────────────────────

/**
 * PubMed（生物医学，PMID 权威）。
 *
 * **为什么必须发第二个请求**: 早先的实现只调 `esearch`，把 `title` 设成 `PubMed <id>`，
 * 理由是"保持一次调用只发一个请求的简单性"。这在**覆盖度判据**落地后被证明是错的 
 * 标题里没有任何查询词，所以：
 *   - 覆盖度判据对它永远是 0 覆盖
 *   - 用户看到的结果列表是一串 `PubMed 24558651`
 * 而 `esummary` **支持一次传多个 id**，所以"多一次请求"的代价是**每次检索多 1 个请求**，
 * 不是每个 id 一个请求。用一次额外请求换回可用的标题，这个交换显然是值得的。
 *
 * 标识符不受影响: `identity` 仍是 `pmid:<id>`（那是权威性的来源，标题只是可读性）。
 *
 * 这条约束的完整论证（包括"为什么'esummary 要多发一次请求'这个理由本身是错的"）
 * 见 ``。
 
 * .agents/notes/implemented/architecture/2026-09-16-source-title-is-evidence.md
 */
export function pubmedSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${limit}&sort=relevance`
    const body = await getJson(doFetch, url, 'PubMed 检索', 'web')
    const ids = ((body.esearchresult as { idlist?: string[] } | undefined)?.idlist) ?? []
    if (ids.length === 0) return []

    const summaryUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`
    const summary = await getJson(doFetch, summaryUrl, 'PubMed 摘要', 'web')
    const result = (summary.result ?? {}) as Record<string, PubMedSummary | undefined>

    return ids.map(id => {
      const doc = result[id]
      // 拿不到摘要时**退回** id 作标题（真实、不编造），而不是丢掉这条结果
      const title = doc?.title !== undefined && String(doc.title) !== '' ? String(doc.title) : `PubMed ${id}`
      const h: AuthoritativeHit = {
        sourceId: 'pubmed',
        title,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        identity: `pmid:${id}`,
        publisher: doc?.source !== undefined && String(doc.source) !== '' ? String(doc.source) : 'PubMed',
      }
      const bits: string[] = []
      if (doc?.pubdate !== undefined) bits.push(String(doc.pubdate))
      const doi = (doc?.articleids ?? []).find(a => a.idtype === 'doi')?.value
      if (doi !== undefined) bits.push(`doi:${doi}`)
      if (bits.length > 0) h.snippet = bits.join(' · ')
      return h
    })
  }
}

interface PubMedSummary {
  title?: string
  pubdate?: string
  source?: string
  articleids?: Array<{ idtype?: string; value?: string }>
}

// ── arXiv（预印本，arXiv ID 权威） ─────────────────────────────

export function arxivSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(`"${query}"`)}&max_results=${limit}`
    const xml = await getText(doFetch, url, 'arXiv 检索', 'web')
    const entries = xml.split('<entry>').slice(1)
    const out: AuthoritativeHit[] = []
    for (const e of entries) {
      const title = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? ''
      const id = /<id>([\s\S]*?)<\/id>/.exec(e)?.[1] ?? ''
      const published = /<published>([\s\S]*?)<\/published>/.exec(e)?.[1] ?? ''
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(e)?.[1] ?? ''
      const arxivId = /abs\/([^<v]+)/.exec(id)?.[1]
      if (title.trim() === '') continue
      const h: AuthoritativeHit = {
        sourceId: 'arxiv',
        title: title.replace(/\s+/g, ' ').trim(),
        url: id.trim(),
        snippet: summary.replace(/\s+/g, ' ').trim().slice(0, 300),
        publisher: 'arXiv',
      }
      if (arxivId !== undefined) h.identity = `arxiv:${arxivId}`
      if (published !== '') h.publishedAt = published.trim()
      out.push(h)
    }
    return out
  }
}

// ── GitHub（代码事实，仓库身份权威） ────────────────────────────

export function githubSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`
    const body = await getJson(doFetch, url, 'GitHub 检索', 'web')
    const items = (body.items as Array<Record<string, unknown>> | undefined) ?? []
    return items.map(it => {
      const full = String(it.full_name ?? '')
      return {
        sourceId: 'github',
        title: full,
        url: String(it.html_url ?? ''),
        snippet: String(it.description ?? '').slice(0, 300),
        identity: `github:${full}`,
        publisher: String((it.owner as { login?: string } | undefined)?.login ?? ''),
      }
    })
  }
}

// ── Wikipedia（参考资料） ───────────────────────────────────────

export function wikipediaSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${limit}`
    const body = await getJson(doFetch, url, 'Wikipedia 检索', 'web')
    const items = ((body.query as { search?: Array<{ title?: string; snippet?: string; pageid?: number }> } | undefined)?.search) ?? []
    return items.map(it => {
      const h: AuthoritativeHit = {
        sourceId: 'wikipedia',
        title: it.title ?? '',
        url: `https://zh.wikipedia.org/?curid=${it.pageid ?? ''}`,
        snippet: (it.snippet ?? '').replace(/<[^>]+>/g, ''),
      }
      if (it.pageid !== undefined) h.identity = `wikipedia:zh:${it.pageid}`
      return h
    })
  }
}

// ── Hacker News（原始技术讨论存档） ─────────────────────────────

export function hackernewsSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${limit}`
    const body = await getJson(doFetch, url, 'Hacker News 检索', 'web')
    const items = (body.hits as Array<Record<string, unknown>> | undefined) ?? []
    return items.map(it => {
      const oid = String(it.objectID ?? '')
      const h: AuthoritativeHit = {
        sourceId: 'hackernews',
        title: String(it.title ?? it.story_title ?? '(无标题)'),
        url: String(it.url ?? `https://news.ycombinator.com/item?id=${oid}`),
        identity: `hn:${oid}`,
        publisher: 'Hacker News',
      }
      if (it.created_at !== undefined) h.publishedAt = String(it.created_at)
      if (it.num_comments !== undefined) h.snippet = `${String(it.points ?? 0)} 分 · ${String(it.num_comments)} 条讨论`
      return h
    })
  }
}

// ── OpenAlex（跨学科文献图，需带 mailto 否则 429） ──────────────

export function openalexSearch(doFetch: HttpFetch = realFetch) {
  return async (query: string, limit: number): Promise<AuthoritativeHit[]> => {
    // 实测: 不带 mailto 会返回 429 "Insufficient budget"；带上即 200。
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&mailto=research@example.invalid`
    const body = await getJson(doFetch, url, 'OpenAlex 检索', 'web')
    const items = (body.results as Array<Record<string, unknown>> | undefined) ?? []
    return items.map(it => {
      const doi = String(it.doi ?? '')
      const h: AuthoritativeHit = {
        sourceId: 'openalex',
        title: String(it.display_name ?? it.title ?? ''),
        url: doi !== '' ? doi : String(it.id ?? ''),
        snippet: String(it.publication_year ?? ''),
      }
      if (doi !== '') h.identity = doi.replace('https://doi.org/', 'doi:')
      if (it.publication_year !== undefined) h.publishedAt = String(it.publication_year)
      return h
    })
  }
}

/** 第 0 层全部的来源与取数函数（`recall.ts` 按 id 取用）。 */
export const AUTHORITATIVE_SOURCES: Record<string, (query: string, limit: number) => Promise<AuthoritativeHit[]>> = {
  crossref: crossrefSearch(),
  arxiv: arxivSearch(),
  github: githubSearch(),
  wikipedia: wikipediaSearch(),
  hackernews: hackernewsSearch(),
  pubmed: pubmedSearch(),
  openalex: openalexSearch(),
  ...extendedSources(),
}

/**
 * 把第 0 层的取数函数适配成 `recall` 要的形状。
 *
 * 单独提供它是因为签名不同（这里按 `query+limit` 调用，recall 传的是
 * `source+query+ctx`）。适配放在这一层，调用方不需要自己写胶水。
 */
export function authoritativeFetchers(
  sources: Record<string, (query: string, limit: number) => Promise<AuthoritativeHit[]>> = AUTHORITATIVE_SOURCES,
): Record<string, (source: { id: string }, query: string, ctx: { perSourceLimit: number }) => Promise<AuthoritativeHit[]>> {
  const out: Record<string, (source: { id: string }, query: string, ctx: { perSourceLimit: number }) => Promise<AuthoritativeHit[]>> = {}
  for (const [id, fn] of Object.entries(sources)) {
    out[id] = async (_source, query, ctx) => fn(query, ctx.perSourceLimit)
  }
  return out
}

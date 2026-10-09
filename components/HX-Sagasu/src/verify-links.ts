/**
 * 链接核验：**互证**（Tier 0）+ **探活**（Tier 1）。
 *
 * ## 为什么需要它（2026-09-19，学自 aether-search）
 *
 * 我们的 LLM 侧（`wide_research`、argo 的模型答案）**会产出 URL**  而 LLM **会幻觉 URL**。
 * 此前**完全没有防线**：答案里的链接原样进结果，没有任何东西检查它是否真实存在。
 *
 * aether-search 的 `verify.py` 把这件事的判据说清楚了  **按「URL 的来源」分流**：
 *
 * > `verify_urls` — Tier 0 (corroboration) + Tier 1 probe. **Used for LLM-generated citations**:
 * > these **can hallucinate URLs**.
 * > `probe_urls` — Tier 1 only. **Used for any URL surfaced to the user**: **search engines
 * > don't hallucinate URLs, but pages can be dead (404/410) or blocked.**
 *
 * **即：对不会伪造 URL 的来源做互证，是没有信息量的开销。**
 *
 * | 来源 | 互证 (Tier 0) | 探活 (Tier 1) |
 * |---|---|---|
 * | **LLM 生成**的引用 | 必须 | 必须 |
 * | **搜索引擎返回**的链接 | 不需要 | 需要 |
 *
 * ## 与 `url-safety.ts` 的分工（**必须分清**）
 *
 * - `url-safety.ts`: **能不能请求**（SSRF 防护，私有 IP / 内网名 / 非 http scheme） 安全边界
 * - **本模块**: **请求了结果如何解读**（活着 / 死了 / 无法判定） 信任边界
 *
 * **两者不可互相替代**：一个 URL 可以既安全又已死（`https://example.invalid/404`），
 * 也可以不安全但活着（`http://192.168.1.1/`）。
 *
 * ## 探活的两个工程细节（学自 aether-search，都保留）
 *
 * 1. **HEAD 优先，遇 405/501 降级为 `GET + Range: bytes=0-0`**  很多服务器不支持 HEAD，
 *    而普通 GET 会拉全文（对只想知道"在不在"是浪费）。只取首字节是折中。
 * 2. **失败一律归 `unverified` 而非 `dead`**  **「探不到」不等于「死了」**（超时、被墙、
 *    反爬都可能）。这与本组件的三分法同源：`not-applicable ≠ no-content ≠ 失败`。
 */

import { checkUrl } from './url-safety.ts'

/** 核验状态。**四级**，不是两级  `alive` 与 `corroborated` 必须分开。 
 * .agents/notes/implemented/architecture/2026-09-19-link-verification.md
 */
export type VerifyStatus = 'corroborated' | 'alive' | 'dead' | 'unverified'

/** 单个 URL 的核验结论。 */
export interface VerifyOutcome {
  readonly url: string
  readonly status: VerifyStatus
  /** 人类可读的依据。**必须能解释"为什么是这个状态"**。 */
  readonly detail: string
}

/** 状态 → 符号。给界面/文本用。** `alive` 与 `corroborated` 共用 `✓` 但语义不同（见下）。 */
const MARK: Readonly<Record<VerifyStatus, string>> = {
  corroborated: '✓',
  alive: '✓',
  dead: '⚠',
  unverified: '?',
}

/** 取状态的展示符号。 */
export function mark(status: VerifyStatus): string {
  return MARK[status] ?? '?'
}

const URL_RE = /https?:\/\/[^\s<>"'`，。、；：！？》）】\)\]]+/gu

/**
 * 从文本里抽出 URL。
 *
 * **归一化后再去重**（否则 `http://x.com/a/` 与 `http://x.com/a` 会被当成两条）。
 */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/u, '')
    const key = normalizeUrl(url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}

/**
 * URL 归一化  **融合键与互证比对都必须用它**。
 *
 * 规则取自 aether-search 的 `normalize_url`：scheme/host 小写、路径去尾斜杠、**丢弃 fragment**。
 * **保留 query**（`?v=2` 通常是不同资源）。
 */
export function normalizeUrl(url: string): string {
  try {
    const p = new URL(url)
    const path = p.pathname.replace(/\/+$/u, '')
    return `${p.protocol.toLowerCase()}//${p.host.toLowerCase()}${path}${p.search}`
  } catch {
    return url
  }
}

/** 探活可注入（测试用）。 */
export type Prober = (url: string) => Promise<{ status: number | null; note?: string }>

/** 默认探活器：HEAD → 405/501 时降级为 GET + Range。 */
export function makeProber(timeoutMs = 2500): Prober {
  return async (url: string) => {
    const signal = AbortSignal.timeout(timeoutMs)
    const headers = { 'User-Agent': 'HX-Sagasu/0.1 (link-verify; mailto:research@example.invalid)' }
    try {
      let res = await fetch(url, { method: 'HEAD', headers, redirect: 'follow', signal })
      if (res.status === 405 || res.status === 501) {
        // 服务器不支持 HEAD  只取首字节，避免拉全文
        res = await fetch(url, { headers: { ...headers, Range: 'bytes=0-0' }, redirect: 'follow', signal })
      }
      return { status: res.status }
    } catch (err) {
      return { status: null, note: (err as Error).name === 'TimeoutError' ? '超时' : '请求失败' }
    }
  }
}

function classify(status: number | null): { status: VerifyStatus; detail: string } {
  if (status === null) return { status: 'unverified', detail: '请求失败/超时（**不等于已死**）' }
  if (status === 404 || status === 410) return { status: 'dead', detail: `HTTP ${status}  可能是不存在的 URL` }
  if (status < 400) return { status: 'alive', detail: `HTTP ${status}` }
  // 403/429/5xx 等都归 unverified: **服务器在，只是不让我们看**
  return { status: 'unverified', detail: `HTTP ${status}（可达但未确认）` }
}

/** 并发上限  核验是**附加**步骤，不该拖垮主流程。 */
const VERIFY_CONCURRENCY = 6

/**
 * **Tier 1 探活**  用于任何会展示给用户的链接。
 *
 * **先过 SSRF 白名单再探**  否则核验本身就成了 SSRF 的入口（让攻击者用一个 URL 探内网）。
 */
export async function probeUrls(
  urls: readonly string[],
  opts: { prober?: Prober; timeoutMs?: number } = {},
): Promise<VerifyOutcome[]> {
  if (urls.length === 0) return []
  const prober = opts.prober ?? makeProber(opts.timeoutMs)
  const out: VerifyOutcome[] = new Array(urls.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < urls.length) {
      const i = cursor++
      const url = urls[i]!
      const safety = await checkUrl(url)
      if (!safety.ok) {
        // **不安全的 URL 一律 unverified**  不去探它
        out[i] = { url, status: 'unverified', detail: `跳过探活: ${safety.reason}` }
        continue
      }
      const r = await prober(url)
      const c = classify(r.status)
      out[i] = { url, status: c.status, detail: r.note !== undefined ? `${c.detail} / ${r.note}` : c.detail }
    }
  }
  await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, urls.length) }, worker))
  return out
}

/**
 * **Tier 0 互证 + Tier 1 探活**  用于 **LLM 生成**的引用。
 *
 * 互证的含义：这个 URL **也出现在我们自己的证据集里**。
 * 命中的直接标 `corroborated`，**不再探活**  它已被独立来源证实存在。
 *
 * @param cited LLM 给出的引用 URL
 * @param evidence 我们自己的证据集（来自检索结果）
 */
export async function verifyUrls(
  cited: readonly string[],
  evidence: readonly string[],
  opts: { prober?: Prober; timeoutMs?: number } = {},
): Promise<VerifyOutcome[]> {
  if (cited.length === 0) return []
  const corr = new Set(evidence.map(normalizeUrl))
  const out: VerifyOutcome[] = new Array(cited.length)
  const toProbe: Array<{ i: number; url: string }> = []
  for (const [i, url] of cited.entries()) {
    if (corr.has(normalizeUrl(url))) {
      out[i] = { url, status: 'corroborated', detail: '被证据集中的独立来源证实' }
    } else {
      toProbe.push({ i, url })
    }
  }
  const probed = await probeUrls(toProbe.map(x => x.url), opts)
  for (const [k, r] of probed.entries()) out[toProbe[k]!.i] = r
  return out
}

/**
 * 核验结论 → 人读文本。**附在答案后面**，让幻觉 URL 可见。
 *
 * **只报非 `alive` 的**（`corroborated` 与 `alive` 都是好消息，逐条列会淹没重点）。
 */
export function renderVerifyReport(outcomes: readonly VerifyOutcome[]): string {
  const bad = outcomes.filter(o => o.status !== 'alive' && o.status !== 'corroborated')
  if (bad.length === 0) return ''
  const lines = ['', '链接核验（仅列未通过项）:']
  for (const o of bad) lines.push(`  ${mark(o.status)} ${o.url} — ${o.detail}`)
  return lines.join('\n')
}

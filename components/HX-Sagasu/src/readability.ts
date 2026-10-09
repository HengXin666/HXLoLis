/**
 * 正文提取（readability 密度法，零依赖）。
 *
 * ## 来源
 *
 * **移植自 argo v2.8.6 的 `scripts/readability_extract.py`**（MIT License © 2026 taxueseek）。
 * 移植理由同 `url-safety.ts`：它是纯逻辑、无依赖、可直译的，而整体 fork 会让本仓库
 * 放弃"零依赖零构建"。
 *
 * ## 算法（argo 自研，思路对标 Mozilla readability / crawl4ai fit-markdown）
 *
 * 1. **块级密度评分**: `(文本 - 2×链接文本) / (块字符数 + 1)`
 *    链接越多的块（导航/侧栏/页脚）分数越低，**无需 query 即可区分正文与噪音**。
 * 2. **标签权重**: `article`/`main` 加权，`li`/`h1-h6` 降权，`div`/`p` 基准。
 * 3. **容器归并**: 同深度的相邻块合并为同一正文段，**保持文档顺序输出**。
 *    （旧版 sort-by-density 会把页脚插进正文中间  这是 argo 踩过的坑。）
 *
 * ## 三个容易做错的细节（argo 都做对了）
 *
 * - **`td` 的短块下限是 2 而不是 30**: 表格是原子数据单元（"型号"、"15999 元"），
 *   30 字符下限会把整张表的数据全部丢光。
 * - **标题（h1-h6）下限是 6 且不参与短块降权**: 标题短但信息密度高。
 * - **容器清空只在"容器内没产出任何正文块"时发生**: 否则表格里 `td` 之外的
 *   剩余文本（残句、表格数据）会被整个丢掉。
 */

const SKIP_TAGS: ReadonlySet<string> = new Set([
  'script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript',
  'iframe', 'form', 'button', 'dialog',
])
const CONTAINER_TAGS: ReadonlySet<string> = new Set(['div', 'article', 'main', 'section', 'blockquote'])
const BLOCK_TAGS: ReadonlySet<string> = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'pre', 'td'])

const TAG_WEIGHT: Readonly<Record<string, number>> = {
  article: 1.5, main: 1.5, blockquote: 1.2, p: 1.1,
  td: 1.0, div: 1.0, section: 0.9, pre: 1.0,
  h1: 0.6, h2: 0.6, h3: 0.6, h4: 0.6, h5: 0.6, h6: 0.6,
  li: 0.5, tr: 0.5,
}

const MIN_BLOCK_CHARS = 30
const MAX_BLOCK_CHARS = 6000
const MIN_DENSITY = 0.55

interface TextBlock {
  text: string
  linkChars: number
  depth: number
  weight: number
  start: number
  isHeading: boolean
}

function blockScore(b: TextBlock): number {
  const chars = b.text.length
  const nonSpace = b.text.replace(/ /gu, '').replace(/\n/gu, '').length
  const density = nonSpace / Math.max(chars, 1)
  let base = (chars - 2 * b.linkChars) / Math.max(chars + 1, 1)
  base *= density / (MIN_DENSITY * 1.2)
  base *= b.weight
  if (chars < 80 && !b.isHeading) base *= 0.6
  if (chars > MAX_BLOCK_CHARS) base *= MAX_BLOCK_CHARS / chars
  return base
}

/** 一组块的总分：求和归一化到块数，避免容器内块数虚高。 */
function groupScore(blocks: readonly TextBlock[]): number {
  if (blocks.length === 0) return 0
  let sum = 0
  for (const b of blocks) sum += blockScore(b)
  return sum / Math.max(Math.sqrt(blocks.length), 1)
}

// ── 最小 HTML 解析器 ─────────────────────────────────────────────
//
// Node 没有内置 HTML parser（Python 有 `html.parser`）。这里只需要
// **标签事件 + 文本**，不需要属性、不需要容错到浏览器级别  所以自己写
// 比引入依赖更合适（本仓库零依赖）。
//
// **刻意处理的两种情形**:
//   - `<script>`/`<style>` 的内容里可能有 `<`，必须整段跳过而不是当标签解析
//   - 自闭合标签（`<br/>`、`<img>`）不产生 endtag，不能让深度计数失衡

interface TagEvent { kind: 'start' | 'end'; tag: string }

function* tokenizeHtml(html: string): Generator<TagEvent | { kind: 'text'; data: string }> {
  let i = 0
  const n = html.length
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      yield { kind: 'text', data: html.slice(i) }
      return
    }
    if (lt > i) yield { kind: 'text', data: html.slice(i, lt) }
    // 注释
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end < 0 ? n : end + 3
      continue
    }
    // DOCTYPE / CDATA
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt)
      i = end < 0 ? n : end + 1
      continue
    }
    const gt = html.indexOf('>', lt)
    if (gt < 0) { yield { kind: 'text', data: html.slice(lt) }; return }
    const raw = html.slice(lt + 1, gt)
    const isEnd = raw.startsWith('/')
    const body = isEnd ? raw.slice(1) : raw
    const m = /^([a-zA-Z][a-zA-Z0-9-]*)/u.exec(body)
    if (m === null) { i = gt + 1; continue }
    const tag = m[1]!.toLowerCase()
    yield { kind: isEnd ? 'end' : 'start', tag }
    // raw text 元素：内容整段跳过，避免其中的 '<' 被当成标签
    if (!isEnd && (tag === 'script' || tag === 'style')) {
      const close = new RegExp('</' + tag + '\\s*>', 'iu')
      const rest = html.slice(gt + 1)
      const cm = close.exec(rest)
      if (cm === null) return
      i = gt + 1 + cm.index + cm[0].length
      yield { kind: 'end', tag }
      continue
    }
    i = gt + 1
  }
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (whole, ent: string) => {
    if (ent.startsWith('#')) {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return Number.isNaN(code) ? whole : String.fromCodePoint(code)
    }
    return ENTITIES[ent.toLowerCase()] ?? whole
  })
}

export interface Extracted { readonly text: string; readonly title: string }

/** 从 HTML 提取正文与标题。 */
export function extractReadability(html: string, maxChars = 8000): Extracted {
  const blocks: TextBlock[] = []
  const containerStack: number[] = []
  let inSkip = 0
  let linkDepth = 0
  let depth = 0
  let current: string[] = []
  let currentLink: string[] = []
  let title = ''
  let inTitle = false

  const flush = (tag: string): void => {
    const text = current.join('').trim()
    const linkChars = currentLink.join('').trim().length
    current = []
    currentLink = []
    const isHeading = /^h[1-6]$/u.test(tag)
    const minChars = tag === 'td' ? 2 : (isHeading ? 6 : MIN_BLOCK_CHARS)
    if (text.length < minChars) return
    blocks.push({
      text, linkChars, depth, weight: TAG_WEIGHT[tag] ?? 1.0,
      start: blocks.length, isHeading,
    })
  }

  for (const ev of tokenizeHtml(html)) {
    if (ev.kind === 'text') {
      if (inTitle) { title += ev.data; continue }
      if (inSkip > 0 || ev.data.trim() === '') continue
      const decoded = decodeEntities(ev.data)
      if (linkDepth > 0) currentLink.push(decoded)
      else current.push(decoded)
      continue
    }
    const tag = ev.tag
    if (ev.kind === 'start') {
      if (tag === 'title') inTitle = true
      if (SKIP_TAGS.has(tag)) { inSkip++; continue }
      if (inSkip > 0) continue
      if (CONTAINER_TAGS.has(tag) || BLOCK_TAGS.has(tag)) depth++
      if (tag === 'a') linkDepth++
      if (CONTAINER_TAGS.has(tag)) containerStack.push(blocks.length)
    } else {
      if (tag === 'title') inTitle = false
      if (SKIP_TAGS.has(tag)) { inSkip = Math.max(0, inSkip - 1); continue }
      if (inSkip > 0) continue
      if (tag === 'a') linkDepth = Math.max(0, linkDepth - 1)
      if (CONTAINER_TAGS.has(tag)) {
        const start = containerStack.length > 0 ? containerStack.pop()! : null
        // 仅当容器内**没有产出任何正文块**时（纯链接侧栏/导航）丢弃累积文本。
        // 容器内已有正文块（如表格 td 数据）必须保留  否则 td/p 之外的
        // 剩余文本会被整个丢掉。
        if (start !== null && blocks.length === start) { current = []; currentLink = [] }
      }
      if (BLOCK_TAGS.has(tag)) flush(tag)
      if (CONTAINER_TAGS.has(tag) || BLOCK_TAGS.has(tag)) depth = Math.max(0, depth - 1)
    }
  }

  if (blocks.length === 0) return { text: '', title: title.trim() }

  // 按容器深度分组归并：同一深度且相邻的块合并成一段
  const merged: Array<{ score: number; group: TextBlock[] }> = []
  let group: TextBlock[] = []
  let groupDepth: number | null = null
  for (const b of blocks) {
    if (groupDepth === null || b.depth === groupDepth) {
      group.push(b); groupDepth = b.depth
    } else {
      merged.push({ score: groupScore(group), group }); group = [b]; groupDepth = b.depth
    }
  }
  if (group.length > 0) merged.push({ score: groupScore(group), group })

  // 保留与最高分组同量级的组：导航/页脚得分通常差 3-6 倍，
  // 用 max*0.6 比固定分位稳（分位会把"第二高但仍是噪音"的组带上）。
  const maxScore = Math.max(...merged.map(m => m.score))
  const threshold = maxScore * 0.6
  const kept = merged.filter(m => m.score >= threshold).map(m => m.group)
  kept.sort((a, b) => a[0]!.start - b[0]!.start)  // 文档顺序

  const parts: string[] = []
  let total = 0
  for (const g of kept) {
    const text = g.map(b => b.text).join('\n')
    if (text.trim() === '') continue
    if (total + text.length > maxChars) {
      const remaining = maxChars - total
      if (remaining > 200) parts.push(text.slice(0, remaining).replace(/\s+$/u, ''))
      break
    }
    parts.push(text)
    total += text.length
  }
  return { text: parts.join('\n\n'), title: title.trim() }
}

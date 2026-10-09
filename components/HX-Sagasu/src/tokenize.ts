/**
 * 中英混排检索分词  **索引侧与查询侧唯一共用**的分词函数。
 *
 * 对齐已确认规则「全文检索索引与查询必须共用同一分词函数」: 两侧若各写一份，
 * 召回会**静默失效**（不报错，只是查不到），而且这类缺陷在功能测试里看不出来。
 * 因此本文件是全组件唯一的"文本 → 词"实现。
 *
 * 算法与不变量取自 HX-Memory 的 `src/kernel/cjk.ts`（已验证的实测依据，
 * Node 24.15 / SQLite 3.51.3）:
 *   - FTS5 unicode61 把连续汉字当一个 token → "并发" 查不中 "所有容器都有并发策略问题";
 *   - FTS5 trigram 需 >= 3 字符 → 2 字中文查询（"并发"/"容器"）恒不命中;
 *   - Intl.Segmenter('zh-Hans') 能切词，但会把 "连接池" 切成 "连接" + "池"，未登录词无保障。
 * 方案: 双流  词流（Segmenter，保精度）+ CJK bigram 流（保召回）。BM25 给词流更高权重。
 *
 * 与 HX-Memory 的关系: 算法相同、**身份独立**。两者语料与演进节奏不同，共享版本号
 * 会让一方的改动强制另一方重建索引。若将来 HX-Memory 把 tokenizer 作为公开端口导出，
 * 本文件应改为直接引用它而不是继续维护副本。
 */

/** 分词逻辑版本。**任何**影响输出的改动都必须 +1  它进索引身份，不符即全量重建。 */
export const TOKENIZER_VERSION = 1

/** CJK 及谚文/假名区（这些文字没有空格分词，需要 bigram 兜底）。 */
const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

let segmenter: Intl.Segmenter | null | undefined

/** Intl.Segmenter 是可选能力（精简 ICU 的 Node 可能没有）；缺失时退化为纯 bigram。 */
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    try {
      segmenter = typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter('zh-Hans', { granularity: 'word' })
        : null
    } catch {
      segmenter = null
    }
  }
  return segmenter
}

export interface TermStreams {
  /** 词流: 语言感知切词。权重高。 */
  words: string[]
  /** CJK bigram 流: 保证 2 字查询与未登录词可召回。权重低。 */
  bigrams: string[]
}

/** 把一段文本切成词流 + bigram 流。索引侧与查询侧共用。 */
export function termStreams(text: string): TermStreams {
  const words: string[] = []
  const bigrams: string[] = []
  const normalized = fold(text)
  if (normalized.trim() === '') return { words, bigrams }

  const seg = getSegmenter()
  if (seg !== null) {
    for (const part of seg.segment(normalized)) {
      if (!part.isWordLike) continue
      const t = part.segment.trim()
      if (t !== '') words.push(t)
    }
  } else {
    for (const chunk of normalized.match(/[^\s]+/g) ?? []) {
      for (const m of chunk.matchAll(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[a-z0-9_]+/gu,
      )) {
        const t = m[0]
        if (t !== undefined && t !== '') words.push(t)
      }
    }
  }

  for (const chunk of normalized.match(/[^\s]+/g) ?? []) {
    let run = ''
    const flush = (): void => {
      if (run.length === 1) bigrams.push(run)
      else for (let i = 0; i + 1 < run.length; i++) bigrams.push(run.slice(i, i + 2))
      run = ''
    }
    for (const ch of chunk) {
      if (CJK_CHAR.test(ch)) run += ch
      else flush()
    }
    flush()
  }

  return { words, bigrams }
}

/** 文本 → 词集（词流 + bigram 流，去重）。索引与查询的**唯一**入口。 */
export function tokenSet(text: string): Set<string> {
  const s = termStreams(text)
  const out = new Set<string>()
  for (const t of s.words) out.add(t)
  for (const t of s.bigrams) out.add(t)
  return out
}

/** 带权词表: 词流权重 2，bigram 权重 1。用于检索打分。 */
export function weightedTerms(text: string): Map<string, number> {
  const s = termStreams(text)
  const out = new Map<string, number>()
  for (const t of s.words) out.set(t, Math.max(out.get(t) ?? 0, 2))
  for (const t of s.bigrams) if (!out.has(t)) out.set(t, 1)
  return out
}

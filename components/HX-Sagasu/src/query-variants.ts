/**
 * 查询变体：把中文查询**补一条英文**，让权威层的召回量上一个台阶。
 *
 * ## 实测依据（2026-09-19，本机一手）
 *
 * 同一批来源（第 0 层 11 个），中文查询 vs 它的英文改写：
 *
 * ```
 *   Rust 所有权        → 15 条  |  Rust ownership borrow checker  → 21 条   (+40%)
 *   阿司匹林 相互作用    → 13 条  |  aspirin drug interaction        → 21 条   (+62%)
 *   向量数据库 选型      → 13 条  |  vector database comparison      → 23 条   (+77%)
 * ```
 *
 * **三个查询全部上升，幅度 40-77%。** 这不是猜测  而 aether-search 的提示词里
 * 恰好写着同一件事（`English first for volume`），两边独立指向同一个结论。
 *
 * ## 为什么不直接翻译
 *
 * **翻译需要 LLM，而本组件是零依赖的**（无 `package.json`）。所以这里只提供
 * **可注入的改写器**，默认实现是**词典级**的：
 *
 * - 有内置词表 → 逐词替换得到英文查询
 * - 没有 → 返回 `null`（**不猜**）
 *
 * **词典级改写必然不完备**，但它的失败模式是**安全的**：改写不出就不补查询，
 * 退化成当前行为。**而不是产出一个错误的英文查询去污染召回。**
 *
 * ## 与「多查询变体」的关系
 *
 * aether-search 的 `Connector.multi_query` 抽象的是「**一个后端**能不能把 N 个变体
 * 折进一次请求」。**我们没有那样的后端**，所以这里是**在调用方扇出**：
 * 对每个来源依次用 `[原查询, 英文变体]` 调用，结果合并。
 */

/** 查询改写器。返回 `null` = **改写不出**（不猜）。 */
export type QueryRewriter = (query: string) => string | null

/**
 * 内置词表  **只收跨领域高频词**，且**每条都是名词性术语**。
 *
 * **为什么不收动词/虚词**: 它们的译法随语境变化，逐词替换会产出语法不通的查询。
 * 而检索后端多数做的是词项匹配，**名词术语替换的收益远大于语法正确性**。
 *
 * **这张表刻意小**: 它只覆盖「中文社区常问、而英文资料更全」的领域术语。
 * 完备性不是目标  **补不上就退化成原查询**，代价是零。
 */
const GLOSSARY: Readonly<Record<string, string>> = {
  // 通用学术/技术
  '相互作用': 'interaction',
  '副作用': 'side effects',
  '对比': 'comparison',
  '选型': 'comparison',
  '入门': 'getting started',
  '教程': 'tutorial',
  '最佳实践': 'best practices',
  '性能': 'performance',
  '优化': 'optimization',
  '原理': 'principles',
  '实现': 'implementation',
  '架构': 'architecture',
  '设计模式': 'design patterns',
  // 编程
  '所有权': 'ownership',
  '借用': 'borrow checker',
  '生命周期': 'lifetime',
  '并发': 'concurrency',
  '异步': 'async',
  '内存': 'memory',
  '垃圾回收': 'garbage collection',
  '编译': 'compiler',
  '运行时': 'runtime',
  '指针': 'pointer',
  '数据库': 'database',
  '向量': 'vector',
  '索引': 'index',
  '缓存': 'cache',
  '部署': 'deployment',
  '测试': 'testing',
  '重构': 'refactoring',
  '依赖': 'dependency',
  '框架': 'framework',
  '接口': 'interface',
  // 医学/生命科学
  '药物': 'drug',
  '临床': 'clinical',
  '试验': 'trial',
  '疗效': 'efficacy',
  '剂量': 'dosage',
  '机制': 'mechanism',
  '蛋白质': 'protein',
  '基因': 'gene',
  '细胞': 'cell',
  // 法律/金融
  '合同': 'contract',
  '纠纷': 'dispute',
  '判决': 'judgment',
  '诉讼': 'litigation',
  '专利': 'patent',
  '版权': 'copyright',
  '利率': 'interest rate',
  '通胀': 'inflation',
  '汇率': 'exchange rate',
  '财报': 'financial report',
}

/** 词表规模  供测试与文档引用。 */
export const GLOSSARY_SIZE = Object.keys(GLOSSARY).length

const CJK_RUN = /[\u4e00-\u9fff]+/gu

/**
 * 默认改写器：**词典级**逐词替换。
 *
 * **判据: 至少替换掉**一半**的 CJK 词块才算改写成功**  只换掉一个词而剩下的
 * 全是中文，产出的会是一个**中英混杂的查询**，那对英文后端几乎没有帮助，
 * 却可能因为多了一个英文词而干扰中文后端。
 *
 * **替换不出时返回 `null`**  不猜。
 */
export function glossaryRewriter(query: string): string | null {
  const runs = query.match(CJK_RUN) ?? []
  if (runs.length === 0) return null   // 没有中文 → 不需要改写
  const parts: string[] = []
  let replaced = 0
  // **逐块处理**: 一个块可能整体命中词表（'相互作用'），也可能需要拆（'阿司匹林' 不在表里）
  for (const run of runs) {
    const whole = GLOSSARY[run]
    if (whole !== undefined) {
      parts.push(whole)
      replaced++
      continue
    }
    // 整块没命中 → 按最长匹配切分，切不出的部分**累积成连续汉字**。
    //
    // **为什么不能逐字 push**: 我第一版把每个未命中的字单独 push，于是
    // `阿司匹林` 变成了 `阿 司 匹 林`  **空格把中文词切碎了**，
    // 而那会毁掉中文后端的词项匹配（中文检索按词/字组匹配，不按空格分词）。
    // 测试抓到了它（断言 `/阿司匹林/` 失败，实际值是 `阿 司 匹 林 interaction`）。
    let rest = run
    const pieces: string[] = []
    let pending = ''   // 累积连续未命中的汉字
    let hit = 0
    const flush = (): void => {
      if (pending !== '') { pieces.push(pending); pending = '' }
    }
    // 贪心最长匹配（词表里最长的是 4 字）
    while (rest.length > 0) {
      let matched = false
      for (let len = Math.min(4, rest.length); len >= 2; len--) {
        const seg = rest.slice(0, len)
        const en = GLOSSARY[seg]
        if (en !== undefined) {
          flush()          // 命中的译文之前，先把已累积的汉字吐出去（保持原序）
          pieces.push(en)
          rest = rest.slice(len)
          hit++
          matched = true
          break
        }
      }
      if (!matched) {
        pending += rest[0]!   // **累积，不加空格**
        rest = rest.slice(1)
      }
    }
    flush()
    if (hit > 0) replaced++
    parts.push(pieces.join(' '))
  }
  // **一半以上要换掉**  见上面的判据注释
  if (replaced * 2 < runs.length) return null
  // 拉丁词（Rust/Python 等）原样保留：它们本来就是英文
  const out = query.replace(CJK_RUN, () => parts.shift() ?? '')
  return out.replace(/\s+/gu, ' ').trim()
}

/**
 * 为一个查询生成**额外**的检索变体。
 *
 * **只加不减**: 原查询永远保留（它是用户真正想问的），变体是补充。
 * 返回空数组 = 没有变体（改写不出，或本来就是英文）。
 */
export function queryVariants(query: string, rewrite: QueryRewriter = glossaryRewriter): string[] {
  const alt = rewrite(query)
  if (alt === null) return []
  const norm = alt.trim()
  // **与原文相同就不算变体**  否则会白白多打一轮请求
  if (norm === '' || norm === query.trim()) return []
  return [norm]
}

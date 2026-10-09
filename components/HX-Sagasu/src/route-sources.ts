/**
 * 来源语义路由：**决定该查谁**，而不是查完再筛。
 *
 * ## 为什么需要它（2026-09-18，来源扩到 44 个后倒逼）
 *
 * 实测: 查询「美国 GDP 增速」召回了 `uniprot`（蛋白质）与 `rcsb_pdb`（蛋白质结构）
 * **完全不相关**。原因是 **第 1 层 31 个来源被无差别并发查询**。
 *
 * | | 扩张前（15 来源） | 扩张后（44 来源） |
 * |---|---|---|
 * | 每层并发查询数 | 11 | **31** |
 * | 注定返回 0 或不相关的 | 约 4 | **约 20** |
 *
 * 三重代价: **延迟**（2/3 请求浪费）、**限流风险**（argo 上游有配额，
 * GitHub 10 次/分已实测撞过）、**噪声**（不相关来源的结果稀释相关性判据）。
 *
 * ## 与 argo 的关系
 *
 * 形态借鉴 argo 的 `tfidf_router.py`（TF-IDF + 余弦 + boost + 配额感知），
 * **但领域文档是我们自己写的，不是照搬它的**  实测它的 `domain_profiles.json`
 * 只覆盖 `65/157` 个引擎，而**我们接的 44 个来源里只有 12 个有文档**。
 * 照搬意味着 32 个来源无法参与路由，等于没做。
 *
 * ## 刻意不做的两件
 *
 * 1. **不做跨来源分值的融合**  路由分只决定"查不查"，**不参与结果排序**
 *    （那是第一轮就立的铁律: 各来源自报分口径不可比）。
 * 2. **不做"只查 top-k"**  那太激进。路由的产出是**跳过注定为空的来源**，
 *    不是"只信最像的几个"。任何来源只要与查询有一点主题关联就保留。
 */

import { weightedTerms } from './tokenize.ts'
import { SOURCES, type SourceDescriptor } from './recall.ts'

/**
 * 每个来源的**能力描述**: 它擅长回答什么。
 *
 * 写这里的判据是「**用户会怎么问这件事**」，不是「这个来源的技术分类」
 * 因为要匹配的是**查询的措辞**。
 *
 * 例如 `pubchem` 要收「阿司匹林」「分子量」「化学式」而**不收**「化合物数据库」：
 * 前者是人的问法，后者是百科的写法。
 */
/**
 * 每个来源的**话题族**。
 *
 * ## 为什么不能用"能力描述词"逐词匹配（2026-09-18 实测否决了第一版）
 *
 * 第一版我给每个来源写了一段"擅长什么"的描述，用查询词与它做余弦。
 * **实测立刻暴露根本缺陷**: 「Rust 所有权」跳过了 `juejin`（中文技术社区，
 * **恰恰最该查**），因为它的描述是"掘金 前端 后端 编程 教程 实战 面试 中文技术"
 * **没有一个词与 `rust`/`所有`/`有权` 匹配**。
 *
 * 同理 `duckduckgo`（通用兜底）被所有查询跳过，因为它的描述只有"搜索 通用 网页"。
 *
 * **错在语义层不匹配**: 我用"来源的自述词"去匹配"查询的话题词"。
 * 而 `Rust 所有权` 与 `juejin` 的关系不是"词重合"，是"**话题类别**归属"
 * 编程问题 → 技术社区。**类别是有限集，可以枚举；话题是无界的，枚举不了。**
 *
 * ## 所以改成: 查询先判**话题类别**，来源声明它覆盖哪些类别
 *
 * 这与 `recall.ts` 的 `classifyQueryIntent` 是同一思路（那边判意图给来源档位），
 * 但**用途不同**: 那个决定"够不够用"（充分性），这个决定"**查不查**"（省请求）。
 */
export type TopicClass =
  | 'code'        // 编程、代码、工程
  | 'academic'    // 论文、研究、学术
  | 'biomedical'  // 医学、临床、药物
  | 'science'     // 化学、生物、地理、物理
  | 'finance'     // 财经、宏观、市场
  | 'legal'       // 法律、政策
  | 'general'     // 通用（无法归类）
  | 'media'       // 影视、书籍、音乐、动漫
  | 'social'      // 社区讨论、口碑
  // **生成式 AI 的「怎么用」**（2026-09-19 加） 与 `academic` 是**互斥**的。
  //
  // 判据不是「提到 AI」而是「**在问怎么用它**」: 提示词工程、生图/生视频工具、
  // 模型选型、参数调法。而 `academic` 问的是「有什么研究」。
  //
  // **为什么必须分开**: 用户的 benchmark「GPT 文生图 提示词」此前归不了类
  // （词表里没有这一族），于是走兜底分支 → keep 18 个 → **crossref 的 AIGC 论文
  // 与 pubmed 的病史采集挤进了前 5**。那不是排序问题，是**选源问题**。
  | 'genai'

/**
 * 话题类别的**判定正则**。
 *
 * 刻意写得**宽**（宁可多判一个类别，不可漏判） 因为漏判会让整族来源被跳过，
 * 而多判只是多查几个来源。**代价不对称**（见 `routeSources` 的注释）。
 */
const TOPIC_PATTERNS: ReadonlyArray<readonly [TopicClass, RegExp]> = [
  ['biomedical', /医学|临床|疾病|药物|患者|诊断|病理|病毒|疫苗|药理|症状|治疗|医院|癌|肿瘤|血糖|血压|药物相互作用|相互作用|剂量|禁忌|副作用|适应症|疗效|药代|抗生素|阿司匹林|布洛芬|胰岛素|靶点|受试者/i],
  ['science', /化学|分子|化合物|蛋白质|氨基酸|基因序列|物种|分类学|地质|地震|遥感|卫星|气象|物理|量子|材料|元素|反应|溶液|浓度|摩尔|晶体|实验|材料|合金|半导体/i],
  ['finance', /经济|\\bgdp\\b|通胀|利率|财政|货币|股市|股票|财报|营收|市场|宏观|失业|汇率|基金|增速|同比增长|财政赤字|国债|外汇|贸易|进出口|物价|cpi|ppi/i],
  ['legal', /法律|法规|判例|判决|诉讼|合同纠纷|条例|政策文件|司法|条约|合规/i],
  ['academic', /论文|文献|综述|期刊|学术|研究|引用|元分析|学位|课题|预印本/i],
  ['code', /代码|编程|函数|编译|运行时|并发|线程|指针|内存|重构|调试|框架|依赖|包管理|\bapi\b|\bsdk\b|\brust\b|\bpython\b|\bjava\b|\bjavascript\b|\btypescript\b|\breact\b|\bvue\b|\bgo\b|\bsql\b|\bdocker\b|\bkubernetes\b|\bc\+\+\b|所有权|借用|闭包|泛型/i],
  ['media', /电影|电视剧|动漫|动画|漫画|小说|书籍|音乐|专辑|影评|书评|评分|演员|导演|游戏|角色/i],
  ['social', /评价|口碑|怎么样|好用吗|推荐|吐槽|体验|网友|大家|讨论|种草|拔草|争议|热搜/i],
  // **放在靠后位置**（不抢前面的更专精的族）: 一个查询同时命中 biomedical 与 genai 时，
  // 它更可能是医学问题（'AI 辅助诊断'）。**代价不对称**在这里也同样适用。
  ['genai', /提示词|prompt|文生图|文生视频|图生图|生图|生视频|大模型|语言模型|\bllm\b|\bgpt\b|chatgpt|midjourney|stable\s*diffusion|\bsd\b|dall-?e|sora|comfyui|\blora\b|微调|fine-?tun|embedding|向量化|rag\b|智能体|agent|多模态|扩散模型|aigc/i],
]

/** 判定查询的话题类别。**可以命中多个**（跨领域问题是常态）。 
 * .agents/notes/implemented/architecture/2026-09-19-benchmark-is-actually-fine.md
 */
export function classifyTopic(query: string): Set<TopicClass> {
  const out = new Set<TopicClass>()
  for (const [cls, re] of TOPIC_PATTERNS) if (re.test(query)) out.add(cls)
  return out
}

/**
 * 每个来源覆盖哪些**话题类别**。
 *
 * `'*'` = 全域（通用搜索、百科一类"什么都能问"的来源）。
 *
 * **判定依据是"这个来源的用户会问什么"**，不是它的技术架构：
 * `juejin` 覆盖 `code`，因为人会去那儿问编程问题；它不覆盖 `biomedical`。
 */
export const SOURCE_TOPICS: Readonly<Record<string, readonly (TopicClass | '*')[]>> = {
  // ── 第 0 层（永不跳过，此处仅为完整性）─────────────────────
  crossref: ['academic'], arxiv: ['academic', 'science'], pubmed: ['biomedical'],
  openalex: ['academic'], github: ['code', 'genai'], wikipedia: ['*'],
  // **hackernews/mdn/ietf/stackexchange 不覆盖 genai**  它们是「怎么实现」，
  // 而 genai 问的是「怎么用某个工具」。**唯一的例外是 hackernews**:
  // 它对 AI 工具的讨论量很大且质量高（发布、对比、踩坑）。
  hackernews: ['code', 'social', 'genai'], mdn: ['code'], ietf: ['code'],
  npm: ['code', 'genai'], stackexchange: ['code'],
  // ── 第 1 层 ────────────────────────────────────────────────
  juejin: ['code', 'genai'], bilibili: ['*'], 'telegram-public': ['*'],
  // **genai 的可用来源很少**  这是本轮实测的诚实结论:
  // 中文技术社区（juejin/bilibili）与通用搜索是主力，
  // 而**学术库（crossref/pubmed/openalex/doaj/europepmc）明确排除** 
  // 用户 benchmark 的噪声正是它们带来的。
  //
  // huggingface 覆盖 genai: 模型卡与 space 是提示词/参数的一手来源。
  // devto 覆盖 genai: 它的 AI 教程量可观。
  duckduckgo: ['*'],
  baidu_baike: ['*'], moegirl: ['media'], reddit: ['*'],
  douban_book: ['media'], open_library: ['media'], gutenberg: ['media'],
  devto: ['code', 'genai'], huggingface: ['code', 'genai'], crates: ['code'], dblp: ['academic', 'code'],
  pypi: ['code'], stackoverflow: ['code'],
  pubchem: ['science', 'biomedical'], clinicaltrials: ['biomedical'],
  openfda: ['biomedical'], uniprot: ['science'], rcsb_pdb: ['science'],
  gbif: ['science'], nasa_cmr: ['science'], usgs: ['science'],
  fred: ['finance'], worldbank: ['finance'], nbs_stats: ['finance'], sec_edgar: ['finance'],
  courtlistener: ['legal'], gov_policy: ['legal'],
  europepmc: ['biomedical', 'academic'], doaj: ['academic'],
  'argo:anysearch': ['*'],
} as const;

/** 保留旧接口名以免破坏调用方；它现在是话题族而不是描述词。 */
export const SOURCE_PROFILES: Readonly<Record<string, readonly (TopicClass | '*')[]>> = SOURCE_TOPICS

/** 一份领域文档在索引里的形态：词 → 权重。 */
export interface Profile {
  readonly sourceId: string
  readonly terms: ReadonlyMap<string, number>
}

/** 编译成可打分的形态。**只编译一次**（模块级缓存）。 */
let compiled: Profile[] | null = null

export function compileProfiles(): Profile[] {
  if (compiled !== null) return compiled
  const out: Profile[] = []
  for (const [sourceId, docs] of Object.entries(SOURCE_PROFILES)) {
    const terms = new Map<string, number>()
    for (const doc of docs) {
      for (const [t, w] of weightedTerms(doc)) terms.set(t, Math.max(terms.get(t) ?? 0, w))
    }
    out.push({ sourceId, terms })
  }
  compiled = out
  return out
}

export interface RouteDecision {
  /** 该查的来源 id。**保持 `SOURCES` 的登记顺序**  排序不在这里决定。 */
  readonly keep: string[]
  /** 被跳过的来源 id → 为什么跳。**跳过必须可解释**。 */
  readonly skip: ReadonlyMap<string, string>
}

/**
 * 查询与某来源能力描述的相似度（余弦，0..1）。
 *
 * 用 `weightedTerms` 而不是自己分词  **与索引侧共用同一分词函数**
 * （已确认规则: 全文检索索引与查询必须共用同一分词函数）。
 */
export function similarity(queryTerms: ReadonlyMap<string, number>, profile: Profile): number {
  if (queryTerms.size === 0 || profile.terms.size === 0) return 0
  let dot = 0
  let qNorm = 0
  let pNorm = 0
  for (const [t, w] of queryTerms) {
    qNorm += w * w
    const pw = profile.terms.get(t)
    if (pw !== undefined) dot += w * pw
  }
  for (const w of profile.terms.values()) pNorm += w * w
  if (dot === 0) return 0
  return dot / (Math.sqrt(qNorm) * Math.sqrt(pNorm))
}

/**
 * 决定这次查询要查哪些来源。
 *
 * ## 判据（只跳"明显不搭"的，跳过必须有理由）
 *
 * - **相似度为 0**  查询里**一个**能力词都没命中该来源的描述 → 跳过。
 *   这是最强也最安全的信号: 完全无交集。
 * - **相似度 > 0 但极低**（低于中位数的一半）→ **不跳**。理由见下。
 *
 * ## 为什么阈值定得这么松
 *
 * 路由的代价**不对称**:
 *   - 误跳（本该查却跳了）→ **证据永久丢失**，且用户看不见
 *   - 误查（不该查却查了）→ 浪费时间与配额，但**结果仍会被排序判据筛掉**
 *
 * 所以宁可多查。**"相似度低"不等于"不相关"**  一个跨领域问题可能同时命中多个族。
 * 只有**完全零交集**才敢跳。
 *
 * ## 边界情形
 *
 * - `tier === 0` 的来源**永不跳过**。它们是"权威公域"，且只有 11 个 
 *   省下的请求少，误跳的代价大。（对齐第 5 轮立的"权威层永不被短路"）
 * - 查询太短（无有效词）→ **不跳任何**。判据不成立时不做决定。
 */
export function routeSources(
  query: string,
  sources: readonly SourceDescriptor[] = SOURCES,
): RouteDecision {
  const keep: string[] = []
  const skip = new Map<string, string>()
  const topics = classifyTopic(query)

  // **无法归类 → 只保留"通用来源"**（2026-09-18 修正）。
  //
  // 此前这里返回"全查"。理由是对的（判不出类别时跳过任何来源都是赌），
  // **但代价实测不可接受**:
  //
  //   "durov telegram" → 无法归类 → 查 31 个第 1 层来源
  //   而 argo 的 MCP server 是**完全串行**的（mcp_transport.py:78 的 while True 单线程循环）
  //   → 实测 31 个串行 = 123 秒，其中 3 个慢引擎各占 8 秒超时
  //
  // **折中**: 无法归类时保留**标了 '*' 的通用来源**（它们声明了"什么都能问"），
  // 跳过那些**声明了具体话题族**的  一个判不出类别的查询，
  // 去问"蛋白质数据库"/"判例库"本来就不是合理选择。
  //
  // **这不是"赌"**  它保留的正是那些**自称通用**的来源，跳过的正是那些
  // **自称专精**而查询又没命中其专精的。判据仍然来自来源自己的声明。
  if (topics.size === 0) {
    for (const s of sources) {
      // **权威层永不跳过  这条在兜底分支里同样成立**（2026-09-18 修）。
      // 我第一版漏了它：兜底分支在 tier 检查**之前**就 return 了，
      // 于是 crossref/pubmed 这些第 0 层来源被判"只覆盖 academic/biomedical"而跳过 
      // 实测 6 条层级行为测试因此变红。
      if (s.tier === 0) { keep.push(s.id); continue }
      const owned = SOURCE_TOPICS[s.id]
      // 没有声明的 → 保留（不因"我们没写声明"而丢）
      if (owned === undefined || owned.includes('*')) { keep.push(s.id); continue }
      skip.set(s.id, '查询无法归类，而「' + s.label + '」只覆盖 ' + owned.join('/') + '  保留通用来源')
    }
    return { keep, skip }
  }

  for (const s of sources) {
    // **权威层永不跳过**  它们是"权威公域"，且只有 11 个:
    // 省下的请求少，误跳的代价大（对齐"权威层永不被短路"）。
    if (s.tier === 0) { keep.push(s.id); continue }
    const owned = SOURCE_TOPICS[s.id]
    // 没有话题声明的来源 → 不跳（宁可多查，也不因"我们没写声明"而丢证据）
    if (owned === undefined) { keep.push(s.id); continue }
    // 全域来源（通用搜索、百科）→ 永不跳过
    if (owned.includes('*')) { keep.push(s.id); continue }
    // **交集判据**: 来源覆盖的类别里，有**任何一个**被查询命中就查。
    // 宽松是刻意的  跨领域问题会命中多个类别，任何一个成立都该查。
    const hit = owned.find(c => topics.has(c as TopicClass))
    if (hit !== undefined) { keep.push(s.id); continue }
    skip.set(s.id, '「' + s.label + '」只覆盖 ' + owned.join('/') +
      '，而查询属于 ' + [...topics].join('/'))
  }
  return { keep, skip }
}

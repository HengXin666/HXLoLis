/**
 * L3 分层召回  **权威优先，搜索引擎兜底**。
 *
 * 这一层要回答的唯一问题: 什么时候可以停止下降？
 *
 * 用户明确要求的优先序是"先聚合各大权威平台，然后才是搜索引擎"。把它落成结构而不是
 * 一句口号，需要三个东西:
 *   1. 来源的**层级归属**是可被反驳的数据（`SourceDescriptor.rationale`），不是硬编码的 if；
 *   2. **充分性**是一条显式规则，而不是"拿到 N 条就继续/停止"的隐式约定；
 *   3. 每次召回都要能回答"哪一层跑了、哪一层为什么没跑"否则"分层"只是装饰。
 *
 * 三个必须防住的失效模式（每条都有对应测试）:
 *   A. **把失败当空**。若第 0 层全部报错却按"0 条结果"处理，系统会安静地降级到
 *      搜索引擎，而用户以为自己看的是权威来源。所以充分性只统计**成功**返回的命中，
 *      且失败的层级必须带 `failures` 一并上报。
 *   B. **降级不可见**。若最终结果不标注实际到达了哪一层，调用方无法区分
 *      "权威来源确认过且够用" 与 "权威来源全挂了、这是搜索结果的兜底"。
 *   C. **空结果的无限下降**。0 条命中永远不构成"充分"，必须有明确的终止条件。
 */

import { AdapterError } from './adapters/adapter.ts'
import { normalize } from './normalize.ts'
import { routeSources } from './route-sources.ts'
import { resolveScope } from './scope-resolve.ts'
import { queryVariants } from './query-variants.ts'
import { tokenSet, termStreams } from './tokenize.ts'

/** 0 = 权威公域（官方/标准/学术/一手数据）; 1 = 垂直社区与私域; 2 = 通用搜索引擎兜底。 */
export type Tier = 0 | 1 | 2

export const TIER_LABEL: Record<Tier, string> = {
  0: '权威公域',
  1: '垂直社区/私域',
  2: '通用搜索引擎',
}

export interface SourceDescriptor {
  /** 引擎/来源 id。 */
  id: string
  label: string
  tier: Tier
  /**
   * **为什么它是这一层**。必须写成一个可被反驳的判断 
   * 例如"这是该领域的官方发布渠道"而不是"它是大站"。
   * 没有 rationale 的来源不允许登记（由测试强制）。
   */
  rationale: string
  /**
   * 该来源需要调用方提供的作用域（如频道名）。缺省 = 吃原始查询。
   *
   * **声明在来源上而不是藏在取数函数里**: 召回层需要在**发出请求之前**判定
   * "这次用不上它"，所以这个信息必须对召回层可见。
   */
  requiredScope?: readonly string[]
}

/**
 * 已登记的来源。
 *
 * 注意: 这张表的条目全部来自**已实测可用**的通道。不能因为"某网站在现实里很权威"
 * 就往第 0 层塞一个取不到数据的条目  那会让充分性判断基于不存在的供给。
 * 权威性要同时满足"内容权威"与"本机取得到"。
 
 * .agents/notes/implemented/architecture/2026-09-18-authoritative-engine-families.md
 */
export const SOURCES: readonly SourceDescriptor[] = [
  // ── 第 0 层: 权威公域。权威性来自**机构责任与持久标识符**（DOI/PMID/arXiv/owner），
  //    不是来自搜索排名  这是它与"搜到某个官网"的根本差别。
  {
    id: 'crossref',
    label: 'Crossref',
    tier: 0,
    rationale: '出版体系登记机构；每条结果带 DOI，可解析回出版方，标识符由第三方保证',
  },
  {
    id: 'arxiv',
    label: 'arXiv',
    tier: 0,
    rationale: '预印本一手存档，arXiv ID 稳定；未经同行评审，所以只作"一手"而非"定论"',
  },
  {
    id: 'pubmed',
    label: 'PubMed',
    tier: 0,
    rationale: '生物医学文献的国家级索引（NLM）；PMID 可查，但只覆盖该学科',
  },
  {
    id: 'openalex',
    label: 'OpenAlex',
    tier: 0,
    rationale: '跨学科开放文献图，带 DOI 与引用关系；数据由社区镜像，权威性弱于出版方本身',
  },
  {
    id: 'github',
    label: 'GitHub',
    tier: 0,
    rationale: '代码事实的一手来源；仓库有 owner 与提交历史，身份可验证，但不代表设计正确',
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    tier: 0,
    rationale: '有编辑审核与引用要求的综述来源；适合定位术语与线索，**不可单独作为定论**',
  },
  {
    id: 'hackernews',
    label: 'Hacker News',
    tier: 0,
    rationale: '技术讨论的原始存档、可长期引用（HN id 稳定）；是观点而非事实，价值在时间线',
  },
  {
    id: 'mdn',
    label: 'MDN',
    tier: 0,
    rationale: '浏览器厂商共同维护的 Web 平台规范解释；mdn_url 是稳定路径，但不是标准本身',
  },
  {
    id: 'ietf',
    label: 'IETF Datatracker',
    tier: 0,
    rationale: 'RFC 的第一方发布系统；文档名（RFC 编号/draft 名）就是稳定且全球唯一的标识符',
  },
  {
    id: 'npm',
    label: 'npm registry',
    tier: 0,
    rationale: '包的唯一发布方记录；name@version 是全球唯一坐标，谁发布了什么无法被第三方冒名',
  },
  {
    id: 'stackexchange',
    label: 'Stack Overflow',
    tier: 0,
    rationale: '有投票与接受答案机制的问答存档，question_id 稳定；是经验共识而非规范，' +
      '但"有接受答案"与"正确"是两件事，原样呈现判断留给上层',
  },
  // ── 第 1 层: 垂直社区/私域
  {
    id: 'juejin',
    label: '掘金',
    tier: 1,
    rationale: '中文技术社区，文章 id 稳定；有编辑推荐但**无同行评审**，只作线索不作定论',
  },
  {
    id: 'bilibili',
    label: 'B站',
    tier: 1,
    rationale: '用户产出内容平台，内容权威性来自具体 UP 主的可核查性，不是平台本身',
  },
  {
    id: 'bilibili_hot',
    label: 'B站热门榜',
    tier: 1,
    rationale: '站内热门榜，条目 id 稳定；与 bilibili 搜索是两条路径（榜单 vs 检索），只作线索不作定论',
  },
  {
    id: 'telegram-public',
    label: 'Telegram 公开频道',
    tier: 1,
    rationale: '一手发布渠道（官方公告/项目方频道），但缺编辑审核，且只说他们想说的',
    // 实测（2026-09-16）: Telegram **只有频道内搜索**（t.me/s/<ch>?q=<term>），
    // 没有全站搜索（t.me/s/?q= 返回 302）。所以它必须拿到频道名才能查。
    requiredScope: ['channel'],
  },
  // ── 第 2 层: 兜底
  // ── 2026-09-18 扩张：新增的 argo 引擎（按能力族登记）──────────────
  // 一次能加这么多，是因为 argo 把 140 个引擎按 19 个**能力族**组织好了 
  // 族是能力契约，同族可互换。实测 10/10 探测全部返回结果。
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    tier: 2,
    rationale: '通用元搜索，覆盖面广、无权威性判断  只作兜底发现，不作证据',
  },
  {
    id: 'baidu_baike',
    label: '百度百科',
    tier: 1,
    rationale: '中文百科，词条 id 稳定；**无外部编辑审核**，权威性低于维基，只作中文语境的入口',
  },
  {
    id: 'moegirl',
    label: '萌娘百科',
    tier: 1,
    rationale: '中文 ACG 领域专精，该领域内覆盖率高于通用百科；同样无同行评审',
  },
  {
    id: 'reddit',
    label: 'Reddit',
    tier: 1,
    rationale: '国际社区，长尾经验集中；内容高度依赖具体 subreddit 的治理质量',
  },
  {
    id: 'douban_book',
    label: '豆瓣书影音',
    tier: 1,
    rationale: '中文书影音元数据与评分，条目 id 稳定；评分是主观聚合，不作事实判据',
  },
  {
    id: 'open_library',
    label: 'Open Library',
    tier: 1,
    rationale: 'Internet Archive 维护的图书元数据，ISBN 等持久标识符，属图书馆登记体系',
  },
  {
    id: 'gutenberg',
    label: 'Project Gutenberg',
    tier: 1,
    rationale: 'Internet Archive 维护的公版全文存档，每本有稳定的唯一编号；覆盖止于公版年份',
  },
  {
    id: 'devto',
    label: 'DEV Community',
    tier: 1,
    rationale: '技术博客平台，作者可核查；与掘金同族，提供英文对照视角',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    tier: 1,
    rationale: '模型/数据集仓库，owner 与 revision 可核查  该领域的一手供给',
  },
  {
    id: 'crates',
    label: 'crates.io',
    tier: 1,
    rationale: 'Rust 官方包登记机构（crates.io）维护，版本与校验和由该登记机构保证，非内容平台',
  },
  {
    id: 'dblp',
    label: 'dblp',
    tier: 1,
    rationale: 'CS 文献索引（Schloss Dagstuhl 维护），每条带稳定的 dblp key 可解析；与 Crossref 互补',
  },
  // ── 2026-09-18 第二批: argo 权威族引擎（有持久标识符的登记型来源）──
  {
    id: 'pubchem',
    label: 'pubchem',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'clinicaltrials',
    label: 'clinicaltrials',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'openfda',
    label: 'openfda',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'uniprot',
    label: 'uniprot',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'rcsb_pdb',
    label: 'rcsb_pdb',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'gbif',
    label: 'gbif',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'nasa_cmr',
    label: 'nasa_cmr',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'usgs',
    label: 'usgs',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'fred',
    label: 'fred',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'worldbank',
    label: 'worldbank',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'nbs_stats',
    label: 'nbs_stats',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'sec_edgar',
    label: 'sec_edgar',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'courtlistener',
    label: 'courtlistener',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'gov_policy',
    label: 'gov_policy',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'europepmc',
    label: 'europepmc',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'doaj',
    label: 'doaj',
    tier: 1,
    rationale: 'argo 引擎；条目带持久标识符（CID/PDB/AC/series_id 等），实测有产出；**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层',
  },
  {
    id: 'pypi',
    label: 'pypi',
    tier: 1,
    rationale: 'argo 引擎；包注册表/问答社区，内容来自具体作者（实测 2026-09-18 有产出）',
  },
  {
    id: 'stackoverflow',
    label: 'stackoverflow',
    tier: 1,
    rationale: 'argo 引擎；包注册表/问答社区，内容来自具体作者（实测 2026-09-18 有产出）',
  },
  {
    id: 'argo:anysearch',
    label: 'anysearch（argo 聚合）',
    tier: 2,
    rationale: '通用元搜索，覆盖面最广但无权威性判断，只能做兜底发现',
  },
]

export interface SourceHit {
  sourceId: string
  title: string
  url: string
  snippet?: string
  /** 该来源自报的分值。**不参与跨来源比较**（见 scoreHits 注释）。 */
  score?: number
  /**
   * 这条命中来自**缓存**而非本次新鲜取数（目前只有 argo 接入会设它）。
   *
   * **为什么要标出来**（2026-09-18）: 缓存内容与新鲜取数的内容**资格相同** 
   * 它是同一个引擎对同一个（或 ≥0.7 相似的）查询的真实产出。但"这次没真去查"
   * 是一件事，调用方有权知道，**特别是当结果要沉淀进证据账本时**。
   * 不标注就等于让缓存冒充新鲜取数  那是本项目一路在防的"静默伪装"。
   */
  cacheLevel?: 'L1' | 'L2'
}

/**
 * 文字系统。**不是语言检测**  只按字符集分类，不做语种判断。
 *
 * 存在的理由（实测依据，2026-09-16）: 第 0 层以英文语料库为主（Crossref/arXiv/
 * PubMed/OpenAlex/HN/Stack Overflow）。把中文查询喂进去，会拿到一批**标题看起来
 * 很权威、内容与问题无关**的结果  实测查询「Rust 所有权」返回的前三条是
 * Crossref 上的《全民所有自然资源资产所有权委托代理模式探究》等中文法律/资源论文
 * （它们确实含"所有权"，所以任何基于字符重叠的判据都会认为它们相关）。
 *
 * 危害不在于"相关性弱"，而在于它**满足了充分性条件**：条数够 → 停止下降 →
 * 真正可能有答案的中文社区（第 1 层）被挡在外面。用户看到一屏权威来源，
 * 却没有任何一条回答了问题。
 *
 * **这个信号能抓什么、抓不到什么（必须写清楚，否则会被当成"问题已解决"）**:
 *   - 抓得到: **文字系统不匹配**。"Rust 所有权" 拿到一屏纯英文结果 → 报警。
 *   - **抓不到: 同文字系统但话题无关**。真实观测到的那个案例恰恰属于这一类 
 *     Crossref 返回的中文论文里确实含"所有权"二字，所以文字系统判据会**通过**。
 *     我们无法在无语义理解的前提下判断"这篇《自然资源资产所有权》与 Rust 无关"。
 *
 * 因此这条判据是**必要的但不充分的**: 它消掉了一个失效族，剩下一族仍然敞着。
 * 不要因为有了它就以为"权威层的空壳问题已解决"。
 */
export type Script = 'cjk' | 'latin' | 'mixed' | 'other'

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const LATIN_RE = /[a-zA-Z]/

export function detectScript(text: string): Script {
  const cjk = (text.match(new RegExp(CJK_RE.source, 'g')) ?? []).length
  const latin = (text.match(new RegExp(LATIN_RE.source, 'g')) ?? []).length
  if (cjk === 0 && latin === 0) return 'other'
  if (cjk > 0 && latin > 0) return 'mixed'
  return cjk > 0 ? 'cjk' : 'latin'
}

/** 取数函数。失败必须抛错（不允许返回空数组表示失败） 这是全项目的失败契约。 
 * .agents/notes/implemented/architecture/2026-09-16-applicability-is-not-failure.md
 * .agents/notes/implemented/architecture/2026-09-16-layered-recall-authority-first.md
 * .agents/notes/implemented/architecture/2026-09-16-query-coverage-criterion.md
 * .agents/notes/implemented/architecture/2026-09-18-scope-semantics-fix.md
 */
export type SourceFetcher = (source: SourceDescriptor, query: string, ctx: RecallContext) => Promise<SourceHit[]>

export interface RecallContext {
  /**
   * 进度观察者（可选）。给了就**如实逐事件回调**  界面画的顺序即实际发生的顺序。
   * 不给则完全无开销（默认 undefined）。
   */
  observer?: RecallObserver

  /** 关掉语义路由（默认开）。用于 A/B 消融与调试。 */
  route?: boolean
  /**
   * 关掉**换语种重查**（默认开）。用于 A/B 消融与调试。
   *
   * **为什么给它一个开关而不是只写死**: 实测它的收益是 23-85%（见 `query-variants.ts` 与
   * `2026-09-19-query-variants.md`），但那是在**第 0 层**测的  别的层、
   * 别的语种组合下是否同样成立**没人量过**，而它让每个来源**多打一次请求**。
   * 有开关才能继续量。
   */
  variants?: boolean
  /** 查询原文。充分性判断需要它（语种匹配需要知道查询是什么）。 */
  query: string
  /** 目标命中了多少条才算够用。 */
  minHits: number
  /** 每层最多取多少条。 */
  perSourceLimit: number
  /** 结果至少来自几个独立来源才算够用。默认 2。 */
  minSources?: number
  /**
   * 擅长该查询意图的来源至少返回多少条才算"语料里有这个东西"。
   * 默认 1  只要有一个擅长来源真的答上了，就不算空壳。
   */
  topicFitFallback?: number
  /** 一条命中至少要有多少"查询之外"的词才算有信息量。默认 3。 */
  minSubstance?: number
  /** 最佳命中至少要覆盖多少比例的查询词才算「在回答这个问题」。默认 0.5。 */
  minQueryCoverage?: number
  /** 最多下降到第几层。默认 2（即允许全部三层）。 */
  maxTier?: Tier
  /**
   * 本次检索的**作用域**（频道名、仓库名、子版块…）。
   *
   * 存在的理由（2026-09-16 实测）: Telegram 只有频道内搜索。把裸查询"Rust 所有权"
   * 交给它，结果是**每一次召回都失败一次**  而它并不是坏了，是**这次用不上**。
   * 两者混在一起会让 failures 失去意义（真正的故障淹在噪声里）。
   *
   * 空/缺省时，声明 `searchScope: 'channel'` 的来源会被标为"不适用"而不是"失败"。
   */
  scope?: readonly string[]
}

/** 一条可观测的判断依据。`ok=false` 时必须给出人可读的 `detail`。 */
export interface TierSignal {
  name: string
  ok: boolean
  detail: string
}

export interface SufficiencyVerdict {
  sufficient: boolean
  signals: TierSignal[]
}

/** 判定所需的全部输入。打包传递，避免每加一条判据就改一次签名。 */
export interface SufficiencyInput {
  hits: readonly SourceHit[]
  successfulTiers: readonly Tier[]
  /** 本次真正成功返回的来源 id。 */
  successfulSources: readonly string[]
  ctx: RecallContext
}

export interface SufficiencyRule {
  name: string
  /** 返回带证据的判定，而不是一个光秃秃的布尔  "为什么够/不够"必须能被复查。 */
  assess(input: SufficiencyInput): SufficiencyVerdict
}

/** 命中的文字系统与查询是否吻合。不吻合说明这一层可能**根本没有在回答这个问题**。 
 * .agents/notes/implemented/architecture/2026-09-19-query-variants.md
 */
export function languageFitSignal(
  hits: readonly SourceHit[],
  query: string | undefined,
): TierSignal {
  // 没有查询就无法判断  此时**不报警**（不能让"拿不到查询"变成"判定为不相关"）
  if (typeof query !== 'string' || query === '') {
    return { name: 'language-fit', ok: true, detail: '未提供查询原文，无法做文字系统判断' }
  }
  const qScript = detectScript(query)
  if (qScript === 'other' || hits.length === 0) {
    return { name: 'language-fit', ok: true, detail: '查询无文字系统特征或没有命中，不做语种判断' }
  }
  // mixed 查询（如 "Rust 所有权"）要求结果里两种系统都出现，否则说明只覆盖了一半
  const want = qScript === 'mixed' ? ['cjk', 'latin'] : [qScript]
  const got = new Set(hits.map(h => detectScript(h.title)))
  const missing = want.filter(w => !got.has(w as Script) && !got.has('mixed'))
  if (missing.length === 0) {
    return { name: 'language-fit', ok: true, detail: `结果文字系统覆盖了查询的 ${want.join('/')}` }
  }
  const dist: Record<string, number> = {}
  for (const h of hits) {
    const s = detectScript(h.title)
    dist[s] = (dist[s] ?? 0) + 1
  }
  return {
    name: 'language-fit',
    ok: false,
    detail:
      `查询是 ${qScript}，但结果里没有 ${missing.join('/')} 的内容（分布: ${JSON.stringify(dist)}）` +
      `这一层很可能没有在回答这个问题，条数够不代表够用`,
  }
}

/** 结果是否来自足够多的独立来源。单一来源的 N 条本质上只是一条来源。 
 * .agents/notes/implemented/architecture/2026-09-16-sufficiency-evidence-chain.md
 */
export function sourceDiversitySignal(hits: readonly SourceHit[], minSources: number): TierSignal {
  const n = new Set(hits.map(h => h.sourceId)).size
  return n >= minSources
    ? { name: 'source-diversity', ok: true, detail: `结果来自 ${n} 个来源` }
    : { name: 'source-diversity', ok: false, detail: `结果只来自 ${n} 个来源（要求 ≥ ${minSources}）` }
}

// ── 话题契合度: 第 0 层「权威的空壳」的正面判据 ──────────────────

/** 来源的学科归属，由接口性质判定（写下来，可被反驳、可被测试）。 
 * .agents/notes/implemented/architecture/2026-09-16-in-tier-topic-reranking.md
 * .agents/notes/implemented/architecture/2026-09-18-engine-breadth-and-skip-cache.md
 * .agents/notes/implemented/architecture/2026-09-18-source-topic-routing.md
 */
export type SourceScope = 'code' | 'academic' | 'biomedical' | 'web-platform' | 'standards' | 'community' | 'general'

/** 查询意图。`genai` 与 `general` 同族: 都**没有领域先验可用**。 */

/** 查询意图。按**可观测的形态学信号**判定，不做语义理解。 */
export type QueryIntent = 'code' | 'academic' | 'biomedical' | 'web-platform' | 'standards' | 'general'

/** 每个来源的学科归属。 */
export const SOURCE_SCOPE: Readonly<Record<string, SourceScope>> = {
  crossref: 'academic',
  openalex: 'academic',
  arxiv: 'academic',
  pubmed: 'biomedical',
  github: 'code',
  npm: 'code',
  stackexchange: 'community',
  hackernews: 'community',
  wikipedia: 'community',
  juejin: 'community',
  mdn: 'web-platform',
  ietf: 'standards',
}

/**
 * 查询意图判定的形态学依据（都可被测试固定）:
 *   - biomedical: 疾病/基因/临床类词素
 *   - web-platform: Web 平台 API 形态（`Array.`、`useState`、`<div`、CSS/DOM…）
 *   - standards: 协议/规范形态（RFC 编号、HTTP/2、IETF、W3C…）
 *   - code: 编程语言、代码形态、工程概念
 *   - academic: 研究形态（论文/综述/文献/期刊）
 *   - general: 都不成立 → **不做任何话题过滤**
 *
 * 顺序即优先级。刻意**不**用"这看起来像不像一个问题"之类的兜底 
 * 判不出来就是 `general`，让所有来源都参与，而不是猜错方向把正确来源筛掉。
 */
const INTENT_PATTERNS: ReadonlyArray<readonly [QueryIntent, RegExp]> = [
  ['biomedical', /癌|肿瘤|基因|蛋白|细胞|临床|疗效|受体|免疫|药物|病理|诊断|疾病|病毒|综合征/],
  ['web-platform', /Array\.|Prototype|useEffect|useState|<div|<span|\bCSS\b|\bDOM\b|\bHTML\b|JavaScript|TypeScript|\bReact\b|\bVue\b|浏览器|前端|回调|闭包/],
  ['standards', /\bRFC\s?\d+|HTTP\/\d|\bIETF\b|\bW3C\b|\bISO\s?\d|\bOAuth\b|\bTLS\b|\bTCP\b|\bUDP\b|JSON\s?(Schema|Web Token)|规范|标准|协议栈/i],
  ['academic', /论文|文献|综述|期刊|学术|研究方法|引用|元分析/],
  ['code', /代码|函数|编译器|运行时|并发|线程|指针|内存管理|内存泄漏|重构|调试|\bAPI\b|\bSDK\b|框架|依赖|包管理|\bRust\b|\bPython\b|\bJava\b|\bGolang?\b|\bC\+\+\b|\bKotlin\b|\bSwift\b|\bSQL\b|\bDocker\b|\bKubernetes\b|::|=>|\(\s*\)\s*[;{]/i],
]

/**
 * 把覆盖数丢弃在排序之外  "垃圾搜索返回通用结果"的机制
 * .agents/notes/implemented/architecture/2026-09-17-coverage-count-must-rank.md
 */
export function classifyQueryIntent(query: string | undefined): QueryIntent {
  // 与 languageFitSignal 同一约定: 拿不到查询就**不判定**，不许让缺输入变成判定结果
  if (typeof query !== 'string' || query === '') return 'general'
  const normalized = normalize(query).normalized
  for (const [intent, re] of INTENT_PATTERNS) {
    if (re.test(normalized)) return intent
  }
  return 'general'
}

/**
 * 来源话题是否适配该查询意图。
 *
 * **不对称是刻意的**: 学科语料库（Crossref/PubMed/OpenAlex/arXiv）对**非本学科**问题
 * 不参与计数  这正是「权威的空壳」的定义。社区与代码来源对任何工程问题都参与；
 * `general` 意图下**所有来源都参与**。
 *
 * **不反向过滤**（不从结果里删掉不适配的条目）: 那会把可能有用的线索一起丢掉
 * （实测 GitHub 返回的 `rust-lang/rust` 确实相关）。这里只影响"够不够用"。
 */
export function sourceFitsIntent(sourceId: string, intent: QueryIntent): boolean {
  if (intent === 'general') return true
  const scope = SOURCE_SCOPE[sourceId]
  if (scope === undefined) return true
  switch (scope) {
    case 'academic':
      return intent === 'academic'
    case 'biomedical':
      return intent === 'biomedical'
    default:
      return true
  }
}

/** 是否**精确**匹配意图（如 ietf↔standards、pubmed↔biomedical、mdn↔web-platform）。精确匹配排在契合之前。 */
export function sourceMatchesIntentExactly(sourceId: string, intent: QueryIntent): boolean {
  return intent !== 'general' && SOURCE_SCOPE[sourceId] === intent
}

/** 话题契合度: 擅长该意图的来源**成功**返回了至少 `min` 条命中。 */
export function topicFitSignal(
  hits: readonly SourceHit[],
  successfulSources: readonly string[],
  query: string | undefined,
  min: number,
): TierSignal {
  /**
   * genai 话题族  以及两次被实测否决的排序修法
   * .agents/notes/implemented/architecture/2026-09-19-genai-topic-and-failed-fixes.md
   */
  const intent = classifyQueryIntent(query)
  if (intent === 'general') {
    return { name: 'topic-fit', ok: true, detail: '查询意图未识别为特定学科 → 不做话题过滤' }
  }
  const fitting = successfulSources.filter(id => sourceFitsIntent(id, intent))
  if (fitting.length === 0) {
    return {
      name: 'topic-fit',
      ok: true,
      detail: `本次成功的来源里没有擅长「${intent}」的  不构成反证，交由其它判据`,
    }
  }
  const fittingHits = hits.filter(h => sourceFitsIntent(h.sourceId, intent))
  return fittingHits.length >= min
    ? { name: 'topic-fit', ok: true, detail: `擅长「${intent}」的 ${fitting.join('/')} 返回 ${fittingHits.length} 条（≥ ${min}）` }
    : {
        name: 'topic-fit',
        ok: false,
        detail:
          `查询意图是「${intent}」，擅长它的来源（${fitting.join('/')}）只返回 ${fittingHits.length} 条（< ${min}）` +
          `当前结果主要由不擅长该话题的学科语料库贡献，即「权威的空壳」`,
      }
}

/**
 * 证据的信息量: 去掉**查询本身的词**之后还剩多少可引用内容。
 *
 * 依据: 第 0 层返回的条目里，相当一部分与查询"只有标题上的字面重合"
 * Crossref 命中"所有权"是检索器的字符匹配，不是内容关于所有权。既然无法判断
 * 相关性，就退一步问一个能判断的问题: **这条结果除了复述我的查询，还能提供什么**。
 */
export function substanceOfHit(hit: SourceHit, query: string | undefined): number {
  // 同一约定: 没有查询就没有「查询之外的词」这个概念，整条标题都算信息量
  const q = typeof query === 'string' && query !== '' ? tokenSet(query) : new Set<string>()
  const terms = new Set<string>()
  for (const w of termStreams(hit.title).words) terms.add(w)
  if (hit.snippet !== undefined) for (const w of termStreams(hit.snippet).words) terms.add(w)
  let shared = 0
  for (const term of terms) if (q.has(term)) shared++
  return terms.size - shared
}

/**
 * 一条命中里**可被吸收的证据块**有哪些。
 *
 * ## 为什么需要它（2026-09-18 读 argo 源码后加的）
 *
 * 我们此前只有一个**词数**判据（`substanceOfHit`: 去掉查询词后还剩几个词）。
 * 它挡得住"只有标题字面重合"，但挡不住另一类更常见的东西:
 * **一段很长、很有文采、但没有任何可核对事实的文字。**
 *
 * argo 的 `content_signals.score_evidence_density`（借鉴来源）用一个加权方案解决了它:
 * 数字 +0.22 / 定义 +0.18 / 对比 +0.16 / 步骤 +0.12 / 披露 +0.08，且**纯 Q&A 格式 −0.08**。
 * 最后那条是全篇最反直觉的一条  理由是一篇内容如果只是"问-答"套壳，
 * 它往往**不含可核对的具体事实**，而具体事实才是能被吸收进答案的东西。
 *
 * **这是第 18 轮那个错误的同族**: 我们又一次只用了特征的布尔投影。
 * 第 18 轮是"覆盖数被丢弃"，这次是"证据块类型被丢弃"（只知道"有内容"，不知道"有什么内容"）。
 *
 * ## 刻意与 argo 不同的两点
 *
 * 1. **不扣 Q&A 分**。argo 的 −0.08 基于它自己的 GEO 语料实测，我们**没有这个实测**。
 *    照搬一个没有本机证据支持的扣分，正是本项目反复否决的形态（"未实测的假设"）。
 *    这里只**如实统计** `isQaFormat`，把判断留给调用方。
 * 2. **不做跨来源分值融合**。本函数只给**单条命中**打分，不参与跨来源排序 
 *    这条铁律从第一轮就立着（各来源自报 score 口径不可比）。
 *    它只用于**层内**把"有事实的"排在"只有形容词的"前面，与第 18 轮覆盖数分档同层。
 */
export interface EvidenceBlocks {
  hasNumbers: boolean
  hasDefinition: boolean
  hasComparison: boolean
  hasHowto: boolean
  hasDisclosure: boolean
  /** 纯问答格式。**只统计不扣分**  见上方第 1 条。 */
  isQaFormat: boolean
  /** 0..1 的加权密度。与 argo 的权重一致，便于对照。 */
  density: number
}

const NUM_RE = /[0-9０-９]+(?:\.[0-9]+)?\s*(?:%|％|倍|万|亿|千|百|元|美元|人|年|月|日|次|条|个|项)/u
const DEF_RE = /(?:是指|定义为|称为|又称|是一种|是一种|即[^,，。]{0,12}(?:的|是)|是[^,，。]{2,12}(?:的|一种))/u
const CMP_RE = /(?:相比|对比|优于|劣于|高于|低于|大于|小于|区别|差异|不同之处|vs\.?|versus|较[^,，。]{0,6}(?:高|低|快|慢|好|差))/iu
const HOWTO_RE = /(?:步骤|第[一二三四五六七八九十0-9]+步|首先|其次|然后|接着|最后|如何|怎么(?:做|写|用)|配置方法|安装方法|使用方法)/u
const DISCLOSE_RE = /(?:局限|不足|注意|风险|免责|披露|声明|仅供参考|不构成|可能|存在争议|尚未|未能)/u
const QA_FMT_RE = /(?:^|\n)\s*(?:Q|问)[:：]|(?:^|\n)\s*(?:A|答)[:：]/u

/**
 * 学会 argo 的三件事  证据块密度、限流不是故障、以及一次被修正的结论
 * .agents/notes/implemented/architecture/2026-09-18-learning-from-argo.md
 * 平台判定的复核  从"单查询探测"到"多变体多查询"
 * .agents/notes/implemented/architecture/2026-09-18-platform-recheck.md
 */
export function evidenceBlocksOf(hit: SourceHit): EvidenceBlocks {
  const body = String(hit.title ?? '') + '\n' + String(hit.snippet ?? '')
  const hasNumbers = NUM_RE.test(body)
  const hasDefinition = DEF_RE.test(body)
  const hasComparison = CMP_RE.test(body)
  const hasHowto = HOWTO_RE.test(body)
  const hasDisclosure = DISCLOSE_RE.test(body)
  const isQaFormat = QA_FMT_RE.test(body)
  let density = 0.15
  if (hasNumbers) density += 0.22
  if (hasDefinition) density += 0.18
  if (hasComparison) density += 0.16
  if (hasHowto) density += 0.12
  if (hasDisclosure) density += 0.08
  if (body.length >= 80) density += 0.05
  // 取两位小数: 原始浮点会出现 0.6000000000000001 这种值，露给人看是噪音。
  return { hasNumbers, hasDefinition, hasComparison, hasHowto, hasDisclosure, isQaFormat, density: Math.round(Math.min(Math.max(density, 0), 1) * 100) / 100 }
}

/**
 * **同来源内**按标题去重: 同一来源给出两条同标题的记录时只保留第一条。
 *
 * 实测依据（2026-09-16）: 查询「服务端渲染」时 Crossref 返回了两条**完全相同标题**
 * 的《汽车后市场服务模式创新研究》，白占一个名额。
 *
 * **为什么不去重跨来源的同标题命中（这是刻意的）**:
 *   - 实测三个查询里**跨来源重复是 0**  没有需要解决的证据
 *   - 更重要的原则: 两个独立来源给出同一结论是**相互印证**，不是冗余。
 *     合并它们会让 `source-diversity` 判据失真，而那条判据防的正是
 *     「一个来源的 N 条本质是一条」
 *   - 判定「两条不同来源的结果是否同一件事」需要语义理解，不是标题相等
 *
 * 保留顺序: 原序过滤，保留首次出现的那条，不重排。
 */
export function dedupeWithinSource(hits: SourceHit[]): void {
  const seen = new Set<string>()
  const kept: SourceHit[] = []
  for (const h of hits) {
    const key = h.sourceId + '\u0000' + normalizeTitle(h.title)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(h)
  }
  hits.length = 0
  hits.push(...kept)
}

/** 标题归一化: 去掉标点与空白、转小写。仅用于**判同**，不用于展示。 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
}


/**
 * 否定约束：查询里明确**排除**的东西。
 *
 * ## 为什么需要它（2026-09-18 实测）
 *
 * 实测四条查询，全部失败:
 *
 * | 查询 | 实测行为 | 应该的行为 |
 * |---|---|---|
 * | `除了百度的搜索引擎` | 查询词含 `除了`/`了百`/`度的` | 排除「百度」，其余照查 |
 * | `Rust 所有权 -GC` | `gc` 是**必需词** | 排除「GC」 |
 * | `不要广告的图片压缩工具` | 查询词含 `不要`/`要广` | 排除「广告」 |
 * | `notion 替代品 NOT 飞书` | `not` 是检索词 | 排除「飞书」 |
 *
 * **两个方向的错**: ①否定触发词本身被当成检索词（`除了`/`不要`/`not`），
 * 它们**必然出现在查询里**，于是任何含这些字的文档都被判为"覆盖了查询词"；
 * ②被排除的实体被当成**必需**词  用户说"不要广告"，我们却优先返回广告。
 *
 * ## 与 argo 的关系
 *
 * 形态借鉴 argo 的 `query_understanding.parse_negation`（`query_understanding.py:84`），
 * 但**规则是自己写的**，且修掉了它漏掉的两类：中英混排边界、查询末尾无标点。
 *
 * ## 刻意不做的事
 *
 * **不把排除词从检索里删掉就完事**  那样 `不要广告的图片压缩工具` 会退化成
 * `图片压缩工具`，而"不含广告"这个约束**丢失了**。排除词由 `negationPenalty`
 * 参与排序降档（不是丢弃，因为"含该词"未必等于"是关于它"）。
 */

/** 实体边界：在 的/逗号/空白/结束 处收边，且不超过 20 字。 */
const NEG_ENTITY = '([\\u4e00-\\u9fffA-Za-z0-9]{1,20}?)(?=的|[,，、\\s]|以外|之外|外|$)'

const NEGATION_PATTERNS: readonly RegExp[] = [
  new RegExp('除了' + NEG_ENTITY, 'u'),
  new RegExp('不想(?:要|用|看)?' + NEG_ENTITY, 'u'),
  new RegExp('不要' + NEG_ENTITY, 'u'),
  new RegExp('排除' + NEG_ENTITY, 'u'),
  // 减号前缀（Google 语法）。前面不能是字母数字，否则会把 `gpt-4` 的 `-4` 当成排除。
  /(?<![A-Za-z0-9])-([A-Za-z0-9\u4e00-\u9fff]{1,20})/u,
  /\bNOT\s+([A-Za-z0-9\u4e00-\u9fff]{1,20})/iu,
  /\bwithout\s+([A-Za-z0-9\u4e00-\u9fff]{1,20})/iu,
]

/** 否定片段本身（连触发词一起剔除，保留其后正文）。 */
const NEGATION_SPANS: readonly RegExp[] = [
  /除了[\u4e00-\u9fffA-Za-z0-9]{1,20}?(?=的|[,，、\s]|以外|之外|外|$)(?:以外|之外|外)?/u,
  /不想(?:要|用|看)?[\u4e00-\u9fffA-Za-z0-9]{1,20}?(?=的|[,，、\s]|$)/u,
  /不要[\u4e00-\u9fffA-Za-z0-9]{1,20}?(?=的|[,，、\s]|$)/u,
  /排除[\u4e00-\u9fffA-Za-z0-9]{1,20}?(?=的|[,，、\s]|$)/u,
  /(?<![A-Za-z0-9])-[A-Za-z0-9\u4e00-\u9fff]{1,20}/u,
  /\bNOT\s+[A-Za-z0-9\u4e00-\u9fff]{1,20}/iu,
  /\bwithout\s+[A-Za-z0-9\u4e00-\u9fff]{1,20}/iu,
]

export interface Negation {
  /** 被排除的实体（已去重、保序）。 */
  readonly exclude: readonly string[]
  /** 剔除否定片段后的查询  用于**抽取检索词**，不用于展示。 */
  readonly clean: string
}

export function parseNegation(query: string | undefined): Negation {
  if (typeof query !== 'string' || query === '') return { exclude: [], clean: '' }
  const exclude: string[] = []
  for (const pat of NEGATION_PATTERNS) {
    const g = new RegExp(pat.source, pat.flags.includes('i') ? 'giu' : 'gu')
    for (const m of query.matchAll(g)) {
      const term = (m[1] ?? '').trim()
      if (term !== '' && !exclude.includes(term)) exclude.push(term)
    }
  }
  let clean = query
  for (const pat of NEGATION_SPANS) {
    const g = new RegExp(pat.source, pat.flags.includes('i') ? 'giu' : 'gu')
    clean = clean.replace(g, ' ')
  }
  // 剔除后残留的前导虚词（"的搜索引擎" → "搜索引擎"）
  clean = clean.replace(/^[的了，,、\s]+/u, '').replace(/\s+/gu, ' ').trim()
  return { exclude, clean }
}

/**
 * 命中里出现了**被排除的词**时，它该被降档多少。
 *
 * **不是丢弃**: "含该词"未必等于"是关于它"  一篇《广告之外：图片压缩工具横评》
 * 含"广告"却是好结果。所以只降档，且降档幅度**小于**"完全不相关"那一档。
 *
 * 返回 0 表示不受影响，1 表示命中里确实出现了排除词。
 */
export function negationPenalty(hit: SourceHit, query: string | undefined): number {
  const { exclude } = parseNegation(query)
  if (exclude.length === 0) return 0
  const hay = (hit.title + ' ' + (hit.snippet ?? '')).toLowerCase()
  for (const term of exclude) if (hay.includes(term.toLowerCase())) return 1
  return 0
}

/**
 * 查询放宽阶梯：精准查询归零时，**按宽松代价从小到大逐层剥离**。
 *
 * ## 为什么需要它（2026-09-18，读 argo 的 recovery 后加）
 *
 * 我们现在有几种**平台原生语法**（不是我们发明的抽象，是平台边界的直接映射）：
 *   - Telegram: `<频道名> <关键词>`（频道内搜索，见 adapters/telegram.ts）
 *   - 通用减号: `关键词 -排除词`（否定约束）
 *   - 引号短语: `"精确短语"`
 *
 * 这些语法**越精准，归零的概率越高**。而我们现在归零时什么都不做 
 * 调用方写 `durov telegram` 拿回 0 条，就到此为止了。
 *
 * argo 的 `structured_relax_steps`（`recovery.py:152`）解了这个问题：
 * **每步只撤一类条件，从"最不损失意图"的那类开始撤**。
 * 它的顺序是「排除 → 热度 → 媒体 → 语言 → 日期 → 账号 → 短语」
 * 越靠前撤掉，对用户意图的损失越小。
 *
 * ## 我们为什么只做三层（而不是照搬七层）
 *
 * argo 的七层对应它支持的七类平台语法（X 的 `min_faves:`、GitHub 的 `repo:`…）。
 * **我们只有三类**，照搬七层会产出四个永远为空的步骤  那是**假的能力**，
 * 界面上会显示"试了 7 种策略"，实际只有 3 种存在。
 * **阶梯的层数必须等于真实支持的语法数。**
 *
 * ## 顺序的依据
 *
 * 1. **撤减号**（损失最小）: 用户排除某词，多半是"不想要但也能接受"。
 *    撤掉后查询变宽，最可能拿到结果。
 * 2. **撤引号**（损失中等）: 精确短语是强约束，但撤掉后词还在，只是不再要求连续。
 * 3. **撤频道作用域**（损失最大）: 这会改变**查哪个来源**，不是改变查询 
 *    所以它必须放最后，且由调用方决定要不要用（我们**不自动**跨频道降级，
 *    因为那等于把一个来源的失败变成另一个来源的请求，语义不同）。
 */

export interface RelaxStep {
  /** 第几步（从 1 开始）。 */
  readonly level: number
  /** 撤掉了哪一类条件。 */
  readonly dropped: 'exclude' | 'phrase' | 'scope'
  /** 放宽后的查询。 */
  readonly query: string
  /** 为什么要撤它  给人看的。 */
  readonly reason: string
}

/** 引号短语（中英文引号都收）。 */
const PHRASE_RE = /"[^"]+"|"[^"]+"|'[^']+'/gu
/** 减号排除（负号前不能是字母数字，否则会把 `gpt-4` 的 `-4` 当成排除）。 */
const EXCLUDE_RE = /(?<![A-Za-z0-9])-([A-Za-z0-9\u4e00-\u9fff]{1,20})/gu

/**
 * 构造放宽阶梯。**只在精准查询归零时调用**  它不是常规路径。
 *
 * 返回的每一步都是**完整可用**的查询，调用方按顺序试，首个非空即停。
 * 无语法可撤时返回 `[]`（不是返回原查询  那会让调用方以为"试过了"）。
 
 * .agents/notes/implemented/architecture/2026-09-18-relax-ladder.md
 */
export function relaxSteps(query: string | undefined): RelaxStep[] {
  if (typeof query !== 'string' || query.trim() === '') return []
  const steps: RelaxStep[] = []

  // 第 1 步: 撤减号排除
  if (EXCLUDE_RE.test(query)) {
    const q = query.replace(new RegExp(EXCLUDE_RE.source, 'gu'), ' ').replace(/\s+/gu, ' ').trim()
    if (q !== '' && q !== query) {
      steps.push({ level: steps.length + 1, dropped: 'exclude', query: q,
        reason: '撤掉减号排除项  排除是"不想要"而非"必须没有"，撤掉后查询变宽' })
    }
  }

  // 第 2 步: 撤引号（在第 1 步结果之上继续放宽）
  const base = steps.length > 0 ? steps[steps.length - 1]!.query : query
  if (PHRASE_RE.test(base)) {
    const q = base.replace(new RegExp(PHRASE_RE.source, 'gu'), m => m.slice(1, -1)).replace(/\s+/gu, ' ').trim()
    if (q !== '' && q !== base) {
      steps.push({ level: steps.length + 1, dropped: 'phrase', query: q,
        reason: '撤掉引号  词还在，只是不再要求连续出现' })
    }
  }

  return steps
}

/**
 * 查询里可用于**字面匹配**的项：≥2 字的词 + CJK bigram。
 *
 * **为什么必须带 bigram（实测倒逼）**: `Intl.Segmenter` 的 zh-Hans 词典缺技术词，
 * 实测把「服务端组件原理」切成 `服务|端|组|件|原理`  **核心概念「组件」被切碎**，
 * 于是所有 React 相关结果都只能匹配到 1 个词，覆盖度判据对它们一律判否
 * （实测「React 服务端组件原理」17 条全部停在 1/3 覆盖）。
 *
 * `termStreams` 本来就产出 bigram 流（它的注释写着"保证 2 字查询与未登录词可召回"），
 * 覆盖度却只用了词流  这是一个**口径不一致**：检索侧用 bigram 召回，判定侧不用，
 * 于是"能召回到"的东西被判为"不相关"。
 *
 * 两处共用这一个函数，口径不允许漂移。
 */
export function queryTerms(query: string | undefined): string[] {
  if (typeof query !== 'string' || query === '') return []
  // 顺序: **先归一容错，再剥否定片段，最后抽词**。三步各有实测依据:
  //
  // 1. **归一（错别字/同音字/口语句读）**  2026-09-18 实测的缺口:
  //    `微薄 热搜` 归一成 `微博 热搜`，**但 queryTerms 抽的仍是 `微薄`**，
  //    于是去匹配含"微薄"的文档而不是"微博"。`normalize` 模块早就写好了
  //    （混淆词表/自我更正/填充词/**变体集**），**而它的归一结果从没进过检索词**。
  //    同一形态在本项目出现过五次: 机制在、测试绿、没接线。
  //
  // 2. **剥否定片段**  否则 `除了`/`不要`/`not` 这些触发词本身会变成检索词
  //    （它们**必然出现在查询里**，于是任何含这些字的文档都被判为"覆盖了查询词"）。
  //
  // 3. **抽词（词流 + CJK bigram）**  bigram 保证"2 字查询与未登录词可召回"。
  //
  // **变体集进不进检索词？不进。** 理由: `buildVariants` 产出的是**整串查询的变体**
  // （`微薄 热搜` / `微博 热搜`），而这里抽的是**词**。把两串的词并起来会让
  // "微薄"和"微博"同时成为检索词  那是把容错变成"两种写法都算命中"，
  // 判据会失真（一条含"微薄"的旧文就成了相关证据）。**容错的正确形态是
  // 用归一后的词去检索，而不是把错字也当有效词。**
  const cleaned = parseNegation(query).clean
  const normalized = normalize(cleaned).normalized
  /**
   * 错别字容错必须进检索词  第五次"机制在、没接线"
   * .agents/notes/implemented/architecture/2026-09-18-normalize-must-reach-query-terms.md
   */
  const streams = termStreams(normalized)
  const out = new Set<string>()
  for (const w of streams.words) if (w.length >= 2) out.add(w)
  // CJK bigram 是 2 字，天然满足长度要求；latin 的 bigram 会切碎单词，只取含 CJK 的
  for (const b of streams.bigrams) if (/\p{Script=Han}/u.test(b)) out.add(b)
  return [...out]
}

/** 一条命中覆盖了几个查询词。比较**大小写不敏感**（线上标题是 `Rust`，分词器给 `rust`）。 */
export function queryTermMatches(hit: SourceHit, query: string | undefined): number {
  const terms = queryTerms(query)
  if (terms.length === 0) return 0
  const hay = (hit.title + ' ' + (hit.snippet ?? '')).toLowerCase()
  let n = 0
  for (const t of terms) if (hay.includes(t)) n++
  return n
}

/**
 * 层内排序是二维的  字面相关性优先于来源话题契合
 * .agents/notes/implemented/architecture/2026-09-16-two-dimensional-in-tier-ordering.md
 */
export function isQueryRelevant(hit: SourceHit, query: string | undefined): boolean {
  const terms = queryTerms(query)
  if (terms.length === 0) return true
  return queryTermMatches(hit, query) >= 1
}

/**
 * 命中是否**真的覆盖了查询**。
 *
 * 实测依据（2026-09-16，8 个查询全部停在第 0 层）: 第 0 层是**学科语料库**，
 * 对任何字符串都能在它的子集里找到「含该词」的东西。按覆盖度量出来:
 *
 * | 查询 | 最佳命中 | 覆盖 |
 * |---|---|---|
 * | `Rust 所有权` | `@codemirror/lang-rust` | 1/2 |
 * | `某国内小众框架的配置怎么写` | 《框架的主要特性》 | 1/5 |
 * | `2026 年某某事件进展` | 《色觉研究的某些重要进展》 | 1/4 |
 * （加判据后该查询改由一条摘要含全部四词的 Wikipedia 条目满足  见下方已知边界）
 * | `DeepSeek 最新模型发布` | 《大语言模型赋能政务智慧化服务》 | 1/4 |
 *
 * 最刺眼的是最后两条: 它们**原理上不可能**由学术语料库回答（一个是不存在的时事，
 * 一个是产品发布），却各自拿到 14-15 条并通过了**全部**判据  包括
 * `evidence-substance`（它只检查「查询之外还有没有内容」，不检查「查询覆盖了多少」）。
 *
 * 判据要求**至少有一条命中**同时满足:
 *   1. 覆盖 ≥ `minRatio` 的查询词
 *   2. 覆盖 ≥ 2 个查询词（查询本身只有 1 个词时豁免）
 *
 * 第 2 条防的是「Rust 所有权」这类两词查询被一个只含 rust 的包名糊弄过去。
 * 取「最佳单条」而不是「所有命中的并集」 并集会被「十条各匹配一个词」的
 * 无关结果满足，那正是要防的形态。
 *
 * **已知边界（实测踩到过，必须写下来）**: 判据会读 `snippet`，而摘要里出现查询词
 * 不等于**条目**在讲这件事。实测「2026 年某某事件进展」最终由一条 Wikipedia 条目
 * （标题《2026年3月中國大陸》，摘要恰好含全四个词）满足了覆盖度并停在 L0 
 * 而那一层其余 14 条全是无关内容。所以这条判据**降低**了「学科语料库接不住任何查询」
 * 的概率，**没有根除**。真正的解法是判断"这条结果是不是在回答这个问题"，那需要
 * 语义理解（见 architecture 文档的后续工作）。
 
 * .agents/notes/implemented/architecture/2026-09-18-negation-constraints.md
 */
export function queryCoverageSignal(
  hits: readonly SourceHit[],
  query: string | undefined,
  minRatio: number,
): TierSignal {
  if (typeof query !== 'string' || query === '') {
    return { name: 'query-coverage', ok: true, detail: '未提供查询原文，无法判断覆盖度' }
  }
  const terms = queryTerms(query)
  if (terms.length === 0) return { name: 'query-coverage', ok: true, detail: '查询里没有可判定的词' }
  if (hits.length === 0) return { name: 'query-coverage', ok: true, detail: '没有命中，不做覆盖度判断' }

  let best = 0
  let bestTitle = ''
  for (const h of hits) {
    // 大小写不敏感: 线上实测第 0 层返回的标题是「Rust 所有权…」（大写 R），
    // 而分词器给出的是小写 rust  大小写敏感会让真实命中被判为未覆盖。
    const hay = (h.title + ' ' + (h.snippet ?? '')).toLowerCase()
    let matched = 0
    for (const t of terms) if (hay.includes(t)) matched++
    if (matched > best) {
      best = matched
      bestTitle = h.title
    }
  }
  const ratio = best / terms.length
  const needMatched = Math.min(2, terms.length)
  const pct = Math.round(minRatio * 100)
  const head = '最佳命中覆盖 ' + best + '/' + terms.length + ' 个查询词（要求 ≥ ' + needMatched + ' 且 ≥ ' + pct + '%）'
  return ratio >= minRatio && best >= needMatched
    ? { name: 'query-coverage', ok: true, detail: head + ': ' + bestTitle.slice(0, 40) }
    : {
        name: 'query-coverage',
        ok: false,
        detail:
          '没有一条命中同时覆盖 ' + needMatched + ' 个以上的查询词（最佳 ' + best + '/' + terms.length +
          ': ' + bestTitle.slice(0, 40) + '） 这一层拿到的是「含某个词的东西」，不是「在回答这个问题」',
      }
}
export function evidenceSubstanceSignal(
  hits: readonly SourceHit[],
  query: string | undefined,
  minSubstance: number,
): TierSignal {
  if (hits.length === 0) return { name: 'evidence-substance', ok: true, detail: '没有命中，不做信息量判断' }
  const substantial = hits.filter(h => substanceOfHit(h, query) >= minSubstance).length
  return substantial >= hits.length / 2
    ? { name: 'evidence-substance', ok: true, detail: `${substantial}/${hits.length} 条命中含查询之外的可引用内容` }
    : {
        name: 'evidence-substance',
        ok: false,
        detail: `只有 ${substantial}/${hits.length} 条命中含查询之外的可引用内容（其余与查询只有字面重合）`,
      }
}

/**
 * 默认充分性规则。**条数够只是必要条件，不是充分条件。**
 *
 * 四条判据全过才算够用（每条都产出一个可复查的 signal）:
 *   1. `authoritative-supply`  第 0 层**成功**返回（全错不算供给）
 *   2. `volume`                命中数 ≥ minHits
 *   3. `topic-fit`             擅长该话题的来源真的答上了（「权威的空壳」的正面判据）
 *   4. `language-fit`          结果的文字系统与查询吻合
 *   5. `evidence-substance`    命中里含查询之外的可引用内容
 *   4. `source-diversity`      结果来自 ≥ 2 个独立来源
 *
 * 第 3、4 条是**实测倒逼出来的**：查询「Rust 所有权」时第 0 层返回 18 条、
 * 标识符覆盖 18/18，看起来完美  但没有任何一条与问题相关，而它满足了条数条件，
 * 于是把真正可能有答案的中文社区挡在了外面。
 *
 * **诚实边界**: 语种判据只能识别"文字系统不匹配"，识别不了"同系统但无关"。
 * 上述案例里 Crossref 返回的正是**中文**论文（含"所有权"三字），所以线上实测中
 * 这条判据是**通过**的、系统仍停在 L0。它降低了一类失效的概率，**没有解决它**。
 * 真正的解决需要语义相关性判断或来源级的话题适配，属后续工作。
 */
export const AUTHORITATIVE_FIRST: SufficiencyRule = {
  name: 'authoritative-first',
  assess({ hits, successfulTiers, successfulSources, ctx }) {
    const signals: TierSignal[] = []
    if (!successfulTiers.includes(0)) {
      signals.push({ name: 'authoritative-supply', ok: false, detail: '第 0 层没有任何来源成功返回  不构成供给' })
      return { sufficient: false, signals }
    }
    signals.push({ name: 'authoritative-supply', ok: true, detail: '第 0 层有来源成功返回' })
    signals.push(
      hits.length >= ctx.minHits
        ? { name: 'volume', ok: true, detail: `${hits.length} 条（≥ ${ctx.minHits}）` }
        : { name: 'volume', ok: false, detail: `${hits.length} 条（< ${ctx.minHits}）` },
    )
    // 第 3 条是「权威的空壳」的**正面判据**: 语种只看"看不看得懂",
    // 话题看的是"这个来源有没有可能回答这种问题"  后者才是根因。
    // 但只有在**有来源真的一无所获**时它才生效: 若擅长该意图的来源返回了结果，
    // 那说明它的语料里确实有相关内容（实测: GitHub 对「Rust 所有权」返回
    // rust-lang/rust），此时不能因为别处有噪声就说"整层是空壳"。
    signals.push(topicFitSignal(hits, successfulSources, ctx.query, ctx.topicFitFallback ?? 1))
    signals.push(languageFitSignal(hits, ctx.query))
    signals.push(sourceDiversitySignal(hits, ctx.minSources ?? 2))
    signals.push(evidenceSubstanceSignal(hits, ctx.query, ctx.minSubstance ?? 3))
    // 覆盖度排在最后: 它是「这一层到底在不在回答这个问题」的最后一道闸。
    signals.push(queryCoverageSignal(hits, ctx.query, ctx.minQueryCoverage ?? 0.5))
    return { sufficient: signals.every(s => s.ok), signals }
  },
}

export interface SourceFailure {
  sourceId: string
  kind: string
  message: string
}

/**
 * 召回过程中的**进度事件**  给"看得见的检索"用。
 *
 * 存在的理由: `recall()` 是逐层执行的，但在它返回之前调用方**什么都看不到**。
 * 一个要展示"分层下降"的界面只能等最终结果，于是动画是**事后补的**，不是真实过程。
 * 这个端口让进度**如实流出**：界面画的顺序就是实际发生的顺序。
 *
 * 刻意做成**观察者**而不是"返回一个生成器": 调用方大多只要最终结果，
 * 让所有人都去迭代事件流是把成本推给不需要它的人。
 */
export type RecallEvent =
  /** 某一层开始跑。`sources` 是这一层真正会发出请求的来源。 */
  | { kind: 'tier-start'; tier: Tier; sources: readonly string[] }
  /**
   * **单个来源开始请求**（2026-09-18 加）。
   *
   * **为什么需要它**: 此前只有 \`source-settled\`（带 \`elapsedMs\`），
   * 而 \`elapsedMs\` 是**从这一层开始算**的  它把排队时间也算进去了。
   * 实测: 某个来源 \`elapsedMs=33028\` 而它的真实网络耗时只有 975ms 
   * **其余 32 秒全在闸门后面排队**。
   *
   * 有了开始时刻，时间线才能区分「慢」与「排队」。**那是最常被混淆的两件事**。
   */
  | { kind: 'source-started'; tier: Tier; sourceId: string; at: number }
  // ↑ **at 是「进入队列」的时刻，不是「开始执行」的时刻**（2026-09-18 修正）。
  // 事件发在 await fetch() 之前，而闸门在 fetch 内部  所以多个来源
  // 会报出**相同**的 at（它们同时进入队列），然后被闸门串行处理。
  // **我一度把这个误读成「闸门失效」**  见 2026-09-18-timeline-diagnosis.md。
  /** 单个来源回来了（成功或失败）。**逐个报**，因为慢的来源正是用户最想看见的那个。 */
  | { kind: 'source-settled'; tier: Tier; sourceId: string; hits: number; failure?: SourceFailure; elapsedMs: number }
  /** 某一层结束，附完整判据  让界面能显示"为什么停/为什么继续"。 */
  | { kind: 'tier-end'; tier: Tier; outcome: TierOutcome }
  /** 某一层被跳过（超出 maxTier 或已充分）。 */
  | { kind: 'tier-skipped'; tier: Tier; reason: string }
  /** 全部结束。 */
  | { kind: 'done'; result: RecallResult }

/**
 * 执行时间线（--explain） 以及我重复了自己上轮的教训
 * .agents/notes/implemented/architecture/2026-09-18-execution-timeline.md
 */
export type RecallObserver = (e: RecallEvent) => void

export interface TierOutcome {
  tier: Tier
  /** 这一层是否真的跑了。false 时 `skippedReason` 必须给出原因。 */
  ran: boolean
  skippedReason?: string
  sources: string[]
  hits: number
  failures: SourceFailure[]
  elapsedMs: number
}

export interface RecallResult {
  query: string
  hits: SourceHit[]
  /** 停止时的完整判据（含未通过项） 让"为什么停在这里"可复查。 */
  verdict: SufficiencyVerdict
  /** 按执行顺序（0→1→2），**含被跳过的层**  这是"分层可审计"的载体。 */
  tiers: TierOutcome[]
  /** 实际到达的最深层。 */
  reachedTier: Tier
  /** 停止原因（人可读）。 */
  stoppedBecause: string
  /** 是否所有登记的层级都跑过了。 */
  exhausted: boolean
}

function kindOf(err: unknown): string {
  if (err instanceof AdapterError) return `${err.platform}/${err.kind}`
  return 'unknown'
}

/**
 * 分层召回。
 *
 * 注意这里**不做**跨来源打分融合  不同来源的分值不可比（B站的播放量、Telegram 的
 * 无分值、搜索引警的相关度），把它们塞进一个数里会让"权威优先"变成"分高优先"。
 * 层级顺序本身就是优先级；层内保持来源给出的相对顺序。
 */
export async function recall(
  query: string,
  fetchers: Partial<Record<string, SourceFetcher>>,
  ctx: RecallContext,
  rule: SufficiencyRule = AUTHORITATIVE_FIRST,
): Promise<RecallResult> {
  // **归一后的查询**: 发给来源用它，而不是用原文。
  // 错别字/同音字/口语句读在这里被纠正一次，之后所有来源收到的是规范形式。
  // 依据: 2026-09-18 A/B 消融（见下方 fetch 调用处的注释）。
  const queryForSources = normalize(parseNegation(query).clean).normalized || query

  // **自动识别作用域**（2026-09-18）: 让 `ctx.scope` 有生产者。
  //
  // 上轮修好了判据（"有没有提供作用域"），但没人传  用户写 `durov telegram`
  // 时 Telegram 仍被判 not-applicable。这里从查询里识别一次。
  //
  // **显式传入的优先、且不被覆盖**: 调用方明确给了 scope 就用它的  那是更强的信号
  // （调用方可能知道查询里看不出的东西）。自动识别只在**调用方没给**时补位。
  // **每层算一次**，不在来源循环里算  同一层所有来源共用同一批变体。
  /**
   * A/B 消融推翻了上一轮的结论  归一必须发给上游
   * .agents/notes/implemented/architecture/2026-09-18-ablation-normalized-query-upstream.md
   */
  const variants = ctx.variants === false ? [] : queryVariants(queryForSources)

  const needsScope = SOURCES.filter(s => s.requiredScope !== undefined && s.requiredScope.length > 0).map(s => s.id)
  const auto = resolveScope(query, needsScope)
  const effectiveScope = (ctx.scope !== undefined && ctx.scope.length > 0)
    ? ctx.scope
    : auto.scope
  /**
   * 给 `ctx.scope` 接上生产者  机制对了但没人传
   * .agents/notes/implemented/architecture/2026-09-18-scope-producer.md
   */
  const ctxWithScope = effectiveScope.length > 0 ? { ...ctx, scope: effectiveScope } : ctx

  const maxTier = ctx.maxTier ?? 2
  const tiers: TierOutcome[] = []
  const hits: SourceHit[] = []
  const successfulTiers: Tier[] = []
  /** 真正**有产出**的来源（不含跑通了但 0 条的） 话题契合度需要它。 */
  const successfulSources: string[] = []
  let stoppedBecause = ''
  let reachedTier: Tier = 0
  let verdict: SufficiencyVerdict = { sufficient: false, signals: [] }

  // 进度事件**如实流出**。观察者是可选端口: 不给则每次调用只是一个空函数，零分支。
  const emit = ctx.observer ?? ((): void => {})

  for (const tier of [0, 1, 2] as Tier[]) {
    if (tier > maxTier) {
      tiers.push({ tier, ran: false, skippedReason: `超出 maxTier=${maxTier}`, sources: [], hits: 0, failures: [], elapsedMs: 0 })
      emit({ kind: 'tier-skipped', tier, reason: `超出 maxTier=${maxTier}` })
      continue
    }
    if (stoppedBecause !== '') {
      tiers.push({ tier, ran: false, skippedReason: stoppedBecause, sources: [], hits: 0, failures: [], elapsedMs: 0 })
      emit({ kind: 'tier-skipped', tier, reason: stoppedBecause })
      continue
    }

    // **先路由再查**（2026-09-18 加）: 跳过与本次查询话题零交集的来源。
    //
    // 实测倒逼: 来源从 26 扩到 44 后，「美国 GDP 增速」召回了 uniprot（蛋白质）
    // 与 rcsb_pdb（蛋白质结构） 完全不相关。原因是第 1 层 31 个来源被无差别并发查询。
    //
    // **只跳"话题类别零交集"的来源**，判据保守（见 route-sources.ts 的注释）:
    // 权威层永不跳、全域来源永不跳、无法归类时全查、没有话题声明的来源不跳。
    // 代价不对称  误跳会让证据永久丢失且用户看不见，误查只是浪费一次请求。
    const routed = ctx.route === false ? null : routeSources(query, SOURCES)
    const sources = SOURCES.filter(s => s.tier === tier)
      .filter(s => routed === null || routed.keep.includes(s.id))
    const usable = sources.filter(s => fetchers[s.id] !== undefined)
    if (usable.length === 0) {
      // **必须区分两种情况**（2026-09-16 实测倒逼）:
      //
      //   (a) 这一层**根本没有登记来源**  正常的"没有这一层"，继续下降
      //   (b) 登记了来源，但**一个都没有取数实现**  这是**没有接线**，
      //       而它此前被伪装成 (a)，显示为"该层没有已登记且可用的来源"。
      //
      // 实测: 第 1、2 层登记了 5 个来源（juejin/bilibili/telegram-public/argo:anysearch），
      // 而 `authoritativeFetchers()` 只覆盖第 0 层。于是第 1 层显示"ran: false，
      // 该层没有已登记且可用的来源" 看起来像"这两层本来就是空的"，
      // 实际是**忘了接线**。这是本项目铁律禁止的形态: 把实现缺失伪装成没有内容。
      const unwired = sources.filter(s => fetchers[s.id] === undefined)
      const failures: SourceFailure[] = unwired.map(s => ({
        sourceId: s.id,
        kind: 'unwired',
        message: `来源「${s.id}」（第 ${s.tier} 层）没有取数实现  是**没有接线**，不是"没有内容"`,
      }))
      // `ran: false`  **没有接线不是"跑过"**。这一层没有发出任何请求，
      // 所以它不构成供给（`successfulTiers` 也不会收它），但仍要留下 failures，
      // 让"忘了接线"与"本来就没有这一层"在审计面上可区分。
      tiers.push({
        tier,
        ran: false,
        skippedReason:
          sources.length === 0
            ? '该层没有登记来源'
            : `该层登记了 ${sources.length} 个来源，但没有取数实现（未接线）`,
        sources: sources.map(s => s.id),
        hits: 0,
        failures,
        elapsedMs: 0,
      })
      continue
    }

    const started = Date.now()
    const failures: SourceFailure[] = []
    const tierHits: SourceHit[] = []
    // 层内来源**并行**取数: 权威接口是本层最慢的部分（Crossref/PubMed 各 1-3s），
    // 串行会让一次召回退化到十几秒。并行不改变任何判定语义。
    emit({ kind: 'tier-start', tier, sources: usable.map(s => s.id) })
    const settled = await Promise.all(usable.map(async (source): Promise<SourceHit[] | SourceFailure> => {
      // t0 用于给这条来源**单独**计时  并发跑时"整层耗时"掩盖不了快慢差异
      const t0 = Date.now()
      const fetch = fetchers[source.id]
      // **不适用 ≠ 失败**（2026-09-16 实测倒逼）。
      //
      // 实测: Telegram 只有频道内搜索。把裸查询「Rust 所有权」交给它，结果是**每一次
      // 召回都失败一次**  而它并不是坏了，是**这次用不上**。两者混在一起会让 failures
      // 失去意义: 真正的故障会淹在"注定失败的调用"产生的噪声里。
      //
      // 判定放在**调用之前**: 需要作用域但 ctx.scope 为空的来源直接标为
      // not-applicable，不发出请求。
      if (source.requiredScope !== undefined && source.requiredScope.length > 0) {
        // **作用域是"这次查询有没有作用域"的标记，不是"作用域叫什么名字"**（2026-09-18 修正）。
        //
        // 此前这里写的是 `provided.includes(s)`  要求 `ctx.scope` **字面包含**
        // `requiredScope` 里的字符串（即 `'channel'`）。后果实测：
        //
        //   用户写 `durov telegram`（合法的频道作用域查询，适配器自己能解析出频道名）
        //   → 若 ctx.scope 传的是 `['durov']` 或 `['telegram','durov']`，
        //     这里判定"缺 channel 作用域" → 标 `not-applicable` → **适配器从未被调用**。
        //   只有恰好传 `['channel']` 这个**能力标签**才通过  而那是测试里的写法，
        //   真实调用方自然会给**频道名**。
        //
        // 同一个字段在本仓库有**两份互相矛盾的理解**:
        //   - `adapters/adapter.ts` 的 `isApplicable`：`scope !== undefined && scope.length > 0`
        //     （非空即适用  它是对的）
        //   - 这里：要求字面包含 `'channel'`（**错的**）
        //
        // **判据取"有没有提供作用域"**，具体是什么由适配器自己解析
        // （`adapters/telegram.ts` 的 `splitScopeQuery` 从 query 里取频道名）。
        const provided = ctxWithScope.scope ?? []
        if (provided.length === 0) {
          const na = {
            sourceId: source.id,
            kind: 'not-applicable',
            message: `来源「${source.id}」需要作用域 ${source.requiredScope.join('/')}（如「频道名 关键词」的写法），` +
              '本次查询没有提供  不是坏了，是这次用不上',
          }
          // **这里也必须发事件**（2026-09-17 截图实测抓到）: 提前 return 而不 emit
          // 会让界面上这个来源永远停在"查询中…"  它明明已经决定了，只是没告诉任何人。
          emit({ kind: 'source-settled', tier, sourceId: source.id, hits: 0, failure: na, elapsedMs: Date.now() - t0 })
          return na
        }
      }
      // **缺失实现必须响亮**，不许静默变成 0 条。
      //
      // 实测依据（2026-09-16）: 第 1、2 层登记了 5 个来源（juejin/bilibili/
      // telegram-public/argo:anysearch…），而 `authoritativeFetchers()` **只覆盖第 0 层**。
      // 于是它们全部落进这一行，被当成"跑通了、只是没有内容"。调用方看到的是
      // 「第 1 层跑了，0 条」 一个**看起来正常的分层结果**，实际是**没有接线**。
      //
      // 这正是本组件从第一轮就在防的那个形态: 把"实现缺失"伪装成"没有内容"。
      // argo 的 `safe_search` 是这么做的，我们当初否决了它；这一行是同一个错误
      // 在我们自己的代码里的残留。
      if (fetch === undefined) {
        return {
          sourceId: source.id,
          kind: 'unwired',
          message: `来源「${source.id}」（第 ${source.tier} 层）没有取数实现  是**没有接线**，不是"没有内容"`,
        }
      }
      try {
        // **发给来源的查询必须是归一后的**（2026-09-18 A/B 消融倒逼）。
        //
        // 消融实测（同一假来源，只改查询）:
        //   上游按**查询原文**过滤 → 「微薄 热搜」只拿回含"微薄"的旧文 1 条，
        //   而「微博 热搜」拿回 2 条正确文档。
        //   **排序层修不了这件事**  错误在召回，不在排序。
        //
        // 归一后的查询此前只用于**排序与判定**（`queryTerms`），
        // 从没发给上游。于是"错别字容错"只在"上游恰好也返回了正确文档"时才生效 
        // 那是个巧合，不是能力。
        //
        // **为什么不传 variants 全部**: variants 是"多种写法并列搜"，
        // 那会让上游返回错字文档与正确文档的**并集**，然后由我们的判据筛 
        // 请求数不变但结果集变大。当前选更保守的做法: **只传归一后的规范形式**。
        // 若实测发现"上游只有错字文档"是常见情况，再改成并列。
        // 传 **ctxWithScope**（含自动识别的作用域），不是原始 ctx
        // **进入时刻必须单独报**  它与 settled 的 elapsedMs 配合才能区分
        // "这个来源慢" 与 "这个来源在排队"（见 RecallEvent 的注释）。
        emit({ kind: 'source-started', tier, sourceId: source.id, at: Date.now() })

        // **换语种重查**（2026-09-19 实测倒逼）。
        //
        // 实测（第 0 层 11 个来源，中文查询 vs 它的英文改写）:
        // ```
        //   Rust 所有权      → 15 条 | Rust ownership borrow checker → 21 条 (+40%)
        //   阿司匹林 相互作用  → 13 条 | aspirin drug interaction       → 21 条 (+62%)
        //   向量数据库 选型    → 13 条 | vector database comparison     → 23 条 (+77%)
        // ```
        // **三个查询全部上升 40-77%。** aether-search 的提示词里写着同一件事
        // （`English first for volume`） 两边独立指向同一结论。
        //
        // **与上面那段"不传 variants"的注释为什么不矛盾**
        // （读者会立刻问这个）:
        // - 那里否决的是**同语言的多种写法**（错字/正字），并列会返回并集、
        //   而并集里**混着错字文档**，要靠判据筛  是净负担;
        // - 这里是**不同语言的同义查询**。英文结果与中文结果**不重叠**
        //   （实测证据: 条数从 13 涨到 21，说明多出来的是新文档而非重复）。
        //
        // **变体与原文的结果合并，且原文永远在前**  用户问的是原文，
        // 变体只是补量。合并后仍走 `ctx.perSourceLimit` 截断。
        let got = await fetch(source, queryForSources, ctxWithScope)
        if (variants.length > 0) {
          // 变体失败**不让整个来源失败**  它是补充，不是主路径。
          // 但也不静默: 记进 `variantNotes` 由调用方决定是否展示。
          try {
            const alt = await fetch(source, variants[0]!, ctxWithScope)
            if (Array.isArray(alt) && alt.length > 0) {
              const seen = new Set(got.map(h => String(h.url)))
              const extra = alt.filter(h => !seen.has(String(h.url)))
              if (extra.length > 0) got = [...got, ...extra]
            }
          } catch {
            /* 变体是补充: 它失败不该让这条来源整体失败 */
          }
        }
        // 非法返回值必须**响亮**  静默变成 0 条会让"实现写错"伪装成"没有内容"
        if (!Array.isArray(got)) {
          throw new Error(`取数函数返回了非数组（${typeof got}） 实现有误，不是"没有内容"`)
        }
        const sliced = got.slice(0, ctx.perSourceLimit)
        // **在这里发**（而不是 Promise.all 之后再补）: 事件必须在它自己落定的那一刻流出,
        // 否则界面只能等整层跑完再一次性播放  那是**演戏**, 时间轴与实际执行无关。
        emit({ kind: 'source-settled', tier, sourceId: source.id, hits: sliced.length, elapsedMs: Date.now() - t0 })
        return sliced
      } catch (err) {
        // 失败进入 failures，**不**变成 0 条命中
        /**
         * argo 接线的三条硬约束  不接受缓存、不接受改道、缺失实现必须响亮
         * .agents/notes/implemented/architecture/2026-09-16-argo-wiring-three-constraints.md
         */
        const failure = { sourceId: source.id, kind: kindOf(err), message: (err as Error).message }
        emit({ kind: 'source-settled', tier, sourceId: source.id, hits: 0, failure, elapsedMs: Date.now() - t0 })
        return failure
      }
    }))
    for (let i = 0; i < settled.length; i++) {
      const item = settled[i]!
      const srcId = usable[i]!.id
      if (Array.isArray(item)) {
        tierHits.push(...item)
        // 有产出才算「成功返回」 跑通了但 0 条的来源不参与话题契合度
        if (item.length > 0) successfulSources.push(srcId)
      } else {
        failures.push(item)
      }
    }
    const succeeded = failures.length < usable.length
    tiers.push({
      tier,
      ran: true,
      sources: usable.map(s => s.id),
      hits: tierHits.length,
      failures,
      elapsedMs: Date.now() - started,
    })
    emit({ kind: 'tier-end', tier, outcome: tiers[tiers.length - 1]! })
    if (succeeded) {
      successfulTiers.push(tier)
      // **层内重排**: 话题契合的来源（擅长这类问题）优先于不契合的（学科语料库）。
      //
      // 依据（线上实测，2026-09-16）: 查询「Rust 所有权」时第 0 层**确实**拿到了
      // 相关结果（github 的 rust-lang/rust、npm、mdn），但 Crossref 的 3 篇中文
      // 法律论文排在前面  因为来源按登记顺序拼接，而 crossref 登记在最前。
      // 于是 18 条命中里前 3 条全无关，用户看到的就是「一屏权威来源，没一条答问题」。
      //
      // 这是**稳定排序**: 组内保持来源给出的相对顺序，不引入任何跨来源分值。
      // **两维六档稳定排序**。两个维度是独立的，必须都排:
      //
      //   1. **字面相关性**（这条命中覆盖了几个查询词、够不够及格线） 实测依据:
      //      覆盖 0 个查询词的结果占到 6/22、9/20、6/21，即约**三分之一的结果
      //      与查询毫无字面关系**，而它们按来源登记顺序占据固定名额，把相关结果往后挤。
      //   2. **来源话题契合度**（这个来源擅长不擅长这类问题） 实测依据:
      //      Crossref 的中文法律论文曾在第 0 层占据前三位。
      //
      // 只排第 2 维会漏掉"契合来源里的无关命中"；只排第 1 维会漏掉"两篇都覆盖了
      // 查询词、但一篇来自官方文档一篇来自无关学科"的情况。
      //
      // **字面相关性是第一维，来源话题契合是第二维。顺序不能反。**
      //
      // 我先写成了反的（来源维度优先），线上实测立刻打脸: 查询「Rust 所有权」时
      // 第 4 位是 npm 的 `@formatjs/icu-messageformat-parser`（覆盖 0 个查询词），
      // 它排在一堆**可能相关**的 MDN/Wikipedia 条目之前  只因为 npm 与查询意图
      // 同为 `code`。这条 0 覆盖的包名对用户毫无价值，它凭的是"来源对口"这个**先验**。
      //
      // 两者的性质不同，所以强度不同:
      //   - 字面相关性看的是**这条内容本身**（覆盖了几个查询词） 直接证据
      //   - 来源话题契合看的是**来源的学科归属**（提问是否属于它的领域） 先验
      // 直接证据强于先验，所以先按相关性分档，档内再按来源分档。
      //
      // 完全是**稳定排序**: 组内保持来源给出的相对顺序，不引入任何跨来源分值。
      const intent = classifyQueryIntent(ctx.query)
      const sourceBands = (list: readonly SourceHit[]): SourceHit[] => [
        ...list.filter(h => sourceMatchesIntentExactly(h.sourceId, intent)),
        ...list.filter(h => !sourceMatchesIntentExactly(h.sourceId, intent) && sourceFitsIntent(h.sourceId, intent)),
        ...list.filter(h => !sourceFitsIntent(h.sourceId, intent)),
      ]
      // **按覆盖数分档，不是按"相关/不相关"两档**（2026-09-17 基准题实测倒逼）。
      //
      // 实测（查询「GPT 文生图 提示词」，5 个查询词）:
      //
      //   crossref  AIGC驱动下传统纹样文化转译的分层**提示词**方法论研究   覆盖 1/5
      //   pubmed    Feasibility study of using **GPT** for history-taking    覆盖 1/5
      //   github    ...支持 gpt-image-2 和千问的**文生图**模型的**提示词**…    覆盖 3/5
      //
      // 旧实现把它们全归入"相关组"（`>= 1` 即为真），组内再按**来源契合度**排 
      // 而意图是 `general`，所有来源同档，于是排序退化成**登记顺序**: crossref 登记在最前，
      // 两篇与问题无关的论文就稳稳占住前两位，4 个真正相关的仓库被挤到第 5 位之后。
      //
      // 这就是"垃圾搜索返回通用结果"的机制: **把覆盖 1 个词和覆盖 3 个词当成同一回事**。
      // 字面覆盖数不是语义理解，但它是**已有的直接证据**，丢掉它没有任何理由。
      const covered = (h: SourceHit): number => queryTermMatches(h, ctx.query)
      const relevant = tierHits.filter(h => isQueryRelevant(h, ctx.query))
      const irrelevant = tierHits.filter(h => !isQueryRelevant(h, ctx.query))
      // **只把"覆盖面明显更广"的提到前面，同档内一个都不动。**
      //
      // 判据用"最佳覆盖数"而不是逐条覆盖数分组  后者会打乱同覆盖数的相对顺序，
      // 破坏"层内保持来源给出的顺序"这条铁律（实测: 6 项测试当场变红）。
      //
      // 门槛取 ceil(词数/2) 且至少 2: 单靠一个词命中不足以证明"在讲这件事"
      // （crossref 的论文含"提示词"、pubmed 的文章含"GPT"，两者都只覆盖 1 个词）。
      // **只在意图为 `general` 时启用**  有领域先验就用先验，没有才退到字面覆盖数。
      //
      // 理由（一次实测失败逼出来的边界）: 用「Rust 所有权」做了对照  那是 `code` 意图，
      // github 精确契合、crossref 是学科语料库。若覆盖数优先，crossref 的标题
      // 「全民所有自然资源资产**所有权**委托代理模式探究」会**赢**，因为
      // 一个 CJK 词贡献了 3 个匹配（`所有权` 本身 + bigram `所有`/`有权`）。
      // 而它显然与问题无关。**字面覆盖数会被 CJK bigram 虚高，压不过领域先验。**
      //
      // 反过来，`general` 意图下**所有来源同档**（先验没有意见），排序退化成登记顺序 
      // 那正是基准题「GPT 文生图 提示词」的症状: crossref/pubmed 各命中 1 个词就占住前两位。
      // 此时覆盖数是**唯一可用的直接证据**，必须用它。
      const best = relevant.reduce((m, h) => Math.max(m, covered(h)), 0)
      // **门槛的来历与它已知的缺陷**（2026-09-19 实测记录）。
      //
      // `queryTerms` 把 CJK **bigram 也算进去**  「文生图」贡献 `文生`/`生图`，
      // 「提示词」贡献 `提示`/`示词`。于是 `queryTerms('GPT 文生图 提示词')` =
      // `[gpt, 文生, 提示, 生图, 示词]` **5 个** → 门槛 `ceil(5/2) = 3`。
      //
      // 而实测的覆盖数分布是: `2 crossref(含「提示词」) / 1 github / 1 pubmed / 0 github`
      //  **没有任何一条达到 3**，于是 `promote` 为假，**排序退回登记顺序**，
      // crossref/pubmed 的无关论文坐稳前两位。
      //
      // **我试过两种修法，都被实测否决，故保留原样并记录**:
      //
      // 1. 门槛改按**实词数**算（`ceil(3/2)=2`）→ 门槛降到 2，
      //    **crossref 靠 bigram 虚高的 2 分冲到了第 1 位，比原来更差**。
      // 2. `queryTermMatches` 改按**实词段**计（一个实词的多个 bigram 只算一次）
      //    → 虚高确实消除了（三者都变 1），**但也失去了区分力**（crossref 与 github 同分），
      //    且**当场打红 2 条既有测试**（`错字与正字都在相关组内` 等）。
      //
      // **结论**: 这条排序维在 CJK 上的**分辨率不足是结构性的** 
      // 字面覆盖数压不过 bigram 的噪声，而这是注释里早就写下的判断
      // （「字面覆盖数会被 CJK bigram 虚高，压不过领域先验」）。
      // **真正的解法是语义判据，不是继续调这个数值门槛。**
      // 这里保留原实现并留下两次失败的记录，以免后人重走。
      const strongMin = Math.max(2, Math.ceil(queryTerms(ctx.query).length / 2))
      // **注意两个 `general` 不是同一个东西**（2026-09-19 澄清，我在这里绕过一次）。
      //
      // 本项目有**两套独立分类**:
      //   - `recall.ts` 的 `QueryIntent`（5 类 + general） 管**充分性判断**与这一行的排序
      //   - `route-sources.ts` 的 `TopicClass`（9 类 + genai） 管**选源裁剪**
      //
      // 我给 `TopicClass` 加了 `genai` 之后，一度以为要在这里也放行 `genai` 
      // **那是死代码**: `classifyQueryIntent('GPT 文生图 提示词')` 实测返回的是 `general`
      // （`genai` 从来不在 `QueryIntent` 里）。**先把 `check` 写成 `=== 'genai'`，
      // 再用实测核对它是否可达，才发现它永远不会为真。**
      //
      // **留给后人的判据**: 改这套分类之前先用 `classifyQueryIntent` 实测一次，
      // 不要靠"名字看起来像"推断。
      const noPrior = intent === 'general'
      const promote = noPrior && strongMin <= best
      const strong = promote ? relevant.filter(h => covered(h) >= strongMin) : []
      const weak = promote ? relevant.filter(h => covered(h) < strongMin) : relevant
      // **第三维: 证据块密度**（2026-09-18 读 argo 后加）。
      //
      // 前两维（覆盖数、来源契合）都不看"这条内容里**有什么**"。
      // 实测问题: 两条都覆盖了查询词、都来自契合来源，一条写"Rust 所有权很重要"，
      // 另一条写"所有权规则要求：每个值有唯一主人（定义）；相比 GC 无需运行时开销（对比）；
      // 规则共 3 条（数字）"  后者才是有东西可以被吸收进答案的。
      //
      // **仍然是稳定分档，不是全序**: 只在"有事实块 / 无事实块"之间分层，
      // 同层内保持原有顺序。全序排序会打乱同分顺序，破坏"层内保持来源顺序"（第 18 轮的教训）。
      // 门槛取 0.5: 基线 0.15 + 长度 0.05 = 0.20 是"什么都没有"，
      // 命中任一实质特征（数字 0.37 / 定义 0.33 / 对比 0.31 / 步骤 0.27）即越过 0.5 需要两项，
      // 所以 0.5 的门槛含义是"至少两个证据块"。
      const factual = (list: readonly SourceHit[]): SourceHit[] => {
        const withFacts = list.filter(h => evidenceBlocksOf(h).density >= 0.5)
        const without = list.filter(h => evidenceBlocksOf(h).density < 0.5)
        return [...withFacts, ...without]
      }
      // **第四维: 否定约束**（2026-09-18）。用户说"不要广告"，就不该把广告排在前面。
      // 只降档不丢弃  "含该词"未必等于"是关于它"（《广告之外：图片压缩工具横评》
      // 含"广告"却是好结果）。放在最后一维，因为它是最弱的信号。
      const nonExcluded = (list: readonly SourceHit[]): SourceHit[] => {
        const clean = list.filter(h => negationPenalty(h, ctx.query) === 0)
        const excluded = list.filter(h => negationPenalty(h, ctx.query) !== 0)
        return [...clean, ...excluded]
      }
      hits.push(
        ...nonExcluded(factual(sourceBands(strong))),
        ...nonExcluded(factual(sourceBands(weak))),
        ...sourceBands(irrelevant),
      )
      dedupeWithinSource(hits)
    }
    reachedTier = tier

    verdict = rule.assess({ hits, successfulTiers, successfulSources, ctx })
    if (verdict.sufficient) {
      stoppedBecause = `${rule.name}: ${verdict.signals.map(s => `${s.name} ${s.ok ? '✓' : '✗'} ${s.detail}`).join('; ')}`
    }
  }

  if (stoppedBecause === '') {
    stoppedBecause = '已跑完所有登记的层级'
    // 没停说明最后一次评估仍不充分; 若一次都没评估过(所有层都没跑), 用当前 hits 评估一次
    if (verdict.signals.length === 0) verdict = rule.assess({ hits, successfulTiers, successfulSources, ctx })
  }

  // exhausted = 没有因为"够了"而提前停  即一路下降到 maxTier 或跑完了所有层
  // 证据块随结果一起下发（2026-09-18）: 前端不该重复实现正则，也不该猜。
  // 这条**不是**为了排序排序在下面的层内分档里已经用过它了；
  // 这里是为了让**人**能看见"这条到底有什么可吸收的东西"。
  for (const h of hits) (h as SourceHit & { blocks?: EvidenceBlocks }).blocks = evidenceBlocksOf(h)
  const result: RecallResult = {
    query,
    hits,
    verdict,
    tiers,
    reachedTier,
    stoppedBecause,
    exhausted: stoppedBecause === '已跑完所有登记的层级',
  }
  emit({ kind: 'done', result })
  return result
}

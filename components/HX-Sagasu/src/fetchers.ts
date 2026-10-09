/**
 * 取数函数的**统一组装点**。
 *
 * ## 为什么需要这个文件
 *
 * 三条实现路径各自导出取数函数，而**没有任何地方把它们合并**（2026-09-16 实测确认）：
 *
 *   `authoritativeFetchers()`  第 0 层，11 个原生 HTTP 实现（crossref/arxiv/…）
 *   `argoFetchers(session)`    第 1、2 层的 argo 引擎（juejin/bilibili/argo:anysearch）
 *   `adapters/`                直连平台 API（bilibili 的 search+thread、telegram 的 thread）
 *
 * 结果是：**适配器那一路从未被接进召回**。`SOURCES` 里登记了 `bilibili`，
 * 于是调用方以为它在工作  实际跑的是 argo 引擎，而适配器（能拿评论区对话现场的那个）
 * 一行都没执行。这和上一轮修的"第 1、2 层没接线"是**同一个病的最后一处**：
 * 登记表说"有"，实际路径说"没有"。
 *
 * ## 这条路径的语义: 适配器优先，argo 备选
 *
 * 一个来源可能有多条实现。选择规则**不是"谁更新"或"谁更快"**，而是:
 *
 *   **适配器 > argo 引擎 > 原生 HTTP**
 *
 * 理由（都有实测依据）: 适配器能拿到 argo 拿不到的东西，且**失败语义更精确**。
 *   - `bilibili` 适配器: 搜索 + `thread()` 取**评论区两层结构**（顶层 + 楼中楼），
 *     这是"对话式语义"在 B站的唯一来源；argo 只给视频元数据
 *   - `telegram` 适配器: 频道内搜索实测可用（`?q=` 服务端过滤）
 *   - 反例 `juejin`: **没有**适配器，所以走 argo  这不是退让，是平台现状
 *
 * 但"优先"不等于"独断": 某条路径失败时**不自动降级**。降级会让调用方无法区分
 * "主路坏了"与"主路没有内容"。**要降级必须由调用方显式组装**（传入自己的顺序）。
 */

import type { SourceHit } from './recall.ts'
import type { ThreadAdapter } from './adapters/adapter.ts'

/** 与 `recall.ts` 的 `SourceFetcher` 同形  这里故意不 import 它以防循环依赖。 */
export type Fetcher = (
  source: { id: string },
  query: string,
  ctx: { perSourceLimit: number },
) => Promise<SourceHit[]>

/** 取数函数 + 它的适用条件。 */
export interface AdapterFetcherEntry {
  fetcher: Fetcher
  /** 搜索需要的作用域（`'channel'` = 必须先给出频道名）。`'none'` = 吃原始查询。 */
  searchScope: 'none' | 'channel'
}

/**
 * 把适配器的 `search()` 包成取数函数。
 *
 * **能力检查在组装期完成，不在调用期**: `capabilities.search === false` 的适配器
 * 会被直接拒绝并给出原因，而不是在每次召回时抛一次错。组装期的失败更便宜，
 * 也更容易被看到。
 *
 * 返回的条目**带上 `searchScope`**  让调用方能在查询进入之前判断"这次用得上它吗"，
 * 而不是等一个必然的失败（Telegram 的频道内搜索遇到裸查询就是这种情形）。
 */
export function adapterFetcherEntries(
  adapters: Readonly<Record<string, ThreadAdapter>>,
): Record<string, AdapterFetcherEntry> {
  const out: Record<string, AdapterFetcherEntry> = {}
  for (const [sourceId, adapter] of Object.entries(adapters)) {
    if (!adapter.capabilities.search) {
      throw new Error(
        `适配器 ${adapter.platform} 不支持搜索（capabilities.search=false），不能作为来源「${sourceId}」的取数实现。` +
          '需要按 ref 读取线程时请用 thread()，而不是把它注册成一个可回答查询的来源',
      )
    }
    out[sourceId] = {
      searchScope: adapter.capabilities.searchScope ?? 'none',
      fetcher: async (_source, query, ctx) => {
        // `limit` 而非 `perSourceLimit`: 适配器端口用前者。这是**唯一的**换算点，
        // 这样上层改 ctx 字段名时只需改这里一处。
        const hits = await adapter.search(query, { limit: ctx.perSourceLimit })
        return hits.map(h => {
          const out: SourceHit = { sourceId, title: h.title, url: h.url }
          if (h.createdAt !== undefined) out.snippet = new Date(h.createdAt).toISOString().slice(0, 10)
          return out
        })
      },
    }
  }
  return out
}

/**
 * 只要取数函数、不要作用域信息时的便捷包装。
 *
 * **注意它丢掉的信息**: 对 `searchScope: 'channel'` 的来源（Telegram），用这个函数
 * 组装会让裸查询走向一个必然的失败。**只有在确定会传入作用域、或明确接受那次失败时
 * 才用它**；否则用 `adapterFetcherEntries`。
 
 * .agents/notes/implemented/architecture/2026-09-16-fetcher-composition-point.md
 */
export function adapterFetchers(
  adapters: Readonly<Record<string, ThreadAdapter>>,
): Record<string, Fetcher> {
  const out: Record<string, Fetcher> = {}
  for (const [id, entry] of Object.entries(adapterFetcherEntries(adapters))) out[id] = entry.fetcher
  return out
}

/**
 * 把多条路径的取数函数合并成一张表。
 *
 * **冲突一律抛错，不做优先级仲裁。** 这是刻意的: 如果允许"靠后的覆盖靠前的"，
 * 那么"哪一份实现在跑"就取决于参数顺序  而**没有人会去读参数顺序**。
 * 上一轮刚加测试防"同一来源被两个模块实现而无人察觉"，这里在运行期再防一次。
 *
 * 也就是说: 合并是**把不同来源的表拼起来**，不是"给同一来源挑一个实现"。
 * 给同一来源挑实现是 `fetcherPlan()` 的职责，它必须显式写出主次。
 */
export function composeFetchers(...tables: Array<Record<string, Fetcher>>): Record<string, Fetcher> {
  const out: Record<string, Fetcher> = {}
  const owner = new Map<string, number>()
  tables.forEach((table, i) => {
    for (const id of Object.keys(table)) {
      if (owner.has(id)) {
        throw new Error(
          `来源「${id}」被第 ${owner.get(id)! + 1} 张与第 ${i + 1} 张取数表同时实现。` +
            '合并**不做优先级仲裁**  请先用 fetcherPlan() 显式挑定实现，再合并',
        )
      }
      owner.set(id, i)
      out[id] = table[id]!
    }
  })
  return out
}

/** 一条来源的实现路径与它的主次。 */
export interface SourcePath {
  sourceId: string
  /** 实际提供实现的模块。 */
  module: 'adapter' | 'argo' | 'authoritative'
  /** 主路优先；备选只在主路**不可用**（未接线/能力缺失）时接管，不因运行时失败降级。 */
  rank: 'primary' | 'fallback'
  /** 为什么是这条路  必须能指向一条实测证据。 */
  reason: string
}

/**
 * 来源 → 实现路径的**完整计划**。
 *
 * 这张表存在的理由: 在此之前，"哪个模块实现哪个来源"只写在代码注释和我的记忆里，
 * 于是 `bilibili` 同时有适配器与 argo 引擎却**没有任何地方知道该用哪个**，
 * 而实际跑的是谁纯属偶然（组装点根本不存在，适配器一路从未接线）。
 *
 * 新增来源或新增实现路径时**必须在这里登记**，否则 `planFetchers()` 会把它当
 * 未接线处理。这与 `registry-consistency.test.ts` 的 `IMPL_OWNER` 是同一件事的
 * 运行期版本  那个防"忘了登记"，这个防"登记了但没接线"。
 */
export const SOURCE_PLAN: readonly SourcePath[] = [
  // ── 适配器主路: 能拿到 argo 拿不到的东西，且失败语义更精确
  { sourceId: 'bilibili', module: 'adapter', rank: 'primary',
    reason: '适配器提供 thread() 取评论区两层结构（顶层+楼中楼） 对话式语义在 B站的唯一来源；argo 只给视频元数据' },
  { sourceId: 'telegram-public', module: 'adapter', rank: 'primary',
    reason: '2026-09-16 实测频道内搜索可用（?q= 服务端过滤，telegram 20/20 命中、无结果词 0 条）' },
  // ── juejin 是唯一的多路交集（原生 + argo），主次由**实测产出**决定
  { sourceId: 'juejin', module: 'authoritative', rank: 'primary',
    reason: '原生 juejinSearch 实测返回 20 条高度相关（《Rust 所有权与借用：从堆栈开始建立心智模型》），强于 argo 引擎' },
  { sourceId: 'juejin', module: 'argo', rank: 'fallback',
    reason: '原生实现失效时接管  需要调用方显式启用，不做运行期自动降级' },
  // ── 2026-09-18 扩张：新增 argo 引擎（按能力族登记）────────────────
  // 这些来源**只有** argo 一条实现路径  我们不各自实现 140 个 HTTP 客户端，
  // 这正是"复用 argo"的具体形态：它已经解决了鉴权/解析/限流。
  //
  // **wikipedia / hackernews 走 fallback 而不是 primary**: 它们在第 0 层已有
  // **原生直连实现**（官方 API），实测产出更好且失败语义更精确。argo 那条是第二条
  // 独立路径（本地镜像 / 不同端点），按 juejin 的先例登记为 fallback 
  // 需要调用方显式启用，不做运行期自动降级。
  // **wikipedia / hackernews 是双路来源**（与 juejin 同形）: 第 0 层有原生直连实现
  // （官方 API，产出更好、失败语义更精确），argo 那条是第二条独立路径。
  // 主次按实测产出定  原生为主，argo 显式启用为备。
  { sourceId: 'wikipedia', module: 'authoritative', rank: 'primary',
    reason: '第 0 层原生走 Wikipedia 官方 API，条目 id 稳定、失败语义精确' },
  { sourceId: 'wikipedia', module: 'argo', rank: 'fallback',
    reason: 'argo 的 local_wikipedia 是本地镜像路径，与官方 API 互为独立佐证  需显式启用' },
  { sourceId: 'hackernews', module: 'authoritative', rank: 'primary',
    reason: '第 0 层原生走 HN 官方 API（Algolia），条目 id 与点数可核查' },
  { sourceId: 'hackernews', module: 'argo', rank: 'fallback',
    reason: 'argo 引擎为第二条独立路径  需显式启用，不做运行期降级' },
  // 以下来源只有 argo 一条路径
  { sourceId: 'duckduckgo', module: 'argo', rank: 'primary',
    reason: '通用元搜索兜底（第 2 层），覆盖面广但无权威性判断' },
  { sourceId: 'baidu_baike', module: 'argo', rank: 'primary',
    reason: '中文百科入口，词条 id 稳定；无外部编辑审核，权威性低于维基' },
  { sourceId: 'moegirl', module: 'argo', rank: 'primary',
    reason: 'ACG 领域专精百科，该领域覆盖率高于通用百科' },
  { sourceId: 'reddit', module: 'argo', rank: 'primary',
    reason: '国际社区长尾经验，内容质量依赖具体 subreddit 治理' },
  { sourceId: 'douban_book', module: 'argo', rank: 'primary',
    reason: '中文书影音元数据，条目 id 稳定；评分是主观聚合' },
  { sourceId: 'devto', module: 'argo', rank: 'primary',
    reason: '英文技术博客平台，作者可核查；与掘金同族提供英文对照' },
  { sourceId: 'huggingface', module: 'argo', rank: 'primary',
    reason: '模型/数据集仓库，owner 与 revision 可核查，该领域一手供给' },
  { sourceId: 'dblp', module: 'argo', rank: 'primary',
    reason: 'CS 文献索引，每条带稳定 dblp key，与 Crossref 互补' },
  { sourceId: 'open_library', module: 'argo', rank: 'primary',
    reason: 'Internet Archive 图书元数据，ISBN 等持久标识符' },
  { sourceId: 'gutenberg', module: 'argo', rank: 'primary',
    reason: '公版全文存档，每本有稳定唯一编号；覆盖止于公版年份' },
  { sourceId: 'crates', module: 'argo', rank: 'primary',
    reason: 'Rust 官方包登记机构维护，版本与校验和由该机构保证' },
  { sourceId: 'bilibili_hot', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'pubchem', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'clinicaltrials', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'openfda', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'uniprot', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'rcsb_pdb', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'gbif', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'nasa_cmr', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'usgs', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'fred', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'worldbank', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'nbs_stats', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'sec_edgar', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'courtlistener', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'gov_policy', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'europepmc', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'doaj', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'pypi', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },
  { sourceId: 'stackoverflow', module: 'argo', rank: 'primary', reason: 'argo 引擎，实测 2026-09-18 有产出；只有 argo 一条实现路径' },  { sourceId: 'argo:anysearch', module: 'argo', rank: 'primary',
    reason: '第 2 层兜底，argo auto 模式按语言与话题自适应选引擎（实测中文→local_bing、英文→crates）' },
]


export interface FetcherPlanInput {
  /** 各模块**已就绪**的取数表。缺失的模块（如未装 argo）直接不传。 */
  available: Partial<Record<'adapter' | 'argo' | 'authoritative', Record<string, Fetcher>>>
}

export interface FetcherPlanResult {
  fetchers: Record<string, Fetcher>
  /** 计划里有、但对应模块**没提供**的来源  这是"未接线"，必须能被上报。 */
  missing: Array<{ sourceId: string; module: SourcePath['module']; reason: string }>
}

/**
 * 按 `SOURCE_PLAN` 解析出一张可直接喂给 `recall()` 的取数表。
 *
 * **只做主路解析，不做运行期降级**: 主路模块没传进来（如没装 argo）时，该来源进
 * `missing` 而不是自动改用备选。理由: "主路不可用"与"主路没有内容"必须可区分 
 * 自动降级会让调用方永远不知道主路是坏的。要启用备选就显式调 `fallbackPaths()` 并合并。
 */
/**
 * 第 0 层（权威公域）的**模块级通路**：整层由一个模块提供。
 *
 * ## 为什么需要它（2026-09-17 实测倒逼）
 *
 * 在此之前 `SOURCE_PLAN` 只登记 5 条，而 `SOURCES` 有 15 条  **11 个第 0 层来源
 * 没有任何 route 条目**。实测后果：
 *
 *   authoritativeFetchers() 提供 12 个实现
 *   planFetchers({available:{authoritative}}) 输出 **1 个**（只有 juejin）
 *
 * → 11 个第 0 层来源在**组装点被静默丢弃**，到了 recall 才报"没有取数实现"。
 * 这比"忘了接线"更糟：实现是**已就绪**的，是组装点把它扔了；而报出来的错还指向了
 * 错误的层（读者会去查取数层，问题却在组装点）。
 *
 * ## 为什么不把那 11 条写进 SOURCE_PLAN
 *
 * 它们的 reason 完全相同。**一条模块级通路表达的正是它们唯一的共性。** 逐条重复 11 遍
 * 只会让表变长而不变准，而且每加一个第 0 层来源都要记得补一条  **那正是这个 bug 的成因**。
 *
 * 逐条登记仍然优先：已登记在 `SOURCE_PLAN` 里的来源不会被本通路覆盖，
 * 所以 juejin（第 0 层与第 1 层都有实现、主次由实测决定）仍由 `SOURCE_PLAN` 说了算。
 
 * .agents/notes/implemented/architecture/2026-09-17-assembly-point-drops-wired-sources.md
 */
export const AUTHORITATIVE_WHOLE_TIER: SourcePath = {
  sourceId: '*',
  module: 'authoritative',
  rank: 'primary',
  reason: '第 0 层整层由 authoritative.ts 提供（原生 HTTP 实现，逐条登记的 reason 完全相同）',
}

/**
 * 一个精确复现但未根治的并发失败  以及两处已修的真 bug
 * .agents/notes/implemented/architecture/2026-09-18-argo-concurrency-unresolved.md
 * 第 0 层被 argo 覆盖 + 握手计时器起点错  以及一个未解决的差异
 * .agents/notes/implemented/architecture/2026-09-18-tier0-override-and-handshake.md
 */
export function planFetchers(input: FetcherPlanInput): FetcherPlanResult {
  const fetchers: Record<string, Fetcher> = {}
  const missing: FetcherPlanResult['missing'] = []
  const claimed = new Set<string>()
  for (const path of SOURCE_PLAN) {
    if (path.rank !== 'primary') continue
    claimed.add(path.sourceId)
    const table = input.available[path.module]
    if (table === undefined) {
      missing.push({
        sourceId: path.sourceId,
        module: path.module,
        reason: `主路模块 ${path.module} 未提供（该来源: ${path.reason}）`,
      })
      continue
    }
    const fn = table[path.sourceId]
    if (fn === undefined) {
      missing.push({
        sourceId: path.sourceId,
        module: path.module,
        reason: `模块 ${path.module} 已提供，但没有来源「${path.sourceId}」的实现`,
      })
      continue
    }
    fetchers[path.sourceId] = fn
  }
  // 模块级通路: 补上整层由一个模块提供的来源，**不覆盖**逐条登记过的
  const whole = input.available[AUTHORITATIVE_WHOLE_TIER.module]
  if (whole !== undefined) {
    for (const [id, fn] of Object.entries(whole)) {
      if (claimed.has(id)) continue
      claimed.add(id)
      fetchers[id] = fn
    }
  }
  // **argo 表也整层补齐**（2026-09-18 扩张）: 新增的引擎只有 argo 一条实现路径
  // （我们不各自实现 140 个 HTTP 客户端），但它们**跨层分布**  dblp/open_library/
  // gutenberg/crates 登记在第 0 层，duckduckgo 在第 2 层。上面的 authoritative
  // 整层补齐只认第 0 层原生直连来源（AUTHORITATIVE_WHOLE_TIER 指向 authoritative 模块），
  // 所以这里对 **argo 模块**再补一次，覆盖那些"登记在某一层、实现只在 argo"的来源。
  //
  // **为什么不做成"按 tier 过滤"**: 那会要求 fetchers.ts 依赖 SOURCES 的 tier 字段，
  // 把"组装"与"登记"两个关注点耦合起来。整层补齐的语义是**模块级**的
  // （"这个模块能提供哪些来源"），保持它不依赖分层信息更稳。
  const argoWhole = input.available['argo']
  if (argoWhole !== undefined) {
    // **必须避开所有已登记的来源，而不只是已认领的**（2026-09-18 修）。
    //
    // 此前只查 `claimed`，而 `claimed` 只记录 **SOURCE_PLAN 的 primary**。
    // `wikipedia`/`hackernews` 的 argo 那条登记为 **fallback**（它们的 primary 是
    // authoritative 的原生 HTTP），于是它们不在 `claimed` 里 →
    // **被整层补齐覆盖成 argo 实现**。
    //
    // 实测后果: 第 0 层的 `wikipedia` 走了 argo（串行 12 秒），而它的原生 HTTP
    // 实现被顶掉；同层并发时进一步挤掉其他 argo 来源的握手。
    //
    // 判据: **只要某个 id 在 SOURCE_PLAN 里出现过（无论 primary 还是 fallback），
    // 它的实现就必须由 SOURCE_PLAN 决定**  整层补齐只负责"没有任何登记"的那些。
    const registered = new Set(SOURCE_PLAN.map(p => p.sourceId))
    for (const [id, fn] of Object.entries(argoWhole)) {
      if (claimed.has(id) || registered.has(id)) continue
      claimed.add(id)
      fetchers[id] = fn
    }
  }
  return { fetchers, missing }
}

/** 取某个来源的备选路径  供调用方**显式**组装降级链，而不是隐式发生。 */
export function fallbackPaths(sourceId: string): SourcePath[] {
  return SOURCE_PLAN.filter(p => p.sourceId === sourceId && p.rank === 'fallback')
}


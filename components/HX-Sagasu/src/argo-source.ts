/**
 * argo 取数层: 把 argo 的引擎接进分层召回的第 1、2 层。
 *
 * 为什么单独一个文件: argo 通过 **MCP 子进程**通信（stdio JSON-RPC），而其余来源都是
 * 纯 HTTP。把子进程生命周期、协议握手与"哪些错误算失败"集中在这里，让 `recall.ts`
 * 继续只面对 `SourceFetcher` 这个端口。
 *
 * ## 本项目对 argo 的三条硬约束（都有实测依据）
 *
 * 1. **引擎与实际路由必须一致**（2026-09-18 修正）: 响应里的 `engines_used` 若与请求的
 *    engine 不符（且请求不是 auto），说明这次拿到的内容**不是目标引擎产出的** 
 *    响亮报错，不静默接受。**这才是真正的保护，而且它是充分的。**
 *
 *    ### 一条被修正的约束（重要）
 *
 *    这里原本还有一条"**不接受任何 `cached: true` 的结果**"，理由写的是
 *    "argo 的 L2 缓存**键不含 engine**"。**那个前提是错的。**
 *    `cache.py:607-616` 的键是 `{kind}|{nq}|{engine}|{domain}|{mode}|{depth}`，
 *    **engine 是第三个字段**。
 *
 *    真因是 `find_similar`（`cache.py:449-490`）**语义软命中**：精确键 miss 时按
 *    minhash 相似度 ≥ 0.7 找近重复查询的缓存，而它**收了 `engine` 参数却从不使用**，
 *    候选只按 `domain = ?` 过滤。**所以串味确实会发生在"软命中"这条路径上** 
 *    但它的**表现形式**是 `engines_used` 里出现**别的引擎名**，
 *    而那恰好被下面第 2 条检查精确拦住。
 *
 *    ### 为什么必须删掉这条误拒（实测代价）
 *
 *    2026-09-18 同日对照实验：`juejin` 直调返回 **9 条全部相关**的结果
 *    （"180个精选OpenAI GPT4o文生图核心提示词"…），但走完整 `recall` 时
 *    **9 条全部被这条误拒丢掉**，该来源报 `argo/unsupported`，
 *    而查询退化成第 2 层 metasearch 拿回的 arxiv 论文。
 *
 *    **一条基于错误归因的防护，比没有防护更危险**：它看起来在保护证据完整性，
 *    实际在丢弃正确证据，而且理由写得很具体、让人不会去怀疑它。
 *
 * 3. **失败必须响亮**: 进程起不来、协议超时、工具报错，一律抛 `AdapterError`，
 *    绝不返回 `[]`。空数组只表示"真的查了、真的没有"。
 *
 * ## 与 argo 自身"吞成空"的差别
 * argo 的 `safe_search` 装饰器与 CLI builder 的 `_run` 会把异常与非零退出**吞成空结果**。
 * 本模块**不复用**那条路径  它直连 MCP 的 `tools/call`，把错误原样带出来。
 */

import { adapterError } from './adapters/adapter.ts'
import { createGate } from './argo-gate.ts'
import type { SourceHit } from './recall.ts'

/** 一次 MCP 会话的最小接口。抽成端口是为了让测试能注入假进程。 */
export interface McpSession {
  call(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>>
  close(): void
}

export interface ArgoSearchResponse {
  query?: string
  engine?: string
  engines_used?: string[]
  count?: number
  cached?: boolean
  results?: Array<{ title?: string; url?: string; snippet?: string; source?: string; score?: number }>
}

/** argo 引擎 → 本组件来源 id 的映射。第 1 层用具体平台，第 2 层用通用兜底。 
 * .agents/notes/implemented/architecture/2026-09-18-reachability-recheck.md
 */
export const ARGO_ENGINE: Readonly<Record<string, string>> = {
  juejin: 'juejin',
  bilibili: 'bilibili',
  // 2026-09-18 复核时发现可用: 站内热门榜，与 bilibili 搜索是两条不同路径
  bilibili_hot: 'bilibili_hot',
  'argo:anysearch': 'auto',
  // ── 2026-09-18 扩张：从 3 个到 15 个 ─────────────────────────────
  //
  // **为什么现在扩**: 用户问"同一个 q，你的结果最差也是和他一模一样吗"。
  // 实测同引擎同查询已等价（juejin 9→9、0 缺失），但 **argo 有 134 个可路由引擎，
  // 我们只接了 3 个**  那是唯一的真实差距，而且它只能靠"多接"来缩小。
  //
  // **为什么一次能接这么多而不用逐个验证**: argo 已把 134 个引擎按 19 个**能力族**
  // 组织好了（web_general/academic/code/knowledge/social/...），族是**能力契约** 
  // 同族引擎可互换，这正是它设计里最值得复用的部分。
  //
  // **登记口径**: 只收**零成本、无凭证**的引擎。付费/需 key 的（firecrawl/Tavily/bocha）
  // 一律不登  它们会让"这条查不到"变成"这次没配 key"，而那是我们明确拒绝的混淆
  // （`unwired` 与 `no-content` 必须可区分）。
  // ⚠ **实测坏掉**（2026-09-18）: 两组查询（'Rust' / '天气'）均 0 条。
  // 它与 \`argo:anysearch\` 同为通用兜底，但那个是好的（实测有产出）。
  // **保留登记而不删**：它可能只是上游临时故障，删掉会让'恢复后没人知道要加回来'。
  duckduckgo: 'duckduckgo',      // 通用兜底（⚠ 实测 0 条）
  wikipedia: 'local_wikipedia',  // 知识（与第 0 层的 wikipedia API 是两条独立路径）
  baidu_baike: 'baidu_baike',    // 中文百科
  moegirl: 'moegirl',            // 中文 ACG 百科
  hackernews: 'hackernews',      // 技术社区
  reddit: 'reddit',              // 国际社区
  douban_book: 'douban_book',    // 中文书影音
  open_library: 'open_library',  // 图书元数据
  devto: 'devto',                // 技术博客
  huggingface: 'huggingface',    // 模型仓库
  crates: 'crates',              // Rust 包
  dblp: 'dblp',                  // CS 文献索引
  gutenberg: 'gutenberg',        // 公版书籍
  // ── 2026-09-18 第二批: 权威族（science/legal/finance/archive）────────
  //
  // **为什么这批最值得接**: 它们是**有持久标识符的登记型来源** 
  // PubChem CID、PDB ID、UniProt AC、GBIF taxon key、FRED series_id、
  // World Bank 指标码、判例 doc id、PMID、DOI。**这正是第 0 层"权威性来自
  // 机构责任与持久标识符"的判据所指的东西**，而不是"看起来很像权威网站"。
  //
  // **实测依据**: 一次性探测 26 个候选引擎，**18 个有真实产出、0 个失败**
  // （8 个合法空结果）。见 2026-09-18 的探测记录。
  pubchem: 'pubchem',
  clinicaltrials: 'clinicaltrials',
  openfda: 'openfda',
  uniprot: 'uniprot',
  rcsb_pdb: 'rcsb_pdb',
  gbif: 'gbif',
  nasa_cmr: 'nasa_cmr',
  usgs: 'usgs',
  fred: 'fred',
  worldbank: 'worldbank',
  nbs_stats: 'nbs_stats',
  sec_edgar: 'sec_edgar',
  courtlistener: 'courtlistener',
  gov_policy: 'gov_policy',
  europepmc: 'europepmc',
  doaj: 'doaj',
  pypi: 'pypi',
  stackoverflow: 'stackoverflow',
}

/**
 * 把 argo 响应转成 SourceHit[]。
 *
 * **什么都不隐藏**: cached / 引擎不符 / 空结果都走抛错路径，因为这三者都意味着
 * "这次没有从目标引擎拿到证据"。把它们混进返回值会让上层以为拿到的是该引擎的内容。
 */
export function argoHits(
  sourceId: string,
  engine: string,
  res: ArgoSearchResponse,
): SourceHit[] {
  // `cached: true` **不再拒绝**（2026-09-18 修正，理由见文件头第 1 条）。
  // 缓存内容仍然是**该引擎自己的产出**（下面的 engines_used 检查保证这一点），
  // 唯一的差别是它可能来自一个 ≥0.7 相似的邻近查询  那不影响它作为该引擎证据的资格，
  // 但**要说出来**，所以把它记在 hit 上由上层如实标注。
  if (engine !== 'auto') {
    const used = res.engines_used ?? []
    if (used.length > 0 && !used.includes(engine)) {
      throw adapterError(
        'argo',
        'unsupported',
        `${sourceId}: 请求引擎 ${engine}，实际路由到 ${JSON.stringify(used)}  不把别处的证据当作它的`,
      )
    }
  }
  const results = res.results ?? []
  // 真的查了、真的没有 → 这才是合法的空数组
  return results
    .filter(r => String(r.title ?? '') !== '' && String(r.url ?? '') !== '')
    .map(r => {
      const h: SourceHit = {
        sourceId,
        title: String(r.title),
        url: String(r.url),
        snippet: String(r.snippet ?? '').slice(0, 400),
      }
      if (typeof r.score === 'number') h.score = r.score
      // **缓存来源必须可见**（2026-09-18）: 缓存内容与该引擎新鲜取数的内容**资格相同**，
      // 但"这次没真去查"是一件事，调用方有权知道  特别是当结果要沉淀进证据账本时。
      // 不标注就等于让缓存冒充新鲜取数，那是本项目一路在防的"静默伪装"。
      if (res.cached === true) h.cacheLevel = res.cache_level === 'L1' ? 'L1' : 'L2'
      return h
    })
}

/** 子进程 MCP 会话: 每层一次握手，多次调用复用同一个进程。 */
export interface SpawnLike {
  (cmd: string, args: string[]): {
    stdin: { write(chunk: string): void; end(): void }
    stdout: { on(event: 'data', cb: (chunk: Buffer | string) => void): void; on(event: 'end', cb: () => void): void }
    stderr: { on(event: 'data', cb: (chunk: Buffer | string) => void): void }
    kill(): void
    on(event: 'error', cb: (err: Error) => void): void
  }
}

/**
 * 起一个 argo MCP 会话。
 *
 * `searchCommand` / `searchArgs` 与 DSH profile patch 里的写法一致  同一个 argo
 * 安装目录、同一个 python3，这样"插件通了"与"本组件通了"验证的是同一条路径。
 */
export function openArgoSession(spawn: SpawnLike, searchCommand: string, searchArgs: string[]): McpSession {
  const child = spawn(searchCommand, searchArgs)
  let buf = ''
  const waiters = new Map<number, (msg: Record<string, unknown>) => void>()
  let nextId = 1
  let stderrTail = ''
  let exited = false

  child.stdout.on('data', chunk => {
    buf += String(chunk)
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      nl = buf.indexOf('\n')
      if (line === '') continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue // argo 会在 stdout 打日志行，非 JSON 的忽略
      }
      const id = msg.id
      if (typeof id === 'number') {
        const w = waiters.get(id)
        if (w !== undefined) {
          waiters.delete(id)
          w(msg)
        }
      }
    }
  })
  child.stderr.on('data', c => {
    stderrTail = (stderrTail + String(c)).slice(-400)
  })
  child.on('error', err => {
    exited = true
    for (const [, w] of waiters) w({ __spawnError: err.message })
    waiters.clear()
  })

  /**
   * 发一个 JSON-RPC 请求。
   *
   * ## **必须有超时**（2026-09-18 实测倒逼）
   *
   * 此前这里是这样写的:
   *
   * ```js
   * const id = nextId++
   * return new Promise((resolve, reject) => {
   *   waiters.set(id, resolve)
   *   child.stdin.write(...)
   *   void reject        // ← 这一行是**占位符，超时根本没实现**
   * })
   * ```
   *
   * 后果实测: 当 argo 因为**并发压力**（第 1 层 31 个来源同时打同一个会话）
   * 或内部异常**没回某个 id 的响应**时，这个 Promise **永不 settle** 
   * 于是 `recall` 永不 resolve，而 Node 判定"没有待处理工作"后
   * 以 **`exit=13`（ERR_UNSETTLED_TOP_LEVEL_AWAIT）**退出，
   * **stdout 一行都不输出**。
   *
   * 复现条件精确: `--min-hits` 大到让第 0 层不满足、必须下降到第 1 层
   * （实测 5 正常、20 必挂）。**第 0 层单独跑时永远不会触发** 
   * 因为那里只有 11 个来源、且 argo 来源在第 1 层。
   *
   * **超时值取的依据**: `call()` 的调用方各自传 `timeoutMs`（如 60s），
   * 这里再加一层**兜底**（调用方超时 + 5s） 让"调用方忘了设"也不至于挂死。
   */
  const send = (obj: Record<string, unknown>, timeoutMs = 90_000): Promise<Record<string, unknown>> => {
    if (exited) return Promise.reject(new Error('argo 子进程已退出'))
    const id = nextId++
    obj.id = id
    return new Promise((resolve, reject) => {
      // **清理必须两条路都走**  否则超时后 waiters 里会留一个死条目
      const settle = (fn: (v: Record<string, unknown>) => void) => (v: Record<string, unknown>) => {
        clearTimeout(timer)
        waiters.delete(id)
        fn(v)
      }
      const timer = setTimeout(() => {
        waiters.delete(id)
        // 超时不是"没有内容"  抛错让上层看见（与全组件失败契约一致）
        reject(new Error(`argo 请求超时 ${timeoutMs}ms（id=${id}，method=${String(obj.method ?? '?')}）`))
      }, timeoutMs)
      waiters.set(id, settle(resolve))
      child.stdin.write(JSON.stringify(obj) + '\n')
    })
  }

  // 握手: 不成功就抛，不许带着未初始化的会话往下走
  /**
   * 握手。
   *
   * **必须有自己的短超时**（2026-09-18 实测）: 此前它用 `send` 的默认值（90s），
   * 而 `call` 的第一行是 `await ready`  于是**握手一旦不响应，所有调用一起等 90 秒**。
   * 实测报错正是 `argo 请求超时 90000ms（id=1，method=initialize）`。
   *
   * 15 秒的依据: argo 的 warm-core 实测约 400ms，启动到应答在 1-2 秒内。
   * 15 秒已经是一个**宽到不会误杀**、又**短到不会让人以为程序挂了**的值。
   */
  // **握手是懒发的**（2026-09-18 修）。
  //
  // 此前它在**会话创建时**就发出去，并立刻挂上 15 秒计时器。而实测:
  //
  //   第 0 层耗时 10.5 秒（wikipedia 网络超时占大头，它不走 argo）
  //   → 等第 1 层真正要用 argo 时，那个计时器**已经流逝了 10.5 秒**
  //   → 只剩 4.5 秒给握手，稍有波动就超时
  //   → **11 个等待者全部收到同一个 reject**（它们 await 的是同一个 Promise）
  //
  // 修法: 把发送推迟到**第一次真正需要它的时候**。这样计时器与"谁在用"同步，
  // 也与 `call` 的超时语义一致  都是"从我开始等"起算。
  /**
   * 请求必须有超时  CLI 挂死的真因是"永不 settle 的 Promise"
   * .agents/notes/implemented/architecture/2026-09-18-request-timeout.md
   */
  let readyPromise: Promise<Record<string, unknown>> | null = null
  const ready = (): Promise<Record<string, unknown>> => {
    if (readyPromise === null) {
      readyPromise = send({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'hx-sagasu', version: '0.1' } },
      }, 15_000)
      // **不缓存失败**（2026-09-18 实测抓到的真因）。
      //
      // 我上轮只写了这段注释而**没有写代码**  于是 `readyPromise` 仍然永久缓存了
      // rejected 值。后果实测: `initialize` 超时一次 → 之后**每一个** `call` 都
      // **立即**拿到同一个 rejection（耗时 0ms）→ 闸门串行放行它们全部 →
      // **9 个来源在同一毫秒落定并失败**。
      //
      // 证据（gate 放行时刻日志）:
      //   +10624ms running=1     ← 第 1 个（真的跑了，成功）
      //   +25635ms running=1     ← 第 2 个
      //   +25635ms running=1 × 9 ← 其余 9 个**同一毫秒**（立即失败）
      //
      // **注释写了而代码没写**是一个特别坏的失误类型: 它让下一个人（包括我自己）
      // 以为问题已修。所以这里把注释与代码放在一起。
      readyPromise = readyPromise.catch((err: unknown) => {
        readyPromise = null   // ← 这一行是上轮漏掉的
        throw err
      })
    }
    return readyPromise
  }

  return {
    async call(name, args, timeoutMs) {
      await ready()
      const raw = await Promise.race([
        send({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args } }),
        new Promise<Record<string, unknown>>((_, rej) =>
          setTimeout(() => rej(new Error(`argo ${name} 超时 ${timeoutMs}ms${stderrTail !== '' ? ' / stderr: ' + stderrTail : ''}`)), timeoutMs),
        ),
      ])
      if (typeof raw.__spawnError === 'string') throw new Error(`argo 子进程错误: ${raw.__spawnError}`)
      const err = raw.error as { message?: string } | undefined
      if (err !== undefined) throw new Error(`argo ${name} 报错: ${String(err.message ?? JSON.stringify(err))}`)
      const result = (raw.result ?? {}) as { content?: Array<{ text?: string }>; isError?: boolean }
      if (result.isError === true) throw new Error(`argo ${name} 返回 isError`)
      const text = result.content?.[0]?.text ?? ''
      return JSON.parse(text) as Record<string, unknown>
    },
    close() {
      try {
        child.stdin.end()
      } catch {
        /* 已经关了 */
      }
      // **必须显式销毁管道，否则进程不退出**（2026-09-18 实测）:
      //
      // `child.kill()` 杀的是**子进程**，而父进程侧的 `stdout`/`stderr` 是可读流 
      // 它们各自持有一个活跃的 Socket 句柄。实测: 子进程确实死了（ps 查无），
      // 而 Node 仍有 **2 个活跃 Socket**，于是 CLI 处理完全部数据后**永不退出** 
      // 表现为 `Warning: Detected unsettled top-level await` 之后长时间挂住。
      //
      // 触发条件很具体: 只有当**真的调用过 argo 来源**（管道被写过）时才留句柄。
      // 第 0 层就满足充分性时 argo 从未被调用，所以此前一直没暴露 
      // **直到用 `--min-hits 200` 强制它下降到第 1 层。**
      child.kill()
      try {
        child.stdout?.destroy()
        child.stderr?.destroy()
      } catch {
        /* 已经销毁 */
      }
    },
  }
}


/**
 * 把 argo 会话包成 `SourceFetcher`。
 *
 * **会话是懒建的且每层复用一次**: 一次召回可能有 3 个 argo 来源，起 3 个 python 进程
 * 会让第 1 层比第 0 层还慢。这里共享一个会话，收尾由调用方 `close()`。
 */
/** 会话级闸门  所有 argo 来源共享同一个（会话是共享的，闸门也必须是）。 */

/**
 * **实测无产出或极慢**的引擎  给它们更短的超时。
 *
 * ## 判据是实测耗时与产出，不是猜测
 *
 * ```
 *   duckduckgo  30057ms（超时）  实测两组查询均 0 条
 *   reddit      30050ms（超时）  实测多组查询均 0 条
 * ```
 *
 * 它们**本就大概率无产出**，让它们各占 30 秒会拖住整次召回
 * （32 个来源串行最坏 1920 秒，实测 12 个已 90 秒）。
 *
 * **保留在表里而不删**: 与 `ARGO_ENGINE` 的处理一致 
 * 上游恢复后它们应当自动回到正常超时，而"删掉再没人加回来"是更坏的结果。
 * 这条注释就是恢复时的提醒。
 */
export const ARGO_SLOW_ENGINES: ReadonlySet<string> = new Set(['duckduckgo', 'reddit'])

const gate = createGate()

export function argoFetchers(
  session: McpSession,
  engines: Readonly<Record<string, string>> = ARGO_ENGINE,
): Record<string, (source: { id: string }, query: string, ctx: { perSourceLimit: number }) => Promise<SourceHit[]>> {
  const out: Record<string, (source: { id: string }, query: string, ctx: { perSourceLimit: number }) => Promise<SourceHit[]>> = {}
  for (const [sourceId, engine] of Object.entries(engines)) {
    out[sourceId] = async (_source, query, ctx) => {
      let res: ArgoSearchResponse
      // **过闸门再调用**（2026-09-18 实测倒逼）: argo 的 MCP server 串行处理，
      // 而第 1 层有 31 个来源同时发起  实测并发 31 个只成功 3 个（25s 内）。
      // 闸门把并发压到 4，让请求排队而不是各自超时。见 `argo-gate.ts`。
      const release = await gate()
      try {
        res = (await session.call(
          'argo_search',
          // **指定引擎时必须 skip_cache**（2026-09-18 实测）。
          //
          // 不加这个参数时，同一查询的第二次调用会被 argo 的**语义软命中**
          // （`cache.py:449-490` 的 find_similar）截胡：它按 minhash 相似度 ≥0.7
          // 找近重复查询的缓存，而**收了 engine 参数却从不使用**  于是
          // `engine=moegirl` 会拿回 `baidu_baike` 的缓存内容。
          //
          // 实测（2026-09-18）: 依次请求 baidu_baike → moegirl → crates → dblp，
          // 后三个全部返回 `engines_used: ["baidu_baike"]`。
          //
          // 我们的 `engines_used` 检查**如实拦住了**这些响应（报 argo/unsupported），
          // 所以没有把别处的证据当成目标引擎的  但结果是**三个引擎全部不可用**。
          // 跳过缓存才是真正的修法：既然调用方点名了引擎，就不该有任何缓存
          // 替它作答。
          { query, engine, max_results: ctx.perSourceLimit, skip_cache: true },
          // **按来源分档超时**（2026-09-18 实测倒逼）。
          //
          // 实测单个引擎的耗时（串行，同一会话）:
          // ```
          //   bilibili_hot   87ms | bilibili 248ms | baidu_baike  530ms
          //   juejin        806ms | argo:anysearch 1028ms | hackernews 1170ms
          //   wikipedia   12035ms | duckduckgo 30057ms | reddit     30050ms
          // ```
          //
          // **两个极端**: 健康的在 1 秒内，而 `duckduckgo`/`reddit` 各占满 30 秒
          // （它们的后端实测无产出  上轮已测出 duckduckgo 两组查询均 0 条）。
          //
          // 统一 60 秒的代价: 32 个来源串行最坏 `32 × 60 = 1920 秒`。
          // 实测 12 个来源串行已经 **90 秒**。
          //
          // 分档依据**不是"猜哪个快"，而是上表的实测**: 未知来源给 20 秒
          // （足够覆盖 wikipedia 那种 12 秒的），已知慢的给 8 秒
          // （它们本就大概率无产出，不值得为它们拖住整次召回）。
          ARGO_SLOW_ENGINES.has(engine) ? 8_000 : 20_000,
        )) as ArgoSearchResponse
      } catch (err) {
        // 网络/协议/超时 → 响亮失败，不返回空数组
        throw adapterError('argo', 'network', `${sourceId}: ${(err as Error).message}`)
      } finally {
        // **必须在 finally 释放**  否则一次异常永久占一个槽位，闸门会逐渐堵死
        release()
      }
      return argoHits(sourceId, engine, res)
    }
  }
  return out
}


#!/usr/bin/env node
/**
 * HX-Sagasu 检索界面  一个能看见"分层下降"的网页。
 *
 * ## 为什么是 SSE 不是"先查完再渲染"
 *
 * 界面要展示的是**渐进式检索**: 第 0 层在跑、某几个来源回来了、第 1 层为什么没跑。
 * 这些必须**如实反映实际发生的顺序**。先阻塞查完再播放动画，那是**演戏** 
 * 动画的时间轴与实际执行无关，用户看到的"过程"是编的。
 *
 * 所以用 Server-Sent Events 把 `recall()` 的 `observer` 事件**实时推给浏览器**。
 * 慢的来源（OpenAlex 常常 429、Telegram 要 2 秒）是真实慢，不是动画效果。
 *
 * ## 为什么不用框架
 *
 * 与全组件一致: 零依赖、零构建。Node 内置 `http` + 一段原生 HTML/CSS/JS。
 * 没有 `package.json`、没有打包步骤  因此**不会因为"忘了 build"而让界面与代码脱节**，
 * 这个组件至今的价值之一就是这个（见 scripts/test.sh 的注释）。
 *
 * ```bash
 * node --experimental-strip-types scripts/serve.ts        # 然后开 http://127.0.0.1:8787
 * ```
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { planFetchers, adapterFetchers } from '../src/fetchers.ts'
import { authoritativeFetchers } from '../src/authoritative.ts'
import { makeBilibiliAdapter } from '../src/adapters/bilibili.ts'
import { makeTelegramAdapter } from '../src/adapters/telegram.ts'
// 副作用导入: 注册作用域探测（让 ctx.scope 有生产者）
import '../src/adapters/scope-probes.ts'
import { argoFetchers, openArgoSession } from '../src/argo-source.ts'
import { recall, SOURCES, type RecallEvent, type Tier } from '../src/recall.ts'
import { coverage, PLATFORMS } from '../src/adapters/registry.ts'
import { normalizeThread } from '../src/thread.ts'
import { resolve } from '../src/resolve.ts'
import { buildReplyTree } from '../src/reply-tree.ts'
import type { RawThreadInput } from '../src/types-text.ts'
import { PAGE } from './page.ts'

const PORT = Number(process.env['HX_SAGASU_PORT'] ?? '8787')
const ARGO_PY = process.env['HX_SAGASU_ARGO_PY'] ?? '/usr/bin/python3'
const ARGO_SERVER = process.env['HX_SAGASU_ARGO_SERVER'] ??
  [process.env['HOME'] ?? '', '.local/share/hx-sagasu/argo/scripts/mcp_server.py'].join('/')

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write('event: ' + event + '\n')
  res.write('data: ' + JSON.stringify(data) + '\n\n')
}

async function handleSearch(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const q = url.searchParams.get('q') ?? ''
  const scope = url.searchParams.get('scope') ?? undefined
  const tier = Number(url.searchParams.get('tier') ?? '2') as Tier

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    // 不设这条的话，反代/浏览器可能缓冲，事件就不再"实时"了
    'x-accel-buffering': 'no',
  })

  if (q.trim() === '') {
    sse(res, 'error', { message: '查询为空' })
    res.end()
    return
  }

  const ctx: { session?: { call: (n: string, a: Record<string, unknown>, t: number) => Promise<Record<string, unknown>>; close: () => void } } = {}
  try {
    ctx.session = openArgoSession(spawn, ARGO_PY, [ARGO_SERVER]) as never
  } catch {
    ctx.session = undefined
  }
  const available: Record<string, unknown> = {
    authoritative: authoritativeFetchers(),
    adapter: adapterFetchers({ bilibili: makeBilibiliAdapter(), 'telegram-public': makeTelegramAdapter() }),
  }
  if (ctx.session !== undefined) available['argo'] = argoFetchers(ctx.session as never)
  const { fetchers, missing } = planFetchers({ available: available as never })

  // 未接线必须响亮  否则界面上"没接上"永远显示成"没搜到"
  if (missing.length > 0) sse(res, 'unwired', missing)

  const recallCtx: Record<string, unknown> = {
    query: q, minHits: 5, perSourceLimit: 4, minSources: 1, maxTier: tier,
    // 观察者端口: recall 每发生一件事就推一条 SSE。**顺序即实际顺序。**
    observer: (e: RecallEvent) => sse(res, 'recall', e),
  }
  if (scope !== undefined && scope !== '') recallCtx['scope'] = [scope]

  try {
    await recall(q, fetchers, recallCtx as never)
  } catch (err) {
    sse(res, 'error', { message: String((err as Error).message).slice(0, 300) })
  } finally {
    try { ctx.session?.close() } catch { /* 关不掉不影响已推的内容 */ }
    res.end()
  }
}


/**
 * 对话语义端点  把 `sagasu thread` 的能力搬到界面。
 *
 * ## 为什么需要它
 *
 * 目标第 (3) 项的四个子能力（错别字容错 / 帖子-回复结构 / 引用链 / 多轮上下文）
 * 此前**只在 CLI 上可用**。而界面是本项目唯一"让人看见"的地方 
 * 目标第 (2) 项的平台可用性就是靠面板才变得可见的（见 2026-09-18-platform-visibility.md）。
 *
 * **同一个道理**: 对话语义如果只有 CLI，那么"引用链指回了哪一楼"、
 * "楼主是谁"、"这句话是在对哪一楼说的"都不会出现在屏幕上。
 *
 * ## 与 CLI 的差别: 界面不写账本
 *
 * 这是**刻意的**。CLI 的 `--sink` 是显式副作用；界面是观察工具，
 * 不该因为有人点了按钮就往只追加的账本里写东西。
 * **抓取与对话证据的沉淀必须由调用方显式发起。**
 */
async function handleThread(url: URL, res: ServerResponse): Promise<void> {
  const ref = url.searchParams.get('ref') ?? ''
  const ask = url.searchParams.get('ask') ?? undefined
  const at = url.searchParams.get('at') ?? undefined

  const colon = ref.indexOf(':')
  if (colon <= 0) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'ref 必须是 <平台>:<id>，收到: ' + ref }))
    return
  }
  const platform = ref.slice(0, colon)
  const id = ref.slice(colon + 1)

  const adapters: Record<string, { thread: (r: string, c: never) => Promise<RawThreadInput> }> = {
    bilibili: makeBilibiliAdapter() as never,
    'telegram-public': makeTelegramAdapter() as never,
  }
  const adapter = adapters[platform]
  if (adapter === undefined) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '未接入的平台: ' + platform + '，已接入: ' + Object.keys(adapters).join(', ') }))
    return
  }

  let raw: RawThreadInput
  try {
    raw = await adapter.thread(id, { perSourceLimit: 50 } as never)
  } catch (err) {
    // 失败必须**响亮**  与全组件契约一致
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '取帖子失败: ' + (err as Error).message }))
    return
  }

  const { thread } = normalizeThread(raw)

  // 游标: 界面传**楼层序号**（人读帖子数的是"第几楼"），这里转成 turnId
  let cursorTurnId: string | undefined
  if (at !== undefined) {
    const n = Number(at)
    if (Number.isInteger(n) && n >= 1 && n <= thread.turns.length) cursorTurnId = thread.turns[n - 1]!.id
  }

  // 楼主的 participant id 集合（resolve 用的是同一个判据）
  const opIds = new Set(thread.participants.filter(p => p.isOp).map(p => p.id))

  const tree = buildReplyTree(thread.turns)

  const body: Record<string, unknown> = {
    platform, ref,
    // 回复树: 父子关系与引用关系分开给（引用可能指向非父楼层）
    tree: { roots: tree.roots.length, maxDepth: tree.maxDepth, edges: tree.flat.filter(n => n.parentId !== undefined).map(/**
                                                                                                                           * 回复树  把"这句话在回谁"从平铺里捞出来
                                                                                                                           * .agents/notes/implemented/architecture/2026-09-18-reply-tree.md
                                                                                                                           */
                                                                                                                          n => ({ from: n.id, to: n.parentId, quoted: n.quotedTurnId ?? null, inferred: n.quoteInferred })) },
    turns: thread.turns.map((t, i) => ({
      index: i + 1,
      id: t.id,
      author: typeof t.author === 'string' ? t.author : (t.author?.name ?? '(无名)'),
      text: t.normalizedText,
      // **isOp 在 participants 上，不在 turn.author 上**（2026-09-18 实测）。
      // 我第一版读的是 t.author.isOp  那是 undefined，于是界面上"楼主"一个都没标出来。
      // 而 resolve 用的是 thread.participants.find(p => p.isOp)，它是对的。
      isOp: opIds.has(typeof t.author === 'string' ? '' : (t.author?.id ?? '')),
    })),
  }

  if (ask !== undefined && ask !== '') {
    const res2 = resolve(thread, ask, cursorTurnId)
    body['question'] = ask
    body['cursor'] = at ?? null
    body['topic'] = res2.topic ?? null
    // **引用链在 targets[].turns**  不是 relevantFloors（第 23 轮的教训）
    body['targets'] = res2.targets.map(tg => ({
      role: tg.role,
      who: tg.participantName ?? tg.participantId ?? '(未命名)',
      reason: tg.reason,
      confidence: tg.confidence,
      turns: tg.turns.map(t => ({ id: t.id, text: t.normalizedText })),
    }))
    body['ambiguous'] = res2.ambiguous.map(a => ({ token: a.token, reason: a.reason, candidates: a.candidates.map(c => c.name) }))
  }

  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/api/sources') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(SOURCES.map(s => ({ id: s.id, label: s.label, tier: s.tier, requiredScope: s.requiredScope ?? null }))))
    return
  }
  // **平台可用性必须可见**（2026-09-18 加）。
  //
  // 这些判定（'微博被风控'、'贴吧 403'、'小红书需 xhs CLI'）此前**只写在代码注释里**，
  // 于是：① 想加适配层的人不知道哪些路已经被走过；② '这个平台搜不到' 与 '这个平台不可用'
  // 在界面上长得一模一样。**而它们是完全不同的两件事**  一个是结果问题，一个是能力问题。
  //
  // 每条都带 evidence（一手实测）与 unlock（接上它需要什么），这是本项目对
  // '未实测的假设' 的一贯拒绝：判定必须能追溯到某次具体测量。
  if (url.pathname === '/api/platforms') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ coverage: coverage(), platforms: PLATFORMS }))
    return
  }
  if (url.pathname === '/api/thread') {
    void handleThread(url, res)
    return
  }
  if (url.pathname === '/api/search') {
    void handleSearch(req, res, url)
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(PAGE)
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('HX-Sagasu 检索界面: http://127.0.0.1:' + PORT + '\n')
})

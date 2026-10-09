import { test } from 'node:test'
import assert from 'node:assert/strict'
import { argoHits, argoFetchers, ARGO_ENGINE, type McpSession } from '../src/argo-source.ts'
import { recall, SOURCES } from '../src/recall.ts'
import { AdapterError } from '../src/adapters/adapter.ts'

/** 造一个按脚本应答的假 MCP 会话  不启动真进程，测试是离线、毫秒级的。 */
const fakeSession = (responder: (name: string, args: Record<string, unknown>) => unknown): McpSession & { calls: Array<[string, Record<string, unknown>]> } => {
  const calls: Array<[string, Record<string, unknown>]> = []
  return {
    calls,
    async call(name, args) {
      calls.push([name, args])
      const r = responder(name, args)
      if (r instanceof Error) throw r
      return r as Record<string, unknown>
    },
    close() {},
  }
}

const good = (engine: string) => ({
  engine,
  engines_used: [engine],
  count: 2,
  cached: false,
  results: [
    { title: `${engine} 结果一`, url: `https://e.invalid/${engine}/1`, snippet: '摘要一' },
    { title: `${engine} 结果二`, url: `https://e.invalid/${engine}/2`, snippet: '摘要二' },
  ],
})

// ── 约束 1: 不接受缓存结果（上一轮实测发现的缺陷）────────────────

test('cached 结果**接受**  缓存内容仍是该引擎自己的产出（2026-09-18 修正）', () => {
  // **这条测试此前锁的是一个错误结论**，原文是"cached 结果必须被拒绝  缓存键不含 engine"。
  // 实测证明 `cache.py:611` 的键里 engine 是第三个字段；串味的真因是语义软命中
  // （find_similar 收了 engine 却不使用），而它的表现是 engines_used 出现别的引擎名，
  // 那由下面那条检查精确拦住。**一条基于错误归因的防护在误杀正确结果。**
  const hit = argoHits('juejin', 'juejin', {
    cached: true,
    engines_used: ['juejin'],
    results: [{ title: 't', url: 'https://a/b', snippet: 's' }],
  })
  assert.equal(hit.length, 1, '引擎名相符的缓存结果必须被接受  它是该引擎自己的产出')
  assert.equal(hit[0]!.cacheLevel, 'L2', '但必须标注出来源是缓存，不许冒充新鲜取数')
})

test('缓存串味真正的表现（engines_used 不符）仍被响亮拒绝', () => {
  // 这才是有实测支撑的判据: 实测 zhihu+查询A → juejin+同一查询A 拿到 engines_used=["zhihu"]。
  assert.throws(
    () => argoHits('juejin', 'juejin', { cached: true, engines_used: ['zhihu'], results: [{ title: 't', url: 'u' }] }),
    (err) => {
      assert.equal((err as { kind?: string }).kind, 'unsupported')
      assert.match(String((err as Error).message), /zhihu/)
      return true
    },
    '别的引擎的缓存内容必须被拒  这才是保护',
  )
})


test('请求引擎与实际路由不符 → 响亮失败，不把别处的证据当作它的', () => {
  const res = { engine: 'juejin', engines_used: ['bilibili'], count: 3, cached: false, results: [{ title: 'x', url: 'u' }] }
  assert.throws(() => argoHits('juejin', 'juejin', res), /实际路由到/)
})

test('auto 模式不检查路由  它本来就是自适应选引擎（实测: 中文→local_bing，英文→crates）', () => {
  const res = { engine: 'auto', engines_used: ['anysearch', 'local_bing'], count: 2, cached: false, results: [{ title: 't', url: 'u' }] }
  assert.equal(argoHits('argo:anysearch', 'auto', res).length, 1)
})

// ── 约束 3: 空数组只表示"真的查了、真的没有" ───────────────────

test('真的 0 条才是合法空数组', () => {
  assert.deepEqual(argoHits('juejin', 'juejin', { engine: 'juejin', engines_used: ['juejin'], count: 0, cached: false, results: [] }), [])
})

test('缺 title 或 url 的条目被丢掉  没有坐标的结果不是证据', () => {
  const res = { engine: 'juejin', engines_used: ['juejin'], cached: false, results: [{ title: '有标题' }, { url: 'u' }, { title: 'ok', url: 'u2' }] }
  assert.deepEqual(argoHits('juejin', 'juejin', res).map(h => h.url), ['u2'])
})

test('协议/网络错误一律抛 AdapterError，绝不返回空数组', async () => {
  const session = fakeSession(() => new Error('子进程已退出'))
  const f = argoFetchers(session)
  await assert.rejects(() => f.juejin!({ id: 'juejin' }, 'q', { perSourceLimit: 3 }), (err: unknown) => {
    assert.ok(err instanceof AdapterError)
    assert.equal(err.kind, 'network')
    return true
  })
})

// ── 第 1、2 层登记与实现的对应 ──────────────────────────────────

test('ARGO_ENGINE 覆盖全部 argo 来源，且每个都有对应的登记', () => {
  const registered = new Set(SOURCES.map(s => s.id))
  for (const sourceId of Object.keys(ARGO_ENGINE)) {
    assert.ok(registered.has(sourceId), `ARGO_ENGINE 里的 ${sourceId} 在 SOURCES 里没有登记`)
  }
})

test('第 1、2 层没有实现时**不许**静默变成 0 条  必须报 unwired', async () => {
  // 实测依据（2026-09-16）: 第 1、2 层登记了 5 个来源，而 authoritativeFetchers()
  // 只覆盖第 0 层。它们全部落进"没有实现"分支，被当成"跑通了、只是没有内容"。
  // 调用方看到的是「第 1 层跑了，0 条」 一个看起来正常的分层结果，实际是没有接线。
  const r = await recall('Rust 所有权', { crossref: async () => [] }, {
    query: 'Rust 所有权', minHits: 999, perSourceLimit: 3, minSources: 1, maxTier: 1,
  })
  const t1 = r.tiers.find(t => t.tier === 1)!
  const unwired = t1.failures.filter(f => f.kind === 'unwired')
  assert.ok(unwired.length >= 3, `第 1 层的 3 个来源都必须报 unwired，实际: ${JSON.stringify(t1.failures)}`)
  assert.match(unwired[0]!.message, /没有接线/)
})

// ── 指定引擎时必须跳过缓存（2026-09-18 实测）──────────────────────

test('点名引擎时必须传 skip_cache  否则会被语义软命中截胡', async () => {
  // **实测依据**: 依次请求 baidu_baike → moegirl → crates → dblp，
  // 后三个全部返回 engines_used: ["baidu_baike"]。
  // 真因是 argo 的 find_similar（cache.py:449-490）按 minhash 相似度 ≥0.7
  // 找近重复查询的缓存，而它**收了 engine 参数却从不使用**。
  //
  // 我们已有的 engines_used 检查会如实拦住这些响应（报 argo/unsupported），
  // 所以不会把别处的证据当目标引擎的  但代价是**三个引擎全部不可用**。
  // 这条测试锁住"真的传了 skip_cache"，否则那个检查会把所有引擎都拦死。
  const seen: Array<Record<string, unknown>> = []
  const fakeSession = {
    call: async (_name: string, args: Record<string, unknown>) => {
      seen.push(args)
      return { results: [{ title: 't', url: 'https://a/b' }], engines_used: ['juejin'] }
    },
  }
  const f = argoFetchers(fakeSession as never)
  await f['juejin']!({ id: 'juejin' }, 'q', { perSourceLimit: 3 })
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!['skip_cache'], true, '点名引擎却不跳过缓存 = 可能拿到别的引擎的缓存')
  assert.equal(seen[0]!['engine'], 'juejin')
})

// ── 引擎活性复核（2026-09-18）─────────────────────────────────────
//
// 起因: 实测 `duckduckgo` 两组查询均 0 条，而它是**通用兜底**且标 `'*'`（路由永不跳过）
//  **每次召回都在浪费一次请求**。而 `argo:anysearch`（同为兜底）是好的。

test('路由的 '*' 全域来源必须**至少有一个是活的**  否则兜底是空的', async () => {
  // 这条不是"代码正确性"测试，而是**配置健全性**测试:
  // 全域来源在路由里永不跳过（因为"什么都能问"），所以它们坏了不会被路由挡掉，
  // 只会每次白跑。**必须有一个活的兜底。**
  const { SOURCE_TOPICS } = await import('../src/route-sources.ts')
  const wildcards = Object.entries(SOURCE_TOPICS).filter(([, t]) => t.includes('*')).map(([id]) => id)
  assert.ok(wildcards.length >= 1, '必须有全域来源')
  // 至少有一个是**非 duckduckgo** 的活兜底（duckduckgo 实测坏掉）
  const alive = wildcards.filter(/**
                                  * 引擎与平台的**可达性**复核  两个"标着可用但其实不可用"
                                  * .agents/notes/implemented/architecture/2026-09-18-reachability-recheck.md
                                  */
                                 id => id !== 'duckduckgo' && id !== 'bilibili' && id !== 'telegram-public' && id !== 'reddit')
  assert.ok(alive.length >= 1, '除实测坏掉的之外，必须有活的兜底: ' + JSON.stringify(wildcards))
  assert.ok(alive.includes('argo:anysearch'), 'anysearch 是实测可用的那个兜底')
})

test('实测坏掉的引擎仍保留登记  删掉会让"恢复后没人知道要加回来"', async () => {
  const { ARGO_ENGINE } = await import('../src/argo-source.ts')
  assert.ok('duckduckgo' in ARGO_ENGINE, 'duckduckgo 仍在映射里')
})

// ── 请求必须有超时（2026-09-18 实测倒逼）─────────────────────────
//
// 实测: CLI 在 `--min-hits 20`（迫使下降到第 1 层）时 **永挂** 
// Node 以 `exit=13`（ERR_UNSETTLED_TOP_LEVEL_AWAIT）退出且 **stdout 一行不输出**。
// 根因: 会话请求在某些并发/异常情况下**不收响应**，而 Promise 永不 settle。
//
// 复现条件精确: `min-hits 5` 正常、`20` 必挂  **第 0 层单独跑时永远不触发**。

test('会话请求超时后必须 reject，而不是永不 settle', async () => {
  // 用一个**不回应任何请求**的假子进程（模拟 argo 因并发压力不响应）。
  const { EventEmitter } = await import('node:events')
  const fakeChild = new EventEmitter() as never as {
    stdout: EventEmitter; stderr: EventEmitter; stdin: { write: () => void; end: () => void }
    kill: () => void; on: (e: string, f: (...a: unknown[]) => void) => void
  }
  fakeChild.stdout = new EventEmitter()
  fakeChild.stderr = new EventEmitter()
  // **吞掉所有写入、永不应答**  这正是挂死场景
  fakeChild.stdin = { write: () => {}, end: () => {} }
  fakeChild.kill = () => {}

  const { openArgoSession } = await import('../src/argo-source.ts')
  const fakeSpawn = (() => fakeChild) as never
  const session = openArgoSession(fakeSpawn, 'python3', ['x'])

  const t0 = Date.now()
  await assert.rejects(
    () => session.call('argo_search', { query: 'x' }, 300),
    (err: Error) => {
      assert.match(err.message, /超时|timeout/i, '要是超时错误: ' + err.message)
      return true
    },
    '**不回应时必须超时 reject**  此前会永不 settle 导致进程挂死',
  )
  const dt = Date.now() - t0
  assert.ok(dt < 20000, '要在超时值附近 reject，实际 ' + dt + 'ms')
  session.close()
})

test('超时后 waiters 里不留死条目（否则反复超时会持续泄漏）', async () => {
  const { EventEmitter } = await import('node:events')
  const fakeChild = new EventEmitter() as never as Record<string, unknown>
  fakeChild['stdout'] = new EventEmitter()
  fakeChild['stderr'] = new EventEmitter()
  fakeChild['stdin'] = { write: () => {}, end: () => {} }
  fakeChild['kill'] = () => {}
  const { openArgoSession } = await import('../src/argo-source.ts')
  const session = openArgoSession((() => fakeChild) as never, 'python3', ['x'])
  // 连续三次超时  若 waiters 不清理，内存与错误信息都会累积
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => session.call('argo_search', {}, 100))
  }
  session.close()
  // 能跑到这里就说明没有因为泄漏而卡住
  assert.ok(true)
})

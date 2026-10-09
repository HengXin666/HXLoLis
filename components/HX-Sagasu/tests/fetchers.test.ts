import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SOURCE_PLAN, adapterFetchers, adapterFetcherEntries, composeFetchers, planFetchers, fallbackPaths, type Fetcher } from '../src/fetchers.ts'
import { SOURCES, recall, type SourceHit } from '../src/recall.ts'
import { AdapterError, type ThreadAdapter } from '../src/adapters/adapter.ts'
import { makeTelegramAdapter } from '../src/adapters/telegram.ts'

const hit = (id: string, title: string): SourceHit => ({ sourceId: id, title, url: `https://e.invalid/${id}` })
const fakeFetcher = (id: string, n = 1): Fetcher => async () => Array.from({ length: n }, (_, i) => hit(id, `${id}-标题${i}`))

// 与 authoritative.ts 的实现表对齐  必须在用到它的第一个测试**之前**求值
const { AUTHORITATIVE_SOURCES } = await import('../src/authoritative.ts')
const { extendedSources } = await import('../src/authoritative-tech.ts')
const AUTHORITATIVE_IDS = new Set<string>([
  ...Object.keys(AUTHORITATIVE_SOURCES),
  ...Object.keys(extendedSources()),
])

// ── SOURCE_PLAN 的完整性与自洽 ──────────────────────────────────

test('SOURCE_PLAN 覆盖 SOURCES 的全部非权威来源  不许有来源没人规划', () => {
  // 权威来源（第 0 层 11 个）走 authoritativeFetchers()，是单独一条路；
  // 其余每一个都必须在这张计划表里有归属，否则它就是"登记了但没接线"。
  const planned = new Set(SOURCE_PLAN.map(p => p.sourceId))
  const nonAuthoritative = SOURCES.filter(s => s.id !== 'telegram-public' || true)
    .map(s => s.id)
    .filter(id => !AUTHORITATIVE_IDS.has(id))
  const unplanned = nonAuthoritative.filter(id => !planned.has(id))
  assert.deepEqual(unplanned, [], `以下来源没有任何实现路径规划: ${unplanned.join(', ')}`)
})

test('每个 sourceId 的 rank 组合合法: 最多一个 primary，且 primary 必须存在', () => {
  const byId = new Map<string, string[]>()
  for (const p of SOURCE_PLAN) {
    const list = byId.get(p.sourceId) ?? []
    list.push(p.rank)
    byId.set(p.sourceId, list)
  }
  for (const [id, ranks] of byId) {
    const primaries = ranks.filter(r => r === 'primary')
    assert.equal(primaries.length, 1, `${id} 有 ${primaries.length} 个主路（必须恰好 1 个）`)
  }
})

test('每条路径都要写明理由  空理由等于没有决策', () => {
  for (const p of SOURCE_PLAN) {
    assert.ok(p.reason.length >= 10, `${p.sourceId}/${p.module} 的 reason 太短，说明没有真的记录依据`)
  }
})

test('bilibili 的主路是**适配器**而不是 argo  这是本轮修的核心', () => {
  // 实测依据: 适配器提供 thread() 取评论区两层结构（对话式语义的唯一来源），
  // 而 argo 只给视频元数据。此前两者同时"存在"却没有任何地方决定用哪个。
  const primary = SOURCE_PLAN.find(p => p.sourceId === 'bilibili' && p.rank === 'primary')!
  assert.equal(primary.module, 'adapter')
})

test('juejin 的主路是原生实现（实测 20 条），argo 只是备选', () => {
  const primary = SOURCE_PLAN.find(p => p.sourceId === 'juejin' && p.rank === 'primary')!
  assert.equal(primary.module, 'authoritative')
  assert.deepEqual(fallbackPaths('juejin').map(p => p.module), ['argo'])
})

// ── planFetchers: 未接线必须可见 ────────────────────────────────

test('模块没提供时来源进 missing  而不是静默消失', () => {
  const { fetchers, missing } = planFetchers({ available: { authoritative: { juejin: fakeFetcher('juejin') } } })
  assert.ok('juejin' in fetchers)
  const missingIds = missing.map(m => m.sourceId).sort()
  // 只有 juejin 有实现。其余来源分两类:
  //   - bilibili/telegram-public: 适配器模块没传
  //   - 2026-09-18 新增的 argo 引擎: argo 模块没传
  // **断言"全部都在 missing 里"而不是列死名单**  列死名单会在每次加来源时
  // 变成机械维护，而这里真正要守的性质是"没实现的来源一个都不许静默消失"。
  const planned = SOURCE_PLAN.map(p => p.sourceId).filter(id => id !== 'juejin')
  assert.deepEqual(missingIds, [...new Set(planned)].sort())
  assert.ok(missingIds.includes('bilibili') && missingIds.includes('telegram-public'))
  for (const m of missing) assert.match(m.reason, /未提供|没有/)
})

test('模块提供了但缺那个来源的实现 → 也要进 missing，且理由不同', () => {
  const { fetchers, missing } = planFetchers({ available: { adapter: { bilibili: fakeFetcher('bilibili') } } })
  assert.ok('bilibili' in fetchers)
  const tg = missing.find(m => m.sourceId === 'telegram-public')!
  assert.match(tg.reason, /没有来源/)
})

test('全部模块齐备时 missing 为空，且每个来源都有一份实现', () => {
  const { fetchers, missing } = planFetchers({
    available: {
      adapter: { bilibili: fakeFetcher('bilibili'), 'telegram-public': fakeFetcher('telegram-public') },
      // 模块齐备 = **每个被规划的来源都有实现**。用 SOURCE_PLAN 反推而不是列死名单。
      argo: Object.fromEntries(
        SOURCE_PLAN.filter(p => p.module === 'argo').map(p => [p.sourceId, fakeFetcher(p.sourceId)]),
      ),
      authoritative: Object.fromEntries(
        SOURCE_PLAN.filter(p => p.module === 'authoritative' && p.rank === 'primary')
          .map(p => [p.sourceId, fakeFetcher(p.sourceId)]),
      ),
    },
  })
  assert.deepEqual(missing, [])
  const planned = [...new Set(SOURCE_PLAN.map(p => p.sourceId))].sort()
  assert.deepEqual(Object.keys(fetchers).sort(), planned)
})

test('主路模块缺失时**不自动降级**到备选  否则主路坏了没人知道', () => {
  // juejin 有 argo 备选，但 authoritative 模块没传时不应该悄悄用 argo
  const { fetchers, missing } = planFetchers({ available: { argo: { juejin: fakeFetcher('juejin') } } })
  assert.ok(!('juejin' in fetchers), '主路缺失时不许自动接管备选')
  assert.ok(missing.some(m => m.sourceId === 'juejin'), '但必须报出来')
})

// ── adapterFetchers: 能力检查在组装期 ───────────────────────────

test('capabilities.search=false 的适配器在**组装期**被拒绝，不是调用期', () => {
  const noSearch: ThreadAdapter = {
    platform: 'telegram',
    capabilities: { search: false, thread: true, requiresAuth: false, politeHeaders: false },
    async search() { throw new AdapterError('telegram', 'unsupported', 'x') },
    async thread() { throw new Error('unused') },
  }
  assert.throws(() => adapterFetchers({ 'telegram-public': noSearch }), (err: unknown) => {
    assert.match(String((err as Error).message), /不支持搜索/)
    assert.match(String((err as Error).message), /thread\(\)/, '拒绝时必须指出正确的用法')
    return true
  })
})

test('adapterFetchers 把适配器结果换算成 SourceHit（含 createdAt → snippet 日期）', async () => {
  const tg = makeTelegramAdapter({
    fetch: async () => ({ ok: true, status: 200, text: async () => '<div class="tgme_channel_info"></div><div data-post="durov/1"><div class="tgme_widget_message_text">hello</div><time datetime="2026-06-15T18:58:13+00:00"></time></div>' }),
  })
  const f = adapterFetchers({ 'telegram-public': tg })
  const hits = await f['telegram-public']!({ id: 'telegram-public' }, 'durov hello', { perSourceLimit: 5 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.sourceId, 'telegram-public')
  assert.ok(hits[0]!.url.startsWith('https://t.me/'), 'url 必须指向具体帖子')
  assert.equal(hits[0]!.snippet, '2026-06-15')
})

// ── composeFetchers: 冲突不静默 ─────────────────────────────────

test('两张表实现同一来源 → 抛错，不静默覆盖', () => {
  assert.throws(
    () => composeFetchers({ a: fakeFetcher('a') }, { a: fakeFetcher('a') }),
    /同时实现/,
  )
})

test('不重叠的表可以正常合并', () => {
  const merged = composeFetchers({ a: fakeFetcher('a') }, { b: fakeFetcher('b') })
  assert.deepEqual(Object.keys(merged).sort(), ['a', 'b'])
})

// ── 作用域: 不适用 ≠ 失败 ──────────────────────────────────────

test('需要频道作用域的来源在裸查询下是**不适用**，不是失败', async () => {
  // 实测倒逼（2026-09-16）: Telegram 只有频道内搜索。此前裸查询让这个来源
  // **每次召回都失败一次**，而 failures 的语义是"哪里坏了"  噪声会淹掉真故障。
  const boom: ThreadAdapter = {
    platform: 'telegram',
    capabilities: { search: true, searchScope: 'channel', thread: true, requiresAuth: false, politeHeaders: false },
    async search() { throw new AdapterError('telegram', 'unsupported', '不该被调用到') },
    async thread() { throw new Error('unused') },
  }
  const { fetchers } = planFetchers({ available: { adapter: adapterFetchers({ 'telegram-public': boom }) } })
  const r = await recall('Rust 所有权', fetchers, { query: 'Rust 所有权', minHits: 99, perSourceLimit: 3, minSources: 1, maxTier: 1 })
  const f = r.tiers.find(t => t.tier === 1)!.failures
  assert.equal(f.length, 1)
  assert.equal(f[0]!.kind, 'not-applicable', '不适用必须与失败区分开')
  assert.match(f[0]!.message, /不是坏了，是这次用不上/)
  assert.ok(!/unsupported/.test(f[0]!.kind), '不许复用"不支持"这个类别  语义不同')
})

test('给出作用域后同一个来源就不再被跳过（真的去查）', async () => {
  let called = false
  const ok: ThreadAdapter = {
    platform: 'telegram',
    capabilities: { search: true, searchScope: 'channel', thread: true, requiresAuth: false, politeHeaders: false },
    async search() { called = true; return [{ platform: 'telegram', id: 'c/1', title: 't', url: 'https://t.me/c/1' }] },
    async thread() { throw new Error('unused') },
  }
  const { fetchers } = planFetchers({ available: { adapter: adapterFetchers({ 'telegram-public': ok }) } })
  const r = await recall('durov rust', fetchers, { query: 'durov rust', scope: ['channel'], minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 1 })
  assert.equal(called, true, '有作用域就必须真的调用')
  assert.equal(r.hits.length, 1)
  assert.equal(r.tiers.find(t => t.tier === 1)!.failures.length, 0)
})

test('不需要作用域的来源不受 ctx.scope 影响', async () => {
  const plain: ThreadAdapter = {
    platform: 'bilibili',
    capabilities: { search: true, thread: true, requiresAuth: false, politeHeaders: true },
    async search() { return [{ platform: 'bilibili', id: 'BV1', title: 't', url: 'https://b.invalid/BV1' }] },
    async thread() { throw new Error('unused') },
  }
  const { fetchers } = planFetchers({ available: { adapter: adapterFetchers({ bilibili: plain }) } })
  const r = await recall('x', fetchers, { query: 'x', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 1 })
  assert.equal(r.hits.length, 1, 'searchScope 缺省为 none，不该被作用域门控挡住')
})

test('adapterFetcherEntries 暴露 searchScope；adapterFetchers 会丢掉它（已在文档里写明）', () => {
  const tg = makeTelegramAdapter({ fetch: async () => ({ ok: true, status: 200, text: async () => '' }) })
  const entries = adapterFetcherEntries({ 'telegram-public': tg })
  assert.equal(entries['telegram-public']!.searchScope, 'channel')
  const bare = adapterFetchers({ 'telegram-public': tg })
  assert.equal(typeof bare['telegram-public'], 'function', '便捷包装仍然可用，但拿不到作用域信息')
})

// ── 端到端: 适配器路径真的进了召回 ──────────────────────────────

test('接好线后 bilibili 走**适配器**实现，且它的失败是 AdapterError 而不是空数组', async () => {
  const boom: ThreadAdapter = {
    platform: 'bilibili',
    capabilities: { search: true, thread: true, requiresAuth: false, politeHeaders: true },
    async search() { throw new AdapterError('bilibili', 'blocked', '风控拦截') },
    async thread() { throw new Error('unused') },
  }
  const { fetchers } = planFetchers({ available: { adapter: adapterFetchers({ bilibili: boom }) } })
  const r = await recall('x', fetchers, { query: 'x', minHits: 1, perSourceLimit: 3, maxTier: 1 })
  const t1 = r.tiers.find(t => t.tier === 1)!
  assert.equal(t1.failures.length, 1, '失败必须上报')
  assert.equal(t1.failures[0]!.kind, 'bilibili/blocked', '失败类型必须带上平台与类别')
  assert.equal(t1.hits, 0)
})

// ── 组装点不许丢弃已就绪的实现（2026-09-17 实测抓到的缺陷）──────────

test('模块级通路: authoritative 整层的实现必须全部接线，一条都不许丢', async () => {
  // 实测缺陷: SOURCE_PLAN 只登记 5 条而 SOURCES 有 15 条，于是
  //   authoritativeFetchers() 提供 12 个实现
  //   planFetchers({available:{authoritative}}) 只输出 **1 个**（juejin）
  // → 11 个第 0 层来源在**组装点被静默丢弃**，到 recall 才报「没有取数实现」，
  //   而那个错**指向了错误的层**（问题在组装点，不在取数层）。
  const { authoritativeFetchers } = await import('../src/authoritative.ts')
  const table = authoritativeFetchers()
  const { fetchers } = planFetchers({ available: { authoritative: table } })
  for (const id of Object.keys(table)) {
    assert.ok(fetchers[id] !== undefined, `来源「${id}」已就绪却被组装点丢了`)
  }
  assert.equal(Object.keys(fetchers).length, Object.keys(table).length)
})

test('逐条登记优先于模块级通路  juejin 的主次仍由 SOURCE_PLAN 说了算', async () => {
  // juejin 在第 0 层与第 1 层都有实现，主次由实测决定（见 SOURCE_PLAN 的 reason）。
  // 模块级通路**不许**覆盖这个判断。
  const { authoritativeFetchers } = await import('../src/authoritative.ts')
  const { fetchers } = planFetchers({ available: { authoritative: authoritativeFetchers() } })
  assert.ok(fetchers['juejin'] !== undefined)
})

test('未提供模块时，其来源进 missing 而不是静默消失', () => {
  const { fetchers, missing } = planFetchers({ available: {} })
  assert.equal(Object.keys(fetchers).length, 0)
  assert.ok(missing.length > 0, '没有模块可提供时必须报告 missing，不许假装没有这些来源')
})

test('第 0 层来源数 == SOURCES 里 tier 0 的条数（组装点与登记表不许脱节）', async () => {
  // 这条把「两处表格说同一件事」的漂移变成测试失败，而不是等到跑起来才发现
  const { SOURCES } = await import('../src/recall.ts')
  const { authoritativeFetchers } = await import('../src/authoritative.ts')
  const tier0 = SOURCES.filter(s => s.tier === 0).map(s => s.id)
  const { fetchers } = planFetchers({ available: { authoritative: authoritativeFetchers() } })
  const wired = tier0.filter(id => fetchers[id] !== undefined)
  assert.deepEqual(wired, tier0, '第 0 层每一个登记来源都必须有取数实现，缺的: ' + tier0.filter(id => !wired.includes(id)).join(','))
})

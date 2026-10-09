import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFetchers } from '../src/fetchers.ts'
import { recall, SOURCES } from '../src/recall.ts'
import { EvidenceLedger } from '../src/ledger.ts'
import { sinkHits, sinkThread } from '../src/sink.ts'
import { buildIndex, loadOrRebuild, query as queryIndex, serializeIndex } from '../src/index-store.ts'

/**
 * 端到端链路测试：**组装 → 召回 → 沉淀 → 建索引 → 反查**。
 *
 * ## 为什么单独一个文件（2026-09-18）
 *
 * 实测：`fetchers.test.ts` 有 15 处 `planFetchers` 但 **0 处 sink**；
 * `sink.test.ts` 有 19 处 sink 但 **0 处 planFetchers** 
 * **每个部件都有自己的测试，而没有一条测试走完这条链**。
 *
 * **这正是本项目反复栽的坑**：
 *   - 第 16 轮 `resolve` 核心场景坏了 16 轮，因为"测试验证各部件，没有一条走完完整路径"
 *   - 第 23 轮 `loadOrRebuild` 零调用方
 *   - 第 24 轮 `url-safety`/`readability` 零调用方
 *
 * **目标第 (4) 项要的"可复用数据资产"是一条链**，不是五个部件。
 * 这组测试锁住的是**链本身**。
 */

/** 一个受控的取数器，模仿真实来源的形状（`(source, query, ctx)` 三参）。 */
function fakeFetcher(docs: Array<{ title: string; url: string; snippet?: string }>) {
  return (source: { id: string }) =>
    Promise.resolve(docs.map(d => ({ sourceId: source.id, ...d })))
}

test('端到端: 组装后的取数表能真的喂给 recall', async () => {
  // 这一条看似显然，但它正是"各部件都有测试而链断了"的最常见形态：
  // planFetchers 的输出形状与 recall 的入参形状**必须真的兼容**。
  const t0 = SOURCES.filter(s => s.tier === 0).map(s => s.id)
  const table = Object.fromEntries(t0.map(id => [id, fakeFetcher([{ title: 'x ' + id, url: 'https://e/' + id, snippet: '内容够长的摘要用来通过检查' }])]))
  const plan = planFetchers({ available: { authoritative: table } })
  assert.ok(Object.keys(plan.fetchers).length > 0, '规划出了取数器')
  const r = await recall('测试查询', plan.fetchers, { query: '测试查询', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
  assert.ok(r.hits.length > 0, '取数表的产出真的进了 recall.hits')
})

test('端到端: 召回结果能沉淀进账本', async () => {
  const t0 = SOURCES.filter(s => s.tier === 0).map(s => s.id)
  const table = Object.fromEntries(t0.map(id => [id, fakeFetcher([
    { title: '标题 ' + id, url: 'https://e/' + id, snippet: '这是一段足够长的摘要内容用于通过证据长度检查' },
  ])]))
  const plan = planFetchers({ available: { authoritative: table } })
  const r = await recall('测试查询', plan.fetchers, { query: '测试查询', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })

  const ledger = new EvidenceLedger()
  const tierOf = new Map(SOURCES.map(s => [s.id, s.tier as 0 | 1 | 2]))
  let appended = 0
  for (const tier of [0, 1, 2] as const) {
    const inTier = r.hits.filter(h => tierOf.get(h.sourceId) === tier)
    if (inTier.length === 0) continue
    appended += sinkHits(ledger, inTier, { tier, fetchedBy: 'e2e-test' }).appended
  }
  assert.ok(appended > 0, '召回结果进得了账本')
  assert.equal(ledger.size, appended, '账本大小 == 新增数')
})

test('端到端: 账本能建索引，且索引能反查回卡片', async () => {
  const t0 = SOURCES.filter(s => s.tier === 0).map(s => s.id)
  const table = Object.fromEntries(t0.map(id => [id, fakeFetcher([
    { title: '标题 ' + id, url: 'https://e/' + id, snippet: '关于服务端组件原理的说明内容足够长用于通过检查' },
  ])]))
  const plan = planFetchers({ available: { authoritative: table } })
  const r = await recall('服务端组件原理', plan.fetchers, { query: '服务端组件原理', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
  const ledger = new EvidenceLedger()
  sinkHits(ledger, r.hits, { tier: 0, fetchedBy: 'e2e-test' })

  const index = buildIndex(ledger)
  const found = queryIndex(index, '组件', 10)
  assert.ok(found.length > 0, '索引能反查到卡片')
  // **反查回来的必须是账本里真实存在的卡**  这是"指针有效"的定义
  for (const f of found) {
    assert.ok(ledger.get(f.cardId) !== undefined, 'cardId 指向的卡必须在账本里: ' + f.cardId)
    assert.ok(f.matched.length > 0, '要能说出为什么被召回（matched）')
  }
})

test('端到端: 索引过期能全量重建，且重建后反查结果一致', async () => {
  // 这是第 (4) 项"可全量重建、带版本身份"的核心验收：
  // **账本是真相，索引是派生品**  重建后结果必须与首次一致。
  const ledger = new EvidenceLedger()
  ledger.appendByIdentity(
    { sourceId: 'crossref', sourceKey: 'doi:1', quote: '服务端组件原理与渲染模型' },
    { url: 'https://doi.org/1', title: 'A', sourceTier: 0, fetchedAt: '2026-09-18' } as never,
  )
  const first = buildIndex(ledger)
  const q1 = queryIndex(first, '组件', 10).map(x => x.cardId)

  // 篡改身份 = 模拟分词器升级
  const stale = JSON.parse(serializeIndex(first)) as { identity: { tokenizerId: string } }
  stale.identity.tokenizerId = 'hx-sagasu-zh-v0'
  /**
   * 端到端链路测试  补上"没有一条测试走完完整路径"的缺口
   * .agents/notes/implemented/architecture/2026-09-18-e2e-pipeline-test.md
   */
  const rebuilt = loadOrRebuild(JSON.stringify(stale), ledger)
  assert.equal(rebuilt.rebuilt, true)

  const q2 = queryIndex(rebuilt.index, '组件', 10).map(x => x.cardId)
  assert.deepEqual(q1, q2, '重建后的反查结果必须与首次一致  否则"可全量重建"是空话')
})

test('端到端: 对话证据（帖子）与检索证据进同一个账本', async () => {
  // 目标第 (3) 与第 (4) 项的交汇点：帖子证据与检索证据**是同一类资产**，
  // 它们该能被同一个索引检索到。
  const ledger = new EvidenceLedger()
  const thread = {
    id: 'BV1xx', platform: 'bilibili',
    turns: [{ id: 'r1', text: '这条楼层在讲服务端渲染的组件边界问题' }],
  }
  sinkThread(ledger, thread as never, { tier: 1 })
  sinkHits(ledger, [{ sourceId: 'crossref', title: '论文', url: 'https://doi/x', snippet: '服务端渲染的组件边界研究综述' }], { tier: 0 })

  const index = buildIndex(ledger)
  const found = queryIndex(index, '组件', 10)
  assert.equal(found.length, 2, '帖子证据 + 检索证据都要能被检索到，实际 ' + found.length)
})

test('端到端: 幂等  同一链路跑两次，账本与索引都不变', async () => {
  const t0 = SOURCES.filter(s => s.tier === 0).map(s => s.id)
  const mk = () => Object.fromEntries(t0.map(id => [id, fakeFetcher([
    { title: '标题 ' + id, url: 'https://e/' + id, snippet: '一段足够长的摘要内容用于通过证据长度检查' },
  ])]))
  const run = async () => {
    const plan = planFetchers({ available: { authoritative: mk() } })
    const r = await recall('测试查询', plan.fetchers, { query: '测试查询', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
    const ledger = new EvidenceLedger()
    sinkHits(ledger, r.hits, { tier: 0 })
    return { size: ledger.size, digest: buildIndex(ledger).identity.sourceDigest }
  }
  const a = await run()
  const b = await run()
  assert.equal(a.size, b.size, '两次跑出的账本大小相同')
  assert.equal(a.digest, b.digest, '**sourceDigest 相同**  这是"可全量重建"的定义')
})

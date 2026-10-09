import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EvidenceLedger, cardsFromThread } from '../src/ledger.ts'
import {
  buildIndex, loadOrRebuild, serializeIndex, query, sourceDigest,
  checkIdentity, tokenizerId, INDEX_FORMAT_VERSION, type Embedder,
} from '../src/index-store.ts'

const prov = { kind: 'api', endpoint: 'https://example.invalid/api' } as const

function seed(): EvidenceLedger {
  const l = new EvidenceLedger()
  l.appendByIdentity({ platform: 'bilibili', threadId: 'BV1', turnId: 'c1', quote: '这个原神更新很有诚意' }, { sourceTier: 1, provenance: prov, retrievedAt: 1 })
  l.appendByIdentity({ platform: 'zhihu', threadId: 'q1', turnId: 'a1', quote: '并发策略在容器里是必须的' }, { sourceTier: 0, provenance: prov, retrievedAt: 2 })
  l.appendByIdentity({ platform: 'xiaohongshu', threadId: 'n1', turnId: 'c1', quote: '露营装备清单推荐' }, { sourceTier: 1, provenance: prov, retrievedAt: 3 })
  return l
}

test('索引与查询共用同一分词函数  2 字中文查询必须能命中', () => {
  const idx = buildIndex(seed())
  // "并发" 是 2 字: FTS5 trigram 与 unicode61 都会漏, 双流方案必须命中
  const hits = query(idx, '并发')
  assert.equal(hits.length, 1, '2 字中文查询命中失败说明索引/查询分词不对称')
})

test('查询结果带 matched 词  「为什么这张卡被召回」可审计', () => {
  const idx = buildIndex(seed())
  const hit = query(idx, '原神更新')[0]!
  assert.ok(hit.matched.length > 0)
  assert.equal(typeof hit.score, 'number')
})

test('身份四要素齐全，且 sourceDigest 只由卡 id 决定', () => {
  const l = seed()
  const idx = buildIndex(l)
  assert.equal(idx.identity.indexFormatVersion, INDEX_FORMAT_VERSION)
  assert.equal(idx.identity.tokenizerId, tokenizerId())
  assert.equal(idx.identity.embedderId, null, '未接入语义端口时必须是 null 而不是伪造的 id')
  assert.equal(idx.identity.sourceDigest, sourceDigest(l.all()))
  // 同一批卡, 换构建时刻, sourceDigest 必须不变
  const again = buildIndex(l, { now: () => 999_999 })
  assert.equal(again.identity.sourceDigest, idx.identity.sourceDigest)
})

test('tokenizerId 变化 → 身份不符 → 全量重建（而非增量修补）', () => {
  const l = seed()
  const idx = buildIndex(l)
  const stale = { ...idx, identity: { ...idx.identity, tokenizerId: 'hx-sagasu-zh-v0' } }
  const mism = checkIdentity(stale.identity, buildIndex(l).identity)
  assert.deepEqual(mism.map(m => m.field), ['tokenizerId'])

  const res = loadOrRebuild(serializeIndex(stale), l)
  assert.equal(res.rebuilt, true)
  assert.equal(res.mismatches[0]!.field, 'tokenizerId')
  assert.equal(res.index.identity.tokenizerId, tokenizerId())
})

test('Ledger 内容变了（sourceDigest 变）→ 重建', () => {
  const l = seed()
  const raw = serializeIndex(buildIndex(l))
  l.appendByIdentity({ platform: 'v2ex', threadId: 't9', turnId: 'a9', quote: '新增的一张卡' }, { sourceTier: 1, provenance: prov, retrievedAt: 9 })
  const res = loadOrRebuild(raw, l)
  assert.equal(res.rebuilt, true)
  assert.ok(res.mismatches.some(m => m.field === 'sourceDigest'))
  // 断言"新卡可见且排第一"，而不是"结果只有 1 条"  索引是**候选生成器**，
  // 高频虚词（"的""一"）会产生低分噪声，那是排序层的事，不该由这里保证。
  const hits = query(res.index, '新增的一张卡')
  assert.equal(hits[0]!.cardId, l.all().find(c => c.quote.includes('新增'))!.id, '重建后新卡必须可见且排第一')
})

test('条数相同但内容不同也会被发现  这是不用「条数」当摘要的原因', () => {
  const l = seed()
  const raw = serializeIndex(buildIndex(l))
  // 一进一出: 条数不变
  l.appendByIdentity({ platform: 'v2ex', threadId: 'tX', turnId: 'aX', quote: '换进来的一张卡' }, { sourceTier: 1, provenance: prov, retrievedAt: 10 })
  const before = l.size
  assert.equal(before, 4)
  const res = loadOrRebuild(raw, l)
  assert.equal(res.rebuilt, true, '条数变了当然要重建；这里验证的是 digest 确实跟着内容走')
})

test('索引损坏 = 派生品丢失 → 直接重建，不报错（真相在 Ledger）', () => {
  const l = seed()
  const res = loadOrRebuild('{ 这不是合法 JSON', l)
  assert.equal(res.rebuilt, true)
  assert.equal(query(res.index, '露营').length, 1, '重建后必须立即可用')
})

test('身份相符时不重建  避免每次打开都全量重算', () => {
  const l = seed()
  const raw = serializeIndex(buildIndex(l))
  const res = loadOrRebuild(raw, l)
  assert.equal(res.rebuilt, false)
  assert.deepEqual(res.mismatches, [])
})

test('语义端口是端口: 注入 embedder 会进身份，不注入则保持 null', () => {
  const fake: Embedder = { id: 'fake-embedder', dim: 8, embed: () => new Array(8).fill(0.1) }
  const idx = buildIndex(seed(), { embedder: fake })
  assert.equal(idx.identity.embedderId, 'fake-embedder/d8')
  // 换了实现 → 身份不符 → 必须重建
  const other: Embedder = { id: 'other', dim: 16, embed: () => new Array(16).fill(0) }
  const mism = checkIdentity(idx.identity, buildIndex(seed(), { embedder: other }).identity)
  assert.deepEqual(mism.map(m => m.field), ['embedderId'])
})

test('同义词归一必须**双向**成立（索引侧与查询侧都展开）', () => {
  const l = new EvidenceLedger()
  // 卡里写的是别名，查询用正名
  l.appendByIdentity({ platform: 'bilibili', threadId: 'BV9', turnId: 'c1', quote: 'B站的弹幕质量下降了' }, { sourceTier: 1, provenance: prov, retrievedAt: 1 })
  // 卡里写的是正名，查询用别名
  l.appendByIdentity({ platform: 'bilibili', threadId: 'BV8', turnId: 'c1', quote: '哔哩哔哩的推荐算法变了' }, { sourceTier: 1, provenance: prov, retrievedAt: 2 })
  const idx = buildIndex(l)
  assert.equal(query(idx, '哔哩哔哩').find(h => h.cardId === l.all()[0]!.id) !== undefined, true,
    '卡里写 B站、查询用正名时也必须召回（索引侧展开）')
  assert.equal(query(idx, 'B站').find(h => h.cardId === l.all()[1]!.id) !== undefined, true,
    '卡里写正名、查询用别名时也必须召回（查询侧展开）')
})

test('M5 验收判据: 删掉派生索引 → 从 Ledger 全量重建 → 检索结果逐条一致', () => {
  const l = seed()
  const first = buildIndex(l, { now: () => 1000 })
  const queries = ['并发策略', '原神', '露营装备', 'B站', '不存在的内容xyz']
  const before = queries.map(q => query(first, q))

  // 索引被删掉（派生品丢失），从真相重新构建
  const rebuilt = loadOrRebuild(null, l, { now: () => 2000 }).index
  const after = queries.map(q => query(rebuilt, q))

  assert.deepEqual(after, before, '重建后的检索结果必须逐条一致  否则索引不是 Ledger 的纯函数')
  assert.equal(rebuilt.identity.sourceDigest, first.identity.sourceDigest)
  assert.notEqual(rebuilt.identity.builtAt, first.identity.builtAt, 'builtAt 不参与身份比对，重建后必然变')
})

test('构建是确定的: 同一 Ledger 构建两次，序列化逐字节一致（builtAt 除外）', () => {
  const l = seed()
  const a = buildIndex(l, { now: () => 111 })
  const b = buildIndex(l, { now: () => 111 })
  assert.equal(serializeIndex(a), serializeIndex(b), '不确定的索引会让"重建后一致"这个判据无法成立')
})

test('证据必须来自 Thread 的原文  建卡用 text 而不是 normalizedText', () => {
  const cards = cardsFromThread(
    { id: 't', platform: 'tieba', provenance: prov },
    [{ id: 'f1', text: '这个检所很好用' }],
    { sourceTier: 1, retrievedAt: 1 },
  )
  const l = new EvidenceLedger()
  for (const c of cards) l.append(c)
  const idx = buildIndex(l)
  // 用错字查也应当命中（因为索引会切 bigram），但卡片内容是原文
  assert.equal(query(idx, '检所').length, 1)
  assert.equal(l.all()[0]!.quote, '这个检所很好用')
})

// ── CLI 的 `query` 必须走身份校验（2026-09-18 修）──────────────────

test('过期索引必须被 loadOrRebuild 拦下并重建，而不是静默查不到', async () => {
  // 修的缺陷: CLI 此前直接 JSON.parse 索引喂给 queryIndex，**绕过身份校验**。
  // 分词器升级后查询侧算新口径的词、索引侧存旧口径的词 → 查不到却不报错。
  const { EvidenceLedger } = await import('../src/ledger.ts')
  const { buildIndex, loadOrRebuild, serializeIndex, query: q } = await import('../src/index-store.ts')
  const ledger = new EvidenceLedger()
  ledger.appendByIdentity(
    { sourceId: 'crossref', sourceKey: 'doi:1', quote: 'Rust 所有权与借用检查' },
    { url: 'https://doi.org/1', title: 'A', sourceTier: 0, fetchedAt: '2026-09-18' } as never,
  )
  const good = serializeIndex(buildIndex(ledger))
  assert.equal(q(loadOrRebuild(good, ledger).index, '所有权').length, 1, '新鲜索引能查到')

  // 篡改身份 = 模拟分词器升级
  const stale = JSON.parse(good) as { identity: { tokenizerId: string } }
  stale.identity.tokenizerId = 'hx-sagasu-zh-v0'
  const r = loadOrRebuild(JSON.stringify(stale), ledger)
  assert.equal(r.rebuilt, true, '身份不符必须重建')
  assert.equal(r.mismatches[0]!.field, 'tokenizerId')
  assert.equal(q(r.index, '所有权').length, 1, '重建后仍然查得到  真相在账本里')
})

test('源摘要不符（卡片增删）也要触发重建', async () => {
  const { EvidenceLedger } = await import('../src/ledger.ts')
  const { buildIndex, loadOrRebuild, serializeIndex } = await import('../src/index-store.ts')
  const l1 = new EvidenceLedger()
  l1.appendByIdentity(
    { sourceId: 'x', sourceKey: 'k:1', quote: '第一张卡的内容' },
    { url: 'u1', title: 'A', sourceTier: 0, fetchedAt: '2026-09-18' } as never,
  )
  const idx = serializeIndex(buildIndex(l1))
  // 账本多了一张卡  索引没有它
  l1.appendByIdentity(
    { sourceId: 'x', sourceKey: 'k:2', quote: '第二张卡的内容' },
    { url: 'u2', title: 'B', sourceTier: 0, fetchedAt: '2026-09-18' } as never,
  )
  const r = loadOrRebuild(idx, l1)
  assert.equal(r.rebuilt, true)
  assert.equal(r.mismatches[0]!.field, 'sourceDigest', '条数变了也要察觉（一进一出条数相同但 id 不同）')
})

test('索引损坏 = 派生品丢失，直接重建而不是报错', async () => {
  const { EvidenceLedger } = await import('../src/ledger.ts')
  const { loadOrRebuild } = await import('../src/index-store.ts')
  const ledger = new EvidenceLedger()
  ledger.appendByIdentity(
    { sourceId: 'x', sourceKey: 'k:1', quote: '内容' },
    { url: 'u1', title: 'A', sourceTier: 0, fetchedAt: '2026-09-18' } as never,
  )
  const r = loadOrRebuild('{ 这不是 JSON', ledger)
  assert.equal(r.rebuilt, true)
  assert.deepEqual(r.mismatches, [], '损坏不是"身份不符"，不该报成 mismatches')
})


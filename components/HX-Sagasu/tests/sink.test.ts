import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EvidenceLedger } from '../src/ledger.ts'
import { hitIdentity, quoteOf, sinkDigest, sinkHits } from '../src/sink.ts'
import type { SourceHit } from '../src/recall.ts'

const hit = (over: Partial<SourceHit> = {}): SourceHit => ({
  sourceId: 'github',
  title: 'rust-lang/rust',
  url: 'https://github.com/rust-lang/rust',
  snippet: 'Empowering everyone to build reliable and efficient software.',
  ...over,
})

const opts = { tier: 0 as const, fetchedBy: 'test', now: () => 1_700_000_000_000 }

// ── quote 的契约: 必须是可在源站核对的原文 ─────────────────────

test('quote 取 snippet  它是来源给出的原文片段', () => {
  assert.equal(quoteOf(hit()), 'Empowering everyone to build reliable and efficient software.')
})

test('没有 snippet 时退回 title  标题也是来源给出的原样文本', () => {
  assert.equal(quoteOf(hit({ snippet: undefined })), 'rust-lang/rust')
  assert.equal(quoteOf(hit({ snippet: '' })), 'rust-lang/rust')
})

test('url 永远不进 quote  它是坐标不是内容', () => {
  // 链接本身不主张任何事。把它当"证据"，下游引用时引用的是一条 URL 而不是一句话。
  const q = quoteOf(hit({ snippet: '', title: '' , url: 'https://example.invalid/a' }))
  assert.equal(q, '', 'title/snippet 都空时必须是空串，而不是退回 url')
})

test('两者都空 → 拒绝造卡，并把它计数报出来', () => {
  const ledger = new EvidenceLedger()
  /**
   * 检索结果到账本的桥  第 (4) 项需求的缺口
   * .agents/notes/implemented/architecture/2026-09-17-hits-to-ledger-bridge.md
   */
  const r = sinkHits(ledger, [hit(), hit({ title: '', snippet: '', url: 'https://x.invalid/1' })], opts)
  assert.equal(r.appended, 1)
  assert.equal(r.skippedNoQuote, 1, '没有可核对原文的命中必须被看见，不能静默丢弃')
  assert.equal(ledger.size, 1, '一张无法核对的卡都不许进账本')
})

// ── 幂等: 可全量重建的前提 ──────────────────────────────────────

test('同一份内容重复沉淀是 no-op  这是"可全量重建"的前提', () => {
  const ledger = new EvidenceLedger()
  const first = sinkHits(ledger, [hit()], opts)
  const second = sinkHits(ledger, [hit()], opts)
  assert.equal(first.appended, 1)
  assert.equal(second.appended, 0, '再次沉淀同一内容不该产生新卡')
  assert.equal(ledger.size, 1)
})

test('id 由内容与位置决定，**不含 query**  同一内容换问法仍是同一张卡', () => {
  // 若身份含 query，同一份内容会因为问法不同变成多张卡，账本里全是重复。
  const a = hitIdentity('github', hit(), 'q')
  const b = hitIdentity('github', hit(), 'q')
  assert.deepEqual(a, b)
  assert.equal('query' in a, false, '身份字段里不许出现 query')
})

test('同 URL 但内容变了 → 是**另一张**卡（内容寻址的意义）', () => {
  const ledger = new EvidenceLedger()
  sinkHits(ledger, [hit()], opts)
  sinkHits(ledger, [hit({ snippet: '内容被改过了' })], opts)
  assert.equal(ledger.size, 2, '内容变了就是新证据，不许被 URL 相同而合并')
})

// ── sourceTier 与 provenance 如实记录 ──────────────────────────

test('sourceTier 必须显式给出  层级是权威性的一部分', () => {
  const ledger = new EvidenceLedger()
  sinkHits(ledger, [hit()], { tier: 1, now: opts.now })
  const card = [...ledger.all()][0]!
  assert.equal(card.sourceTier, 1)
})

test('argo 来源记为 metasearch，直连来源记为 api  两者可信度不同', () => {
  const ledger = new EvidenceLedger()
  sinkHits(ledger, [hit({ sourceId: 'argo:anysearch' }), hit({ sourceId: 'crossref', url: 'u2' })], opts)
  const cards = [...ledger.all()]
  const bySrc = new Map(cards.map(c => [c.platform, c.provenance]))
  assert.deepEqual(bySrc.get('argo:anysearch'), { kind: 'metasearch', engine: 'anysearch' })
  assert.deepEqual(bySrc.get('crossref'), { kind: 'api', endpoint: 'crossref' })
})

// ── 端到端: 沉淀后能被索引检索到 ────────────────────────────────

test('沉淀后的卡能被 buildIndex + query 检索到（第 (4) 项需求的完整回路）', async () => {
  const { buildIndex, query } = await import('../src/index-store.ts')
  const ledger = new EvidenceLedger()
  sinkHits(ledger, [hit({ snippet: 'Rust 所有权与借用检查器的关系' })], { tier: 0, now: opts.now })
  const index = buildIndex(ledger)
  const found = query(index, '所有权')
  assert.equal(found.length, 1, '搜到的东西必须能被下次会话检索回来  这正是"资产"的含义')
  // query() 返回的是 {cardId, score, matched}，**不是卡本身**  索引只存指针，
  // 正文留在账本里。这正是"Ledger 是真相、Index 是派生品"这条契约的形状。
  const card = ledger.get(found[0]!.cardId)
  assert.ok(card !== undefined, '索引里的 cardId 必须能在账本里查到  否则索引成了孤儿')
  assert.match(card.quote, /所有权/)
})

test('空命中列表是合法的 no-op', () => {
  const ledger = new EvidenceLedger()
  const r = sinkHits(ledger, [], opts)
  assert.deepEqual(r, { appended: 0, skippedNoQuote: 0 })
  assert.equal(ledger.size, 0)
})

test('sinkDigest 把"跳过了几条"说出来，而不是只报成功数', () => {
  assert.equal(sinkDigest({ appended: 3, skippedNoQuote: 0 }, 3), '3/3 新增')
  assert.match(sinkDigest({ appended: 2, skippedNoQuote: 1 }, 3), /1 条无可核对原文被跳过/)
})

// ── 帖子与抓取的沉淀（2026-09-18 加）──────────────────────────────
//
// 此前**只有 search 会写账本**。而 thread 产出整楼原文、fetch 产出完整正文 
// 它们比 search 的 snippet 更接近"一手证据"。

test('帖子沉淀: quote 必须是**原文**，不是归一文本', async () => {
  // **这是本模块最容易做错的地方。** EvidenceCard 的 quote 契约写着
  // "原文字面引用。**不是**归一化后的文本  证据必须能在源站核对得上"。
  // 而 L1 归一改了错别字/繁简/全半角  那些改动让文本更好检索，
  // 却让它不再是源站上的原文。
  const { EvidenceLedger } = await import('../src/ledger.ts')
  const { sinkThread } = await import('../src/sink.ts')
  const ledger = new EvidenceLedger()
  const thread = {
    id: 'T1', platform: 'bilibili',
    turns: [{ id: 'r1', text: '视屏压缩工具很好用，模版也全', normalizedText: '视频压缩工具很好用，模板也全', author: { id: 'u1', name: 'a' } }],
  }
  const r = sinkThread(ledger, thread as never, { tier: 1 })
  assert.equal(r.appended, 1)
  const card = ledger.all()[0]!
  assert.ok(card.quote.includes('视屏'), '必须是原文（含错别字）: ' + card.quote)
  assert.ok(!card.quote.includes('视频'), '不许用归一后的文本当证据')
})

test('太短的楼层不沉淀  但也不改变帖子本身', async () => {
  const { EvidenceLedger } = await import('../src/ledger.ts')
  const { sinkThread, MIN_QUOTE_CHARS } = await import('../src/sink.ts')
  const ledger = new EvidenceLedger()
  const long = '这是一条足够长的楼层内容用来通过证据长度阈值检查'
  const thread = {
    id: 'T1', platform: 'bilibili',
    turns: [
      { id: 'r1', text: '沙发' },
      { id: 'r2', text: long },
      { id: 'r3', text: '' },
    ],
  }
  const r = sinkThread(ledger, thread as never, { tier: 1 })
  assert.equal(r.appended, 1, '只有够长的沉淀')
  assert.equal(r.skippedTooShort, 1)
  assert.equal(r.skippedNoQuote, 1)
  assert.ok(long.length >= MIN_QUOTE_CHARS)
})

test('帖子沉淀是幂等的  同内容重复沉淀是 no-op', async () => {
  // 这是"可全量重建"的前提: 只要能重新取到同样的内容，账本收敛到同一状态。
  const { EvidenceLedger } = await import('../src/ledger.ts')
  const { sinkThread } = await import('../src/sink.ts')
  const ledger = new EvidenceLedger()
  /**
   * 对话语义层以「原文保真 + 推断必标记」为不可退让的契约
   * .agents/notes/implemented/architecture/2026-09-16-conversation-semantics-contract.md
   */
  const thread = { id: 'T1', platform: 'bilibili', turns: [{ id: 'r1', text: '一条足够长的楼层内容用于通过阈值检查' }] }
  const a = sinkThread(ledger, thread as never, { tier: 1 })
  const b = sinkThread(ledger, thread as never, { tier: 1 })
  assert.equal(a.appended, 1)
  assert.equal(b.appended, 0, '第二次不该新增')
  assert.equal(ledger.size, 1)
})

test('卡片带 platform/threadId/turnId  能指回具体某一楼', async () => {
  const { EvidenceLedger } = await import('../src/ledger.ts')
  const { sinkThread } = await import('../src/sink.ts')
  const ledger = new EvidenceLedger()
  const thread = { id: 'BV1xx', platform: 'bilibili', turns: [{ id: 'r42', text: '一条足够长的楼层内容用于通过阈值检查' }] }
  sinkThread(ledger, thread as never, { tier: 1 })
  const c = ledger.all()[0]!
  assert.equal(c.platform, 'bilibili')
  assert.equal(c.threadId, 'BV1xx')
  assert.equal(c.turnId, 'r42', '指回具体楼层，不是整帖')
})

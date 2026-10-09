import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EvidenceLedger, cardId, openLedger, cardsFromThread, dedupeKey } from '../src/ledger.ts'

const prov = { kind: 'browser', session: 'anonymous', url: 'https://example.invalid/t' } as const

function mkLedger() {
  const l = new EvidenceLedger()
  l.appendByIdentity(
    { platform: 'heybox', threadId: 't1', turnId: 'f1', quote: '小黑盒的评分机制我觉得是暗改了' },
    { sourceTier: 1, provenance: prov, retrievedAt: 1000 },
  )
  return l
}

test('内容寻址: 同内容必然同 id，与抓取时间/抓取者无关', () => {
  const a = cardId({ platform: 'heybox', threadId: 't1', turnId: 'f1', quote: '同一句话' })
  const b = cardId({ platform: 'heybox', threadId: 't1', turnId: 'f1', quote: '同一句话' })
  assert.equal(a, b)
  // 但换线程/换楼/换文字都必须是不同的卡
  assert.notEqual(a, cardId({ platform: 'heybox', threadId: 't2', turnId: 'f1', quote: '同一句话' }))
  assert.notEqual(a, cardId({ platform: 'heybox', threadId: 't1', turnId: 'f2', quote: '同一句话' }))
  assert.notEqual(a, cardId({ platform: 'heybox', threadId: 't1', turnId: 'f1', quote: '另一句话' }))
})

test('两个来源各自抓到同一段原文 → 天然同 id，去重不需要额外状态', () => {
  const idA = dedupeKey({ platform: 'bilibili', threadId: 'BV1', turnId: 'c1', quote: '这个更新很有诚意' })
  const idB = dedupeKey({ platform: 'bilibili', threadId: 'BV1', turnId: 'c1', quote: '这个更新很有诚意' })
  assert.equal(idA, idB, '跨来源同内容必须收敛到同一张卡')
})

test('只追加: 同 id 再写是 no-op，绝不覆盖（引用必须永远指向同一段原文）', () => {
  const l = mkLedger()
  const first = l.all()[0]!
  const again = l.append({ ...first, quote: '被改过的文字', id: first.id })
  assert.equal(again.appended, false)
  assert.equal(l.size, 1)
  assert.equal(l.get(first.id)!.quote, '小黑盒的评分机制我觉得是暗改了', '已发布的证据不许被改写')
})

test('卡片保存的是**原文**，不是归一化文本', () => {
  const cards = cardsFromThread(
    { id: 't9', platform: 'tieba', provenance: { kind: 'api', endpoint: 'x' } },
    [{ id: 'f1', text: '这个检所功能挺好用的' }],
    { sourceTier: 1, retrievedAt: 1 },
  )
  assert.equal(cards[0]!.quote, '这个检所功能挺好用的', '证据层不许出现归一化后的字')
})

test('JSONL 往返: 序列化再打开，内容一致', () => {
  const l = mkLedger()
  l.appendByIdentity(
    { platform: 'zhihu', threadId: 'q1', turnId: 'a1', quote: '第二张卡' },
    { sourceTier: 0, provenance: prov, retrievedAt: 2000, lensId: 'lens-1' },
  )
  const reopened = openLedger(l.toJSONL())
  assert.equal(reopened.size, l.size)
  assert.deepEqual(reopened.all().map(c => c.id), l.all().map(c => c.id))
  assert.equal(reopened.all()[1]!.lensId, 'lens-1')
})

test('落盘后被手改内容会被抓住  静默丢证据不可接受', () => {
  const l = mkLedger()
  const lines = l.toJSONL().split('\n')
  const card = JSON.parse(lines[0]!)
  card.quote = '偷偷改过的内容'   // id 没跟着改
  assert.throws(() => openLedger(JSON.stringify(card)), /id 与内容不符/)
})

test('坏行不吞: 结构不合法的卡直接报错并指出行号', () => {
  // 第 1 行是合法 JSON 但不是合法卡片  必须在**读入时**被抓住，
  // 否则它会一路流到引用/索引层再以更难定位的方式炸
  assert.throws(() => openLedger('{"valid":1}\nnot json at all'), /第 1 行缺字段/)
  // 第 2 行才是非 JSON
  const good = mkLedger().toJSONL()
  assert.throws(() => openLedger(good + '\nnot json at all'), /第 2 行不是合法 JSON/)
})

test('按 lens / tier 过滤', () => {
  const l = new EvidenceLedger()
  l.appendByIdentity({ platform: 'v2ex', threadId: 't', turnId: 'a', quote: '甲' }, { sourceTier: 1, provenance: prov, retrievedAt: 1, lensId: 'L1' })
  l.appendByIdentity({ platform: 'v2ex', threadId: 't', turnId: 'b', quote: '乙' }, { sourceTier: 0, provenance: prov, retrievedAt: 1, lensId: 'L2' })
  assert.equal(l.filterByLens('L1').length, 1)
  assert.equal(l.filterByTier(0).length, 1)
})

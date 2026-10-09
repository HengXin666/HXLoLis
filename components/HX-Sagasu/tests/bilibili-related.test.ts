import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── B站相关视频（2026-09-19 加，实测倒逼）──────────────────────────

/** 造一个假的取数器  不发真实请求。 */
function fake(status: number, body: string) {
  // **契约是 json() 方法**  与 FetchedResponse 一致
  return async () => ({ ok: status < 400, status, json: async () => JSON.parse(body) })
}

test('relatedVideos: 正常解析 bvid/标题/UP主', async () => {
  const { relatedVideos } = await import('../src/adapters/bilibili.ts')
  const payload = JSON.stringify({ code: 0, data: [
    { bvid: 'BV1aa', title: '甲', owner: { name: 'UP甲' } },
    { bvid: 'BV1bb', title: '乙', owner: { name: 'UP乙' } },
  ] })
  const v = await relatedVideos('BV1x', { fetcher: fake(200, payload) })
  assert.equal(v.length, 2)
  assert.equal(v[0]!.bvid, 'BV1aa')
  assert.equal(v[0]!.author, 'UP甲')
})

test('relatedVideos: **HTTP 非 200 必须抛**  不许静默变空数组', async () => {
  const { relatedVideos } = await import('../src/adapters/bilibili.ts')
  await assert.rejects(() => relatedVideos('BV1x', { fetcher: fake(403, '') }), /HTTP 403/)
})

test('relatedVideos: **code !== 0 必须抛**  接口级错误不是「没有相关内容」', async () => {
  const { relatedVideos } = await import('../src/adapters/bilibili.ts')
  await assert.rejects(
    () => relatedVideos('BV1x', { fetcher: fake(200, JSON.stringify({ code: -403, message: 'wbi' })) }),
    /code=-403/,
  )
})

test('relatedVideos: 非 JSON 响应必须抛（不是静默空）', async () => {
  const { relatedVideos } = await import('../src/adapters/bilibili.ts')
  await assert.rejects(() => relatedVideos('BV1x', { fetcher: fake(200, '<html>not json') }), /不是 JSON|Unexpected/)
})

test('relatedVideos: 缺 bvid 的条目被滤掉（它会毁掉后续按 id 的抓取）', async () => {
  const { relatedVideos } = await import('../src/adapters/bilibili.ts')
  const payload = JSON.stringify({ code: 0, data: [
    { bvid: 'BV1aa', title: '甲', owner: { name: 'A' } },
    { title: '无 bvid', owner: { name: 'B' } },
    { bvid: '', title: '空 bvid', owner: { name: 'C' } },
  ] })
  const v = await relatedVideos('BV1x', { fetcher: fake(200, payload) })
  assert.equal(v.length, 1)
  assert.equal(v[0]!.bvid, 'BV1aa')
})

test('relatedVideos: limit 生效', async () => {
  const { relatedVideos } = await import('../src/adapters/bilibili.ts')
  const data = Array.from({ length: 40 }, (_, i) => ({ bvid: 'BV' + i, title: 't' + i, owner: { name: 'u' } }))
  const v = await relatedVideos('BV1x', { fetcher: fake(200, JSON.stringify({ code: 0, data })), limit: 5 })
  assert.equal(v.length, 5)
})

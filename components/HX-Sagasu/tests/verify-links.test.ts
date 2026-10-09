import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── 链接核验（2026-09-19 加，学自 aether-search）────────────────────

test('extractUrls: 抽 URL 并按归一化去重', async () => {
  const { extractUrls, normalizeUrl } = await import('../src/verify-links.ts')
  const text = 'see https://example.com/x/ and https://example.com/x plus https://example.org/y?q=1#frag'
  const got = extractUrls(text)
  // **`https://example.com/x/` 与 `https://example.com/x` 归一后相同 → 只留一条**
  assert.equal(got.length, 2, JSON.stringify(got))
  assert.equal(normalizeUrl('https://Example.com/x/'), 'https://example.com/x')
  // **query 必须保留**（?v=2 通常是不同资源）；**fragment 必须丢弃**
  assert.equal(normalizeUrl('https://example.com/y?q=1#frag'), 'https://example.com/y?q=1')
})

test('extractUrls: 中文标点紧跟 URL 时不吞进 URL', async () => {
  const { extractUrls } = await import('../src/verify-links.ts')
  assert.deepEqual(extractUrls('见 https://example.com/x，另见 https://example.org/y。'), ['https://example.com/x', 'https://example.org/y'])
})

test('Tier 0 互证: 命中证据集 → corroborated，**且不再探活**', async () => {
  // 这是 aether-search 那条判据的核心: 被独立来源证实的 URL **不需要**再探。
  const { verifyUrls } = await import('../src/verify-links.ts')
  let probes = 0
  const prober = async () => { probes++; return { status: 200 } }
  const out = await verifyUrls(
    ['https://example.com/x'],
    ['https://example.com/x'],   // 证据集里有它
    { prober },
  )
  assert.equal(out[0]!.status, 'corroborated')
  assert.equal(probes, 0, '互证命中就**不该**去探活  那是没有信息量的开销')
})

test('Tier 1: 404/410 → dead，其余非 2xx → unverified', async () => {
  const { probeUrls } = await import('../src/verify-links.ts')
  const statuses: Record<string, number | null> = {
    'https://example.com/404': 404,
    'https://example.com/410': 410,
    'https://example.com/ok': 200,
    'https://example.com/403': 403,
    'https://example.com/500': 500,
  }
  const prober = async (u: string) => ({ status: statuses[u] ?? null })
  const out = await probeUrls(Object.keys(statuses), { prober })
  const by = Object.fromEntries(out.map(o => [o.url, o.status]))
  assert.equal(by['https://example.com/404'], 'dead')
  assert.equal(by['https://example.com/410'], 'dead')
  assert.equal(by['https://example.com/ok'], 'alive')
  // **403/500 归 unverified 而非 dead**: 服务器在, 只是不让我们看
  assert.equal(by['https://example.com/403'], 'unverified')
  assert.equal(by['https://example.com/500'], 'unverified')
})

test('**探不到不等于死了**  超时/异常一律 unverified', async () => {
  // 这是本轮最重要的语义: 与本组件 `not-applicable ≠ no-content ≠ 失败` 同源。
  const { probeUrls } = await import('../src/verify-links.ts')
  const prober = async () => ({ status: null, note: '超时' })
  const out = await probeUrls(['https://example.com/x'], { prober })
  assert.equal(out[0]!.status, 'unverified')
  assert.match(out[0]!.detail, /不等于已死/)
})

test('探活前必须先过 SSRF 校验  否则核验自己成了 SSRF 入口', async () => {
  // 让攻击者用一个 URL 借我们的探活去打内网。
  const { probeUrls } = await import('../src/verify-links.ts')
  let probed: string[] = []
  const prober = async (u: string) => { probed.push(u); return { status: 200 } }
  const out = await probeUrls(
    ['http://127.0.0.1/secret', 'http://192.168.1.1/admin', 'https://example.net/x'],
    { prober },
  )
  assert.deepEqual(probed, ['https://example.net/x'], '内网地址**一次都不许探**')
  assert.equal(out[0]!.status, 'unverified')
  assert.match(out[0]!.detail, /跳过探活/)
})

test('renderVerifyReport: 只列未通过项，全通过时返回空串', async () => {
  const { renderVerifyReport } = await import('../src/verify-links.ts')
  const clean = renderVerifyReport([
    { url: 'https://example.com', status: 'alive', detail: 'HTTP 200' },
    { url: 'https://example.org', status: 'corroborated', detail: '被证据集中的独立来源证实' },
  ])
  assert.equal(clean, '', '都是好消息时不该有输出')
  const dirty = renderVerifyReport([
    { url: 'https://example.com', status: 'alive', detail: 'HTTP 200' },
    { url: 'https://ghost.example.com', status: 'dead', detail: 'HTTP 404' },
  ])
  assert.match(dirty, /ghost\.example\.com/)
  assert.ok(!dirty.includes('https://example.com'), 'alive 的不要列')
})

test('mark: 四种状态各有符号', async () => {
  const { mark } = await import('../src/verify-links.ts')
  assert.equal(mark('alive'), '✓')
  assert.equal(mark('corroborated'), '✓')
  assert.equal(mark('dead'), '⚠')
  assert.equal(mark('unverified'), '?')
})

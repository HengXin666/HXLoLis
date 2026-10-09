import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── 兜底装配（2026-09-19 加，学自 aether-search 的「证据链接兜底」）────────

/** 造一个最小的 RecallResult  只填本项目关心的字段。 */
function mk(hits: number, failures: number, ranTiers: Array<[number, number, number]>): never {
  return {
    query: 'q',
    hits: Array.from({ length: hits }, (_, i) => ({ sourceId: 's' + i, title: 't', url: 'https://example.com/' + i })),
    verdict: { sufficient: hits > 0, signals: [] },
    tiers: ranTiers.map(([tier, h, f]) => ({
      tier, ran: true, sources: [], hits: h,
      failures: Array.from({ length: f }, (_, i) => ({ sourceId: 'bad' + i, kind: 'network', message: 'x' })),
      elapsedMs: 1,
    })),
    reachedTier: 0, stoppedBecause: '', exhausted: true,
  } as never
}

test('answer: 有证据且无失败 → 不打扰', async () => {
  const { fallbackOf } = await import('../src/fallback.ts')
  const o = fallbackOf(mk(5, 0, [[0, 5, 0]]))
  assert.equal(o.level, 'answer')
  assert.equal(o.headline, '', '没有坏消息时不说话')
})

test('partial: 有证据但有失败 → **必须标注它是局部的**', async () => {
  // 否则用户会把"部分"当"全部"。
  const { fallbackOf } = await import('../src/fallback.ts')
  const o = fallbackOf(mk(3, 2, [[0, 3, 2]]))
  assert.equal(o.level, 'partial')
  assert.match(o.headline, /2 个来源失败/)
  assert.match(o.headline, /部分证据/)
})

test('partial: 整层无产出时要说清是哪一层', async () => {
  const { fallbackOf } = await import('../src/fallback.ts')
  const o = fallbackOf(mk(3, 2, [[0, 3, 0], [1, 0, 2]]))
  assert.deepEqual([...o.degradedTiers], [1])
  assert.match(o.detail, /第 1 层/)
})

test('**「确实没有」与「全线崩溃」必须区分**  这是本模块存在的全部理由', async () => {
  const { fallbackOf } = await import('../src/fallback.ts')
  // 处 A: 跑通了，就是没有
  const empty = fallbackOf(mk(0, 0, [[0, 0, 0]]))
  assert.equal(empty.level, 'answer')
  assert.match(empty.headline, /确实没有/)
  assert.match(empty.headline, /不是故障/)
  // 处 B: 全线崩溃  也是 0 条，但**含义完全相反**
  const broken = fallbackOf(mk(0, 5, [[0, 0, 5]]))
  assert.equal(broken.level, 'degraded')
  assert.match(broken.headline, /降级/)
  assert.match(broken.detail, /不要把空结果当成结论/)
})

test('isDegraded: 只有 degraded 才算结果不可信', async () => {
  const { fallbackOf, isDegraded } = await import('../src/fallback.ts')
  assert.equal(isDegraded(fallbackOf(mk(0, 5, [[0, 0, 5]]))), true)
  assert.equal(isDegraded(fallbackOf(mk(3, 2, [[0, 3, 2]]))), false, '有证据就不算不可信，只是不完整')
  assert.equal(isDegraded(fallbackOf(mk(5, 0, [[0, 5, 0]]))), false)
})

test('renderFallback: answer 且无话可说时返回空串', async () => {
  const { fallbackOf, renderFallback } = await import('../src/fallback.ts')
  assert.equal(renderFallback(fallbackOf(mk(5, 0, [[0, 5, 0]]))), '')
  const s = renderFallback(fallbackOf(mk(0, 5, [[0, 0, 5]])))
  assert.match(s, /降级/)
  assert.match(s, /不要把空结果当成结论/)
})

test('失败计数跨层累加', async () => {
  const { fallbackOf } = await import('../src/fallback.ts')
  const o = fallbackOf(mk(1, 4, [[0, 1, 2], [1, 0, 2]]))
  assert.equal(o.failures, 4)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── 闸门（2026-09-18 加）──────────────────────────────────────────

// **测试覆盖的边界（诚实标注，2026-09-18）**:
//
// 我对这组测试做过**变异检验**  把 while 改回 if（即恢复惊群写法），
// **三条测试仍然全绿**。说明它们**没有真正覆盖惊群的时序**。
//
// 惊群的触发条件是: 一次 release() 之后，被唤醒者的微任务 running++
// 与下一个 release() 在同一 tick 里交错  而 setTimeout 驱动的测试
// **构造不出那个交错**（每个任务至少隔一个宏任务）。
//
// **所以这三条测试守的是**: 上限有效、release 幂等、异常后仍能用。
// **它们不守**惊群。要覆盖惊群需要可控的微任务调度，属未做的工作。


test('闸门: 上限内的并发不排队，超出的排队', async () => {
  const { createGate } = await import('../src/argo-gate.ts')
  const gate = createGate(2)
  let running = 0, maxRunning = 0
  const order: number[] = []
  await Promise.all([0, 1, 2, 3, 4, 5].map(async i => {
    const release = await gate()
    running++; maxRunning = Math.max(maxRunning, running)
    order.push(i)
    await new Promise(r => setTimeout(r, 30))
    running--
    release()
  }))
  assert.ok(maxRunning <= 2, '最大并发不该超过上限，实际 ' + maxRunning)
  assert.equal(order.length, 6, '全部都要跑到')
})

test('闸门: release 幂等  重复调用不让计数失衡', async () => {
  // **重复 release 会让计数失衡，闸门越放越宽**  那是"闸门失效"的经典形态。
  const { createGate } = await import('../src/argo-gate.ts')
  const gate = createGate(1)
  const r1 = await gate()
  r1(); r1(); r1()   // 多余的三次
  let running = 0, maxRunning = 0
  await Promise.all([0, 1, 2].map(async () => {
    const rel = await gate()
    running++; maxRunning = Math.max(maxRunning, running)
    await new Promise(r => setTimeout(r, 10))
    running--
    rel()
  }))
  assert.equal(maxRunning, 1, '幂等生效时仍是严格串行，实际 ' + maxRunning)
})

test('闸门: 异常路径必须释放  **在 finally 里调 release**', async () => {
  // 若抛错时不释放，一次异常会永久占一个槽位，闸门逐渐堵死。
  const { createGate } = await import('../src/argo-gate.ts')
  const gate = createGate(1)
  // 模拟 fetcher 的写法: await gate → try { 抛错 } finally { release }
  const task = async (shouldThrow: boolean) => {
    const release = await gate()
    try {
      if (shouldThrow) throw new Error('boom')
      return 'ok'
    } finally { release() }
  }
  await assert.rejects(() => task(true))
  // **抛错之后闸门必须还能放行**  否则就是堵死了
  assert.equal(await task(false), 'ok', '异常后闸门仍要能工作')
})


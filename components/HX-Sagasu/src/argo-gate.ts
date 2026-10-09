/**
 * argo 会话的**并发闸门**。
 *
 * ## 为什么需要它（2026-09-18 实测）
 *
 * 实测对照:
 *
 * | 模式 | 结果 |
 * |---|---|
 * | **串行 5 个请求** | 每个 500-1600ms，**全部成功** |
 * | **并发 31 个请求** | **25 秒只成功 3 个**，28 个超时 |
 *
 * 根因: **argo 的 MCP server 是串行处理的**（`mcp_server.py` 是单线程读 stdin 循环）。
 * 并发打进去的请求全部堆在管道/队列里，而每个 `call` 各自带着自己的超时计时器 
 * **先超时的先死，活下来的只是排在最前面的几个。**
 *
 * 而我们的第 1 层恰好有 **31 个来源**同时发起  于是 90% 的请求注定超时。
 * **这不是 argo 坏了，是我们的调用方式与它的处理模型不匹配。**
 *
 * ## 做法: 把并发改成有界串行
 *
 * 闸门限制**同时在飞的请求数**（默认 4）。超出的排队等。
 *
 * **为什么是 1 而不是 4**（我先写了 4，实测推翻了它）: 直觉上"限流到 4"能在
 * 吞吐与延迟间取折中。**实测: 限流 4 反而比完全串行更差** 
 * \`\`\`
 *   闸门=4:  31 个请求 → 成功 15 / 失败 15，耗时 133s
 *   串行:   12 个请求 → 全部成功，      耗时  90s
 * \`\`\`
 * 原因: argo 的 MCP server 串行处理，**并发反而让它内部退化成极慢** 
 * 连本来 0.1-1.2 秒的健康引擎也开始超时。
 * **它不接受任何并发。** 所以闸门取 1。
 *
 * **上限是常量而不是配置项**: 它由 argo 的实现决定（串行），
 * 不是我们的运行时偏好。做配置只会多一个"没人会去读"的隐式分支 
 * 而当 argo 改成并发处理时，这个值**要跟着改**（改在代码里更容易被发现）。
 */
export const ARGO_CONCURRENCY = 1


/**
 * 有界并发闸门。`acquire()` 返回一个 `release` 函数。
 *
 * **必须能被 `finally` 释放**  否则一次异常会永久占用一个槽位，
 * 让闸门逐渐变窄直到完全堵死。
 
 * .agents/notes/implemented/architecture/2026-09-18-gate-and-missing-code.md
 */
export function createGate(limit: number = ARGO_CONCURRENCY): () => Promise<() => void> {
  let running = 0
  const queue: Array<() => void> = []
  return async () => {
    // **醒来后必须重新检查**（2026-09-18 实测抓到的惊群）。
    //
    // 此前是 `if (running >= limit) await once`  而 `release()` 会连环唤醒:
    // 一次 release → next() → 被唤醒者的 resolve 排进微任务 → 它 `running++`
    // → 但它自己的 `release()` 又唤醒下一个……
    //
    // **在 limit=1 时这仍然是错的**: 实测闸门放行时刻**
    // ```
    //   +10624ms running=1     ← 第 1 个（成功）
    //   +25635ms running=1     ← 第 2 个
    //   +25635ms running=1     ← 第 3 到第 11 个，**同一毫秒**
    // ```
    // `running` 计数看着是对的（闪进闪出），但 **9 个请求在同一刻被放出去**
    // 而 argo 的 MCP 是串行的，于是它们**同时**等同一个 15 秒握手超时、**同时**失败。
    //
    // 修法是经典的"醒来后 while 重检": 用 `while` 而不是 `if`，
    // 且唤醒者只在**确实有位置**时才 pop。
    while (running >= limit) {
      await new Promise<void>(resolve => queue.push(resolve))
    }
    running++
    /**
     * argo 会话不接受并发  闸门、分档超时、兜底裁剪
     * .agents/notes/implemented/architecture/2026-09-18-argo-serial-gate.md
     */
    let released = false
    return () => {
      // **幂等**: 重复 release 会让计数失衡，闸门越放越宽
      if (released) return
      released = true
      running--
      // **只在有空位时才唤醒**，且只唤醒一个  避免惊群
      if (running < limit) {
        const next = queue.shift()
        if (next !== undefined) next()
      }
    }
  }
}

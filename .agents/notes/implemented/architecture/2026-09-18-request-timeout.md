# Agent Note: 请求必须有超时  CLI 挂死的真因是"永不 settle 的 Promise"

Status: implemented

- 影响: `components/HX-Sagasu/src/argo-source.ts`（`send` 加超时清理 + 握手 15s 超时）

## Problem

**CLI 在 `--min-hits 20` 时挂死**，表现为：

```
$ node scripts/sagasu.ts search "durov telegram" --tier 1 --limit 2 --min-hits 20
Warning: Detected unsettled top-level await at .../sagasu.ts:713
if (sub === 'search') code = await cmdSearch()
exit=13          ← ERR_UNSETTLED_TOP_LEVEL_AWAIT
stdout: 0 字节   ← **一行都没输出**
```

**复现条件精确**：`min-hits 5` 正常（exit=0）、`20` **必挂**。原因是
`min-hits ≥ 20` 迫使召回**下降第 1 层**（第 0 层只有 13 条），
而第 1 层有 31 个来源**并发打同一个 argo 会话**。

**第 0 层单独跑时永远不会触发**  这正是它此前没被发现的原因。

### 找到它的过程（值得记，因为走了很长的弯路）

我按"句柄泄漏"的方向查了很久：确认子进程确实死了（`ps` 查无）、
检查 Node 活跃句柄（剩 2 个 = **fd 1/2 标准流，它们不阻止退出**）、
写了最小复现（正常退出）。

**每一次"排除"都是必要的，但方向从一开始就错了。** 真正让我转向的是：

1. **分离 stdout/stderr 捕获**  发现 `exit=13` 且 **stdout 为空**。
   此前用 `| tail -8` 看输出，**stdout 与 stderr 混在一起**，只看到那句 warning，
   读成了"挂住不动"。**分离后立刻看出是"提前退出"而不是"挂死"。**
2. **二分参数**  `min-hits 5/20/50/100` 逐个试，精确定位到"必须下降层"这个触发条件。
3. **给 CLI 插探针**  发现 `cmdSearch` 连第一行探针都没走到，
   说明卡在 `recall` 之前的某个 `await`。

## 根因

`call()` 的实现是：

```js
async call(name, args, timeoutMs) {
  await ready                       // ← 握手
  const raw = await Promise.race([
    send({...}),
    new Promise((_, rej) => setTimeout(() => rej(new Error(超时)), timeoutMs)),
  ])
```

看起来**有超时**。但两个漏洞：

1. **`ready` 握手用的是 `send` 的默认超时（90s）**，而 `call` 第一行就 `await ready` 
   **握手一旦不响应，所有调用一起等 90 秒**。
2. **`send` 的 Promise 在超时后仍留在 `waiters` 里**（`Promise.race` 只让外面的 race 结束，
   里面的 `send` 依然 pending，且 `waiters` 条目不清理）。

实测报错正是：`argo 请求超时 90000ms（id=1，method=initialize）`。

## Decision

**`send` 加自己的超时与**两条路都清理**；握手用**独立的短超时**。**

```js
const send = (obj, timeoutMs = 90_000) => {
  const settle = (fn) => (v) => { clearTimeout(timer); waiters.delete(id); fn(v) }
  const timer = setTimeout(() => {
    waiters.delete(id)
    reject(new Error(\`argo 请求超时 \${timeoutMs}ms（id=\${id}，method=\${...}）\`))
  }, timeoutMs)
  waiters.set(id, settle(resolve))
}
```

**握手 15 秒**（argo 的 warm-core 实测约 400ms，15 秒宽到不会误杀、短到不会让人以为程序挂了）。

**超时错误带 `id` 与 `method`**  否则"超时了"无法定位是哪个请求。

## Alternatives considered

- **只加握手超时，不改 `send`**：改动更小。**否决理由**：**`waiters` 泄漏仍在**  每次超时都留一个死条目（闭包持着 resolve 与对象引用）。而"反复超时"在长会话里是常态。
- **给 `send` 加超时但不清理 `waiters`**：能解决挂死（race 会 reject）。**否决理由**：**留着死条目意味着"那个 id 永远不会被复用"是对的，但内存与错误定位都会累积**。而且**清理必须两条路都走**（成功与超时） 这需要一个 `settle` 包装，不能只在超时分支删。
- **把超时做成可配置的环境变量**：更灵活。**否决理由**：**默认值必须是对的**。当前两组默认（握手 15s / 请求 90s）都有实测依据；加环境变量会多一个"没设就走默认"的隐式分支，而**没人会去读它**。
- **改成 kill 子进程再重建会话**（超时即重启）：更彻底。**否决理由**：那会让**一次慢响应毁掉后续所有调用**（重建要重新握手）。而且当前证据表明 argo 侧确实偶发不响应  **它不是一个"坏了要重启"的问题，是"某些请求不该无限等"的问题**。
- **不修，改用 `--min-hits` 的保守默认（如 5）**：绕开触发条件。**否决理由**：**那是把 bug 藏起来**。`min-hits` 是用户可调的，而且"下降层"是这套架构的**正常行为**  任何让第 0 层不足的查询都会触发。**绕开一个必然发生的路径，等于承认它坏着。**
- **只写测试不改实现**：确认问题存在。**否决理由**：**测试会红**（而且红 90 秒）。实现修好之后测试才有意义。

## Consequences

- **CLI 不再挂死**：`exit=13 → exit=0`，stdout 从 0 字节 → 5479 字节。
- **超时让真因可见**：现在报 `argo 请求超时 15000ms（id=1，method=initialize）` 
  **这暴露了一个此前被挂死掩盖的事实：argo MCP 的握手在本机偶发不响应。**
  那是 argo 侧的问题，而**我们的修复让它从"挂死"变成"这条来源失败"** 
  这正是全组件的失败契约（失败必须响亮）。
- **`send` 的默认超时 90s，握手 15s**  两处都有实测依据。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **274 tests / 274 pass / 0 fail**（新增 2 条）
- **CLI 实测（修复前 → 后）**：
  ```
  修复前: exit=13 | stdout 0 字节 | warning: unsettled top-level await
  修复后: exit=0  | stdout 5479 字节
  ```
- **新增 2 条测试**：用一个**不回应任何请求**的假子进程，
  断言"必须超时 reject"与"反复超时不泄漏"。**两条都真的会等超时**（各 90 秒），
  这是**有意的**  它们验证的正是"时间维度上的行为"。
- **参数二分实测**：`min-hits 5` 正常、`20/50/100` 全挂 → 精确定位到"必须下降层"这个触发条件

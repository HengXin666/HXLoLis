# Agent Note: 接上界面里那条「死事件」 `source-started` 此前服务端发、页面不收

Status: implemented

Decision-ID: dead-event-wired


## Code

- `components/HX-Sagasu/scripts/page.ts`

## Problem

本轮做交付前的界面实测，发现**一条已经发了 9 轮、而没人接收的事件**:

```
服务端 SSE 流实测（/api/search）: 11 条 "kind":"source-started"
页面 page.ts:                  grep -c source-started → 0
```

**这条事件的用途正是它被加进来时的理由**（`RecallEvent` 的注释）:
与 `elapsedMs` 配合，**区分「这个来源慢」与「这个来源在排队」**。

而 `elapsedMs` 是**从这一层开始算**的  它把排队时间也算进去了。
实测某个来源 `elapsedMs=33028` 而真实网络耗时只有 975ms，**其余 32 秒全在闸门后面排队**。

**页面只能显示 `elapsedMs`，于是那 32 秒被当成了「这个来源慢」**  而它是被冤枉的。

## Decision

### 一、页面消费 `source-started`，记下进入时刻

在事件分支里加一支，把 `at` 存进 `started` 表；`source-settled` 时取出来用。

### 二、显示时**并列**两个耗时（而不是替换）

```js
timing = (queued > 1000 && queued > detail.elapsedMs)
  ? detail.elapsedMs + 'ms (排队 ' + queued + 'ms)'
  : detail.elapsedMs + 'ms'
```

**判据**: 只在**排队占大头**时才附加显示  否则这条附加信息会成为噪声。
两个都在，是因为**它们分别是不同的成本**（自己慢 vs 等别人），不是同一个量的两种写法。

## Alternatives considered

**什么都不做 / 复用现有。** 最强理由是无需新增实现和维护成本. 现有状态仍存在 Problem 中的具体缺口, 因此采用本记录的选择

- **用 `startedAt` 替换 `elapsedMs`**：更简洁。**否决理由**：**两者是不同的量**  `elapsedMs` 是 recall 内部算的层内耗时，`Date.now() - startedAt` 是墙钟差（含队列）。换掉会丢掉「这一层跑了多久」这个信息。
- **总是显示排队时间**：信息更全。**否决理由**：**大多数来源不排队**，无条件显示会让每行都挂一个「排队 0ms」，把真正的异常淹没掉。
- **在服务端把两个时间算好一起发**：页面更薄。**否决理由**：**排队是「相对于其他来源」的概念**，而服务端在逐条发出时并不知道全局  它要在所有来源落定后才算得出来。而那时用户已经在看了（渐进式界面就是要**实时**）。
- **不管它，因为界面「能用」**：改动最小。**否决理由**：**界面能用，但它在撒谎**  把「排队 32 秒」显示成「这个来源慢 32 秒」，是**把系统的调度问题归咎于来源**。
- **回退那条事件（不再发）**：省掉页面改动。**否决理由**：**CLI 的 `--explain` 正在用它**，而且它是唯一能区分慢与排队的信号。

## Consequences

- **界面现在能如实区分「慢」与「排队」**  与 CLI 的 `--explain` 语义一致。
- **`source-started` 不再是死事件**。

## 一次值得记的踩坑（改错层）

我给 `page.ts` 加注释时用了 TS 风格的**反引号**，结果 **serve 直接启动失败**:

```
SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expected a semicolon
  at scripts/page.ts:150
```

**根因**: `page.ts` 整体是一个 `String.raw` 模板串（`export const PAGE = String.raw` + 反引号），
**它的内部不能出现未转义的反引号**  会提前终止字符串。

**我改的是「JS 源码」，而实际是「模板串内容」**  两者的转义规则不同。
教训: **改一个文件之前先看它是「代码」还是「装代码的字符串」。**

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **311 tests / 311 pass / 0 fail**
- **界面实测**（`HX_SAGASU_PORT=8790`）: `HOME 200 / 20788 bytes`；`source-started` 处理 5 处；排队显示逻辑 1 处
- **SSE 流实测**（`/api/search?q=Rust 所有权`）: **24280 字节**
  ```
  11 source-started | 11 source-settled | 2 tier-skipped
   1 tier-start     |  1 tier-end        | 1 done
  ```
- **API 实测**: `/api/sources` 200/3101B、`/api/platforms` 200/5730B

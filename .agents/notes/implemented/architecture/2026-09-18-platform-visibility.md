# Agent Note: 平台可用性必须可见  以及一个"判据选错"的测试

Status: implemented

Decision-ID: platform-visibility


## Code

- `components/HX-Sagasu/scripts/page.ts`
- `components/HX-Sagasu/src/adapters/registry.ts`

## Problem

目标第 (2) 项是"支持私域/垂直社区平台接入"，而现实是 **12 个平台里 2 个可用**。
这个事实此前**只写在代码注释里**，于是界面上：

- "这个平台搜不到"
- "这个平台不可用"

**长得一模一样。而它们是完全不同的两件事**  前者是结果问题（换个词再试），
后者是能力问题（这条路没走通，且已经知道为什么）。

## Decision

### 一、用 argo 的 140 个引擎**复核**平台判定

此前那些 `blocked-*` 判定只基于**我们自建的直连适配器**。本轮把 argo 的引擎
按平台名探了一遍，得到**同一结论但更硬的证据**：

| 平台 | argo 有引擎吗 | 实测 |
|---|---|---|
| 微博 | ✅ `weibo` | **0 条**（多组查询） |
| X.com | ✅ `twitter` + `fxtwitter` | **均 0 条** |
| Reddit | ✅ `reddit` | **0 条** |
| 微信公众号 | ✅ `wechat_sogou` | **0 条** |
| 贴吧/小黑盒/YouTube | ❌ argo 也没有 | 原判定成立 |

**两条独立路径（我们自建 + argo 引擎）都失败**  这比单侧判定可信得多。

### 二、微博那条挖到了真因，且它印证了 argo 的已知缺陷

`weibo_engine.py` 直连 `m.weibo.cn/api/container/getIndex`。
实测该端点 **HTTP 200 + 10KB 内容**，但内容是 **Sina Visitor System 访客验证页（HTML 而非 JSON）**
→ `json.load` 抛异常 → 引擎吞掉 → 上层看到"0 条"。

> **它不是"没有结果"，是被风控  而它把这两件事报成了同一个样子。**

这正是 argo 被反复报告的那个病（`safe_search` 把异常吞成空结果），
也是本项目从第一轮就在防的形态。`2026-09-18-argo-source-reading.md` 里记过，
**本轮在微博这个具体平台上抓到了它的活体样本。**

### 三、`/api/platforms` + 界面面板

每条带 `evidence`（一手实测）与 `unlock`（接上它需要什么）。
**判定必须能追溯到某次具体测量**  这是本项目对"未实测的假设"的一贯拒绝。
`unlock` 同样重要：不写它，下一个人只会重走一遍已经走过且失败的路。

## Alternatives considered

**什么都不做 / 复用现有。** 最强理由是无需新增实现和维护成本. 现有状态仍存在 Problem 中的具体缺口, 因此采用本记录的选择

- **把这些判定留在代码注释里**：省掉一个端点和一块 UI。否决理由：**注释不会出现在任何人的屏幕上**。而"12 个平台只有 2 个可用"是**决策级事实**  它决定了第 (2) 项需求的现实进度。埋在 `registry.ts` 第 90 行，等于没写。
- **只在 CLI 加一个 `sagasu platforms` 子命令**：实现更省。否决理由：**界面才是"让人看见"的地方**。CLI 输出是一次性的、滚过就没了；面板是**常驻的静态现实**，随时可看。两者不冲突  但先做面板。
- **面板只显示状态标签（ready/blocked）**：更简洁。否决理由：**"blocked-anti" 这个词对人没有信息量**。真正有用的是"2026-09-18 实测：端点返回 200 但内容是访客验证页"  那才能让人判断"要不要再试一次"。
- **不显示 `unlock`**：面板更短。否决理由：**不写解锁条件，下一个人只会重复劳动**。这一轮我自己就在重走上一次的路（去探 argo 的引擎），如果上次的结论里写了"argo 也没有这些引擎"，能省掉这一轮的一部分工作。
- **删掉重复的 X.com 条目后不改测试判据**：反正重复已经没了。否决理由：**判据错了，同样的重复会再发生**。见下。

## 一个"判据选错"的测试（本轮最值得记的）

补实测结论时我给 X.com 加了**第二条**记录（`platform: 'twitter'`），
而原有条目用的是 `platform: 'x'`  **同一平台两条记录，`coverage()` 把它算了两次**。

我写了一条测试来防这个：

```js
const seen = new Map()
for (const p of PLATFORMS) seen.set(p.platform, (seen.get(p.platform) ?? 0) + 1)
const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
assert.deepEqual(dupes, [], ...)
```

**它通过了。而重复还在。**

因为两条记录的 `platform` 分别是 `'x'` 与 `'twitter'`  **字符串不同，
按 `platform` 去重的判据根本看不见这个重复**。

> **判据选错 = 测试在守卫一个不存在的问题。**
> 它给出的绿色信号比没有测试更危险：让人以为这个类别的错误已经被防住了。

改成按 `label` 去重（同一平台的人类可读名不会因键名不同而变化），并**追加一条
专门锁住 X.com 只有一条**的测试  因为它的键名历史上就是两种写法。

**这与第 18 轮"测试锁住了一个错误结论"是同一族问题的不同形态**：那次是测试的内容错了，
这次是测试的**判据**错了。

## Consequences

- **平台登记 13 → 12 条**（去重后），`coverage()` 不再重复计数。
- **`/api/platforms` 返回 `{ coverage, platforms }`**，每条含 `evidence` 与 `unlock`。
- **界面顶部常驻平台面板**：`平台可用性 2/12 可用` + 每张卡片带实测依据与解锁条件。
- **未做**：CLI 的 `platforms` 子命令；把那 4 条 `blocked-anti` 平台真正解锁
  （都需要登录态或第三方服务，属独立决策）。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **228 tests / 228 pass / 0 fail**
- **端点实测**：`curl /api/platforms` → `total: 12 | ready: 2`，X 条目只有 `['x']`
- **界面实测**（无头 Chromium + CDP，DOM 探针）：
  `{"panel":true,"items":12,"head":"平台可用性 2/12 可用","first":"B站 ready 2026-09-16 实测…"}`，
  **无 JS 异常**
- **新增 3 条一致性测试**：按 `label` 去重、`coverage` 各状态之和等于总数、
  每条非 ready 平台必须有 `evidence` 与 `unlock`

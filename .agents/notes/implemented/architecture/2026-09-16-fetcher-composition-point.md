# Agent Note: 取数函数的统一组装点  适配器路径从未接线

Status: implemented

Decision-ID: fetcher-composition-point


## Code

- `components/HX-Sagasu/src/fetchers.ts`

## Problem

上一轮修掉"第 1、2 层登记了却没有实现"之后，我按同样的怀疑去查**每条实现路径到底有没有接线**，发现最后一处同类缺陷。

三条实现路径各自导出取数函数，而**没有任何地方把它们合并**（实测确认：全仓库搜 `composeFetchers` 零结果，`authoritativeFetchers()` 只在测试里被调用过）：

| 路径 | 导出 | 覆盖 |
|---|---|---|
| `authoritativeFetchers()` | `authoritative.ts` | 第 0 层 11 个原生 HTTP 实现 |
| `argoFetchers(session)` | `argo-source.ts` | 第 1、2 层的 argo 引擎 |
| `adapters/` | 各适配器 | B站 search+thread、Telegram thread |

**结果：适配器那一路从未被接进召回。** `SOURCES` 里登记了 `bilibili`，调用方以为它在工作实际跑的是 argo 引擎，而适配器（**能取评论区两层结构、即"对话式语义"在 B站的唯一来源**的那个）一行都没执行。

这与第 12 轮修的是**同一个病的最后一处**：登记表说"有"，实际路径说"没有"。

**而且我上一轮加的检测测试不完整。** 它写成：

```ts
const both = Object.keys(ARGO_ENGINE).filter(id => id in AUTHORITATIVE_SOURCES)
assert.deepEqual(both, ['juejin'], ...)
```

只比对 **argo ∩ authoritative**，漏掉了适配器这一路而 `bilibili` 正是**适配器 + argo 双路**，于是它逃过了检测。

> **一个只覆盖三条路里两条的检测，比没有检测更危险**：它给出"重叠已经检查过了"的错觉。

## Decision

**新增 `src/fetchers.ts` 作为唯一的取数组装点**，把"哪条路优先"从注释和记忆变成**数据**。

1. `SOURCE_PLAN`  来源 → 实现路径 + 主次 + **理由**。每条 reason 必须能指向一条实测证据。
2. `planFetchers({available})`  按计划解析出可喂给 `recall()` 的表，**未接线的来源进 `missing` 而不是静默消失**。
3. `adapterFetchers(adapters)`  把适配器包成取数函数；**能力检查在组装期完成**（`search=false` 直接拒绝，并指出应该用 `thread()`）。
4. `composeFetchers(...tables)`  合并多张表，**冲突抛错不静默覆盖**。
5. `fallbackPaths(sourceId)`  取备选路径，供调用方**显式**组装降级链。

**关键取舍：不做运行期自动降级。** 主路模块缺失时来源进 `missing`，不允许备选悄悄接管。

## Alternatives considered

- **什么都不做，让 `bilibili` 继续跑 argo**：argo 的 B站引擎**实测是能用的**（`engines_used=["bilibili"]`、返回真实 BV 号），所以"能用"这一条成立。否决理由：**丢掉的是 `thread()`**评论区两层结构（顶层评论 + 楼中楼）是"对话式/论坛语义"在 B站的具体形态，也是本项目第 (3) 项需求的直接来源。用 argo 意味着**永久放弃这条数据**，而它已经写好并测过了。
- **让 `bilibili` 走"适配器失败时自动降级到 argo"**：可用性最高，两条路互相兜底。否决理由：**降级会让调用方无法区分"主路坏了"与"主路没有内容"**正是本项目从第一轮就在防的那个病。要降级必须显式：`fallbackPaths()` 把备选交出来，由调用方决定何时启用。
- **用优先级数字（`priority: 1, 2, 3`）代替 `rank: 'primary'|'fallback'`**：更灵活，能表达三条以上的路。否决理由：本项目**没有任何来源有三条以上实现**，而数字会立刻招来"能不能把某条调成 1.5"这类问题。两态是当前真实的复杂度，不要预先泛化。
- **让 `composeFetchers` 支持"后者覆盖前者"的优先级语义**：调用方写起来更短（`composeFetchers(base, overrides)`）。否决理由：那样"哪一份实现在跑"就取决于**参数顺序**，而没有人会去读参数顺序。冲突抛错把问题推回给调用方它必须显式回答"我要哪个"。
- **把适配器直接塞进 `authoritativeFetchers()`**：少一个文件，改动更小。否决理由：`authoritative` 的语义是"公域权威平台"，把 B站/Telegram 混进去会让那条边界失效而"权威性来自机构责任与持久标识符"是第 0 层存在的全部理由。**组装点应该在外面，而不是让一个模块同时承担两种语义。**
- **只修那个不完整的检测测试，不建组装点**：改动最小，也能让"bilibili 双路"变得可见。否决理由：可见之后仍然要回答"用哪个"，而**没有组装点就没有地方回答这个问题**。测试能让问题显形，不能让路径接通。

## Consequences

- **B站适配器第一次真正进入召回**。端到端实测（真网络）：第 1 层 6 条，含 `bilibili: [最后一次入门Rust]#13：所有权`。
- **`juejin` 走实测更强的原生实现**（20 条 vs argo 的缓存风险），argo 降为显式备选。
- `missing` 让"未接线"从**不可见**变成**一个数组**。`planFetchers` 端到端实测 `missing: (无)`  四条主路全部接通。
- **检测测试的范围修正为三种模块**（authoritative / argo / adapter），并新增 `DUAL_PATH` 登记表把"允许的重叠"写死。**这个测试现在能抓到 `bilibili` 了**（上一版抓不到）。
- `SOURCE_PLAN` 与测试里的 `IMPL_OWNER`、`DUAL_PATH` **是同一事实的三份表达**（静态归属 / 允许的重叠 / 运行期主次）。这是冗余，但它防的是三种不同的失败已知的代价，未合并。
- **新增一条未解决的事**：`telegram-public` 现在有了取数实现（走适配器），但它的搜索要求查询写成 `<频道名> <关键词>`，而 `recall` 传下来的是用户的原始查询。**跨平台查询改写**（把用户的查询转成每个来源各自接受的语法）还没有机制这是下一个待办。
- **`adapterFetchers` 把 `createdAt` 塞进 `snippet`** 作为日期提示。这是权宜：`SourceHit` 没有 `createdAt` 字段，而适配器给了。**正确做法是给 `SourceHit` 加字段**，但那会动到第 0 层全部实现**记在这里，不假装它是干净的。**

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **160 tests / 160 pass / 0 fail**（新增 14 项）
- **端到端真实网络验证**：`planFetchers` 接齐三模块 → `missing: (无)` → `recall('Rust 所有权')` 第 1 层 6 条，含 B站真实视频与掘金原生结果
- **检测范围修正的有效性验证**：修正前测试断言 `both === ['juejin']`（漏 bilibili），修正后 `DUAL_PATH` 含 `bilibili` 且新增一条测试锁住"适配器路径确实被检测到"
- 新增测试覆盖：SOURCE_PLAN 覆盖全部非权威来源、rank 组合合法（恰好一个 primary）、理由非空、`bilibili` 主路是适配器、`juejin` 主路是原生、模块缺失进 missing、模块有但来源缺进 missing、全齐时 missing 为空、**主路缺失不自动降级**、能力检查在组装期、createdAt→snippet、冲突不静默覆盖、端到端失败带平台类别
- **一条自身判断被推翻并已收回**：本轮我曾判定"`authoritative-tech.ts` 是工厂、`authoritative.ts` 是直接实现，两种调用约定并存"复核实测后两处**全部是同一工厂约定**（arity 皆 0，无参调用一律返回 function）。我把"没看清签名就传参"误记成了"设计缺陷"，已就地更正。

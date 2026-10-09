# Agent Note: 不适用 ≠ 失败  来源的作用域声明

Status: implemented

Decision-ID: applicability-is-not-failure


## Code

- `components/HX-Sagasu/src/recall.ts`
- `components/HX-Sagasu/src/adapters/adapter.ts`

## Problem

上一轮把 `telegram-public` 接进取数层之后，实测发现**它在每一次普通召回里都失败一次**：

```
recall('Rust 所有权') → 第1层 6条 | 失败: telegram-public=telegram/unsupported
```

原因不是它坏了，而是**它不适用于这个查询**：Telegram 只有频道内搜索（`t.me/s/<ch>?q=<term>`），没有全站搜索（`t.me/s/?q=` 返回 302）。裸查询交给它，必然被拒绝。

**危害在于 failures 的语义被稀释。** `TierOutcome.failures` 存在的理由是"哪里坏了，去看看"而一个**每次都会出现、且注定会出现**的条目会训练人忽略整个 failures 列表。真正的故障（网络断了、凭证过期、接口改版）会淹在噪声里。

这与本项目反复踩的形态**相反但同源**：以前是"失败被伪装成成功"，这次是"不适用被伪装成失败"。两者都让一个信号失去意义。

## Decision

**新增"作用域"这一维到能力声明里，并在发出请求之前判定适用性。**

1. `AdapterCapabilities.searchScope?: 'none' | 'channel'`  缺省 `'none'`（吃原始查询）。
2. `SourceDescriptor.requiredScope?: readonly string[]`  **声明在来源上而不是藏在取数函数里**，因为召回层需要在调用之前就知道，不能靠调用后读错误信息。
3. `RecallContext.scope?: readonly string[]`  调用方提供本次检索的作用域。
4. 召回循环在取数**之前**判定：需要作用域而 `ctx.scope` 为空 → 记 `kind: 'not-applicable'`，**不发出请求**。
5. `adapterFetcherEntries()` 返回带 `searchScope` 的条目；`adapterFetchers()` 保留为便捷包装，并在文档里写明**它会丢掉作用域信息**。

## Alternatives considered

- **什么都不做，让 Telegram 每次召回失败一次**：改动最小，而且失败是**如实的**它确实没能回答这个查询。否决理由：**failures 列表的价值来自"里面每一条都值得看"**。加入一个必然出现的条目，等于让这个列表从"故障清单"退化成"已知噪声清单"。这就是告警疲劳的成因，代价在几个月后才显现，那时已经没人读 failures 了。
- **让 Telegram 自己处理裸查询：返回 `[]` 而不是抛错**：最省事，调用方什么都不会看到。否决理由：这是**把"不适用"伪装成"没有内容"**正是本项目第一轮就否决的 argo `safe_search` 形态。而且它比原来更糟：用户会以为"Telegram 上关于 Rust 所有权确实没有讨论"。
- **在 `RecallContext` 里传一个 `scopeBySource` 映射**（每个来源各自的作用域）：更灵活，能表达"Telegram 查 A 频道、别的来源查 B"。否决理由：**当前没有这个需求**，而它会立刻招来"没给某个来源配作用域时算失败还是不适用"这类边界问题。现在需要的是一个**布尔式**的"本次检索有没有作用域"，不要预先泛化。
- **把适用性判定放在 `fetchers.ts`（组装层）而不是 `recall.ts`**：组装层已经知道每个适配器的 `searchScope`，放那里更内聚。否决理由：`SOURCE_PLAN` 是**静态表**，而作用域是**每次调用不同的**组装层拿不到本次查询的 `ctx.scope`。判定必须发生在有 `ctx` 的地方，也就是召回循环。
- **复用 `AdapterFailureKind` 的 `'unsupported'`**（不加新类别）：少一个字符串，少一处改动。否决理由：`unsupported` 的含义是"**这个平台/这个操作**永远不支持"，而不适用是"**这次查询**用不上它"。前者导致"以后别再试了"，后者导致"给它作用域就行"**行动建议完全相反**。测试里专门断言了不许复用。
- **让 `requiredScope` 留空就算"永远适用"**（不做缺省处理）：更简单。否决理由：那会把 11 个第 0 层来源全部变成"需要作用域"或"需要逐个补空数组"。`undefined` = `'none'` 是**正确的缺省**，因为绝大多数来源确实吃原始查询。

## Consequences

- **裸查询下 Telegram 不再产生失败**：实测 `recall('Rust 所有权')` → 第 1 层 6 条、失败为 `telegram-public=not-applicable`；`failures` 里其他条目（真故障）现在不会被淹没。
- **带作用域时它真的工作**：`recall('durov telegram', {scope:['channel']})` → 第 1 层 9 条、**零失败**，含真实 Telegram 消息（`t.me/durov/525`）。
- `not-applicable` 是**新增的第三类失败记录**（前两类：`unwired` 未接线、`<platform>/<kind>` 平台失败）。三者语义分离：没接线 / 用不上 / 出错了。
- **`ctx.scope` 目前没有调用方会传**  本轮只把机制建好并验证。真正传它需要对"用户查询里的频道名"做识别（`durov telegram` → scope=`['durov']`），**这是下一个待办，本轮没有做**。
- `adapterFetchers()` 与 `adapterFetcherEntries()` 并存是**已知的冗余**：前者会丢掉作用域信息，用一个必然失败的例子换 API 简洁。文档里写明了，但它仍是一个**未来会被误用的入口**。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **164 tests / 164 pass / 0 fail**（新增 4 项）
- **真网络端到端**：裸查询 → `telegram-public=not-applicable`、第 1 层 6 条；带 `scope:['channel']` → 第 1 层 9 条、零失败、返回 `https://t.me/durov/525` 等真实消息
- 新增测试：裸查询下是不适用而非失败、给出作用域后真的被调用、不需要作用域的来源不受门控影响、`adapterFetcherEntries` 暴露 scope 而 `adapterFetchers` 丢掉它
- **一处失败的自省**：本轮第一次用 Python 脚本做三处替换时，第三个锚点因引号转义不匹配而**静默失败**测试仍然全绿，因为缺的只是那条判定。**是随后的行为验证（`not-applicable` 没出现）抓到了它，而不是测试。** 教训: 脚本化编辑后必须**验证行为**，不能只看测试是否通过"没报错"与"改动生效"是两件事。
- **一条差点写下的错误结论**：实测 `github`/`wikipedia` 引擎在相近查询下返回了与 `reddit` 相同的域名分布，我一度判定"引擎路由错误、来源标签与内容不符"。用**无意义查询**复测后，四个引擎**全部返回 0 条**  说明它们确实各自去查了真实数据源。相同结果是**语义相近查询的合理重合**，不是错误路由。**教训与第 11 轮的缓存假象同类: 一次被污染的测量会产出一个听起来很具体、且有"实测数据"支撑的错误结论。**

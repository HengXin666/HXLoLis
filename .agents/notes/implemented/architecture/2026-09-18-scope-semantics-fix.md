# Agent Note: 作用域的判据  同一个字段曾有两份互相矛盾的实现

Status: implemented

Decision-ID: scope-semantics-fix


## Code

- `components/HX-Sagasu/src/recall.ts`

## Problem

用户写 `durov telegram`（**合法的**频道作用域查询，适配器自己能解析出频道名），
实测却得到：

```
failure: telegram-public not-applicable
  来源「telegram-public」需要作用域 channel（如频道名），本次查询没有提供
```

**适配器从未被调用。**

### 根因：两份互相矛盾的理解

| 位置 | 判据 | 对错 |
|---|---|---|
| `adapters/adapter.ts` 的 `isApplicable` | `scope !== undefined && scope.length > 0` | ✅ **对的** |
| `recall.ts` 的判定 | 要求 `ctx.scope` **字面包含** `'channel'` | ❌ **错的** |

实测三种 `ctx.scope` 写法：

```
["channel"]（能力标签）        → ✅ 被调用
["durov"]（频道名）           → ❌ 未调用 (not-applicable)
["telegram","durov"]         → ❌ 未调用 (not-applicable)
```

**只有恰好传 `['channel']` 这个内部能力标签才通过  而那是测试里的写法，
真实调用方自然会给频道名。**

而**适配器根本不需要频道名在 `ctx.scope` 里** 
`adapters/telegram.ts` 的 `splitScopeQuery` 从 **query 字符串**里解析它
（`durov telegram` → `{channel: 'durov', keyword: 'telegram'}`）。

所以 `ctx.scope` 的正确语义是「**调用方确认这次查询有作用域**」，而不是
「作用域叫什么名字」。

## Decision

**判据改为"有没有提供作用域"**（`provided.length === 0` 才跳过），
具体内容交给适配器解析。

**同时改进了消息措辞**：从"（如频道名）"改成"（如「频道名 关键词」的写法）"
**告诉用户怎么写**，而不只是说缺什么。

## Alternatives considered

**什么都不做 / 复用现有。** 最强理由是无需新增实现和维护成本. 现有状态仍存在 Problem 中的具体缺口, 因此采用本记录的选择

- **把测试改成传 `['durov']`，让 `recall` 的判据不变**：改动最小。**否决理由**：**那会把 bug 固化进测试**。真实调用方给的就是频道名，测试顺着错实现写只会让它更难被发现。**测试要照真实用法写**（这与第 26 轮"测试断言必须照着实测写，否则测的是我的想象"是同一族，方向相反但道理相同）。
- **让 `requiredScope` 的语义变成"必须是这些值之一"**（即承认 `['durov']` 非法）：保持现有实现。**否决理由**：**频道名是无界的**，不可能枚举进 `requiredScope`。而且 `isApplicable`（另一份实现）已经用"非空即适用"表达了正确的语义  **两份实现不一致时，该改的是那个更严的，除非能证明严的那个对**。这里证明不了。
- **删掉 `requiredScope` 机制，让适配器自己抛 `unsupported`**：更简单（适配器已经会抛）。**否决理由**：那会让"**这次用不上**"退化成"**失败**"。实测依据（2026-09-16）：把裸查询交给 Telegram，结果是**每一次召回都失败一次**，真正的故障会淹在噪声里。`requiredScope` 的价值正是**在调用之前就判定**、不发出注定失败的请求。
- **同时删掉 `isApplicable`（重复实现）**：消除两处口径。**否决理由**：它们的**用途不同**  `isApplicable` 给适配器自己用（判断"这次适不适用"），`recall` 的是**分层调度的前置门**（不发出请求）。删任一个都会丢掉一层。**改为让两处判据一致**（都是"非空即适用"）。
- **给 `ctx.scope` 改成结构化类型**（`{kind: 'channel', name: 'durov'}`）：语义最清晰。**否决理由**：那是**契约变更**，要动 `RecallContext`、所有适配器、CLI、界面。而当前问题**只是判据写错了**，不需要改契约。**最小改动优先**  若将来真的需要传递频道名（而不是让适配器从 query 解析），再改结构。

## Consequences

- **`ctx.scope` 现在接受任何非空数组**：`['durov']` / `['telegram','durov']` / `['channel']` 都行。
- **未提供作用域时仍跳过**（边界已测）：这是修复的**边界**  放宽的是"作用域叫什么名字"，不是"要不要有作用域"。
- **空数组等同未提供**（`[]` 不算提供了作用域）。
- **`ctx.scope` 仍是没有生产者**  机制现在对了，但"从查询里识别频道名并传进来"仍未做
  （当前调用方需要自己知道要传）。**这是下一个缺口。**

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **267 tests / 267 pass / 0 fail**（新增 4 条）
- **修复前后对照实测**：
  ```
  ["channel"]      → ✅ → ✅
  ["durov"]        → ❌ 未调用 → ✅ 被调用
  ["telegram","durov"] → ❌ 未调用 → ✅ 被调用
  ```
- **边界实测**（修复后）：
  ```
  裸查询 + 无 scope    → ○ 跳过 (not-applicable)   ← 正确，不给就别白跑
  裸查询 + 给了 scope  → ✅ 调用                    ← 让适配器自己判合法性
  频道查询 + 无 scope  → ○ 跳过 (not-applicable)
  频道查询 + 给了 scope → ✅ 调用
  ```
- **新增 4 条测试**，其中两条是**反向断言**：没给作用域时必须仍跳过、空数组不算提供
- **我自己犯的断言错误**：新测试里我断言"消息不该再提 `channel`"  而 `channel` 正是
  `requiredScope` 的**能力名**，消息里本来就该有。**我把自己改的措辞当成了整体语义**，
  应该断言的是"它讲清了怎么提供作用域"。

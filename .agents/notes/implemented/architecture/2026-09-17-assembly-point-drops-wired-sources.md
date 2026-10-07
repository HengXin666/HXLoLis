# Agent Note: 组装点丢弃已就绪的实现  比"忘记接线"更隐蔽

Status: implemented

- 影响: `components/HX-Sagasu/src/fetchers.ts`

## Problem

第 17 轮写 CLI 入口时，第一次把整套东西真的跑起来，立刻看到：

```
第 0 层: 未运行  (该层登记了 11 个来源，但没有取数实现（未接线）)
  ✖ 失败 crossref: 来源「crossref」（第 0 层）没有取数实现  是**没有接线**，不是"没有内容"
  ✖ 失败 arxiv / pubmed / openalex / github / wikipedia / hackernews / mdn / ietf / npm / stackexchange
```

但 `authoritativeFetchers()` **明明提供了 12 个实现**。测下去：

```
authoritativeFetchers()                        → 12 个实现
planFetchers({available:{authoritative}})      → **1 个**（只有 juejin）
```

**根因**：`SOURCE_PLAN` 只登记了 5 条，而 `SOURCES` 有 15 条。**11 个第 0 层来源没有任何 route 条目**，于是 `planFetchers` 永远走不到它们。

**这比"忘记接线"更糟，有两个原因**：

1. **实现是已就绪的，是组装点把它扔了。** 不是"还没来得及写"，而是"写好了没人认领"。
2. **报出来的错指向了错误的层。** 消息说"没有取数实现"，读者会去查 `authoritative.ts`  而那里一切正常。**错误信息把人引向了无辜的地方。** 我第一反应确实是去查取数层。

而且它与第 14 轮修的那个缺陷（适配器路径从未接线）**同源**：都是"登记表与实际组装脱节"。那一轮我加了 `SOURCE_PLAN` 来消灭这类问题，**却没给它加覆盖率门禁**，于是它自己成了新的脱节点。

## Decision

**加入模块级通路 `AUTHORITATIVE_WHOLE_TIER`：一个模块提供整层时，登记一条而不是 N 条。**

```ts
export const AUTHORITATIVE_WHOLE_TIER: SourcePath = {
  sourceId: '*',
  module: 'authoritative',
  rank: 'primary',
  reason: '第 0 层整层由 authoritative.ts 提供（原生 HTTP 实现，逐条登记的 reason 完全相同）',
}
```

`planFetchers` 先按 `SOURCE_PLAN` 逐条解析（并记录 `claimed`），再用模块级通路补上**未被认领**的。逐条登记优先。

并加了一条**脱节门禁**测试：第 0 层每个登记来源都必须有取数实现，缺一个就失败。

## Alternatives considered

- **把那 11 条逐条写进 `SOURCE_PLAN`**：与现有结构一致，不需要新概念。否决理由：**它们的 reason 完全相同**（"原生 HTTP 实现，见 authoritative.ts"）。逐条重复 11 遍只会让表变长而不变准，而且**每加一个第 0 层来源都要记得补一条  那正是这个 bug 的成因**。用一个需要人工同步的清单去修一个"清单没同步"的 bug，是没解决问题。
- **让 `planFetchers` 自动接线：模块表里有就用，不看 `SOURCE_PLAN`**：彻底消灭脱节不可能再漏。否决理由：`SOURCE_PLAN` 存在的理由是**主次仲裁**（`bilibili` 同时有适配器与 argo 引擎，`juejin` 在第 0/1 层都有实现，**谁上必须显式定**）。自动接线会让这些来源变成"谁先注册谁赢"，**把这轮修的 bug 换成一个更安静的 bug**。模块级通路是"没有主次争议的整层"的快捷方式，不是自动接线的许可证。
- **什么都不做，让第 0 层继续报"未接线"**：它是**如实**的那些来源确实没有 route 条目。否决理由：这不是"如实"，是**归因错误**。实现存在、能力可用，却报"没有实现"，会让人去修一个没坏的地方。而且它让**整套分层召回在第 0 层彻底失效**最高权威那层一条都不出，而第 0 层恰恰是本项目"权威平台优先"这条核心要求的落点。
- **用 `composeFetchers` 替代 `planFetchers` 的用法**（调用方直接合并各模块表）：能立刻绕开问题。否决理由：`composeFetchers` **在冲突时抛错、不做仲裁**，而 `juejin` 正好在两张表里都有  调用方会得到一个异常，而不是一个决定。它解决"表怎么合"，不解决"谁优先"。
- **只加测试门禁，不改实现**（让测试天天红着提醒）：能暴露问题。否决理由：门禁的价值是**防止回归**，不是**代替修复**。红着的测试会被忽略或删除本项目已经有过的教训是"一条每次都会出现的告警会训练人忽略整个列表"（第 15 轮的不适用 ≠ 失败）。
- **把模块级通路做成 `SOURCE_PLAN` 的一个可选字段`(wholeTier: true)`**：少一个导出常量。否决理由：`SOURCE_PLAN` 的每一项都描述**一个来源**（它的 `sourceId` 被用作 key、`reason` 被用作该来源的说明）。塞一个"代表一整层"的项进去会让这张表的每一条语义不一致  后续读代码的人得先判断"这条是来源还是层"。

## Consequences

- **第 0 层第一次真的工作**：`planFetchers` 输出从 **1 → 12**。CLI 实测 `第 0 层: 12 条`，7 个充分性信号全绿，正确早停不再下降。
- **脱节被门禁挡住**：新增测试断言"第 0 层每个登记来源都必须有取数实现"。以后加来源忘了登记，测试会红。
- **`missing` 的语义更准了**：现在只剩真正没传模块的来源（`bilibili`/`telegram-public`/`argo:anysearch`），而不是把"被丢弃"混进"未提供"。
- **一处仍未消除的冗余**：`SOURCE_PLAN` / `IMPL_OWNER` / `DUAL_PATH` / `AUTHORITATIVE_WHOLE_TIER` 现在是**四张表描述同一件事的不同侧面**。本轮加的这条至少带了自己的门禁，但四张表之间的漂移仍只能靠测试逐条挡，不是一个统一的单一事实来源。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **183 tests / 183 pass / 0 fail**（新增 4 项）
- 修复前后：`planFetchers({available:{authoritative}})` **1 个 → 12 个**
- CLI 真网络端到端：`node scripts/sagasu.ts search 'Rust 所有权'` → `第 0 层: 12 条`、7 信号全绿、正确早停；返回 `github/7G-one/Don-t-Fear-the-Borrow-Checker...`、`wikipedia/Rust (编程语言)`、`mdn/属性的可枚举性和所有权`
- 新增测试：模块级通路不丢实现、逐条登记优先于模块级通路、未提供模块时进 missing、第 0 层登记数 == 接线数
- **一处自省**：这个缺陷存在的前提是"**没有任何东西真的把整套跑起来过**"。179 项测试全绿了 17 轮，而第 0 层从未产出过一条结果因为每个测试都只测自己那一块，而"组装"这件事**没有任何测试覆盖**。写 CLI 入口这个动作本身就是发现它的原因。

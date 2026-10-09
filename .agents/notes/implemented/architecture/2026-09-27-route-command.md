# Agent Note: `route` 子命令  把「路由决策的解释」做成零成本的一等命令

Status: implemented

Decision-ID: route-command


## Code

- `components/HX-Sagasu/scripts/sagasu.ts`
- `components/HX-Sagasu/tests/route-cli.test.ts`

## Problem

调路由词表时，我想知道「哪些查询会受影响」，于是只能 `search` 跑一遍看结果 
**那要走网络、要等 25 秒，而我要的只是「哪些来源会被查、哪些被跳过、为什么」**。

学自 smartsearch（MIT）的 `smart-search route "query"`，它的文档明写:

> Explain intent routing **without running providers**.

**这个区分是关键的**: `--explain`（我们的执行时间线）与 `route` 是两件事 

| | `search --explain` | **`route`** |
|---|---|---|
| 网络成本 | 真跑一次召回 | **零** |
| 回答什么 | 每个来源**何时**开始、何时落定、是否排队 | 会查**哪些**来源、跳过哪些、**为什么** |
| 用在什么时候 | 排查「为什么这次很慢」 | 改词表后**快速自查影响面** |

## Decision

### 一、`sagasu route <查询> [--json]`  复用**同一个** `routeSources`

**这是本决策最重要的一条**: `cmdRoute` 调的就是 `recall` 内部用的那个 `routeSources`。
**如果它自己算一套判据，就会与实际检索脱节**  而那是它最坏的失效形态:
**看起来能解释，实则无关**。有测试锁住这条（`route 与 recall 用的是同一个 routeSources`）。

### 二、输出四项判据（它没有的三项，恰好是我们分层的产物）

```
话题族:   genai                ← classifyTopic 的命中（空集时明说「无法归类 → 只保留通用来源」）
查询意图: general             ← classifyQueryIntent（两套分类是独立的，必须都报）
查询变体: (无)                ← queryVariants（它让每个来源多打一次请求，是真实成本）
会查 21 个来源 / 跳过 N 个    ← 按层小计，每条跳过都带理由
```

**按层小计是 smartsearch 没有的**  它的 provider 是平级的，而我们的来源分层。

### 三、末尾明写「不含任何网络请求」

抄的是它 `usage_boundary` 那个设计习惯: **把「这个命令的边界」写进输出本身**，
而不是只写在文档里。使用者（包括几轮后的我）最可能的误判就是「它是不是偷偷跑了搜索」。

## 它立刻给出的一个真实诊断

```
$ sagasu route "GPT 文生图 提示词"
话题族: genai | 查询意图: general | 查询变体: (无)
会查 21 个来源:  第 0 层 (11 个) ← crossref/arxiv/pubmed/openalex 全在里面
```

**第 0 层 11 个全查**（含学术库） 那正是 benchmark 噪声的来源。
而在 `route` 之前，我要看到这一点得真跑一次并读完 20 条输出。

## Alternatives considered

**什么都不做 / 复用现有。** 最强理由是无需新增实现和维护成本. 现有状态仍存在 Problem 中的具体缺口, 因此采用本记录的选择

- **不做，继续用 `search --explain`**：少一个命令。**否决理由**：**两者的成本差两个数量级**
  （0 秒 vs 25 秒），而**使用频次正好相反**  改词表是高频动作，排查慢是低频动作。
- **让 `route` 只打印 keep 列表**：更简洁。**否决理由**：**跳过理由才是它的一半价值** 
  「为什么某来源没被查」是调参时最常问的问题（我在第 39 轮就为此改过兜底分支）。
- **让 `route` 自己实现一套判据**（不调 `routeSources`）：解耦更干净。**否决理由**：
  **那会让解释与实际行为可能不一致**，而一个会撒谎的诊断工具比没有更坏。有测试锁住。
- **把 `route` 并进 `search --dry-run`**：少一个子命令。**否决理由**：`search` 的语义是「去查」，
  `--dry-run` 会让它的参数解析与输出分支都变复杂（它已经有 8 个开关）。
  **一个动词一个命令**更清楚。
- **不写测试**：它是只读命令，看起来风险低。**否决理由**：**它的风险不在崩溃，在于「解释与实际不符」** 
  而那正是唯一需要测试锁的东西。

## Consequences

- **改路由词表的影响面可以零成本自查**。
- **`route` 是只读的、确定性的**（同一个查询永远给同一个答案），适合脚本消费（`--json`）。
- **又一次踩到同一个坑**: 我在 `usage()` 的模板串里用了反引号，**导致 CLI 直接启动失败**
  （`ERR_INVALID_TYPESCRIPT_SYNTAX`）。**这与第 56 轮 `page.ts` 那次是同一个错**。
  两次都记在这里: **改一个文件之前先看它是「代码」还是「装代码的字符串」。**

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **315 tests / 315 pass / 0 fail**（新增 4 条）
- **四个测试**：字段完整性 / 跳过**每个都有理由** / 空查询不崩 / **与 recall 共用同一个 `routeSources`**
- **可发现性**: `sagasu`（无参数）现在列出 **6 个子命令**，`route` 含在内
- **三场景实测**:
  ```
  GPT 文生图 提示词 → genai / general / 无变体 / 查 21（第0层11 + 第1层8 + 第2层2）
  Rust 所有权       → code  / code    / 变体 ['Rust ownership'] / 查 25
  阿司匹林 相互作用  → biomedical / general / 跳过 23
  ```

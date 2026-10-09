# Agent Note: 把 argo 超时缩到"193 行 + 一个目录名"  根因仍未闭合但已可分析

Status: implemented

Decision-ID: minimal-repro


## Code

- `components/HX-Sagasu/scripts/diag/minimal-repro.ts`

## Problem

> **本 note 的"目录决定论"结论已被推翻**  见
> [2026-09-19-conclusion-overturned.md](2026-09-19-conclusion-overturned.md)。
> 那组"目录 vs 结果"的对照被一次**偶发失败**污染了；重复实验显示
> `sagasu.ts` 稳定失败（11×5），而所有手工等价脚本稳定正常（0×6）。
> **保留本 note 是因为二分过程（805→423→194 行）与 29 个排除方向仍然有效。**


上轮做出三段对照（A=11 / B=11 / C=0）并固化成脚本。本轮**继续二分**，
把一个"805 行 CLI 才失败"的问题**缩小到了 193 行**。

## Decision

### 二分过程

| 步骤 | 裁剪后 | initialize 超时 |
|---|---|---|
| 原版 `sagasu.ts` | 805 行 | **11** |
| 删掉 thread/fetch/query 等子命令 | 423 行 | **11** |
| 只留 `buildFetchers` + `cmdSearch` + 分发 | **194 行** | **11** |
| 把 `buildFetchers` **内联**进 `cmdSearch` | 194 行 | **11** |

**194 行时仍然失败**  元凶在 `buildFetchers`/`cmdSearch`/模块级代码里。

### 决定性发现：**同一个文件，换个目录就正常**

```
scripts/_a.ts          （193 行，import '../src/…'）    → 11
scripts/diag/minimal-repro.ts（同一份，'../../src/…'） → 0
```

**而两者的模块解析 URL 完全相同**：

```
scripts/ 下解析成: file:///…/HX-Sagasu/src/fetchers.ts
diag/ 下解析成:    file:///…/HX-Sagasu/src/fetchers.ts
相同? true
```

**同一个文件复制到 `diag/` 下换任意文件名（`z.ts`、`minimal-repro-copy.ts`）都是 0。**

~~**所以决定因素是"文件在 `scripts/` 还是 `scripts/diag/`"**~~  **这条结论已被推翻**（2026-09-19）。
当时那次对照里 `scripts/` 侧的 11 个超时是**偶发**：同一份代码随后连跑 6 次全为 0。

## 本轮新排除的方向（累计 23 个）

| # | 方向 | 实测 |
|---|---|---|
| 23 | **shebang**（`#!/usr/bin/env node`） | 加上/去掉都不改变结果 |
| 24 | **`export` 存在与否** | 两边都是 0 个 export |
| 25 | **`recall` 首参是 `argv[1]`** | 改成字面量后仍 11 |
| 26 | **绝对路径导入** | 改成绝对路径后仍 11 |
| 27 | **文件名** | 在 `diag/` 下换任意名字都是 0 |

## 未验证的可能方向（写进 README 供下一个人接手）

1. **`--experimental-strip-types` 的缓存键**可能是**源路径**而非解析后 URL 
   于是同一模块在不同深度被剥离两次，产生两个实例
2. **`node_modules` 向上查找的起点**不同，导致某依赖被解析成两个实例
3. **进程 cwd 与模块路径的关系**（但两次运行的 cwd 相同，已排除）

**第 1 条最可疑**  而它有一个**可测的推论**：如果是"两个模块实例"，
那么 `argo-gate.ts` 的模块级 `gate` 会有**两份**，闸门就形同虚设。
**而那恰好能解释"11 个同时超时"**。

## Alternatives considered

**什么都不做 / 复用现有。** 最强理由是无需新增实现和维护成本. 现有状态仍存在 Problem 中的具体缺口, 因此采用本记录的选择

- **继续二分那一块**：更彻底。**否决理由**：本轮已 19 次调用，而**二分已经推进到"193 行"这个足够小的规模**  下一步该是**验证"两个模块实例"这个具体假设**（见上第 1 条），而不是继续裁代码。
- **把 `sagasu.ts` 移到 `diag/` 下"修好"它**：一行 `mv` 就能让失败消失。**否决理由**：**那是把症状搬走而不是解决**。而且`scripts/sagasu.ts` 是文档化过的入口路径（多篇 note 引用它），移动它会破坏那些引用。
- **不写 README，只在 note 里描述**：省事。**否决理由**：**这份 README 是与最小复现放在一起的**  下一个人打开 `scripts/diag/` 就能看到现象、复现命令、已排除的 23 个方向、以及三个未验证的假设。**note 在 `.agents/notes/` 下，而它会在这里。**

## Consequences

- **复现规模从 805 行缩到 193 行**  可分析性大幅提高。
- **问题被定位到一个具体变量**：**文件所在目录**（而模块解析 URL 相同）。
- **三个可能方向已写进 README**，其中"两个模块实例"有可测推论。
- **`sagasu.ts` 的实际可用性不变**：`exit=0`、第 0 层完整、命中 21-24 条。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **280 tests / 280 pass / 0 fail**
- **二分实测**：805 → 423 → 194 行，**始终 11 个超时**
- **目录对照**：`scripts/_a.ts` = **11**，`scripts/diag/minimal-repro.ts` = **0**，`diag/z.ts` = **0**
- **URL 解析对照**：两者解析成**同一个 URL**
- **新增资产**：`scripts/diag/{minimal-repro.ts, minimal-control.mjs, README.md}`

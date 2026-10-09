# Agent Note: 让 `thread`/`fetch` 可被发现 + 现状文档追平实际

Status: implemented

Decision-ID: discoverability-and-docs


## Code

- `components/HX-Sagasu/scripts/sagasu.ts`

## Problem

做交付前的文档盘点时发现两处**过时**：

### 一、`thread` 与 `fetch` 不可被发现（真缺陷）

分发器注册了 **5 个子命令**，而 `usage()` 只列了 **3 个**：

```
分发器: search / sources / query / thread / fetch
usage:  search / sources / query          ← 少了两个
```

**这不是文档问题，是「能力不可发现」**  用户跑 `sagasu` 看帮助，
**永远不知道回复树、指代解析、目标抓取这三个能力存在**。
而它们正是目标 (3)「对话式语义」的交付物。

**同一处还漏了两个开关**: `--explain`（执行时间线）与 `--verify`（链接核验）。

### 二、`status-qa.md` 的 §2.2 仍标着 `[未完成]`

那份文档写于 09-17，而 §2.2 的内容（「以 MIT/Apache 许可为硬条件找同类项目」）
**在本会话已经做完**:

- **argo 本身是 MIT**，我们已移植它的 `url-safety.ts` 与 `readability.ts`（含出处标注）
- **aether-search 是 MIT**，我们从中移植了两条判据（`verify-links.ts` / `fallback.ts`）

## Decision

### 一、`usage()` 补全 5 个子命令与全部开关

**每个开关都带一句「为什么」**，不只是名字  例如:

```
  --explain         打印执行时间线（每个来源的进入/落定时刻）
                     用于区分「这个来源慢」与「这个来源在排队」
  --related         相关推荐（目前仅 bilibili）。与 search 是不同信号:
                    它答的是"这条帖子周围还有什么"，不是"哪些帖子提到了这个词"
```

### 二、就地更新 §2.2 与补当前状态摘要

按本仓库规则（**事实就地重写，不追加变更历史**）改写 §2.2，
并在标题后加一节「当前状态摘要」 它回答的正是那份文档的原问题
（「现在能不能跑」「有没有前端」），只是时点从 09-17 推到 09-19。

## Alternatives considered

**什么都不做 / 复用现有。** 最强理由是无需新增实现和维护成本. 现有状态仍存在 Problem 中的具体缺口, 因此采用本记录的选择

- **只更新文档，不修 `usage`**：改动更小。**否决理由**：**那是把「能力不可发现」当成文档问题**。
  它其实更严重: 用户不会读到研究文档，他只会跑 `sagasu` 看帮助。
- **`usage` 只列子命令名，不解释开关**：更简洁。**否决理由**：本项目的开关**多数是「为什么」驱动的**
  （`--explain` 存在的理由是区分慢与排队、`--related` 的理由是与 search 不同信号）
  只列名字会让人以为它们是可选的装饰。
- **给 `status-qa.md` 追加「2026-09-19 更新」小节**：保留历史。**否决理由**：**本仓库规则明写
  「事实就地重写，不追加变更历史」**  文档不是变更日志，变更日志在 evolution-log 里。
- **不更新 `status-qa.md`，另写一份新文档**：更干净。**否决理由**：**那会让两份文档各说一半**，
  而读者无法判断该信哪份。**就地更新 + 明说时点**是更诚实的做法。
- **加 `--help` 参数与自动生成 usage**：更工程化。**否决理由**：**当前 CLI 只有 5 个子命令**，
  手工维护的成本低于引入一个帮助系统的成本。**等它长到 15 个再说。**

## Consequences

- **5 个子命令全部可发现**  目标 (3) 的三个交付物（回复树/指代解析/多轮游标）不再藏在代码里。
- **`--explain` 与 `--verify` 对用户可见**  它们是诊断与核验能力，之前只在 note 里提过。
- **现状文档追平实际**  56 篇 note 被引用，11 项新能力被列出，唯一未达标项被明说。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **311 tests / 311 pass / 0 fail**
- **可发现性实测**: `sagasu`（无参数）现在输出 `fetch / query / search / sources / thread` **5 个**
- **文档实测**: `status-qa.md` 从 102 行 → **157 行**（加摘要 + 更正 §2.2）
- **§2.2 更正依据**: `url-safety.ts` / `readability.ts` / `verify-links.ts` / `fallback.ts`
  四个文件的出处标注都在（MIT）

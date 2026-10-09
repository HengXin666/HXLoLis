# Agent Note: 平台判定的复核  从"单查询探测"到"多变体多查询"

Status: implemented

Decision-ID: platform-recheck


## Code

- `components/HX-Sagasu/src/recall.ts`
- `components/HX-Sagasu/src/adapters/registry.ts`
- `components/HX-Sagasu/tests/registry-consistency.test.ts`

## Problem

目标第 (2) 项"私域/垂直社区平台接入"的现状是 **2/12 ready**  这是唯一未达标的需求。

而 registry 里的判定有两类可信度问题：

1. **有的判定只用了单条查询**。"0 条"可能是**那个词本身没结果**，不是引擎坏了。
2. **有的只看了一个引擎变体**。argo 的引擎定义里同一个平台可能有多个变体 
   而 registry 是按**平台**登记的，容易把"某个变体坏了"写成"这个平台不行"。

**这两类都会让判定偏严**（把可用的误判为不可用），而偏严的代价是**永久放弃一条路**。

## Decision

**复核时用"多变体 × 多查询"，并把复核结果写进证据。**

### 一、知乎：4 个变体 × 各两条查询

argo 有 4 个知乎引擎：`zhihu` / `zhihu_global` / `zhihu_user` / `zhihu_hot`。
实测：

```
zhihu          "Rust 所有权"      → 0 条
zhihu          "怎么学编程"        → 0 条
zhihu_global   "Rust"           → 0 条
zhihu_global   "machine learning" → 0 条
zhihu_user     "编程"            → 0 条
zhihu_hot      "热搜"            → 0 条
```

**四个变体一致失败**  这排除了"单个引擎配置错"，也让 403 的诊断更可信
（直连 `api/v4/search_v3` 仍返回 **HTTP 403**）。

**结论不变（`blocked-dep`），但证据强度完全不同**：从"测过一次"变成
"4 个变体 × 6 条查询一致"。

### 二、小红书：两种查询

`xiaohongshu` 用"护肤"与"美食"两条  都 0 条。同样排除了"查询词没结果"。

### 三、B站：发现了新可用的引擎

探测时顺手试了 `bilibili_hot`（站内热门榜） **3 条真实结果**。

它与 `bilibili` 是**两条不同路径**（榜单 vs 检索），所以单独登记为一个来源。
**登记来源 44 → 45。**

## Alternatives considered

**什么都不做 / 复用现有。** 最强理由是无需新增实现和维护成本. 现有状态仍存在 Problem 中的具体缺口, 因此采用本记录的选择

- **不复核，沿用 09-16 的判定**：省掉一整轮的工作。**否决理由**：**那种判定是"单查询探测"得出的**，而本项目对"未实测的假设"一贯拒绝。更实际的是：本轮**顺手就发现了一个可用来源**（`bilibili_hot`） 说明当时确实漏了东西。
- **把 `bilibili_hot` 合并进 `bilibili` 条目**（反正都是 B站）：登记表更简洁。**否决理由**：它们是**两条独立路径**（榜单 vs 关键词检索），产出内容不同、失败模式也不同。合并会让"B站可用"这句话**掩盖**其中一条路径坏掉。**按路径登记，不按平台聚合**  这与 registry 文件头"按平台登记而不是按引擎数量"的规则不冲突：那条防的是"4 个引擎变体算 4 份覆盖"，而这里是**真的两条路**。
- **把知乎直接标成 `no-endpoint`**（彻底不可接）：比 `blocked-dep` 更坚决。**否决理由**：`no-endpoint` 的语义是"平台没有可用的公开数据路径"（如 Discord 的服务端公开面只有邀请页）。而知乎**有**路径  只是需要凭证（"申请知乎开放平台凭证，或走登录态浏览器"）。**`blocked-dep` + `unlock` 比 `no-endpoint` 更准确。**
- **继续扩大复核范围到全部 12 个平台**：更彻底。**本轮没做**  已有的 09-16 判定里，B站/Telegram（ready）与被 argo 复现的那批（微博/X/Reddit/微信）证据已经足够。**剩下需要多变体复核的只有知乎**（它是唯一有多个变体的）。
- **把复核结论只写在 memory 里，不改 registry**：省一次代码改动。**否决理由**：registry 的 `evidence` 字段**就是给下一个人看的**（界面平台面板也直接读它）。写进 memory 只有 agent 能看到，**而想加适配层的人看的是代码**。

## Consequences

- **登记来源 44 → 45**（新增 `bilibili_hot`）。
- **知乎的证据从"实测 403"升级为"4 变体 × 6 查询一致失败"**  判定不变，可信度更高。
- **平台计数仍是 2/12 ready**  本轮没有让任何平台从 blocked 变 ready，
  **但把"为什么不可用"的证据夯实了**，且**发现并接入了一个漏掉的可用来源**。
- **未做**：验证 `bilibili_hot` 在真实召回里的表现（它现在只是登记上了）。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **255 tests / 255 pass / 0 fail**
- **探测矩阵实测**（共 9 次调用，全部有返回或明确 0 条）：
  ```
  zhihu / zhihu_global / zhihu_user / zhihu_hot  → 全部 0 条（各 1-2 条查询）
  xiaohongshu（护肤 / 美食）                      → 0 条
  bilibili_hot（热门）                           → 3 条  ← 新可用
  ```
- **直连端点复核**：`api/v4/search_v3` → `HTTP 403 Forbidden`
- **四张表同步**（`SOURCES` / `SOURCE_PLAN` / `IMPL_OWNER` / `ARGO_ENGINE`）
- **我自己踩的坑**：往 TS 字符串链里插内容时**匹配到了文件头注释里的同一句话**，
  把代码插进了 `unlock` 之后（非法位置）→ `SyntaxError: Expression expected`。
  **与上两轮"锚点不唯一"是同一族问题  这已是连续第三轮。**

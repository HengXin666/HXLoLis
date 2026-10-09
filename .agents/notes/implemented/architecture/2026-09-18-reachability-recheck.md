# Agent Note: 引擎与平台的**可达性**复核  两个"标着可用但其实不可用"

Status: implemented

Decision-ID: reachability-recheck


## Code

- `components/HX-Sagasu/src/argo-source.ts`
- `components/HX-Sagasu/src/adapters/registry.ts`
- `components/HX-Sagasu/tests/argo-source.test.ts`

## Problem

**"工具已安装"不等于"能力可用"**  这话本项目记了很久，但只用在平台层。
本轮发现**引擎层也有同样的问题，而且更隐蔽**：

### 一、Telegram：标 `ready`，但本机网络不可达

`registry` 里 Telegram 是 `ready`，证据是 09-16 的实测（`t.me/s/durov` 返回 200）。

**09-18 复核**：

| 目标 | 结果 |
|---|---|
| `t.me/s/durov` | **连接超时**（三次） |
| `t.me` DNS 解析 | ✅ **正常**（→ 149.154.167.99） |
| `example.com` | ✅ HTTP 200 |
| `developer.mozilla.org` | ✅ HTTP 200 |

**DNS 能解析而连接超时 = 连接被阻断，不是配置问题。**
适配器代码本身是对的（裸查询正确地报了"不适用"而非失败）。

> **`ready` 判定会随网络环境变化，而 registry 里写的是"某时刻的实测"** 
> 这个时间差是一个**真实的、会误导人的**缺口。

### 二、duckduckgo：标"通用兜底"，但实测 0 条

实测两组查询（`Rust` / `天气`）**均 0 条**。而同为兜底的 `argo:anysearch` 是好的（2 条）。

**它为什么更隐蔽**：`duckduckgo` 在 `SOURCE_TOPICS` 里标 `'*'`（全域），
而路由对全域来源**永不跳过**  所以它坏了**不会被路由挡掉，只会每次白跑**。

**同期对照（9 个引擎实测）**：

```
duckduckgo     "Rust"       →  0 条   ⚠
duckduckgo     "天气"        →  0 条   ⚠
anysearch      "Rust"       →  2 条
baidu_baike    "Rust"       →  2 条
moegirl        "原神"        →  1 条
hackernews     "rust"       →  2 条
stackoverflow  "rust lifetime" → 2 条
pypi           "requests"   →  1 条
crates         "serde"      →  2 条
devto          "javascript" →  2 条
```

**除 duckduckgo 外全部有产出**  这个对照让"是查询词的问题"这个解释不成立。

### 三、B站仍是好的（对照组）

同一轮实测：`search → 5 条`、`thread → 11 层`。
**所以平台层的真实状态是 1/12 可达**（B站），而 registry 写的是 2/12。

## Decision

**两条都保留登记，但把复核结果写进代码，并加健全性测试。**

1. **Telegram**: 更新 `evidence`，写明"适配器没问题，是网络可达性问题，换环境后应重测"。
2. **duckduckgo**: 在 `ARGO_ENGINE` 的注释里标 `⚠ 实测 0 条`。
3. **新增两条测试**（它们是**配置健全性**测试，不是代码正确性测试）：
   - **全域来源里必须至少有一个活的兜底**  全域来源在路由里永不跳过，
     所以坏了不会被挡掉，只会白跑。**这条测试守的是"兜底不是空的"。**
   - **实测坏掉的引擎仍保留登记**  删掉会让"恢复后没人知道要加回来"。

## Alternatives considered

**什么都不做 / 复用现有。** 最强理由是无需新增实现和维护成本. 现有状态仍存在 Problem 中的具体缺口, 因此采用本记录的选择

- **把 Telegram 从 `ready` 改成 `blocked-anti`**：状态更"准确"。**否决理由**：`blocked-anti` 的语义是"**有公开面但被风控挡住（直连被拒）**" 而这里不是风控，是**本机网络到该域不可达**。改状态会让下一个换到能连 Telegram 的网络的人**以为这条路已被否决**。**改证据、不改状态**更准确：状态说"代码可用"，证据说"当前网络不可达"。
- **把 duckduckgo 从 `ARGO_ENGINE` 里删掉**：省掉每次白跑的请求。**否决理由**：**它可能只是上游临时故障**。删掉之后，它恢复时**没有任何机制提醒我们加回来**  而保留登记 + 注释 + 测试，让"它是坏的"成为一个**被记录、可复核**的事实。**这与本项目对"未实测的假设"的态度一致：记录不确定性，而不是消灭它。**
- **把 duckduckgo 从 `SOURCE_TOPICS` 的 `'*'` 改成具体类别**：让路由能跳过它。**否决理由**：那会**掩盖**真正的问题（它坏了）。改类别是为了"优化请求数"，而这里需要的是"标记它坏了"。**两个问题不该用同一个改动解决。**
- **不加健全性测试，只改注释**：省事。**否决理由**：注释不会在 CI 里红。而"全域来源里一个活的都没有"是一个**会导致召回完全失效**的配置状态  它值得一条会红的测试。**这条测试不测代码，测配置健全性  而配置也能坏。**
- **把 `ready` 改成带时间戳的判定**（如 `ready@2026-09-16`）：更诚实。**否决理由**：那会让界面与所有消费方都要解析新格式，而**收益只是"看起来更精确"**。当前做法（状态 + 证据里写明复核时间）已经足够，且不用改契约。
- **本轮顺手修 Telegram 的网络问题**（如配代理）：超出组件职责。**否决理由**：那是**环境配置**，不是 HX-Sagasu 的能力。**记录它，让使用者自己决定。**

## Consequences

- **平台层真实状态是 1/12 可达**（B站），registry 的 `ready` 计数（2/12）现在有了**证据层的修正**。
- **引擎层新增一条已知故障**（duckduckgo），且它是**兜底路径**之一。
- **两条健全性测试**进入 CI  全域兜底为空时会红。
- **未做**：给 `ready` 状态加一个"最近复核时间"字段（见上，契约变更收益不足）。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **263 tests / 263 pass / 0 fail**（新增 2 条）
- **Telegram 复核**：`t.me` 三次连接超时、DNS 正常解析；同期 `example.com`/`developer.mozilla.org` HTTP 200
- **duckduckgo 复核**：两组查询均 0 条；**同期 9 个引擎对照，除它外全部有产出**
- **B站对照组**：`search → 5 条`、`thread → 11 层`（证明"平台层不是普遍坏了"）
- **适配器行为正确**：Telegram 裸查询报 `telegram/unsupported` + 明确说明（"不适用"而非"失败"）

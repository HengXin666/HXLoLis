# Agent Note: B站相关视频能力 + 平台可达性复核

Status: implemented

Decision-ID: bilibili-related


## Code

- `components/HX-Sagasu/scripts/sagasu.ts`
- `components/HX-Sagasu/src/adapters/bilibili.ts`

## Problem

需求 (2)「私域/垂直社区接入」是四条里**唯一未达标的**（**2/12 ready**）。本轮去攻它，做法是**逐平台实测复核**而不是假设。

## Decision

### 一、复核既有结论：它们经受住了复核

| 平台 | 本轮实测 | 既有登记 |
|---|---|---|
| **贴吧** 5 个端点 | **全部 403**（`c/f?kw` 返回 200 但 **0 字节空壳**） | `blocked-anti` ✓ |
| **Reddit / YouTube / t.me** | `fetch failed`（10.5 秒超时） | `blocked-anti` ✓ |
| **B站** | `api.bilibili.com` **200 / 434ms** | `ready` ✓ |

**DNS 解析本身是正常的**（反向解析与域名一致），所以这不是污染  是**这些 IP 在本机网络不可达**。**登记表里写的解锁条件无需修改。**

### 二、找到一条**新的可用能力**：B站相关视频

实测 `x/web-interface/archive/related?bvid=` → **40 条**含 bvid / 标题 / UP主，**无需鉴权、无需 wbi 签名**（对照: `x/space/wbi/arc/search` 返回 `code=-403`，那是签名墙）。

同批探到的还有 `x/web-interface/view`（详情: 播放/弹幕/分P）与 `x/web-interface/search/square`（热搜）。

### 三、为什么「相关视频」值得单列而不是混进 search

| | 反映什么 |
|---|---|
| `search` | **查询词匹配** |
| `related` | **这条视频在 B站的语境**（同题材、同 UP、算法认为相关） |

**两者是不同的信号。** 在 `thread` 场景里后者更有用  它回答的是「楼主这个帖子周围还有什么」，而 search 回答的是「哪些帖子提到了这个词」。

## Alternatives considered

**什么都不做 / 复用现有。** 最强理由是无需新增实现和维护成本. 现有状态仍存在 Problem 中的具体缺口, 因此采用本记录的选择

- **不做，接受 2/12**：省事。**否决理由**：**未达标的只有这一条**，而复核本身有独立价值  它确认了既有登记**不是拍脑袋写的**，也排除了「其实早就通了只是没人测」这种可能。
- **把 12 个平台全做一遍**：更快推进。**否决理由**：**网络层不可达的平台做不了**  本轮已实测 Reddit/YouTube 连 `fetch` 都失败。**先做能做的**（B站），其余标注清楚。
- **把 related 混进 `search` 的返回**：少一个开关。**否决理由**：**两者语义不同**（见上表），混在一起会让调用方分不清「这条是查到的」还是「这条是推出来的」。
- **`related` 返回空时不抛**：与其他接口统一。**否决理由**：**`code !== 0` 是接口级错误**，不是「没有相关内容」。抛出来才能与「真的没有」区分  这是全组件的一致纪律。
- **`--related` 对其它平台也开放**：接口更整齐。**否决理由**：**其它平台的相邻内容接口我没实测过**。假装支持会让「不支持」伪装成「返回空」，而那正是本项目反复栽过的坑（`unwired ≠ no-content`）。

## Consequences

- **B站能力从「搜索 + 评论」扩到三路**：搜索 / 评论（回复树）/ 相关视频。
- **平台可达性的判断有了本轮实测背书**  既有登记表无需修改。
- **一个我自己的错误值得记**：第一版按 `res.body` 写（假设是字符串），而 `FetchedResponse` 的契约是 **`json()` 方法**  运行时报 `"undefined" is not valid JSON`。**契约就在同一个文件里**，读一眼就能避免。这正是本项目反复出现的那类错（凭印象写字段名），与 `thread` 那次 `t.floor` 同形。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **311 tests / 311 pass / 0 fail**（新增 6 条）
- **6 条测试都针对失败路径**：HTTP 非 200 抛、`code !== 0` 抛、非 JSON 抛、缺 bvid 的条目被滤、limit 生效  **没有一条只测 happy path**
- **端到端**（`thread bilibili:BV1GJ411x7h7 --related --limit 6`）:
  ```
  视频 BV1GJ411x7h7 的相关推荐 6 条
    BV1NZ4y1j7nw  比划大魔王        黑人抬棺原版视频
    BV1V4UYY5EhD  CR400BF-AS-542  视频已失效
  ```
- **本轮平台可达性实测汇总**:
  ```
  可达:   api.bilibili.com 200/434ms | bilibili 评论 200/99ms
  不可达: reddit.com / youtube.com / t.me  → fetch failed (10.5s)
  反爬:   tieba 5 个端点全 403（c/f?kw 返回 200 但 0 字节空壳）
  签名墙: bilibili x/space/wbi/arc/search → code=-403
  ```

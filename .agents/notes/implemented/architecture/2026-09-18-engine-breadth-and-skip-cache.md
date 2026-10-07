# Agent Note: 把引擎接入面从 3 个扩到 15 个  以及"点名引擎"必须跳过缓存

Status: implemented

- 影响: `components/HX-Sagasu/src/argo-source.ts`（`ARGO_ENGINE` 扩张 + `skip_cache`）、`src/recall.ts`（`SOURCES` 登记）、`src/fetchers.ts`（`SOURCE_PLAN`）、`tests/registry-consistency.test.ts`（`IMPL_OWNER`/`DUAL_PATH`）
- 上游对照: `research-output/hx-sagasu/2026-09-18-capability-parity.md`

## Problem

用户问：**"能力已经完全等价他了吗？比如同一个 q，你的搜索结果最差也是和他一模一样。"**

实测对照给出了两个不同答案：

1. **同引擎同查询已等价**  `juejin` 直调 9 条，走完整 `recall` 也是 9 条，**0 缺失**（集合级相等）。
2. **广度差 10 倍**  argo 可路由 **140** 个引擎，我们只接了 **3** 个。

**第 2 条是唯一的真实差距，而且它只能靠"多接"来缩小。**

## Decision

### 一、按"能力族"批量接入，而不是逐个手工接

argo 已把 140 个引擎按 **19 个能力族**组织好（`web_general`/`academic`/`code`/`knowledge`/`social`/...）。
族是**能力契约**：同族引擎可互换。这是它设计里最值得复用的部分  我们不必理解每个引擎，
只需知道"这一族提供什么能力"。

一次接入 12 个新引擎（3 → 15）：`duckduckgo`/`baidu_baike`/`moegirl`/`reddit`/`douban_book`/
`open_library`/`gutenberg`/`devto`/`huggingface`/`crates`/`dblp`，加上 `wikipedia`/`hackernews` 的第二条路径。

**登记口径：只收零成本、无凭证的引擎。** 付费/需 key 的（firecrawl/Tavily/bocha）一律不登 
它们会让"这条查不到"变成"这次没配 key"，而那是我们明确拒绝的混淆（`unwired` 与 `no-content` 必须可区分）。

### 二、点名引擎时必须 `skip_cache`

**这是本轮最有价值的发现。** 接入后逐个探测，13 个引擎里 12 个报
`argo/unsupported`，理由都是 `engines_used` 与请求不符。

真因：argo 的 **`find_similar` 语义软命中**（`cache.py:449-490`）在精确键 miss 时，
按 minhash 相似度 ≥0.7 找近重复查询的缓存  而它**收了 `engine` 参数却从不使用**。
于是 `engine=moegirl` 拿回 `baidu_baike` 的缓存内容。

**我们的 `engines_used` 检查如实拦住了这些响应**（没有把别处的证据当目标引擎的）
**但代价是 12 个引擎全部不可用。** 修法是传 `skip_cache: true`：
既然调用方点名了引擎，就不该有任何缓存替它作答。

修后：13 个引擎**全部不再报错**，3 个对中文查询有产出（baidu_baike/moegirl/douban_book），
10 个返回 0 条  那是**合法的空结果**（crates/dblp/gutenberg 本就是英文技术/学术源），
不是失败。这正是我们契约要的区分。

## Alternatives considered

- **逐个为每个引擎写原生 HTTP 客户端**：控制力最强，失败语义最精确。否决理由：**这是 140 份工作**，而且 argo 已经解决了鉴权/解析/限流/反爬。我们真正该自己实现的是**第 0 层那 12 个权威源**（DOI/PMID/owner 可核查），那些我们已经有了。**把"广度"交给 argo，把"权威性判定"留给自己**，这个分工是对的。
- **把新引擎全部登记在第 0 层**（它们里有 dblp/crates/open_library/gutenberg，概念上确实是登记机构）：语义上更准确。否决理由：**本项目第 0 层的语义是"我们原生直连的权威源"**，而测试精确地守卫了这一点（"登记为第 0 层的每个来源都必须有实现"）。把它们放第 0 层会让"权威层"的含义从"我们亲自实现并可验证"退化成"别人实现的、我们信它权威"**那正是我们拒绝的域名白名单思路**。改为按实测产出分层。
- **把 `wikipedia`/`hackernews` 的 argo 路径登记为 primary**：反正都是同一个知识源。否决理由：**原生实现产出更好且失败语义更精确**（官方 API vs 本地镜像），而且测试的 `DUAL_PATH` 机制要求重叠实现**显式写明主次**，否则"两份实现会各自漂移（一个改了排序，另一个没改）"。按 juejin 的先例登记为 fallback。
- **不传 `skip_cache`，改为在本地做缓存**：能省 argo 的往返。否决理由：**那会让"点名引擎"这件事在 argo 侧依然不成立**  问题不在我们缓不缓存，而在 argo 会用别的引擎的缓存回答一个点名请求。**在错误发生的地方修**。
- **放宽 `engines_used` 检查**（允许引擎名不符）：一行改动就能让 13 个引擎"都可用"。否决理由：**那正是这条检查存在的理由**。实测已经证明串味真实发生（`moegirl` 请求拿回 `baidu_baike` 内容），放宽等于把别处的证据当目标引擎的。**检查是对的，错的是调用方式。**
- **什么都不做，维持 3 个引擎**：省掉这一轮所有麻烦。否决理由：用户问的正是"能力是否等价"，而**广度是唯一答"否"的维度**。不做就等于承认这个差距不打算补。
- **改测试的期望值让它变绿**（把 missing 列表写死成新名单）：最省事。否决理由：那些断言真正要守的性质是"**没实现的来源一个都不许静默消失**"，不是"名单恰好是这四个"。改成从 `SOURCE_PLAN` 反推  **加来源时不再需要机械维护测试，而性质仍然被守住**。

## Consequences

- **来源登记 15 → 26**，组装出的取数器 **24 个**（2 个因模块未传进 missing：bilibili/telegram-public 需适配器）。
- **四张表必须同步**（这是本项目已知的架构债）：`SOURCES`（分层+理由）、`SOURCE_PLAN`（模块归属+主次）、`IMPL_OWNER`（谁实现）、`DUAL_PATH`（重叠实现的主次）。本轮四张都更新了，**测试精确地逼着它们一致**  少一张就红。
- **`skip_cache: true` 会让 argo 每次都真去查**，代价是延迟上升、更容易触发上游限流。这是**刻意的**：点名引擎的语义就是"现在去查它"。
- **未做**：`argo:anysearch` 仍走 auto 路由，而实测 argo 的 TF-IDF 路由在这条中文查询上判给了 `free_dictionary`（0.305） 它的路由在这类查询上不可靠，**我们自己的静态登记反而更准**。这条留给后续。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **190 tests / 190 pass / 0 fail**
- **接入前逐个探测**: 13 个引擎里 12 个报 `argo/unsupported`（`engines_used` 不符）
- **接入后**: 13 个**全部不再报错**；3 个有产出，10 个返回合法空结果
- **等价性对照**（`juejin`，同 query）: argo 直调 9 条 → 走完整 recall 9 条，**0 缺失**
- 新增测试锁住 `skip_cache`：断言点名引擎的调用**必须**带这个参数
- 契约测试改为从 `SOURCE_PLAN` 反推期望值  加来源不再需要机械改测试

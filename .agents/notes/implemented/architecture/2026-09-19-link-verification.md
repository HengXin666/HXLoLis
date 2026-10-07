# Agent Note: 链接核验  互证与探活，按 URL 的来源分流

Status: implemented

- 影响: `components/HX-Sagasu/src/verify-links.ts`（新建）、`scripts/sagasu.ts`（`search --verify`）

## Problem

**我们的 LLM 侧会产出 URL，而此前对幻觉 URL 完全没有防线。**

检索结果里的链接原样进输出，没有任何东西检查它是否真实存在。`url-safety.ts` 管的是**能不能请求**（SSRF），不管请求了结果如何解读。

学自 `aether-search`（MIT）的 `verify.py`  它把判据说得很清楚：

> `verify_urls` — Tier 0 (corroboration) + Tier 1 probe. **Used for LLM-generated citations**: these **can hallucinate URLs**.
> `probe_urls` — Tier 1 only. **Used for any URL surfaced to the user**: **search engines don't hallucinate URLs, but pages can be dead (404/410) or blocked.**

## Decision

**按「URL 的来源」分流，而不是对所有 URL 一视同仁。**

| 来源 | Tier 0 互证 | Tier 1 探活 |
|---|---|---|
| **LLM 生成**的引用 | 必须 | 必须 |
| **搜索引擎返回**的链接 | 不需要 | 需要 |

**判据**: 对**不会伪造 URL 的来源**做互证，是**没有信息量的开销**。

### 四种状态（不是两种）

`corroborated` / `alive` / `dead` / `unverified`，符号 `✓ ✓ ⚠ ?`。

**`alive` 与 `corroborated` 必须分开**  前者是「我探到了」，后者是「独立来源证实了」。合并会丢掉「这个 URL 有独立佐证」这个更强的信号。

### 两个学来的工程细节

1. **HEAD 优先，遇 405/501 降级为 `GET + Range: bytes=0-0`**  很多服务器不支持 HEAD，而普通 GET 会拉全文（对只想知道「在不在」是浪费）。只取首字节是折中。
2. **失败一律归 `unverified` 而非 `dead`**  **「探不到」不等于「死了」**。这与本组件的三分法同源：`not-applicable ≠ no-content ≠ 失败`。403/500 也归 `unverified`  **服务器在，只是不让我们看**。

### 与 `url-safety.ts` 的分工（不可互相替代）

- `url-safety.ts`: **能不能请求**（SSRF 防护） 安全边界
- `verify-links.ts`: **请求了结果如何解读**  信任边界

一个 URL 可以**既安全又已死**，也可以**不安全但活着**。

**探活前必须先过 SSRF 校验**  否则核验本身就成了 SSRF 的入口。有测试锁住：内网地址**一次都不许探**。

## Alternatives considered

- **对所有 URL 都做互证**（不分来源）：实现更简单。**否决理由**：**那是没有信息量的开销**  搜索引擎返回的链接本来就不会幻觉，互证只会消耗一个集合查询而零收益。aether-search 的判据正是为此而设，我采用它的理由，不只是它的代码。
- **`alive` 与 `corroborated` 合并成「通过」**：符号本来一样，看似冗余。**否决理由**：两者**证据强度不同**  「有独立来源佐证」比「我探到 200」强得多。合并会让将来无法给「被佐证」的链接更高权重。
- **失败归 `dead`**：更醒目。**否决理由**：**「探不到」不等于「死了」**  超时、被墙、反爬都会探不到。误报 dead 会让人**不敢用**正常链接。这与本组件 `not-applicable ≠ no-content` 的三分法是同一条纪律。
- **不做 SSRF 前置，直接探**：省一次校验。**否决理由**：**那让核验自己变成 SSRF 入口**  调用方只需给一个内网 URL，我们的探活就替他打了内网。
- **默认开启（不加 `--verify`）**：更安全。**否决理由**：每条链接一次网络请求，属于**附加值而非检索本身**，且会引入 1-3 秒延迟。当前 CLI **没有 LLM 作答路径**（`thread --ask` 走本地 `resolve`），所以幻觉 URL 的主要入口是**未来的 LLM 答案**。默认关闭、显式开启，符合「诊断视图显式要」的既有约定（同 `--explain`）。
- **复用 aether-search 的代码**：省事。**否决理由**：它是 Python + httpx + asyncio，我们是 Node 零依赖；**移植判据而不是移植代码**是既有做法（`url-safety.ts`/`readability.ts` 同）。

## Consequences

- **`search --verify` 可用了**  输出「可达/已死/未确认」三档计数，只列未通过项。
- **`probeUrls` / `verifyUrls` 独立可复用**  将来 LLM 答案的引用核验直接调它。
- **默认关闭**  核验是附加值，不是检索本身。
- **测试里踩到的坑**：`a.com` 在**本机解析成私有 IP**，于是 `checkUrl` 拒绝、探活被跳过、两个测试红了。**根因是选测试域名时没考虑本机 DNS**  换成 `example.com/.org/.net` 即通过。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **288 tests / 288 pass / 0 fail**（新增 8 条）
- **关键断言都有针对性**：互证命中**不探活**（计数为 0）、403/500 归 `unverified`、超时归 `unverified`、内网地址**一次都不探**、`renderVerifyReport` 全好时返回空串
- **端到端实测**（`search "Rust 所有权" --verify`）:
  ```
  链接核验: 11 可达 / 0 已死 / 7 未确认
  ? https://www.npmjs.com/package/@codemirror/lang-rust — HTTP 403（可达但未确认）
  ? https://github.com/JuniperLibrary/rust-learning-lab — 请求失败/超时（**不等于已死**） / 超时
  ```
  **0 条被误判为死**  「探不到 ≠ 死了」这条纪律在实际中生效了。

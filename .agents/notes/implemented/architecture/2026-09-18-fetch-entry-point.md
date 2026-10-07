# Agent Note: 给移植来的两个模块接上入口  以及第三次"零调用方"

Status: implemented

- 影响: `components/HX-Sagasu/scripts/sagasu.ts`（新增 `fetch` 子命令，两条路径）
- 相关: `src/url-safety.ts`、`src/readability.ts`（实现未变，此前**都零调用方**）

## Problem

本轮开头实测：**上一轮移植的两个模块都零调用方**。

```
=== url-safety 调用方 ===    （只有 readability.ts 自己 import 它？没有）
=== readability 调用方 ===    （无）
```

**这是同一个病在本会话的第三次出现**：

| 轮次 | 模块 | 状态 |
|---|---|---|
| 第 23 轮 | `index-store.loadOrRebuild` | 零调用方 → 已接线 |
| 第 23 轮 | `resolve` | 零调用方 → 已接线 |
| 本轮 | `url-safety` / `readability` | **零调用方 → 本轮接线** |

移植完了放在那里，和写好测试放在那里，**是同一种自欺**：都有测试证明"能用"，
而没有人能真的用它一次。

## Decision

**给 CLI 加 `fetch` 子命令，两条路径，各用各的长处。**

### 路径 A：`--native`  原生抓取 + 我们自己的提取

```
sagasu fetch <url> --native
  → checkUrl(url) 过 SSRF          （url-safety.ts）
  → fetch(url) 拿原始 HTML
  → extractReadability(html)       （readability.ts，**标签级**）
```

### 路径 B：默认  交给 argo 的降级链

```
sagasu fetch <url>
  → checkUrl(url) 过 SSRF          （同一个校验，**在发起请求之前**）
  → fetch_v3.py（TLS 指纹 / 移动 UA / Wayback / Chrome CDP 降级）
  → 按段落切分（argo 已吐纯文本，没有标签可用）
```

**为什么两条都要**：argo 的 fetch_v3 只吐**纯文本**，而 `extractReadability` 吃的是
**HTML**  它靠标签权重（article/main 1.5、li/h1-h6 0.5）与链接密度区分正文与导航。
**给纯文本它无能为力。** 所以只有原生路径才能用上它；而反爬站只能靠 argo。

这正是 2026-09-18-port-not-fork.md 里那条分界线的具体形态：
**引擎接入/反爬用它的，标签级提取用自己的。**

### SSRF 校验必须在发起任何请求之前

两条路径**都**先过 `checkUrl`。**顺序不能反**  先抓再校验等于请求已经发出去了，
那正是 SSRF 想防的事。实测：

```
$ sagasu fetch http://169.254.169.254/latest/meta-data/
✖ 拒绝抓取: 目标 IP 属于私有/保留段: 169.254.169.254
  （这是 SSRF 防护。确认目标安全可设 HX_SAGASU_ALLOW_PRIVATE_URLS=1）

$ sagasu fetch http://0177.0.0.1/
✖ 拒绝抓取: 目标 IP 属于私有/保留段: 127.0.0.1
```

第二条是**八进制字面量** `0177.0.0.1` 被规范化成 `127.0.0.1` 后拦下的 
那正是移植 `url_safety.py` 时特意保留的判定。

## Alternatives considered

- **只保留默认（argo）路径**：省掉一个分支。否决理由：**那会让 `readability.ts` 永远是零调用方**  它的标签级信息在 argo 的纯文本输出里已经丢了。**不接它，就等于移植了不用。**
- **只保留 `--native` 路径**：彻底不依赖 argo 抓取。否决理由：**反爬站会全部失败**（TLS 指纹、Cloudflare 挑战、JS 渲染）。那正是 argo 的降级链 7 级要解决的问题，也是"用它的"这个分工的核心理由。
- **`readability.ts` 改为吃纯文本**：让一条路径通吃。否决理由：**它靠标签权重和链接密度工作**（`(chars - 2×linkChars) / (chars+1)`）。纯文本没有链接信息，`linkChars` 恒为 0，导航与正文的区分能力**直接消失**  那是把一个有判别力的算法退化成一个按长度切的函数。
- **不写移植保真度测试**：端到端看着对就行。否决理由：**"看着对"不足以说明移植是忠实的**。新增的测试用同一份 HTML 固定 `chars/paras/title`，并**显式锁住标题重复这个 argo 的既有行为**  防止将来有人"顺手改进"常数而破坏一致性。
- **顺手修掉标题重复**（`MDNMDNMozilla`）：看着像 bug。否决理由：**移植的第一原则是忠实**（见 port-not-fork 那篇）。我没有 argo 的测试语料来验证"修了会怎样"，而破坏逐字节一致性会让将来的对照失效。**要修必须另开一次带实测的改动。**

## 移植保真度的决定性对照

用同一份 HTML（MDN `AbortController` 页面，172613 字节）跑两边：

| | argo (Python) | 本移植 (TS) |
|---|---|---|
| `chars` | **679** | **679** |
| `paras` | **5** | **5** |
| `title` | `AbortController - Web API \| MDNMDNMDNMozilla` | **完全相同** |
| 正文前 150 字 | — | **完全相同** |

**逐字节一致。** 这是"移植忠实"的唯一证据  不是"看起来差不多"。

## 三个我自己踩的参数/格式坑

1. **给 `fetch_v3.py` 加了 `--json`** → `unrecognized arguments` 退出 2。
   查它的真实签名（`fetch_v3.py:907-912`）只有
   `url [--max-chars N] [--timeout F] [--browser] [--no-fallback] [--actions JSON]`，
   **而它本来就往 stdout 打 JSON 摘要 + 正文**。教训同上轮：**参数照着实测核对，不凭印象。**
2. **用 `indexOf('}')` 切 JSON 摘要** → 摘要里有嵌套对象，第一个 `}` 会在内层截断，
   `JSON.parse` 必然失败，而失败被 catch 吞成"没有摘要" 
   **看起来像 argo 没返回元数据，实际是我切错了。** 改成括号配平（`findBalancedJsonEnd`）后
   元数据正常显示：`http  质量 0.47  类型 unknown`。
3. **用 shell 传含反引号的 Python 代码** → 反引号被 shell 当命令替换执行
   （`bash: normalizeThread: 未找到命令`），随后的 `python3 -c` 已改坏文件。
   这是**同一天第二次**踩，本轮的修法是把 Python 脚本写进文件再执行。

## Consequences

- **CLI 现在有五个子命令**：`search` / `sources` / `query` / `thread` / `fetch`。
- **`url-safety.ts` 与 `readability.ts` 都被接线了**（此前都零调用方）。
- **SSRF 校验对两条路径都生效**，且在发起请求之前。
- **未做**：把抓到的正文沉淀进账本（`fetch` 目前只打印，不写  抓取证据的
  沉淀需要决定"什么算一张卡"，见 sink.ts 的 `quoteOf` 契约）；
  正文的时效性信号（argo 有 `compute_freshness`，我们还没有）。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **224 tests / 224 pass / 0 fail**
- **SSRF 实测拦住**：`169.254.169.254`（云元数据）、`0177.0.0.1`（八进制环回，被规范化后拦下）
- **两条路径实测**：
  ```
  $ sagasu fetch https://example.com
  抓取    http  质量 0.47  类型 unknown
  段落 1 段（readability 密度法）

  $ sagasu fetch https://example.com --native
  抓取    native   HTML 559 字节
  标题    Example Domain
  正文    116 字符 / 1 段（readability 密度法，标签级）
  ```
- **真实网页**（MDN AbortController）：native 路径 172613 字节 HTML → 679 字符 / 5 段
- **新增 2 条移植保真度测试**，其中之一**显式锁住"标题重复"这个 argo 既有行为**

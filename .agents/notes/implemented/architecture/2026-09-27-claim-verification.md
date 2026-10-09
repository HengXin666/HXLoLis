# Agent Note: 论断级证据核验  「这句话有没有被 fetch 到的原文支持」

Status: implemented

Decision-ID: claim-verification


## Code

- `components/HX-Sagasu/scripts/sagasu.ts`
- `components/HX-Sagasu/src/verify-claims.ts`
- `components/HX-Sagasu/tests/verify-claims.test.ts`

## Problem

我们此前有**两层**核验，而缺第三层:

| 层 | 问的问题 | 已有? |
|---|---|---|
| 检索引擎给的 snippet |  | 它本身就是**候选**，不是证据 |
| `verify-links.ts` | 「这个**链接**还活着吗」 | ✅ 第 49 轮 |
| **（缺）** | 「这**句话**的依据在不在已取得的正文里」 | ❌ |

**一个链接可以活着而完全不能支持那句论断**  前者只证明「页面存在」。

学自 smartsearch（MIT）的 `evidence_policy="fetch_before_claim"`:

> Discovery snippets are **candidates only**; citations are produced **only from
> fetched/read evidence**. If fallback cannot close a gap, research **finishes
> degraded and lists unsupported gaps instead of inventing evidence.**

> Unsupported key claims **must be fetched or downgraded** to unverified candidates.

## Decision

### 一、判据用**词项覆盖率**，不用语义相似度

**为什么不用语义**: 本组件零依赖，没有 embedder。而更重要的原因是 
**覆盖率有一个语义做不到的性质: 它可解释**。

「这句话的 5 个实词里有 4 个出现在第 3 条证据里，所以判它有据」
**这个理由能被反驳**。语义分数给不出这个解释，而**证据核验的结论必须能被反驳**。

### 二、三档（不是两档），且**无据 ≠ 假**

```
'supported'   coverage >= 0.5    有据
'partial'     0 < coverage < 0.5  部分有据（**中间态必须存在**，硬二分会制造假精确）
'unsupported' coverage = 0        无据
```

**「无据」说的是「在已取得的材料里找不到依据」，不是「这句话是假的」。**
这条写进了 `renderClaimReport` 的输出里  因为它是本模块最容易被误读的地方。

### 三、四条防误用设计

1. **`coverage` 与 `matched` 必须报出来**  否则结论不可复核（只给「有据/无据」是判决，不是证据）
2. **单字不成词**  「的/是/在」若参与比对，几乎所有论断都会被判「有据」
3. **`supports` 带上命中的证据词**  「为什么判它有据」要能看到原始依据
4. **`renderClaimReport` 只列未通过项**  全都有据时返回空串（与 `renderVerifyReport` 同一条约定）

### 四、CLI: `sagasu claims <答案文件> --evidence <账本JSONL>`

**要求两者都从文件来**（而不是临时拼参数） 这是它最有价值的用法:
回答「**这份报告里哪些结论有依据**」。

**证据必须从账本读**: 账本是 append-only 的真相源，索引只是它的派生品。

## Alternatives considered

- **用语义相似度（embedder）**：更宽容，同义改写也能判有据。**否决理由**：
  本组件零依赖（无 embedder），且**语义分数不可解释**  而证据核验的结论**必须能被反驳**。
  **同义改写会被误判为无据，这是本方案的已知代价**，我把它写进了模块注释。
- **只分两档（有据/无据）**：更简单。**否决理由**：**「一半实词有据」本来就模糊，
  硬二分会制造假精确**。而 `partial` 恰好是「值得人工看一眼」的那一档  它是最有用的一档。
- **不报 `coverage`/`matched`，只给结论**：输出更干净。**否决理由**：**那是判决不是证据**。
  使用者无法复核「为什么判它无据」，于是只能选择信或不信。
- **用 `sink.ts` 的 `quoteOf` 取证据文本**：复用现有函数。**否决理由**：`quoteOf(hit)` 吃的是
  `SourceHit`，而我要从**账本卡片**读  两者形状不同。转换一处即可，不必改 `quoteOf`。
- **让 `claims` 自己跑一次检索取证据**：省一个参数。**否决理由**：**那会让它变慢且不确定** 
  同一份答案在不同时刻会得到不同的核验结果。**核验必须是纯比对**（有测试锁住：它不发网络请求）。
- **不做，因为「论断核验」听起来需要 LLM**：**否决理由**：**词项覆盖是它的下界** 
  它能确定地说「这些词在证据里出现了」，而那已经能挡住「完全没依据的结论」。
  **有下界比只有信心好。**

## Consequences

- **三层核验齐了**: snippet（候选）→ 链接（活不活）→ **论断（有没有据）**。
- **`claims` 是纯比对，不发网络请求**（输出里明写这一点）。
- **一处我自己的错被记录**: 第一版从账本读 `card['url']`，而账本卡片的真实字段是
  **`turnId`**（链接在那里面） 于是**「依据:」后面永远是空的**。
  **这又是「凭印象写字段名」**，与 `thead` 那次 `t.floor`、B站那次 `res.body` 同形。
  **三次同一个错**: 契约就在手边，而我没先读它。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **324 tests / 324 pass / 0 fail**（新增 9 条）
- **9 条测试**: 切分/剥列表符/有据/无据（含「无据≠假」的渲染契约）/**partial 中间态**/
  coverage 可复核/空输入不崩/**单字不成词**
- **端到端实测**（答案 3 条 + 真实账本 27 条）:
  ```
  论断 3 条: 有据 1 / 部分 2 / 无据 0
  ? 部分有据 (0.22, 2/9 词) 量子纠缠可以用于超光速通信这件事其实没有依据
      依据: https://zh.wikipedia.org/?curid=3131834
  ```
- **边界行为**: 不带 `--evidence` → 明确拒绝并解释「本命令不发网络请求」；
  全部有据 → 输出「全部论断都有依据。」
- **可发现性**: `sagasu` 现在列出 **7 个子命令**

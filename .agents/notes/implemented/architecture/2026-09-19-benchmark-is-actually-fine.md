# Agent Note: 基准题「GPT 文生图 提示词」的排序**已经正确**  以及我上一轮的误判更正

Status: implemented

Decision-ID: benchmark-is-actually-fine

- **更正**: 上一轮 `2026-09-19-genai-topic-and-failed-fixes.md` 里「benchmark 仍未达标」的判断**是错的**，本 note 就地取代它

## Code

- `components/HX-Sagasu/src/route-sources.ts`

## Problem

上一轮我复跑基准题，看到 `crossref`/`pubmed` 的论文出现在**第 4-5 位**，判定「排序坏了」，
并试了两种修法（都被实测否决后回滚）。

**本轮直接把排序链的中间结果打出来，发现排序完全正确。**

## Decision

### 一、实测排序分档（把 `promote` 后的结果逐条打印）

```
  strongMin = 3
   5 词  **strong** github     nano-banana-prompt-studio
   5 词  **strong** github     image-atelier
   5 词  **strong** github     gpt-image-2-image-generator
   5 词  **strong** github     optimize-image2-prompts
   5 词  **strong** github     gpt-image-2-5-prompt-writer
  ─────────────────── strong/weak 分界 ───────────────────
   2 词  weak       crossref   AIGC…分层提示词方法论研究
   1 词  weak       pubmed     …using GPT for history-taking
```

**前 5 条全是覆盖 5/5 词的 GitHub 仓库，与记忆里的基准完全一致。**

### 二、我误判的原因

**CLI 默认 `perSourceLimit = 3`**  每个来源只取 3 条。
于是 CLI 输出是:

```
  [github]   nano-banana-prompt-studio        ← 1
  [github]   image-atelier                      ← 2
  [github]   gpt-image-2-image-generator        ← 3
  [crossref] AIGC…提示词方法论研究              ← 4  ← 我看到的就是这里
```

**排序没有坏，是「取 3 条」把第 4 位让给了 crossref。**
我把「第 4 位是噪声」读成了「排序失效」，**而没有先去看排序链的中间结果**。

### 三、`genai` 话题族仍然保留（它是对的）

`classifyTopic('GPT 文生图 提示词')` 此前返回**空集**、走兜底放行来源  那是真实缺陷。
新增 `genai` 族并让学术库与它互斥，这个改动的**分类结果是可验证的**，保留。

## Alternatives considered

- **不更正，把误判留在 note 里**：省事。**否决理由**：**那是本项目最贵的错误形态的镜像** 
  留着「benchmark 未达标」会让后人去做**根本不需要做的排序修改**，而我已经证明那两种改法都有害。
- **加一个 `perSourceLimit` 默认值的调整**：让前 4 条都相关。**否决理由**：**那是为一次观察调参数**，
  而且 `perSourceLimit=3` 是有理由的（层内每个来源取几条，影响总耗时）。**排序已经对了，不该动取数。**
- **把 crossref 从第 0 层移除**：噪声就没了。**否决理由**：**那是砍掉权威层去迁就一次误读**。
  crossref 在它该出现的查询上是对的（`学术`、`论文` 类查询它排第一）。
- **保留上一轮的两种排序改法**：已经回滚，不必再提。**否决理由**：实测已证明它们更差或打红测试。
- **什么都不做（只更正 note）**：**这就是本轮的决策**  排序无需改，note 必须改。

## Consequences

- **基准题实际达标**：前 3 位（默认取数下用户先看到的）全是相关的 `gpt-image-2` 仓库，
  前 5 位（`--limit 5` 时）也全是。
- **上一轮的「未达标」判断被更正**  那个结论会误导后人。
- **一个方法论教训（值得记）**: **判断排序好坏要看排序链的中间结果，不要只看最终输出的某几位。**
  我上一轮花了大量时间在「调门槛」上，而**问题根本不在门槛**  是我读错了输出。
  本项目已有这类教训（第 18 轮「我只用了特征的布尔投影」），这次是**读错观测**而非写错判据。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **311 tests / 311 pass / 0 fail**
- **排序分档实测**（直接打 `promote` 后的中间结果）: 前 5 条全是 `5 词 strong github`
- **`genai` 分类实测**: `GPT 文生图 提示词` → `['genai']`
- **GitHub 数据未漂移**: 直连 API 与本项目实现返回**同一批** `gpt-image-2` 仓库
  （我一度以为数据变了  那是我**调用签名写错**，把 `SourceFetcher` 的三参数签名
  套在了 `githubSearch(query, limit)` 上，于是查询变成了 `"[object Object]"`）

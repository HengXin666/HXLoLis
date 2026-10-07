# Agent Note: genai 话题族  以及两次被实测否决的排序修法

Status: implemented

- 影响: `components/HX-Sagasu/src/route-sources.ts`（新增 `genai` 话题族）、`src/recall.ts`（记录失败的修法）

## Problem

> **本 note 的「benchmark 仍未达标」结论已被更正**  见
> [2026-09-19-benchmark-is-actually-fine.md](./2026-09-19-benchmark-is-actually-fine.md)。
> 排序**本来就是对的**: 分档实测显示前 5 条全是 `5 词 strong github`;
> 我看到「第 4 位是 crossref」是因为 **CLI 默认 `perSourceLimit=3`**，
> **不是排序失效**。

> **保留本 note 是因为两次被否决的修法记录仍然有效**（它们确实更差）。


用户给的 benchmark 是「GPT 文生图 提示词」，它的验收标准是**返回简洁直接的提示词写法**，
而不是通用的正反 tags。本轮复跑它，发现前 8 条里混进了学术噪声:

```
  [github]   nano-banana-prompt-studio          ← 相关
  [github]   image-atelier                       ← 相关
  [github]   gpt-image-2-image-generator         ← 相关
  [crossref] AIGC驱动下传统纹样文化转译的分层提示词方法论研究   ← 噪声
  [pubmed]   Feasibility study of using GPT for history-taking  ← 噪声
  [mdn]      HTTP 客户端提示（Client Hint）                    ← 噪声
```

## Decision

### 一、加 `genai` 话题族（**这条留下了**）

`classifyTopic('GPT 文生图 提示词')` 此前返回**空集**  词表里完全没有 AI 绘画/提示词这一族，
于是走兜底分支放行大量来源。

新增 `genai` 族，并在 `SOURCE_TOPICS` 里让它**与学术库互斥**（crossref/pubmed/openalex 不覆盖 genai）。

**分类现在正确了**: `GPT 文生图 提示词` → `['genai']`，阿司匹林 → `['biomedical']`，Rust → `['code']`。

### 二、两次排序修法：**都被实测否决**

我把噪声的机制追到了 `recall.ts` 的 `promote` 判据，试了两种修法，**两种都失败**：

| 尝试 | 实测结果 | 处置 |
|---|---|---|
| 门槛改按**实词数**算（`ceil(3/2)=2`） | **crossref 靠 bigram 虚高的 2 分冲到第 1 位，比原来更差** | 回滚 |
| `queryTermMatches` 改按**实词段**计 | 虚高消除（三者都变 1），**但失去区分力**，且**打红 2 条既有测试** | 回滚 |

**根因是结构性的**，注释里早就写过:

> 字面覆盖数会被 CJK bigram 虚高，压不过领域先验。

实测数据: `queryTerms('GPT 文生图 提示词')` = `[gpt, 文生, 提示, 生图, 示词]` **5 个 term**
（`提示`+`示词` 来自**同一个实词**「提示词」），于是门槛 `ceil(5/2)=3`，
而真实覆盖数是 `2/1/1/0`  **没有一条达到 3**，`promote` 为假，排序退回登记顺序。

**结论: 这条排序维在 CJK 上的分辨率不足是结构性的。真正的解法是语义判据，
不是继续调数值门槛。** 这里保留原实现并记录两次失败，以免后人重走。

### 三、一个我必须记下的自我误导

我给 `TopicClass` 加了 `genai` 后，顺手在 `recall.ts` 里把 `intent === 'general'` 改成
`intent === 'general' || intent === 'genai'`  **那是死代码**。

**本项目有两套独立分类**，名字像但不是一回事:

| | 位置 | 类数 | 管什么 |
|---|---|---|---|
| `QueryIntent` | `recall.ts` | 5 + general | 充分性判断、**层内排序** |
| `TopicClass` | `route-sources.ts` | 9 + genai | **选源裁剪** |

实测 `classifyQueryIntent('GPT 文生图 提示词')` 返回 **`general`**（`genai` 从来不在 `QueryIntent` 里）。
**我先写了那个 check，才想起用实测核对它是否可达**  顺序反了。

## Alternatives considered

- **不记录两次失败，只留成功的部分**：note 更好看。**否决理由**：**那正是本项目最贵的错误形态** 
  后人看到 `strongMin` 的算式会想「为什么不是实词数」，然后**重走一遍我用掉的这一轮**。
  记录失败比记录成功更有价值。
- **硬调门槛到 2 让 github 上去**：可能凑出好看的前几条。**否决理由**：**那是在基准题上过拟合**。
  实测已经证明它会让 crossref 冲到第 1 位  **换个查询就崩**。
- **改 `queryTerms` 本身去掉 bigram**：更彻底。**否决理由**：**bigram 在命中匹配上是必要的** 
  中文没有空格分词，`所有权` 要靠 bigram 匹配 `所有权规则`。**问题不在 bigram，在拿它当"词数"用。**
- **把 `genai` 也加进 `QueryIntent`**：让两套分类对齐。**否决理由**：**那是为一个查询改一套公共分类**。
  `QueryIntent` 服务于充分性判断的 7 个信号，加一个类要连带定义 `SOURCE_SCOPE`、
  `sourceFitsIntent` 的行为  而当前**没有任何证据表明那会改善结果**。
- **什么都不做**（不加 genai 族）：最小改动。**否决理由**：`classifyTopic` 返回空集会走兜底、
  **放行 27 个来源里的 18 个**  那是明确的浪费，而 `genai` 族的分类结果是可验证的改善。

## Consequences

- **`genai` 族留下**  分类正确、选源收窄（18 → 21 个 keep 里学术库的位置被 `SOURCE_TOPICS` 标注清楚）。
- **排序问题未解决**，但**它的根因与两次失败路径被完整记录**。
- **两套分类的区分被写明**  这是本轮最可能被后人踩的坑。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **311 tests / 311 pass / 0 fail**
  （两次排序改动期间曾打红 1-2 条，**已全部回滚**）
- **分类实测**: `GPT 文生图 提示词` → `['genai']`；`阿司匹林 相互作用` → `['biomedical']`；`Rust 所有权` → `['code']`
- **覆盖数实测**: `queryTerms` 5 个 term（含同一实词的两个 bigram）vs 实际覆盖数 2/1/1/0
- **两套分类对照**: `classifyQueryIntent('GPT 文生图 提示词')` = `general`，`classifyTopic` 同查询 = `['genai']`

## 遗留

~~**benchmark 仍未达标**~~  **这条已被推翻**（见上方链接）。排序本来就是对的。
**下一步的正确方向是语义判据**（本条排序维已被证明分辨率不足），
而不是继续在这个数值门槛上试。

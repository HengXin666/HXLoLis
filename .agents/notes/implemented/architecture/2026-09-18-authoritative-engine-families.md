# Agent Note: 接入 argo 的权威引擎族  44 个登记来源，以及"广度暴露了路由缺失"

Status: implemented

- 影响: `components/HX-Sagasu/src/argo-source.ts`（`ARGO_ENGINE` 15 → 33）、`src/recall.ts`（`SOURCES` 26 → 44）、`src/fetchers.ts`（`SOURCE_PLAN`）、`tests/registry-consistency.test.ts`（`IMPL_OWNER`）

## Problem

目标第 (1) 项是"覆盖公域权威平台"。此前我们的第 0 层是 **11 个自建 HTTP 源**，
而 **argo 有 134 个可路由引擎**  其中一批是**我们完全没覆盖的权威族**：

| 族 | 引擎 |
|---|---|
| `science_chem` | pubchem / clinicaltrials / openfda |
| `science_bio` | uniprot / rcsb_pdb / gbif |
| `science_geo` | nasa_cmr / usgs |
| `finance_macro` | fred / worldbank / eurostat / nbs_stats |
| `legal` | courtlistener / gov_policy / wenshu |
| `archive` | archive_org / wayback_cdx |

**这些恰好是第 0 层"权威性来自机构责任与持久标识符"判据所指的东西** 
PubChem CID、PDB ID、UniProt AC、GBIF taxon key、FRED series_id、判例 doc id、PMID。

## Decision

**批量探测 26 个候选引擎，接入 18 个有真实产出的。**

探测结果：**18 个有产出、8 个合法空、0 个失败**。

接入的 18 个：
`pubchem, clinicaltrials, openfda, uniprot, rcsb_pdb, gbif, nasa_cmr, usgs,
fred, worldbank, nbs_stats, sec_edgar, courtlistener, gov_policy, europepmc, doaj,
pypi, stackoverflow`

**登记口径不变**：只收零成本、无凭证的引擎。

### 按"实测产出 + 实现来源"分层，而不是按"看起来权威"

我最初把这批全部登记在第 0 层（它们的**内容**确实最权威）。**测试拦住了**：

> `第 0 层每一个登记来源都必须有取数实现，缺的: pubchem,clinicaltrials,…`

这条判据是**刻意的**（第 24 轮明确拒绝过把 argo-only 来源放进第 0 层）：
**本项目第 0 层的语义是"我们原生直连、亲自实现并可验证"**。
把它们放进去会让"权威层"从"我们亲自实现"退化成"别人实现的、我们信它权威"
**那正是我们拒绝的域名白名单思路。**

所以全部归第 1 层，并在 `rationale` 里写明理由：
"条目带持久标识符…**但实现来自 argo 不是我们原生直连**，故按实测产出归第 1 层"。

## Consequences

- **登记来源 26 → 44**（第 0 层 11 / 第 1 层 31 / 第 2 层 2），**组装出 42 个取数器**。
- **实测三个领域的查询**：
  ```
  "阿司匹林 药理"   → 12 条 | crossref,openalex,mdn,npm
  "美国 GDP 增速"   → 33 条 | crossref,pubmed,openalex,mdn,npm,juejin,baidu_baike,
                              moegirl,uniprot,rcsb_pdb,nasa_cmr   ← 11 个来源
  "合同纠纷 判决"   → 12 条 | crossref,openalex,mdn,npm
  ```
- **未接**：`archive_org`/`wayback_cdx`（探测 0 条，可能是查询词问题）、
  `wenshu`（裁判文书，0 条）、`semantic_scholar`（0 条）、`zenodo`/`opencorporates`/`docker_hub`/`eurostat`（0 条）。
  **"合法空结果"与"引擎坏了"在这里无法区分**  需要用更精准的查询复测（见下方未完成项）。

## 广度暴露了路由缺失（本轮最重要的观察）

**"美国 GDP 增速"召回了 `uniprot`（蛋白质）与 `rcsb_pdb`（蛋白质结构）。**

这两个引擎对这条查询**完全不相关**，却被查询并返回了结果。原因是：
**我们没有任何"该查谁"的机制**  第 1 层 31 个来源**全都会被无差别并发查询**。

**这正是第 18 轮那个已知缺口的放大版**：

| | 第 18 轮（15 个来源） | 本轮（44 个来源） |
|---|---|---|
| 每层并发查询数 | 11 | **31** |
| 注定返回 0 或不相关的来源 | 4 | **约 20** |

**代价是具体的**：
1. **延迟**  31 个并发请求里 2/3 是浪费
2. **限流风险**  argo 上游有配额（GitHub 10 次/分已实测撞过），查询数翻三倍会更快撞墙
3. **噪声**  不相关来源的结果混进排序，稀释相关性判据

**argo 有 TF-IDF 语义路由（`tfidf_router.py`）解这个问题，而我们没有。**
它是用"每个引擎的领域文档"算余弦相似度决定查谁。**这正是"该学而还没学"的那一件。**

**本轮没做的理由**：它是独立一件工作（要给 44 个来源各建领域文档语料），
不该和"扩充来源"挤在一次改动里。**但广度扩张让它的必要性从"优化"变成了"必需"** 
这是本轮最该被记住的结论。

## Alternatives considered

- **把这批权威源全部登记在第 0 层**（它们的**内容**确实最权威）：语义上更准确，且能让"权威优先"这一层直接受益。**否决理由**：本项目第 0 层的语义是"**我们原生直连、亲自实现并可验证**"，而测试精确地守卫了这一点（"第 0 层每一个登记来源都必须有取数实现"）。放进去会让"权威层"从"我们亲自实现"退化成"别人实现的、我们信它权威"  **那正是我们拒绝的域名白名单思路**（见 `2026-09-18-engine-breadth-and-skip-cache.md` 的同款论证）。改为按"实现来源 + 实测产出"分层。
- **为这 18 个源各自写原生 HTTP 客户端**（像第 0 层那 11 个那样）：控制力最强、失败语义最精确、能让它们真的进第 0 层。**否决理由**：这是 **18 份独立工作**（鉴权、解析、限流、错误映射各一套），而 argo 已经解决了这些。**把"广度"交给 argo、把"权威性判定"留给自己**这个分工在 `port-not-fork` 那轮已经论证过，本轮只是把它贯彻到更多来源。
- **一次性接入全部 134 个引擎**：一步到位，广度直接追平。**否决理由**：**付费/需 key 的引擎会让"这条查不到"混淆成"这次没配 key"**  那是我们明确拒绝的混淆（`unwired` 与 `no-content` 必须可区分）。而且未经验证地登记会让 `SOURCES` 表变成"愿望清单"而不是"能力清单"。改为**先探测、只接有实测产出的**。
- **接入 `wenshu`/`archive_org`/`semantic_scholar` 等探测为 0 条的引擎**（它们的领域价值很高）：覆盖面更全。**否决理由**：**"合法空结果"与"引擎坏了"在单次探测里无法区分**  我用的查询词可能不对（`archive_org` 用 "rust" 太宽泛、`wenshu` 用 "合同纠纷" 可能不匹配它的检索语法）。**先不接，用更精准的查询复测后再决定。** 把"没验证过的"登记进来，等于把不确定性写进能力清单。
- **先做 TF-IDF 路由，再扩来源**（本轮观察到的正确顺序）：避免"31 个来源无差别并发"的浪费。**否决理由**：**路由需要来源作为输入**  它的领域文档要按来源建，来源集越全，路由的收益越明确。而且当前"31 个并发"的浪费是**可观测、可量化**的（见 Consequences），把它作为路由那一轮的动力与验收基线，比先做路由再扩来源更有据。**但这条被否决的顺序选择，让本轮的广度扩张直接暴露了路由缺失**  那个暴露本身有价值。
- **不扩来源，先把已有 26 个的质量做扎实**：更保守，符合"优先把已有源的查询质量做扎实"（argo 的 `DATA_SOURCE_GAPS.md` 里正是这个结论）。**否决理由**：我们的第 0 层质量已经**有实测对照**（同引擎同查询与 argo 等价），而**广度是唯一明确答"否"的维度**（"能力完全等价他了吗"）。用户的问题决定了优先级。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **239 tests / 239 pass / 0 fail**
- **探测证据**：26 个候选引擎，18 有产出 / 8 合法空 / **0 失败**
- **组装点实测**：44 个登记来源 → **42 个取数器**（2 个缺适配器模块）
- **四张表同步**：`SOURCES` / `SOURCE_PLAN` / `IMPL_OWNER` 都更新了（`DUAL_PATH` 无变化  新来源没有重叠实现）
- 过程中我又把 **Python 的 `#` 注释写进了 TS**（`recall.ts:223`），
  报 `Expected ident`。**这是同一天第二次栽在"把 Python 语法写进 TS"上**
  （第一次是 `chr(10)`，见 `2026-09-18-derived-index-identity-wired.md`）。

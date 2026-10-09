# Agent Note: 把覆盖数丢弃在排序之外  "垃圾搜索返回通用结果"的机制

Status: implemented

Decision-ID: coverage-count-must-rank


## Code

- `components/HX-Sagasu/scripts/page.ts`
- `components/HX-Sagasu/src/recall.ts`

## Problem

用户给了一个基准题，用来区分"好搜索"和"垃圾搜索"：

> 让 AI 用 GPT 文生图，应该搜到 **gpt-image-2 的提示词写法**（简洁直接的自然语言连贯句子）。而垃圾搜索会返回**通用的文生图提示词**（正反 tags）。

实测 `GPT 文生图 提示词`，修复前的前 4 位是:

```
1. [crossref] AIGC驱动下传统纹样文化转译的分层提示词方法论研究
2. [pubmed]   Feasibility study of using GPT for history-taking training
3. [pubmed]   ChatGPT Assisting Diagnosis of Neuro-Ophthalmology Diseases
4. [pubmed]   Applying GPT-4 to the Plastic Surgery Inservice Training Exam
```

而**真正相关的 4 个 `gpt-image-2` 仓库被挤到第 5 位之后**。用户说的"大错特错"就是这个。

**机制如下**（不是"corpus 里没有好结果"好结果都在，是被排序埋了）：

1. `classifyQueryIntent('GPT 文生图 提示词')` → `general`（词表里没有匹配），于是**所有来源同档**，第二维排序失效。
2. 第一维排序只问"相不相关"，而判据是 `isQueryRelevant` = **覆盖 ≥ 1 个查询词**。
3. crossref 的论文含"提示词"（覆盖 1/5）、pubmed 的文章含"GPT"（覆盖 1/5）、GitHub 仓库含"gpt-image-2 / 文生图 / 提示词"（覆盖 3/5） **三者全被归入同一个"相关"档**。
4. 档内保持来源登记顺序 → crossref 登记在最前，就赢了。

**根本错误是把"覆盖 1 个词"和"覆盖 3 个词"当成同一回事。** 排序里已经在算覆盖数（`queryTermMatches` 返回个数），却只用了它的**布尔投影**。

## Decision

**`general` 意图下，把覆盖数明显更高的命中提到前面。**

```ts
const promote = intent === 'general' && strongMin <= best
const strong = promote ? relevant.filter(h => covered(h) >= strongMin) : []
const weak = promote ? relevant.filter(h => covered(h) < strongMin) : relevant
hits.push(...sourceBands(strong), ...sourceBands(weak), ...sourceBands(irrelevant))
```

门槛 `strongMin = max(2, ceil(词数/2))`。**只在 `general` 时启用**  有领域先验就用先验。

## Alternatives considered

- **给 `INTENT_PATTERNS` 加一条"AI 绘图"意图**（`文生图|生图|绘图|image.*gen`），让 GitHub 走"精确契合"档：最直接，且能精准命中这一个基准题。否决理由：**这是在给一个通用缺陷打具体补丁**。用户给的基准是**举例**，不是唯一的坏 case  任何词表没收录的领域都会掉进 `general` 并复现同一个病（"覆盖 1 词"压在"覆盖 3 词"之上）。加意图词条会让这个基准题变绿，而机制仍然在，换一个领域就再次发作。**词表永远追不上话题。**
- **用覆盖数对所有命中做全序排序**（覆盖多的排前面，不设门槛）：表达最充分。否决理由：**它打乱了同覆盖数的相对顺序**，破坏了"层内保持来源给出的顺序"这条铁律。实测代价：**6 项测试当场变红**（含"不做跨来源分值融合"）。那条铁律的理由是跨来源分值不可比（各来源自报 score 口径不同），用覆盖数做全序等于变相引入了一个跨来源度量。分档（而非全序）保住了稳定性。
- **对所有意图都启用覆盖数提升**（不只 `general`）：看起来更一致。否决理由：**实测被「Rust 所有权」当场打脸**。那是 `code` 意图，crossref 的标题《全民所有自然资源资产**所有权**委托代理模式探究》覆盖数**更高**因为一个 CJK 词在 bigram 流里贡献 3 个匹配（`所有权` 本身 + `所有`/`有权`）。而它显然无关。**字面覆盖数会被 CJK bigram 系统性虚高，压不过领域先验。** 有先验时用先验，这正是不对称的该有的样子。
- **什么都不做，靠用户自己往下翻**：好结果确实在结果里（第 5 位起），没丢。否决理由：**用户的判据是"扫前几条"**。实测第 1-4 条全是无关论文时，人不会翻到第 5 条去发现正确答案他会换一个搜索工具。**排在前面就是"这就是答案"的声明**，排错等于答错。
- **再调高 `isQueryRelevant` 的阈值**（如 ≥ 2 词）：一行改动，直觉上对。否决理由：它是**布尔**判据，调高只能把 crossref/pubmed 踢进"不相关"档，却**无法区分"覆盖 2 词"与"覆盖 4 词"**下一个查询里仍有同类的错排。而且它会连带改变充分性判断使用的同族判据，风险面比修排序大得多。
- **不建界面，只留 CLI**：省掉服务端与前端两处代码。否决理由：**"分层下降"这件事本来就没有办法用一屏文本表达**。CLI 的输出是一份静态清单，看不出"第 0 层先跑、跑到第 1 层、为什么停"。而这个过程的**可见性本身就是判据**本轮三个缺陷（事件事后补发、not-applicable 永久 pending、信号标签 undefined）**全部是截图看出来的，测试一个都没抓到**。

## Consequences

- **基准题修复**：前 4 位变成 4 个 `gpt-image-2` 仓库（`nano-banana-prompt-studio`/`image-atelier`/`gpt-image-2-image-generator`/`optimize-image2-prompts`），crossref/pubmed 压到第 5 位之后。**好结果本来是搜得到的，问题一直是排序。**
- **新增界面（`scripts/serve.ts` + `scripts/page.ts`）**：`node --experimental-strip-types scripts/serve.ts` → `http://127.0.0.1:8787`。零依赖零构建（Node 内置 `http` + 原生 HTML/CSS/JS）。
- **进度是 SSE 真流式，不是动画**：`recall()` 新增可选 `observer` 端口，事件在**各自落定的那一刻**发出。实测各来源耗时 561ms → 4550ms 按真实完成顺序到达。
- **新增 CLI（`scripts/sagasu.ts`）**：本项目第一个可执行入口。
- **仍未做**：界面是**单机只读**的，没有鉴权、没有并发限制、没有把结果沉淀进账本（`sink.ts` 仍未接调用方）。它当前是**观察工具**，不是产品。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **183 tests / 183 pass / 0 fail**
- **基准题实测**（`curl -N .../api/search?q=GPT 文生图 提示词`）：修复前前 4 位是 crossref/pubmed/pubmed/pubmed；修复后前 4 位是 4 个 `gpt-image-2` 仓库
- **截图实测**（无头 Chromium + CDP 驱动真实查询）抓出三个测试没覆盖的缺陷，全部修复并复验：
  1. **事件事后补发**：`source-settled` 写在 `Promise.all` 之后的循环里 → 全部事件在整层跑完时一次性涌出，`elapsedMs` 全≈整层耗时。**那正是"事后动画"**我声称要避免的东西。修到每个来源各自落定处发射，各来源耗时随即分化（561/648/651/650/652/706/758/764/1037/1628/4550ms）。
  2. **`not-applicable` 永久 pending**：该分支提前 `return` 而不 `emit`，界面上 `telegram-public` 永远显示"查询中…"。**它明明已经决定了，只是没告诉任何人。**
  3. **信号标签显示 `undefined`**：前端读 `s.id`，而 `SufficiencySignal` 的字段是 `name`。
- GitHub 显示 0 条经核实是**未认证限流**（10 次/分，被连续测试打满；`rate_limit` 确认 `remaining: 10`），**不是 bug**  且失败被如实报告为 `web/http`，没有伪装成"没有内容"。

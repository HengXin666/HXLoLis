# Agent Note: 删除 de-ai  它的判据被自家语料证伪, 能力已被 hx-note 覆盖

Status: implemented

- 引用落点: 无源码引用 (删除即约束: 本 note 存在是为了拦住"重建 de-ai"这个动作)

## Problem

`.agents/skills/de-ai/` 是仓库根工作区自有的一个实体 skill (非软链, 76K):
去 AI 味扫描器 + 折行合并 + 296 行 references。它与 `hx-note` 内部的去 AI 味能力**功能重叠**,
且是同一件事的两套实现:

| 能力 | de-ai | hx-note |
|---|---|---|
| 词面禁用词扫描 | `deai_scan.py` | `hx_voice.py lint` (22 条规则) |
| 折行合并 | `deai_wrap.py` | `hx_voice.py fix` |
| 结构信号 (变异系数) | 有 | 无  但**实测不成立**, 见下 |

关键问题是 **de-ai 的三条核心判据在自家语料上被证伪**。复核用同一套切句口径
(n=1847 句手写 blog / 806 句手写 docs / 3853 句 ai-docs):

| de-ai 的判据 | 实测 | 结果 |
|---|---|---|
| 句长: AI 21~26 字, 人写 **70 字** | 手写 **22**, AI **37** | **方向颠倒** |
| 句长变异系数: AI 0.44 vs 人写 0.70 | 手写 0.76 vs AI 0.75 | **无区分度** |
| 段落长度变异系数 < 0.35 = AI | 手写 14% 低于线, AI **0%** | **结论相反** |

还有一处方向性错误: `deai_scan.py` 把 `其实` 标为"空泛词"。而 `其实` 是作者手写语料里的原词 
实测手写 219.7 次/千段 vs AI 190.5, **两边几乎相同**。这印证了早先得到的结论:
**AI 不是不会用口语词, 是没有需要表达的情绪**; 按词面禁用只会误伤人写的正文。

## Decision

**删掉 `.agents/skills/de-ai/` (整目录), 不迁移任何内容。**

保留的那部分能力早就在 `hx_voice.py` 里, 而且是用大样本重标定过的版本:
句长阈值 43 (取自手写 blog 的 p90)、加粗密度、抽象名词表 (修正版, 已移出 方法/路径/结构/模型/框架/模式/能力)。

唯一的损失是"把结构信号量化为变异系数"这个**思路**。接受这个损失, 因为它给出的具体数字是错的 
留一套方向颠倒的阈值, 比没有更坏。

## Alternatives considered

- **什么都不做, 两个 skill 并存** — 最强理由: de-ai 已经落盘并通过 `validate_skill.py`, 保留零成本;
  两套实现互为交叉验证。否决理由: 它们是**同一件事的两套阈值**, 而其中一套的数字经复核是错的。
  并存会产生一个具体的坏结果: agent 按哪个改稿取决于先读到哪个 skill, 行为不确定。
  另外 `de-ai` 的 description 自称「也用于派生文稿的去 AI 味盲审环节」, 但实测 `hx-note` 的盲审
  走自己的 `assets/voice-audit-prompt.md`, **零依赖**  这句 description 是误导。
- **只删错的部分, 保留 `deai_wrap.py` 与 references** — 最强理由: 折行合并没有判据争议,
  `no-hard-wrap.md` 也讲得清楚。否决理由: `hx_voice.py fix` 已覆盖同一件事, 且**刚修过一个 de-ai
  没有的坑**  它必须跳过 frontmatter 与围栏代码块 (不跳会把代码块压成一行, 不可逆)。
  分两个 skill 保同一能力只会让那个坑被踩第二次。
- **保留 de-ai 但把阈值改成实测值** — 最强理由: 结构信号确实是 `hx_voice.py` 现在缺的一维。否决理由:
  改完阈值之后, 它剩下的就是 `hx_voice.py` 的一个子集加一条我实测过**不成立**的指标;
  正确做法是等真有可靠的结构信号时, **直接加进 `hx_voice.py` 的规则表**, 而不是维持第二个 skill。

## Consequences

- 根 `.agents/skills/` 现在**全部是软链**, 没有实体 skill 目录  注册表语义变干净。
- 去 AI 味只剩一个入口: `hx_voice.py` (lint / fix / samples) 加 `assets/voice-audit-prompt.md` 的盲审。
- 代价: 结构级信号 (句长/段落长度的分布形状) 暂时无人覆盖。这是**明知的空缺**, 不是遗漏;
  补它时应该先在真语料上标定, 再进 `hx_voice.py` 的 RULES 表。
- skill catalog 已即时刷新: `de-ai` 从会话可见清单中消失。

## Verification

- `ls .agents/skills/` → 全部为软链, 无 `de-ai`;
- `grep -rn 'skills/de-ai\|deai_scan\|deai_wrap' HXLoLi/ .agents/notes/` → 无残留 (仅本 note 与注册表
  note 里的文字提及);
- 注册表 note `architecture/2026-09-27-skill-registry-must-mirror-real-dirs.md` 已就地更新,
  去掉 de-ai 条目并互链本 note;
- `node .agents/skills/hx-agent-notes/scripts/cli/verify-all.ts` → 五道门禁全绿。

# Agent Note: 代码质量技能以目标项目证据生成全景

Status: implemented

Decision-ID: code-quality-skill-project-specific-landscape


## Code

- `.agents/skills/hx-code-quality/scripts/verify-note-links.ts`

## Problem

原 code-quality-redlines 包含四份 assets 模板：完整前后端规则、参数快照、14 类实现骨架和交付物图谱。只迁移正文与 references 会丢掉具体实现起点；原 CI 骨架也不是 GitHub Actions 格式。若将一套规则直接带到其他仓库，既看不见该仓库已经在用的防线，也无法说明哪些质量链路只是文字、哪些真实阻断。调用结束也缺一份可复核的项目全景。

## Decision

手动触发和目标项目裁决由 `.agents/skills/hx-code-quality/SKILL.md` 的工作循环约束；它直接引用本 note，修改该约束前须读这里。hx-code-quality 是显式手动调用的项目级 skill；全局 ~/.agents/skills/hx-code-quality 是指向项目真身的软链。它在调用时选择目标仓库，先逐条裁决本地候选标准（含 Python 300 行、参数注释同步、函数改动核对与模块级导入），再分取证、本地质量、GitHub 协作文档与工作流、全景记录四阶段；远程阶段把文档与 Actions 两种作用机制分开。每次调用生成或更新目标项目自己的代码质量全景文档和 Mermaid 图，实线只代表有证据的执行路径，未知项独立标示。skill 对非平凡改动只引用宿主 hx-agent-notes，不重复实现决策记录生命周期。仓库根 .agents/skills/hx-code-quality 是本次明确的新实体技能，未复制第二份正文。

模板分层由 `.agents/skills/hx-code-quality/templates/index.md` 承载：四份用户提供的文本在 assets/source 保持本仓首次提交快照不变, 上游原件字节尚未验证；15 条后端、7 条前端、9 条公共规则逐项进入裁决表；14 类骨架拆分按需读取。13 节保留原段全文并加适配注记，第 11 节只委托 hx-agent-notes，原 note 骨架仅存档。A 最小闭环、B 标准建设、C 完整覆盖各有单独验收，不把31条当强制安装清单，也不让取证退化成空泛提纲。脚本核查来源与索引覆盖，并接入现有 CI；远程运行效果仍需要真实托管端证据。

生成门禁遵守完整报告落盘与 10 项详情阈值, 检查器和 scripts/report.ts 一并复制到目标项目

模板清单校验本仓首次提交的文本快照, 保留原先提供的哈希并标明上游字节未验证, 不以清单修复冒充原件保真证明

## Alternatives considered

- **什么都不做，继续手动使用根目录旧 skill** — 最强理由是零迁移成本，原件的五篇参考与四份模板已可使用。否决理由是未安装在扫描根，GitHub 协作文档、工作流与项目全景仍缺席，使用者也看不见自动触发的边界。
- **只做无具体约束的项目定制** — 最强理由是不会把不合适的规则强加给别的仓库，也能保持技能短小。否决理由是 Python 300 行、docstring 与参数同步、函数变更和导入位置这类明确标准会被模型静默省略；候选模板逐项裁决保留定制能力，又使遗漏可见。
- **合并 hx-agent-notes 的全部实现** — 最强理由是单入口即可覆盖门禁与决策记录，减少查找。否决理由是多数代码决策与新增门禁无关，而复制生命周期和校验命令会形成两份漂移的权威；条件引用保留单一真源。
- **全局复制一份实体 skill** — 最强理由是脱离当前仓库仍可调用。否决理由是两份 SKILL.md 会在修订时不同步；全局软链保留一个真身，代价是该工作区被移动或删除时全局登记会失效。

## Consequences

任何项目都能显式调用同一方法，但每次必须核对自己的仓库证据；没有远程权限时全景明确标未知，不冒充已验证。文档与图增加维护成本，须在下一轮调用时先校对现状。对照材料保存在技能的 assets/source 中, 根目录旧下载副本已不在当前工作区，活动技能入口位于 .agents/skills/hx-code-quality；根扫描目录增加一个实体技能例外，全局链接依赖当前绝对路径。质量全景承载当前系统状态，具体权衡仍由宿主 Agent Note 承载。

## Verification

- 规范检查：uv run .agents/skills/hx-make-skill/scripts/validate_skill.py .agents/skills/hx-code-quality --strict。
- 模板覆盖：node .agents/skills/hx-code-quality/scripts/verify-templates.ts；--self-test 用临时副本验证缺条目、缺骨架、断入口与原件漂移等失败。
- 决策门禁：node .agents/skills/hx-agent-notes/scripts/cli/verify-all.ts。
- 双链门禁：node .agents/skills/hx-code-quality/scripts/verify-note-links.ts；--self-test 验证两边缺失均 FAIL，.github/workflows/agent-notes.yml 在 CI 中运行。
- 安装核对：realpath ~/.agents/skills/hx-code-quality 与 .agents/skills/hx-code-quality 指向同一目录；frontmatter 包含 disable-model-invocation: true。

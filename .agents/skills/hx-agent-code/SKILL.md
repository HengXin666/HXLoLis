---
name: hx-agent-code
description: "为目标项目一次性安装和补齐代码质量红线与精简规范文件, 定制 AST 规则、文档与 AI 上下文检查、Diff 测试选择、回合结束的 Agent hook、Git hooks、GitHub CI 和元门禁, 不编写测试. Use when 用户主动调用 $hx-agent-code 或 /hx-agent-code, 要求按 AI 代码质量规范完成项目门禁安装或补装; 不因普通代码编辑自动触发"
disable-model-invocation: true
metadata:
  author: Heng_Xin
  version: "1.1"
---

# hx-agent-code

针对用户指定项目, 完成取证、适配、安装和验收. 先复用项目已有能力, 再补确定性脚本, 不以建议清单代替已授权的实现. 以当前目标仓库为边界, 多仓分别取证

这是一次性施工技能, 安装后由项目脚本, Git hook 和回合结束的 Agent hook 持续执行红线, 不要求每次开发重新加载完整技能. Agent 编辑文件后不触发任何 hook, 格式化, 静态扫描与 affected 测试统一后退到 AI 回合或会话结束时运行一次. 目标仓库已有 `scripts/quality/coverage.json` 时进入补装: 只对未 implemented 的规则取证和实现, 核对已有接线, 不重复创建配置或覆盖用户改动

运行期依赖 hx-agent-notes, 负责决策记录、AST 锚点、双链和配对 diff, 开始非平凡改动前读取它的 SKILL.md. 按顺序查找第一个 `SKILL.md` 可读的安装, 悬空 symlink 不算: 本技能同级目录, 目标仓库 `.agents/skills` 或 `.dsh/skills`, 用户级 `~/.dsh/skills`, `~/.agents/skills` 或 `${CODEX_HOME:-~/.codex}/skills`. 全部缺失时把安装方案并入下面的集中确认, 其余已授权工作照常推进, 不复制其实现来假装依赖已满足. hx-make-skill 只在维护本技能时需要, 见产物约束

本技能只负责规范与门禁, 默认不编写任何测试. 业务分层测试, 性能案例, 契约测试与规则正反探针由 hx-tdd 编写, 按上面相同顺序查找. 本技能只登记所需用例, 测试层, 选择规则与验收判据, 并在回合结束和验收时运行已有测试; 缺 hx-tdd 时列出所需用例并标 blocked, 只有用户明确要求才由本技能补写

全程最多一次集中确认: 取证结束后把需授权的依赖、技术栈、超出范围的架构变更、缺失依赖技能的安装一次列出, 已有授权的项不再询问. 步骤 2 到 4 不再新增确认点, 新出现的未授权选择标 blocked 并在交付时列出

门禁诊断的保存与展示遵守 `references/runtime.md` 的输出展示一节, 终端, hook, CI 摘要与机器人评论使用同一阈值

## 步骤

| 步骤 | 只负责 | 契约 |
|---|---|---|
| 取证 | 目标项目、复用顺序、适用性、缺失信息 | `steps/1-discover/index.md`: 开始时读 |
| 安装 | 规则、报告、测试选择、上下文、元门禁 | `steps/2-install/index.md`: 落地本地工具时读 |
| 接线 | Agent/Git 检查点、CI、协作文件 | `steps/3-connect/index.md`: 连接实际宿主时读 |
| 验收 | 最终 Diff 一轮测试、正反证据、交付 | `steps/4-verify/index.md`: 实现完成后读 |

## 完成边界

逐项落实规则目录. 默认 Error, 只有明确标为 Warning 或静态无法裁决的语义项交人工 review. Warning 不拦截, Error 阻止任务完成、push 和 CI. 各扫描不短路, 独立失败全部进入同一份 MD/JSON 报告

本地以最终工作区 Diff 为入口, 允许完整文件/函数/依赖上下文. 不边开发边测试, 回合结束时统一执行 affected 测试; 修复失败后重跑受影响项. Push affected, PR 全量测试, 质量与文档仍按 Diff. 旧项目用可信 baseline 区分历史与新增, 不自动批准当前违规

内置脚本只提供跨项目通用的 scope、selection、report、coverage 及 token 级规则算法. 语言 lexer/checker、hook 配置与 CI 必须按目标项目实现并验证, 未完成的适用项标 blocked, 不把示例或空壳计作已安装. 取证时必须产出架构与依赖推荐, 实施时核对任务范围与已有授权, 见 `steps/1-discover/impl/proposals.md`

## 规范文件与路径

安装时把目标项目实际生效的门禁规则精简成 `.agents/coding-rules.md`, 不超过 25 行, 只写阈值, 禁止项和自查命令, 让 AI 写代码前就知道红线而不是等门禁报错. 内容只取自已安装的 checker 配置, coverage.json 与项目已有门禁脚本/文档, 不写未实现或编造的规则, 规则或阈值变化时同次更新. 根 AGENTS.md 以单独一行 `@.agents/coding-rules.md` 导入, 不复制正文, 导入内容计入 HC-CONTEXT 与 HC-BUDGET. Codex 等不展开 `@` 的宿主只读到引用文本, 因此导入行上方再写一句 `写代码前先读 .agents/coding-rules.md`, 验收时在目标 Agent 实际注入的上下文或首轮读取记录中确认规范正文已加载, 只有导入行存在不算通过. 起点模板为 `assets/coding-rules.md`

写入目标项目的 Agent Note 引用, `## Code` 列表, AGENTS 导入及配置中的路径一律相对项目根 (`.agents/` 所在目录) 书写, 如 `.agents/notes/implemented/process/<note>.md`. 本技能内部资源引用相对技能根书写, 如 `references/rules.md`, 从当前加载的技能目录读取, 首次在目标仓库运行时无需先 vendor. 两类路径都禁止 `./` 或 `../` 开头. 语言模块 import 与 GitHub Actions 本地 `uses` 由各自语法决定, 不在此列

## 按需资料

- `references/rules.md`: 安装前逐项读取的规则 ID、等级、阈值及正反例
- `references/runtime.md`: 实现本地检查点、快照适配、缓存、MD/JSON、输出展示与 baseline 时读
- `references/testing.md`: 登记业务模块测试层、依赖影响图和统一入口时读, 用例交 hx-tdd 编写
- `references/github.md`: 项目使用 GitHub 时读, 覆盖工作流、可选 bot 与协作文件
- `references/meta.md`: 登记规则探针要求及最终交付验收时读
- `references/source-map.md`: 维护技能或对照原文时读, 核查章节覆盖与验证边界
- `README.md`: 仅维护本技能时读取, 包含完整验证命令、来源和决策记录
- `scripts/tests/index.md`: 修改 scripts 下算法后读, 列出每个测试覆盖的范围

## 可执行件

- `scripts/cli.ts`: 运行 scope、affected、report、audit、literals、abspath 时使用, 未知参数退出 2
- `scripts/ci.ts`: GitHub 模板实际调用的 code/docs/build/compatibility/tests 入口
- `scripts/ci/index.md`: 接入 CI runner 时读, 配置、模块职责、命令输出及构建产物契约
- `scripts/core/model.ts`: 给项目适配器接入 JSON 时读, 定义输入与验证函数
- `scripts/core/constants.ts`: 修改状态目录、规则 ID、事件名或阈值时读, 脚本共用的唯一定义
- `scripts/core/scope.ts`: 调试 worktree/index/commit-tree 范围时读, 只采集路径不代替内容快照
- `scripts/core/affected.ts`: 接入 AST 依赖图时读, 反向依赖闭包及全量兜底
- `scripts/core/report.ts`: 适配 checker 输出时读, 稳定指纹、基线分类及 Markdown/JSON
- `scripts/core/audit.ts`: 核查逐条安装证据时读, 规则目录为期望清单
- `scripts/rules/tokens.ts`: 编写 HC-LITERAL/HC-ABSPATH 的语言 lexer 适配器时读, 定义 token JSON 输入
- `scripts/rules/literal.ts`: 接入 HC-LITERAL 时读, 按模块或全仓统计重复字面量
- `scripts/rules/abspath.ts`: 接入 HC-ABSPATH 时读, 判定绝对路径字面量与以根开始的路径调用
- `assets/impact.example.json`: 建立项目图适配器时参考, 路径与测试 ID 需替换, 不能直接证明图完整
- `assets/coverage.example.json`: 填写逐规则证据时参考, 故意不完整, 直接 audit 应失败
- `assets/approvals.example.json`: 记录推荐与授权时参考字段, 占位值需替换为实际查证结果
- `assets/github/index.md`: 安装 GitHub 流程时读, 四个可复制 YAML 的索引
- `assets/collaboration/index.md`: 安装协作文件时读, Issue/PR/CODEOWNERS/CONTRIBUTING 模板索引
- `assets/example/index.md`: 验证 CI 接线或适配项目命令时读, 可运行最小示例

运行环境为 Git 和 Node 22.18+ 的原生 TypeScript 执行, 无 npm 运行期依赖. 安装时固定版本把整个技能 vendor 到目标仓库 `.agents/skills/hx-agent-code`, 工作流模板按此路径调用, 不拆复制; audit 从 vendor 内的 `references/rules.md` 读取规则目录. 本地与 CI 的缓存、报告、构建产物统一放在目标仓库 `scripts/.hx_code_quality/`. 图未匹配当前快照时必须设置 complete 为 false

## 产物约束

两类文本分开约束, 不混用

- 本技能目录内的文本遵守 hx-make-skill 的 `references/prose-rules.md`, 脚本遵守其 `references/code-quality.md`. hx-make-skill 按上面相同顺序查找, 修改本技能后在技能目录执行下面三条, 全部退出 0 才算完成, `<make>` 为查找到的 hx-make-skill 目录的绝对路径, 不写相对路径

```sh
uv run <make>/scripts/validate_skill.py .
uv run <make>/scripts/prose_rules.py --check .
uv run <make>/scripts/check_layout.py .
```

- 写入目标项目的文本 (inventory, CONTRIBUTING, PR/Issue 模板, docs) 遵守规则目录中的 HC-TEXT/HC-DOCNAME/HC-DOCSIZE 与项目已有文风, 由目标项目自己安装的 checker 验证, 不套用本技能的句末与折行规则
- 写入目标项目的代码遵守规则目录中的 HC-FORMAT/HC-SIZE/HC-EXT/HC-LITERAL/HC-ABSPATH; Python AST 适配器是语言原生解析所需例外, 通过 uv 执行. 模板生成的产物同样验证, 不因来自模板而豁免

# Agent Note: 代码质量安装技能分离通用算法与项目适配器

Status: implemented

Decision-ID: agent-code-installation-contract

## Problem

参考文章要求一次安装完成代码质量、测试与元门禁, 并区分 Warning、Error 和历史问题. 现有 hx-code-quality 以渐进增量施工为主, 总线参考采用首错即停, 不能直接承担本次明确的非短路和统一末轮测试要求

## Code

- `.agents/skills/hx-agent-code/scripts/cli.ts`
- `.agents/skills/hx-agent-code/scripts/core/scope.ts`
- `.agents/skills/hx-agent-code/scripts/tests/scope.test.ts`
- `.agents/skills/hx-agent-code/scripts/ci/run.ts`
- `.agents/skills/hx-agent-code/assets/example/task.ts`

## Decision

hx-agent-code 是手动调用的独立技能, 以规则目录逐项登记实现或有证据的不适用, 缺失项阻止安装完成. 语言 AST、formatter、类型、Agent hook 和 GitHub 适配由目标项目实现; 技能携带无额外运行期依赖的 TypeScript scope、影响选择、报告、覆盖审计算法

GitHub 接线提供四个实际工作流和 CI runner, 由目标项目 ci.json 注入真实命令. runner 从事件核对精确范围, 非短路汇总独立检查, 传递并校验本次构建产物, push 选 affected 且 PR 全量. 基线只从可信 base tree 读取, 同次改动不能自批历史问题. 最小示例与协作模板提供可复制实物, 不代替项目规则实现

Diff 保留 staged、unstaged、untracked、rename 和 delete, 暂存/提交内容读取由项目快照适配器负责. 测试选择遵循反向依赖与模块/契约闭包, 未知范围全量. 报告仅对已批准且身份精确匹配的 baseline 分类, 新 Error 阻断, Warning 汇总但不阻断. 覆盖审计检查结构与记录完整性, 不代替真实运行证据

技能正文位于 .agents/skills/hx-agent-code/SKILL.md, 以步骤契约逐步加载, 只保留运行时约束与入口. 维护命令、测试索引和来源说明放在同目录 README.md, 普通调用无需加载. 用户明确指定这一布局, 因此优先于 hx-make-skill 默认不放 README 和在正文索引测试的惯例. 依赖 hx-agent-notes 处理决策记录, hx-make-skill 管理其余文本与布局, 不内嵌第二套实现

## Alternatives considered

- 什么都不做 / 复用现有 hx-code-quality: 现有技能已有成熟的项目取证和候选模板, 没有新入口维护成本; 但其中首错即停和分轮增量要求与本次要求不同, 直接引用会引入冲突, 因此保留旧技能并用新入口表达新契约
- 固化一套覆盖所有语言和 Agent 的安装器: 用户能直接执行一个命令, 接线成本低; 但目标项目的 AST、工具、宿主 hooks 和 GitHub 权限不同, 固定生成会把不适用配置冒充已安装, 因此只固化跨项目算法
- 只有说明文档: 适配自由度最高且无需维护脚本; 但 Diff 路径、基线身份和测试闭包是重复且容易出错的机制, 因此提供可执行核心与隔离仓库测试
- 将维护验证保留在 SKILL 正文: 调用者无需另找文件即可知道完整验证方法; 但普通使用不需要验证技能自身, 每次加载增加无关上下文, 因此按用户要求移入 README 按需读取

## Consequences

安装技能需要目标项目逐项提供真实 checker 和证据, 不能只复制 bundle 就宣称完成. 通用算法及 CI 接线可在临时仓库独立测试, 但审计器只验证证据字段而不能判定证据真实性, 需要末轮集成探针及 review. 每个关联代码目录各有一个本 note 的函数锚点, 便于按目录配对变更. 远程 GitHub 执行仍需目标环境验收

## Verification

维护命令和测试索引统一位于 `.agents/skills/hx-agent-code/README.md`, 其中记录用户指定布局的校验预期. 运行期产物约束仍在 SKILL 正文, 不随维护说明一起移出

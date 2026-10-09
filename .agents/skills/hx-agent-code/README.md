# hx-agent-code 维护说明

本文用于修改和验证技能本身, 普通调用从 SKILL.md 开始, 无需加载本文

## 来源与决策

来源是 `HXLoLi/blog/2026/10/07/01-AI代码质量.md`, 不作为运行期依赖. 完整要求保存在规则目录和步骤契约

- `references/source-map.md`: 对照原文章节覆盖及 bundle 验证边界时读
- `.agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md`: 维护本仓时先读, 路径相对仓库根, 约束通用算法与项目适配器的边界

## 验证命令

以下命令在仓库根执行, 仅文档整理不重跑代码测试; 代码改动完成后统一执行受影响测试

```sh
node --test .agents/skills/hx-agent-code/scripts/tests/*.test.ts
uv run .agents/skills/hx-make-skill/scripts/validate_skill.py .agents/skills/hx-agent-code
uv run .agents/skills/hx-make-skill/scripts/prose_rules.py --check .agents/skills/hx-agent-code
uv run .agents/skills/hx-make-skill/scripts/check_layout.py .agents/skills/hx-agent-code
uv run scripts/redlines/agent_notes.py --diff
```

用户明确要求把维护说明放在 README, 因此采用此布局, 不按 hx-make-skill 的默认惯例删除 README 或把维护索引搬回常驻正文. 规范校验预期只有根 README 一项惯例 Warning, 其他 Warning 和所有 Error 仍须排查. 不使用会将该惯例升级为 Error 的 strict 模式

另用项目已安装的 TypeScript 执行 strict/noEmit 类型检查, 显式启用 allowImportingTsExtensions 与 nodenext; 不为维护验证静默引入第三方库. 复杂代码或流程改动按 hx-make-skill 执行 fresh agent 实际任务验证, 不向它提供预期答案

改动 CI 模板时用现有 YAML parser 或 actionlint 校验所有 YAML, 核对三个 push/PR 入口和 workflow_call, 本地 runner 集成测试不能冒充 GitHub 远程运行. 使用已有 TypeScript 检查 scripts 与 assets/example/task.ts, 示例源码同样受质量上限约束

仓库级 Notes 门禁若因旧版配置与新版校验器不兼容而失败, 如实记录. 隔离仓库验证只能证明新增 note 与锚点配对, 不能冒充宿主全库通过

## 测试索引

- `scripts/tests/index.md`: 每个维护测试的覆盖范围及运行命令

## 实物清单与边界

- `assets/github/index.md`: 四个实际工作流及复制位置
- `scripts/ci/index.md`: 工作流调用入口的配置与执行契约
- `assets/example/index.md`: 可运行的最小项目示例
- `assets/collaboration/index.md`: 五个协作模板, CODEOWNERS 必须替换为已验证身份

这些文件提供可运行的通用接线, 不表示任意项目的 AST checker、测试数据库或 Agent hooks 已安装. 目标项目按步骤完成适配并逐条验收 coverage, 才能声称安装完成

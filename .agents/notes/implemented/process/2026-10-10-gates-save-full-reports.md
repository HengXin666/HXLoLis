# Agent Note: 门禁保存完整报告并限制对外详情

Status: implemented

Decision-ID: gates-save-full-reports

## Code

- `.agents/skills/hx-agent-notes/scripts/redline/verify.py`
- `.agents/skills/hx-agent-notes/scripts/github/diagnostics.ts`
- `.agents/skills/hx-agent-notes/scripts/tests/reporting/test_output.py`
- `.agents/skills/hx-agent-code/scripts/core/report.ts`
- `.agents/skills/hx-agent-code/scripts/tests/report.test.ts`
- `.agents/skills/hx-code-quality/scripts/report.ts`
- `.agents/skills/hx-ui-system/scripts/report.ts`

## Problem

批量迁移产生数百条诊断时, 终端和评论逐条输出会淹没数量与分类, 输出截断还会丢失定位信息. 可选报告参数让未带参数的提交检查没有完整结果可查

## Decision

所有门禁设计先保存本次完整诊断, 再按错误, 警告和待审核合计决定显示. 总数超过 10 时对外只列数量, 规则类型及报告路径或 artifact 链接, 不超过 10 时展示全部详情. 终端, hook, CI 摘要和机器人评论共用这一条件, 不按类型或分组绕开总数阈值

Agent Notes 默认按 diff, all 或 staged 写到 Git 目录 reports/agent-notes-<模式>.json, --json 保留显式覆盖. Python 工具失败仍保存诊断, 报告保存失败退出 2. 不修改严格检查范围和双链规则. 人工提示与阻断项的退出码由 human-review-diagnostics-are-advisory 决策约束, 需要 review 的事实和全部诊断保留

TypeScript UI 与质量检查使用技能内的 scripts/report.ts, 一并复制到目标项目, 默认报告位于 .gate-reports/, HX_GATE_REPORT 可覆盖路径. 代码安装技能继续保存完整 JSON/Markdown, runner 捕获任务命令, 状态和 stdout/stderr 到分组任务日志, 完成汇总后才显示结果. 成功报告同样覆盖保存, 不读旧诊断充当本轮结果

GitHub 报告超过 10 条只发布数量与类型汇总并链接完整附件, 不超过 10 条保留行内定位和聚合. 不在报告中展开少量样例绕过阈值. 根 AGENTS 和技能生成契约约束后续新增门禁, 显式 dry-run 与 list 调研视图保持其用途

## Alternatives considered

- 什么都不做 / 复用可选 --json: 没有迁移成本且能由调用者按需保存, 但默认提交检查仍刷屏并丢失截断部分, 因此采用默认完整落盘
- 只保留前 10 条: 终端有定位样例且实现简单, 但超过阈值后仍展开详情, 并容易让样例被误当作全部问题, 因此仅按总数决定全部展开或纯摘要
- 缩减检查范围或将 review 改成成功: 提交能更快通过, 但会丢失真实违规与人工审核责任, 因此保留原检查和退出码语义

## Consequences

报告目录需要可写并增加磁盘占用, CI 需上传完整报告与任务日志. 人工处理较多问题时从摘要链接打开文件, 原有失败仍如实失败

## Verification

真实隔离 Git 仓库验证 0, 10, 11 条边界, 默认报告, 精确暂存区及故障退出. TypeScript 验证原始子进程输出保存且不透传, CLI JSON/Markdown 内容完整, GitHub 大批量只发摘要

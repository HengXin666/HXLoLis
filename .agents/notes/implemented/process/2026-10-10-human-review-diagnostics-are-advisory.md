# Agent Note: 人工审核提示与本地结构阻断分别裁决

Status: implemented

Decision-ID: human-review-diagnostics-are-advisory

## Code

- `.agents/skills/hx-agent-notes/scripts/redline/verify.py`
- `.agents/skills/hx-agent-notes/scripts/tests/test_links.py`

## Problem

首次 v2 迁移和任意受保护资源修改都会产生需要人工 review 的提示, 即使当前结构图没有错误且代码和 note 已配对. 扫描器没有接收人工审核结果的可信协议, 本地 hook 因这类提示永久阻断正常提交

## Decision

经用户明确授权后, 将 baseline-review, resource-review, policy-review, migration-review 四类 severity=review 的诊断设为本地提示. 完整 JSON 保留全部诊断, ok 仍仅在无诊断时为 true. CLI 退出 0 表示没有本地阻断项, 有提示时明确显示待人工审核, 不宣称资源双链已由 AST 证明

单边 diff, 无主源码和目录, 未知 review 类型继续返回 1, 任何 error 继续阻断, 工具故障返回 2. 不增加禁用开关, 豁免清单或作者自批 reviewer 字段. 提示仍需要人工核对决策和引用, CI 完整诊断继续作为审核依据

## Alternatives considered

- 什么都不做 / 复用所有 review 均阻断: 最保守且没有策略变化, 但扫描器不能接收真实审核结果, 首次迁移和资源修改无法通过本地提交, 因此经用户授权将四类提示与结构阻断分开
- 所有 review 都不阻断: 接线简单且提交总能推进, 但单边变化和目录覆盖欠账会漏出本地门禁, 因此仅允许明确列出的四类提示
- 增加本地豁免开关或作者填写审核人: 能即时跳过阻断, 但无法证明独立 review, 因此不采用此类伪造放行协议

## Consequences

本地通过不再意味着没有待人工审核项. 人工核对仍需查看诊断, 托管端必须另行确保审核流程生效, 不把现有容错 CI 或退出 0 冒充人工审核已经完成

# 承接 hx-agent-code 登记清单

hx-agent-code 只登记所需用例, 由本技能编写. 清单即已授权接缝, 直接进入红绿循环

## 输入字段

| 字段 | 内容 |
|---|---|
| id | 稳定用例 ID, 与影响图模块测试列表和 `scripts/quality/ci.json` 的 tests 注册表一致 |
| source | 规则 ID, 性能预算 ID, 契约端点, 或业务模块与已确认接缝 (普通分层用例) |
| layer | hx-agent-code 测试层或 meta 探针 |
| seam | 被测入口: 单 ID 运行的 checker 命令, 端点, 页面路由 |
| criteria | 规则探针写正反例各自的期望 finding, 等级与退出码; 业务用例写主路径与失败路径的期望行为 |
| fixture | 计划的 fixture 或数据集路径, 相对项目根书写; 规则探针分别给出正例与反例路径 |

缺字段时按 hx-agent-code 的规则目录与测试契约补全, 无法补全的项标 blocked, 不自行猜测判据

## 规则探针

- 正例: 合规最小输入, 断言没有该规则的 finding 且退出 0
- Error 反例: 断言有该规则的 finding 且退出非 0
- Warning 反例: 断言有该规则的 finding 且退出 0
- checker 以单 ID 运行, root 与 config 指向临时目录, 不读写真实工作区
- checker 尚未实现时探针天然为红; checker 已存在时先把反例改成合规输入确认探针会红, 再恢复
- 集成边界探针 (多 checker 同时失败, 缺命令, 损坏输出, 超时, staged 与 worktree 不同等) 按 hx-agent-code 的 meta 契约逐项编写, 一项一条测试

## 性能与契约

性能案例的清单, 采样与判据以 hx-agent-code 的测试契约为准, 本技能只把它写成可运行用例: 先断言响应状态与业务内容再统计, 可控慢路径必须产出 HC-PERF Error, 分位数边界用固定样本数组独立验证, 不依赖真实机器速度

契约测试以 YAML 契约为唯一期望来源, 契约变动时同时断言前后端两侧

## 回交

每项回交测试 ID, 测试文件与 fixture 路径, 红绿记录 (命令与结果摘要). 规则探针的正例与反例路径由 hx-agent-code 分别写入 coverage.json 对应规则的 `probes.positive` 与 `probes.negative`, 测试 ID 只登记在影响图与 ci.json 的 tests 注册表, 不写入 coverage.json. 红绿记录只作编写过程的参考, evidence 取交付验收时对最终内容的运行输出. 无法编写的项回交 blocked 与原因, 由 hx-agent-code 在交付时列出

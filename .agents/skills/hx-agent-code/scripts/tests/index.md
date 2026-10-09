# 维护测试

在仓库根执行 `node --test .agents/skills/hx-agent-code/scripts/tests/*.test.ts`, 只验证技能自带算法, 不代表目标项目 checker 已安装

- `scope.test.ts`: 修改 Git 范围算法后运行, 覆盖初始仓库/暂存/改名/删除
- `affected.test.ts`: 修改影响选择算法后运行, 覆盖契约/依赖/未知/PR
- `report.test.ts`: 修改报告, 覆盖审计或规则目录格式后运行, 覆盖基线/等级/缺项/CLI/表格行解析
- `ci.test.ts`: 修改工作流或 runner 后运行, 在临时仓库验证分组、事件、失败汇总、产物和基线
- `ci-fixture.ts`: CI 测试的隔离仓库准备与清理, 由 ci.test.ts 调用

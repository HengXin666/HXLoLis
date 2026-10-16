# 交付契约

只登记测试, 统一运行一次并报告, 不再新增用例

登记: 目标项目装有 hx-agent-code 时, 每个测试 ID 唯一对应层, 模块与命令, 写入模块映射或影响图, 使 affected 选择能选中它; 承接的探针与 fixture 路径回交给 hx-agent-code 写入 coverage.json. 未安装时按项目已有约定登记, 不新建入口

运行: 按最终 diff 执行一次项目的 affected 测试入口 (如 `pnpm test:affected`), 再执行 `.agents/coding-rules.md` 自查行列出的命令. 修复失败后只重跑受修复影响的测试, 不反复执行无关完整测试. 诊断的保存与展示遵守目标项目 AGENTS.md 的门禁报告规则

环境缺失 (如 real 层无隔离测试库, perf 无固定 profile) 标 blocked 并写明原因, 不以 skip, 删测试或放宽断言换取通过

产物是交付报告: 接缝表, 每条测试的红绿记录与登记位置, 末轮命令及结果, blocked 项与原因

通过条件是末轮没有阻断失败, 每个测试 ID 已登记, blocked 已全部列出

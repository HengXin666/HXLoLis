# 交付契约

只登记测试, 统一运行一次并报告, 不再新增用例

登记: 按 SKILL.md 的判据已装 hx-agent-code 时, 每个测试 ID 唯一对应层, 模块与命令, 同时写入影响图的模块测试列表和 `scripts/quality/ci.json` 的 tests 注册表, 末轮运行前核对两处 ID 集合一致, 否则 CI 会因注册表与影响图不一致而失败; 承接的规则探针把正例与反例路径回交给 hx-agent-code, 由其写入 coverage.json 对应规则的 `probes.positive` 与 `probes.negative`. 未安装时按项目已有约定登记, 不新建入口

运行: 按最终 diff 执行一次项目的 affected 测试入口 (如 `pnpm test:affected`), 再执行 `.agents/coding-rules.md` 自查行列出的命令; 该文件不存在时改用项目已有的 lint/type/format 检查入口, 缺文件本身不算阻断. affected 选择兜底全量时运行完整测试集, 否则完整测试集留给 PR CI. 修复失败后只重跑受修复影响的测试, 不反复执行无关完整测试. 诊断的保存与展示遵守目标项目 AGENTS.md 的门禁报告规则

环境缺失 (如 real 层无隔离测试库, perf 无固定 profile) 标 blocked 并写明原因, 不以 skip, 删测试或放宽断言换取通过. 存在未解决的 blocked 时交付报告标为未完成, 不声称测试已就绪

产物是交付报告: 接缝表, 每条测试的红绿记录与登记位置, 末轮命令及结果, blocked 项与原因

通过条件是末轮没有阻断失败, 每个测试 ID 已登记, 承接的规则探针正反例路径已回交且写入 coverage.json, 且没有未解决的 blocked 项; 有 blocked 时只能交付为未完成并逐项列出原因

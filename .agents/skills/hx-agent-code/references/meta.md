# 元门禁与验收

规则目录给出必审 ID, coverage.json 必须逐项记录状态. audit 检查 ID 完整性及证据字段, 不能证明 evidence 指向的命令真的运行; 本次运行输出随验证报告留存

每条 implemented 项包含 checker 命令数组, severity, 正反 fixture, 本次运行 evidence, checkpoints. checker 允许单 ID 运行, root/config 可传入临时目录, 输出稳定. Warning 反例断言有 finding 且退出 0; Error 反例断言有 finding 且退出非 0

必须覆盖以下集成边界

- 两条 checker 同时失败, 两项都写入报告, 后续独立 checker 仍执行
- 缺命令/缺 parser/损坏输出/超时都是 Error, 不发生空结果放行
- staged 与 worktree 内容不同, pre-commit 检查 index, 不污染工作树
- 新增/删除/改名/空格及 Unicode 文件名/首次提交/未知路径均进入 scope 或全量兜底
- Warning 不阻断, 新 Error 阻断, 历史已批准 Error 不阻断, 新违规不可借旧总量通过
- baseline 增加/抬高阈值/规则移除/检查点脱线由可信基准差分发现
- 契约变动双端 + contract 测试, PR 全量, push affected, real 缺环境不能绿
- Agent 编辑文件或执行 Bash 后不触发 hook, 回合结束时只执行一次最终计划, 格式缓存不会因配置变化误命中
- 新增路由或契约端点但未写 perf.json 预算, HC-PERF 失败; 可控延迟超预算和错误响应必须失败, 缺指标/样本不足不得跳过; 放宽预算由可信基准差分发现
- 新增直接依赖缺授权时 HC-DEPS 标 unapproved, 小版本与传递依赖标 review-only; 已有明确授权不重复请求
- 故意删掉注册表规则或接线后, 元门禁失败
- HC-LITERAL 同值出现 2 次通过, 第 3 次失败, 常量目录内与登记豁免不计, 不完整 token 输入失败
- HC-ABSPATH 对 `/x`, `~/x`, `C:\x`, UNC 路径, `join("/", a)` 失败, 对 tmpdir() 或 git toplevel 拼接, 仓库相对路径, `/api/users` 这类路由和 `\d+` 这类模式通过; 基线中删一处同值违规再新增一处, 新增处仍报 new

不复用当前 registry 作为唯一期望清单, 否则删规则后实际与期望一起变少. 用已提交规则目录, 可信 base 快照和逐项 coverage 审核变更. 新规范升级同步 probes 和 note

skill 自带 core helper 测试只验证 scope/selection/report/audit, 不冒充项目 checker 测试. 安装后项目每条规则的真实探针由 hx-tdd 编写, 本技能只按其登记清单字段登记探针要求并验证 hook/CI 接线, 回交的探针路径作为 coverage.json 的 fixture, 红绿记录只作参考, evidence 取本次验收对最终内容的运行输出, 缺 hx-tdd 时探针标 blocked

交付报告给出生效命令, 覆盖表, MD/JSON 问题报告, 已跑测试, 未解决 blocked, 远程是否实际执行. blocked 不算成功, 不为追求绿灯自动删掉适用要求

# CI 执行器接口

入口是技能根的 scripts/ci.ts, 必须从目标仓库根运行, 配置固定读取 scripts/quality/ci.json. 安装时 vendor 整个技能, 避免拆复制后导入路径失效

- `config.ts`: 校验 setup、四个检查组、impact 命令和 tests 注册表
- `context.ts`: 从 GitHub 事件获取精确端点, PR 取 merge-base, 核对 checkout head
- `run.ts`: 顺序运行独立 checker 并收集所有结果, setup 失败时记录 blocked
- `artifact.ts`: 对本次构建输出记录源代码树和文件摘要, 测试前校验
- `baseline.ts`: 只从可信 base tree 读取 scripts/quality/baseline.json, 不信任本次改动自批基线

## 配置

assets/example/ci.json 是能直接配合示例 task.ts 执行的完整配置, 两者路径相对技能根. 安装时将命令替换为项目现有或本轮实现的 checker, 不保留示例规则冒充完整覆盖

每个 task 包含唯一 id、command 参数数组和 format. findings 表示 stdout 必须是 core/model.ts 的 Finding 数组, 即使发现违规也要输出完整 JSON; exit 表示普通命令, 非零退出产生一个 Error, 日志保留在 job 输出. 不把进程异常或空 JSON 当成功

setup 用于锁定依赖安装, 每个 job 都在干净 runner 上执行. code/docs 必须非空, build/compatibility 可用 tasks 为空加 notApplicable 的具体理由表示无对应业务. tests 注册 ID 必须与 impact 命令输出图的测试集合一致, 缺任何一个 ID 都失败

impact 命令读取 HX_QUALITY_SCOPE, 输出 core/affected.ts 所需 Graph JSON, 必须按当前 base/head 建图. 解析不完整设置 complete=false, 全量兜底. runner 不把过期静态图自动认定完整

所有命令接收 HX_QUALITY_SCOPE 指向本次范围 JSON, checker 必须以此选择文件, 不静默全仓扫描; 范围的 head 为已核对 checkout 对应树. 构建任务把可供测试消费的输出写到 HX_QUALITY_BUILD, 测试从同一路径消费, 不重新构建来替代传递产物

每组产出 `scripts/.hx_code_quality/reports/<group>.md` 和 JSON, tests 另产出 `test-plan.json`. build 先清理自身输出目录, 成功后封存非空产物或明确的不适用凭证; 下载的产物只能来自同次 workflow run, tests 验证源代码树与摘要后才执行

runner 基线只分类业务 finding, HC-CI 执行错误不可被 baseline 豁免. 新基线条目需独立审批并成为可信基准, 项目元门禁还须审计移除规则、放宽阈值及 baseline 变更. 本入口不替代 coverage audit

子进程输出保存在 reports/<分组>-tasks/, 完整诊断写入分组 JSON/Markdown, 终端仅在问题合计不超过 10 时展示详情

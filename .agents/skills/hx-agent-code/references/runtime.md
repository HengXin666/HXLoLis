# 本地执行与报告契约

## 单一入口

目标项目安装 `scripts/quality` 和版本化配置, 暂存状态与报告统一写入 gitignored 的 `scripts/.hx_code_quality/`, 下分 `cache/` `reports/` `build/`, 本地 hook 与 CI 共用这一个目录名, 不另建其他状态目录. 格式化/扫描/测试/报告通过同一注册表调用, 不能让 hook, CI 各养一份规则

内置 helpers 是可复用算法, 不声称已为任意仓库实现全部语言 checker. 按 coverage.json 为每条适用规则完成项目适配器, 接入真实工具和 fixture, 缺任一项不交付完成. 安装方式只有一种: 固定版本 vendor 整个 skill 到目标仓库, CLI 与 CI 都从 vendor 目录运行, 不拆出 core 单独复制

```sh
node <skill>/scripts/cli.ts scope --root . --mode worktree --out /tmp/hc-scope.json
node <skill>/scripts/cli.ts scope --root . --mode staged --out /tmp/hc-index.json
node <skill>/scripts/cli.ts scope --root . --mode range --base <sha> --head <sha> --out /tmp/hc-range.json
node <skill>/scripts/cli.ts affected --scope /tmp/hc-scope.json --graph scripts/quality/graph.json --event local --out /tmp/hc-tests.json
node <skill>/scripts/cli.ts report --input /tmp/findings.json --baseline scripts/quality/baseline.json --out scripts/.hx_code_quality/reports/review
node <skill>/scripts/cli.ts audit --manifest scripts/quality/coverage.json --out /tmp/hc-audit
```

report 与 audit 有 Error 返回 1, 输入/工具错误返回 2, 只有 Warning 返回 0. 未知选项拒绝. scope/affected 不执行测试. 具体 JSON 类型见 scripts/core/model.ts, 示例见 assets/impact.example.json 和 assets/coverage.example.json

## 快照语义

- worktree: HEAD 与最终工作树之差, 包括 staged + unstaged + untracked, 排除 ignored; 尚无 HEAD 时与空树比. staged 后又还原工作树的文件仍纳入检查
- staged: HEAD 与 index 比, checker 必须从 index 读取内容, 不能检查工作树冒充暂存检查. 格式化 index 可导出临时快照; 部分暂存时不自动 git add 工作树版本
- range: 精确 base/head, CI 通过可信事件取 SHA; PR 使用 merge-base(base, head) 与实际 PR head, push 使用 before/after, 首次 push 使用空树. 不凭 HEAD~1 猜多提交范围
- 使用 NUL 路径解析, rename 同时保留旧名新名, delete 仍用于依赖/契约影响计算. 子模块变动标为子仓边界, 不递归混入父仓规则
- diff 是入口, 可读完整文件/函数/类型/反向依赖图. AST/type checker 可分析更广上下文, 报告归属受影响范围; 根 AGENTS 改动必须检查整棵后代上下文
- 接入项目 checker 时提供工作区/索引/提交树读取适配器, 禁止 scope 是 index 而实际工具读取工作区. 未支持的模式返回 Error

## 检查点

| 检查点 | 运行内容 | 禁止事项 |
|---|---|---|
| Agent 写入/Bash 后 | 仅格式化变更文件, 更新内容缓存 | 不启动测试, 不递归触发自己 |
| Agent 任务完成 | 最终 diff 静态扫描和一次 affected 测试, 汇总报告 | 有 Error 不宣称完成 |
| pre-commit | staged 格式/静态检查 | 不夹带未暂存内容, 不跑整套测试 |
| post-commit | 清除本次提交文件的缓存项 | 不丢仍未提交文件的缓存 |
| pre-push | 待推送精确范围静态扫描和 affected 测试 | 不只查工作区或最近一条提交 |

先检查目标 Agent 是否真正支持 write/Bash/stop hooks, 使用其实际配置和退出语义. 不臆造通用 hook 名. 不支持时保留任务完成脚本及 Git hooks, 将 Agent 自动触发列为 blocked 并如实交付限制

缓存 key 至少覆盖路径, 内容 hash, checker/version/config hash 和模式. 内容 hash 用 SHA-256, 缓存写在 `scripts/.hx_code_quality/cache/`, 只缓存成功结果. hook 加锁/重入标记, 格式化完成后再记录 hash. 不用格式缓存绕过任务完成测试

各检查均收集全量诊断, 不因首个 Error 提前退出. 依赖构建产物的测试在构建失败时记录 blocked, 其他独立项继续. 超时/命令不存在/无输出/非法 JSON 为 runner Error, 不能视作空诊断 PASS

## 报告

每次覆盖生成 review.md 和 review.json, 不拼接旧报告. Finding 必含 ruleId, severity, path, line, message, evidence, fingerprint, origin. origin 使用 new 或 historical. 指纹由规则 ID + 路径 + 稳定 AST symbol + 违规内容/指标生成, 不只用行号或总数

Warning 汇总为待 review 项, 不改变退出码; Error 阻止任务完成/push/CI. 报告保留历史问题, 但已批准基线中的 Error 不阻止本次增量. 新库必须有匹配当前任务或会话的授权记录, Warning 不等于 Agent 可自行批准依赖安装

排序不依赖输入顺序; 按 path, line, ruleId, fingerprint 排序, 去掉时间戳/随机 ID, 转义 Markdown 控制符. GitHub 行级评论只定位当前 diff 可评论行, 其余写摘要. 评论功能需明确发送授权, 没有授权仍产出 artifact

## Baseline

旧项目从明确的可信基准提交扫描生成 baseline, 新项目默认空. 每项保存 path, ruleId, fingerprint, reason, approvedBy; 不从当前失败结果自动批准. baseline 变更需 review, pre-push/CI 从可信 base 比较, 增加/放宽/挪用条目必须被元门禁发现

同时保存违规身份和数值上限, 不允许旧问题减少一个后新增另一个因总数相同通过. rename 不自动搬豁免. 被扫描范围内消失项应删除, 未扫描范围不得误删. report 仅按已批准精确指纹分类, 不负责批准或修改 baseline, 可信加载与棘轮由项目适配器实施

所有门禁先保存本次完整诊断文件, 包括成功结果和工具故障. 对外按本次问题总数决定展示: 超过 10 条只列数量与类型统计, 不列逐项详情; 不超过 10 条才可展开全部详情. 错误, 警告和待审核合计计数, 不按类型拆开绕过阈值. 终端, hook, CI 摘要与机器人评论遵守同一规则, 附完整报告路径或 artifact 链接. 子进程 stdout/stderr 与复现命令写入文件, 不直接透传; 报告写入失败按工具错误失败, 保持原校验退出码语义

CI 保存每个任务的命令, 退出状态, stdout 和 stderr 到 reports/<分组>-tasks/<任务>. json, 然后展示分组报告摘要. findings 格式仍从子进程 stdout 读取 JSON, 不向用户透传

# GitHub 接线

## 三个入口与可复用测试流程

| 文件 | push | pull_request |
|---|---|---|
| quality-code.yml | 精确 diff 的格式/lint/type/AST/注释 | 同样按 diff |
| quality-docs.yml | diff 文本/命名/行数/上下文/notes | 同样按 diff |
| quality-build.yml | 构建及兼容性, 调用 affected 测试 | 构建及兼容性, 调用全量测试 |
| quality-tests.yml | workflow_call 接收 scope 和产物 | workflow_call 接收 full 和产物 |

以 `assets/github/index.md` 索引的四个实际 YAML 为起点, 路径相对技能根. 复制到目标 `.github/workflows`, vendor 技能并按 `scripts/ci/index.md` 配置项目命令. fetch-depth 0 或精确拉取所需父提交; push 用 before/after, PR 用 merge-base 与 head, 核对 checkout 内容等于 head. 首次 push 无 before 使用空树, 删除分支明确不执行代码扫描

模板由 runner 内部收集每个独立检查的失败, 单组最后按结构化 Error 返回失败, 不需要给检查 step 设置 continue-on-error. build/compatibility 独立运行, 汇总 job 使用 always, 三个入口即使出错也上传 MD/JSON artifact. 如项目拆成多个 step, 才用 continue-on-error 收集状态并由最后一步判失败

build 与兼容性可并行, 测试只依赖 build 本次产物. Dockerfile/compose/基础镜像更新后执行构建与健康启动, 检查端口/卷/schema 迁移对旧版本的影响; 无容器时用实际部署形式证明不适用

AI CR 两项留为明确的未启用扩展: Warning 真问题筛选, 基于 diff 和 commit 语义的 review. 文档 AI review 同样不启用. 不把 TODO job 算成门禁, 不要求模型 token 才能通过基础 CI

## 权限与评论

普通检查使用 contents: read, fork PR 在无 secrets 上下文运行. 可选 bot 使用独立可信 workflow_run, 只消费校验后的报告, 核对仓库/event/head SHA/artifact 和运行来源, 不执行 artifact 代码, 不把 pull_request_target 与不可信 checkout 混用

需要明确评论授权后才启用 bot, 根据 ruleId + fingerprint 幂等更新当前 diff 行评论, 摘要包含其余 Warning/Error. 不可评论的旧行回落摘要. 未获授权时保留 artifact, 不自动发评论

本地文件完成不等于远程 required check 已生效. 有 GitHub 管理授权才配置分支保护, 并核对真实 check 名称; 否则列出需绑定名称和原因

## 协作文件

使用 `assets/collaboration/index.md` 索引的五个模板, 路径相对技能根. 生成或更新 `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/feature.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS`, 根 `CONTRIBUTING.md`. Bug 包含复现/预期/实际/环境, Feature 包含问题/目标行为/边界, PR 包含 diff/契约/note/测试证据/待 review 项

CODEOWNERS 从真实成员/团队或已有文件取得, 不猜用户名. 不知道 owner 时先完成其他工作, 此项列 blocked 并只询问缺失归属. CONTRIBUTING 给出 uv/pnpm 安装, 格式/检查/测试入口, baseline/豁免 review 及检查点行为

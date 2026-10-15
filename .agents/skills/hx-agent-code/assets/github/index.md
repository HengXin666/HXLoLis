# GitHub 模板

四个 YAML 是可复制的实际 Actions 文件, 不是流程伪代码. 复制到目标的 `.github/workflows`, 同时 vendor 本技能并安装 scripts/quality/ci.json 与项目 checker

- `quality-code.yml`: push/PR 的代码检查与失败报告上传
- `quality-docs.yml`: push/PR 的文档检查与失败报告上传
- `quality-build.yml`: 独立构建/兼容性 job, 传递本次产物, 聚合失败状态
- `quality-tests.yml`: workflow_call 入口, 验证产物后执行 push affected 或 PR full

这些模板使用 Node 24、pnpm 10 和 uv, 安装时按项目锁定版本改写. setup 命令来自项目 ci.json, 未配置时不会暗中安装项目依赖. real 测试环境需要在 tests job 配置 service container 或经授权的测试环境, 模板不声称自带任意数据库

workflow 使用默认只读 token, 不发布评论. build result 应绑定为 required check, 同时绑定 code 和 docs job. 分支保护仍需目标仓库管理授权

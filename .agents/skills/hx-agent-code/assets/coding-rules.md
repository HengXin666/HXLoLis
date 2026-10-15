# 编码规范

门禁只在 Agent 回合结束, pre-commit, pre-push 和 CI 运行, 编辑文件时不运行. 以下为默认阈值, 安装时删去不适用行, `<>` 占位替换为项目实际值

- 行宽 120, 4 空格缩进, 左大括号不另起行, 控制语句体不写在同一行
- 逻辑文件不超过 300 行, UI 文件不超过 500 行, 单目录直接文件超过 6 个进 review
- 不手写 js/mjs/cjs, 新建后端优先 Python + async FastAPI + uv, 新建前端用 React + TS + pnpm
- 同一字面量在模块内第 3 次出现前提取到 `<常量目录>` 并 import, 常量只在该目录定义
- 不写绝对路径字面量或以根开头的路径拼接, 用 git toplevel, cwd 或 tmpdir 拼接
- Python import 只放模块头部, 跨业务模块只调公共接口, API 与业务层不直连数据库或远程 SDK, 依赖无环
- 文件头连续注释不超过 10 行, 注释标记后单空格, 只写意图与约束
- 文档与注释只用 ASCII 标点, 不用 emoji, 函数文档参数与签名一致
- 文档不超过 1500 行, docs 下用小写 kebab 命名, 不建 v2/final/copy/bak/tmp/draft 副本
- AGENTS.md 少于 150 行且少于 16384 bytes, 每处 README.md 与 AGENTS.md 配对
- 新增直接依赖或跨大版本升级先取得授权
- 改代码同次更新 Agent Note, notes 与 `.agents` 路径相对项目根书写, 不用 `./` 或 `../`
- 测试由 hx-tdd 编写, 本规范只约束代码与文档

自查: `<项目质量入口命令>`

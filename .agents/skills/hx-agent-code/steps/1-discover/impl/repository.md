# 项目取证

读取目标仓库 AGENTS, git status, package/lock/pyproject, formatter/lint/type 配置, CI, hook, tests 与当前 docs. 子模块分别定位, 不把父仓 diff 当子仓 diff. 记录用户已有未提交改动, 后续不覆盖

优先本项目代码, 标准库, 已用库. 搜索现有格式、依赖图、OpenAPI、测试选择器和报告器, 能适配就复用. 禁止因为现有 checker 不够漂亮而重写一套

建立模块表: 公共接口、内部实现、数据端口、fake/real 实现、请求层/路由层、YAML 契约、测试 ID. 明确工具/常量/类型等公共基础目录及 alias 映射

依赖 hx-agent-notes: 先寻找目标或 skill 旁的安装, 读 SKILL 和当前 note 格式. 目标已有 v1/v2 时按依赖的迁移契约处理, 不复制生命周期逻辑. 缺依赖时准备固定版本的 vendor 安装方案, 不谎报 notes 门禁通过

存量不合规走可信基线, 不为了第一轮绿灯删规则或全仓自动修复. 按 impl/proposals.md 给出架构和依赖推荐, 技术栈迁移或新增依赖核对已有授权, 不把 Warning 当隐式批准

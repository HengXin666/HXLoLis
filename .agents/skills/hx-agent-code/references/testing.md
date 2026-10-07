# 测试选择与层级

完成实现和配置后, 根据最终 diff 统一执行一轮相关测试. 修复该轮失败后只重跑受修复影响的测试, 不在每次编辑后试跑, 不反复执行无关完整测试

## 目录和职责

```text
tests/<business>/
    backend/unit/
    backend/api/mock/
    backend/api/real/
    frontend/api/
    frontend/ui/
    contract/
    e2e/
```

| 层 | 仅验证 | 数据 |
|---|---|---|
| backend/unit | 独立业务逻辑 | 无外部依赖 |
| backend/api/mock | API 校验, 状态码和业务输出 | 假数据/替换依赖 |
| backend/api/real | API 与真实存储/服务契约 | 隔离测试数据库/测试服务 |
| frontend/api | 请求参数/序列化/错误处理及前后端接口 | 测试后端真实响应 |
| frontend/ui | 展示与交互 | 假后端数据 |
| contract | method/path/参数/响应/错误及模块映射 | YAML 统一契约 |
| e2e | 完整用户路径 | 隔离集成环境 |

unit 不重复承担 API 集成职责. 前端请求单元探针可以 mock, 但不能冒充 frontend/api 的真实对接验收. real 永不连接生产数据, 明确 seed/reset/清理与连接串来源

提供统一入口 `pnpm test`, `pnpm test:backend`, `pnpm test:frontend`, `pnpm test:contract`, `pnpm test:e2e`, `pnpm test <module>`, `pnpm test:affected`. Python-only 项目仍提供这些入口作为委托 uv 的薄层; 用户禁止 Node 时记录显式例外, 不偷偷删除入口. 不适用层输出有依据的 not-applicable

## 影响图

选择顺序为依赖关系分析, 业务模块关系, API/契约关系, 路径兜底, 无法可靠判断则全量. graph.json 从项目 AST/编译器/构建工具生成, 不把手写路径表冒充依赖分析. 保留 base 和 head 的依赖边并取并集, 删除 import/文件也能找到旧消费者

内置 selector 使用依赖反向闭包, 再扩展模块 dependsOn 与 contracts. inputs 为直接文件依赖, modules 把代码路径映射到测试套件, global 为公共类型/工具/基础设施/构建配置/图配置的全量触发范围. 调用前验证图与端点匹配, 缺图或解析不完整写 `complete: false`, selector 保守选择全量

路径按完整路径或目录前缀匹配, 不接受 glob. 一个变更可属于多个模块. unmatched 路径包括未跟踪文件, 兜底全量并在 reasons 标明. 契约路径同时属于双方模块, 变更触发双方及 contract 层. 按 test ID 去重排序

Push 与 local 采用 affected. PR 无条件选择全部测试. 基础设施/共享配置变动全量, 文档-only 可明确配置 docs 模块且 tests 为空, 不能用覆盖根目录的空模块吞掉所有未知代码

## 执行

计划保存 modules, tests, reasons, full 字段, 项目入口另记 scope 和图版本. command 数组直接 spawn, 不经 shell 拼接用户路径. 每个 test ID 对应唯一层/模块/命令, 缺 ID 失败. 构建一次, 由该次产物触发相关测试, 禁止读上一轮产物

CI 中 real 层使用 service container 或测试环境 secret, fork PR 不获取 secret. 环境缺失记录 blocked 和原因, 不以 skip 标绿; 若该层 required, 总体验收失败. 仅经项目明确决策才可移交独立 required workflow

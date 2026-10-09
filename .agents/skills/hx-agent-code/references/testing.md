# 测试选择与层级

完成实现和配置后, 根据最终 diff 统一执行一轮相关测试. 修复该轮失败后只重跑受修复影响的测试, 不在每次编辑后试跑, 不反复执行无关完整测试

## 目录和职责

```text
tests/<business>/
    backend/unit/
    backend/api/mock/
    backend/api/real/
    backend/api/perf/
    frontend/api/
    frontend/ui/
    contract/
    e2e/
    e2e/perf/
```

| 层 | 仅验证 | 数据 |
|---|---|---|
| backend/unit | 独立业务逻辑 | 无外部依赖 |
| backend/api/mock | API 校验, 状态码和业务输出 | 假数据/替换依赖 |
| backend/api/real | API 与真实存储/服务契约 | 隔离测试数据库/测试服务 |
| frontend/api | 请求参数/序列化/错误处理及前后端接口 | 测试后端真实响应 |
| frontend/ui | 展示与交互 | 假后端数据 |
| contract | method/path/参数/响应/错误及模块映射 | YAML 统一契约 |
| backend/api/perf | 契约端点响应延迟 | 隔离服务与固定 seed 数据库, 外部服务替身单独标注 |
| e2e | 完整用户路径 | 隔离集成环境 |
| e2e/perf | 路由页面首屏加载 | 生产构建 + 假后端数据 |

unit 不重复承担 API 集成职责. 前端请求单元探针可以 mock, 但不能冒充 frontend/api 的真实对接验收. real 永不连接生产数据, 明确 seed/reset/清理与连接串来源

提供统一入口 `pnpm test`, `pnpm test:backend`, `pnpm test:frontend`, `pnpm test:contract`, `pnpm test:e2e`, `pnpm test:perf`, `pnpm test <module>`, `pnpm test:affected`. Python-only 项目仍提供这些入口作为委托 uv 的薄层; 用户禁止 Node 时记录显式例外, 不偷偷删除入口. 不适用层输出有依据的 not-applicable

## 性能

预算文件 `scripts/quality/perf.json` 是唯一权威, 每条含稳定 ID, kind (page/api), 路由或 method + path, case ID, 数据集/身份, 指标阈值, 采样数, 超时与环境 profile. 前端路由表与 API 契约每增一项, 缺对应预算条目即 HC-PERF Error. 无页面或 API 时分别以实际路由/契约清单登记不适用, 不能把未测或环境缺失判不适用

| 对象 | 测量 | 初始预算 | 采样 |
|---|---|---|---|
| 前端页面 | Playwright 打开生产构建, document 导航, PerformanceObserver 读取 LCP/CLS, 业务就绪标记测 ready | p75 LCP 不超过 2500ms, p75 CLS 不超过 0.1, p75 ready 不超过 3000ms | 服务预热 1 次, 再取 20 次独立冷缓存浏览器上下文 |
| 后端 API | 本地隔离服务经真实 HTTP 栈, 固定 seed 数据库和并发, 单调时钟测完整响应 | p95 不超过 200ms, p99 不超过 500ms, 错误率为 0 | 预热 20 次, 再取至少 1000 次, 默认并发 1 |

LCP/CLS 数值借用 Core Web Vitals good 阈值, 此处为固定实验环境的回归预算, 不声称等于线上用户分布. ready 与 API 数值是技能的初始工程预算, 不冒充行业标准. 安装时根据产品目标和实测基准确定每项预算, 项目可收紧, 放宽必须有理由与授权, 由可信基准差分 review

前端 profile 固定浏览器版本, 视口, CPU 与网络节流, 机器规格, 资源缓存与 Service Worker 策略, 本地和 CI 保持一致. 初始化观察器在页面脚本前注入, buffered 收集, 排除 hadRecentInput 的 layout-shift, CLS 按最多 5s 且间隔小于 1s 的 session window 取最大值. LCP 在明确就绪及固定观察窗口结束后读取, 页面不后台化, 不用 networkidle 代替业务就绪. 缺 LCP/就绪标记, 样本不足或观测超时都失败

API 用例必须断言响应状态和业务内容, 超时/错误不能从样本删除; 响应耗时包括 body 读取. 认证和 seed 预置在计时外, 数据库查询留在计时内. 写操作用独立数据并清理, 流式端点单独定义首事件/完成预算. fake 端口可做稳定的代码开销用例, 但不能代替使用隔离真实存储的延迟预算; 无外部依赖的端点注明事实

结果保存每个样本及 profile, 有限非负数才有效. 分位数统一使用升序样本的 nearest-rank `ceil(p * n) - 1`, 等于预算通过, 超预算失败. 报告保存全部采样与汇总到 `scripts/.hx_code_quality/reports/perf/`, 不自动重跑取最好成绩, 不通过追加无限重试稀释慢请求

### 必须构造的案例

| 用例 | 数据与操作 | 验收 |
|---|---|---|
| 首屏加载 | 核心路由, 冷缓存, 默认身份与典型数据集, 生产构建 | LCP/CLS/ready 均在对应预算内 |
| 重页面 | 固定大列表/图片数量, 固定分页与布局尺寸 | 使用独立 case 与预算, 保留稳定数据量 |
| API 查询 | 认证后的详情/分页, 固定 seed 数量与查询参数 | 验证结果后统计 p95/p99 |
| API 写入 | 合法输入, 独立记录, 重置不进入计时 | 验证状态及持久化结果, 请求延迟达标 |
| 可控慢路径 | 测试专用延迟拦截首屏关键资源或 API 响应, 延迟大于该预算 | 必须产出 HC-PERF Error, 测试延迟不得进入生产实现 |
| 无效测量 | 缺 LCP, NaN, 超时, 错误响应, 样本不足 | runner Error, 禁止当成空样本通过 |
| 预算与覆盖 | 新路由/端点无条目, 删除条目, 同 ID 重复, 提高阈值 | 覆盖检查或可信基准 review 发现变化 |
| 统计边界 | 固定样本数组含慢尾部, 指标等于阈值和超过阈值 | 独立验证分位数及阈值, 不依赖真实机器速度 |

perf 用例按页面或端点归属业务模块并进入影响图. 构建配置/打包器/公共 UI/中间件/数据端口实现变化触发全量 perf, UI perf 依赖本次生产构建. 在完成实现后的测试阶段运行, affected 选中业务模块时同时选中其 perf, PR 全量. 环境缺失为 blocked, 不以 skip 标绿

## 影响图

选择顺序为依赖关系分析, 业务模块关系, API/契约关系, 路径兜底, 无法可靠判断则全量. graph.json 从项目 AST/编译器/构建工具生成, 不把手写路径表冒充依赖分析. 保留 base 和 head 的依赖边并取并集, 删除 import/文件也能找到旧消费者

内置 selector 使用依赖反向闭包, 再扩展模块 dependsOn 与 contracts. inputs 为直接文件依赖, modules 把代码路径映射到测试套件, global 为公共类型/工具/基础设施/构建配置/图配置的全量触发范围. 调用前验证图与端点匹配, 缺图或解析不完整写 `complete: false`, selector 保守选择全量

路径按完整路径或目录前缀匹配, 不接受 glob. 一个变更可属于多个模块. unmatched 路径包括未跟踪文件, 兜底全量并在 reasons 标明. 契约路径同时属于双方模块, 变更触发双方及 contract 层. 按 test ID 去重排序

Push 与 local 采用 affected. PR 无条件选择全部测试. 基础设施/共享配置变动全量, 文档-only 可明确配置 docs 模块且 tests 为空, 不能用覆盖根目录的空模块吞掉所有未知代码

## 执行

计划保存 modules, tests, reasons, full 字段, 项目入口另记 scope 和图版本. command 数组直接 spawn, 不经 shell 拼接用户路径. 每个 test ID 对应唯一层/模块/命令, 缺 ID 失败. 构建一次, 由该次产物触发相关测试, 禁止读上一轮产物

CI 中 real 层使用 service container 或测试环境 secret, fork PR 不获取 secret. 环境缺失记录 blocked 和原因, 不以 skip 标绿; 若该层 required, 总体验收失败. 仅经项目明确决策才可移交独立 required workflow

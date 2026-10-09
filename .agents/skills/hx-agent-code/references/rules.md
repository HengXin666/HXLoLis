# 规则目录

这是必审清单, 不因项目没有事故记录而跳过. 每项在项目 coverage.json 中登记 implemented 或 not-applicable, 后者给出可核查证据. 未实现的适用项为 blocked, 不算安装完成. 下表未标 Warning 的项均为 Error

项目专属规则用 `PROJECT-<NAME>` 形式的 ID 登记到 coverage.json, 同样需要等级/checker/正反探针/证据, audit 接受但不替代下表任何一项. 表格行必须保持 `| HC-ID | Error 或 Warning | ...` 的原样格式, audit 发现行数与解析数不一致即失败

每个 ID 对应独立 checker, 允许多个 ID 共用一个解析器. 正反例是最低验收输入, 安装时将它们写成目标项目可执行的 fixture. 语义无法静态确定的情况产出 Warning, 不用关键词猜测升级为 Error

| ID | 等级 | 判据 | 正例 / 反例 |
|---|---|---|---|
| HC-STACK | Error | 新建后端优先 Python + async FastAPI + uv, 新建前端限定 React + TS + pnpm; 既有栈登记事实和迁移边界 | 合规新模块 / 新增未经裁决的其他前端栈 |
| HC-EXT | Error | 禁止手写 js/mjs/cjs, 框架必需入口和独立转译目录精确登记 | TS 源码 / 业务 mjs |
| HC-REUSE | Warning | 取证必须产出架构与依赖推荐及逐级复用证据, 满足需求可停在现有实现; 需授权的选择核对已有指令 | 推荐复用现有并给出路径 / 无取证直接新增库 |
| HC-DEPS | Warning | manifest 或 lockfile 的依赖变化都进 review, 新直接依赖/跨大版本标批准记录 ID 或 unapproved, 补丁/小版本/传递依赖标 review-only, unapproved 优先 | 版本变化且有审批单 / 新库无审批单 |
| HC-BOUNDARY | Error | AST 导入解析后, 跨业务模块只能访问公共接口或显式公共工具/常量/类型库 | a/impl 调 a/public / b/impl 调 a/impl |
| HC-DATA | Error | API 经可替换端口访问数据, fake 与 real 实现分开, API/业务层禁止直接导入数据库或远程 SDK | port 注入 / router 直连 DB |
| HC-CYCLE | Error | 依赖图无未声明边界的环, 动态解析失败显式报告 | DAG / a 调 b 且 b 调 a |
| HC-DIR | Warning | 单目录直接文件数大于 6, 已确认职责混杂升级 HC-DIR-MIX | 6 文件 / 7 文件 |
| HC-DIR-MIX | Error | 按已声明模块职责/允许成员集合判断混杂, 无机械证据时只发 HC-DIR | 同职责成员 / 已声明边界外成员 |
| HC-PAIR | Error | 前端请求层与后端路由按业务模块和 method + path + operationId 对账, 白名单有原因 | 双方与契约一致 / 漏端点 |
| HC-FORMAT | Error | 成熟 formatter 检查, 行宽 120, 4 空格, 左大括号不另起行, 控制语句体不写同行 | 展开语句 / if 条件同行执行 |
| HC-COMMENT-SPACE | Error | lexer 定位注释, 标记后单空格, 连续尾随单行注释的起始列对齐 | 对齐注释 / 双空格或错列 |
| HC-SIZE | Error | 格式化后逻辑文件不超过 300 行, UI 文件不超过 500 行, 分类由配置决定 | 边界值 / 超过 1 行 |
| HC-LINT | Error | 成熟 lint 的现代规则, 未用变量/不可达代码/异步误用等, 保存实际配置 | 无诊断 / 规则对应诊断 |
| HC-TYPE | Error | Python 和 TS 均运行类型检查, 项目引用完整解析, 不冒充只检查 diff 行 | 合法类型 / 不匹配返回类型 |
| HC-PY-IMPORT | Error | Python AST 中 import 只能位于模块头, 允许 docstring/future 顺序, TYPE_CHECKING 在头部显式建模 | 顶部 import / 函数或后部 import |
| HC-PY-CONST | Error | 常量只在配置的常量目录定义, AST 识别模块级大写赋值和 Final, 局部大写绑定同样检查 | constants/value.py / 普通模块定义常量 |
| HC-DOCSIG | Error | 对已有函数文档及要求文档的公开 API 核对参数名/返回值, 支持 async, overload 和特殊参数 | 签名一致 / 文档遗留已删参数 |
| HC-DOCSYNC | Warning | 函数实现或注释发生变化时, 提醒核对另一侧语义, 签名不一致仍用 HC-DOCSIG | 未改函数 / 实现 diff 且旧说明 |
| HC-COMMENT | Error | 文件头连续注释不超过 10 行, 决策使用 note 引用, 可量化重复/过期证据按项目规则判断 | 短约束 / 11 行头注释 |
| HC-WHY | Warning | 注释只说明意图/原因/约束/特殊情况, 不复述直观行为; 含糊语义交 review | 说明边界 / 注释逐句翻译代码 |
| HC-TEXT | Error | 文档及注释不用 emoji 或非 ASCII 标点, lexer 区分运算符; 本地化数据与引用原文精确登记 | 中文加 ASCII 标点 / 中文逗号或 emoji |
| HC-DOCS | Error | 当前事实 reference, 原因 decisions, 不造 v2 副本, 失效内容 archive; 路径/重复权威/命名规则机械检查 | 更新原文 / 新建同主题 v2 |
| HC-DOC-REVIEW | Warning | 单一主题, 上下层重复, 文档是否仍成立的语义待 review | 当前契约 / 疑似过时叙述 |
| HC-DOCSIZE | Error | 文档最多 1500 行 | 1500 / 1501 |
| HC-DOCNAME | Error | docs 下目录与文件名为小写 kebab `^[a-z0-9]+(-[a-z0-9]+)*$`, 文档扩展名限 md/mdx/yaml; 禁止 `v[0-9]+` 及 final/copy/bak/tmp/draft 独立词段, new/old 可作业务主题词, 同主题副本由 HC-DOCS 判断; 日期前缀只允许 decisions 下 `YYYY-MM-DD-<slug>`; `reference/api/<module>.yaml` 的 module 必须在模块表中; 精确允许 `README.md`, `AGENTS.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `LICENSE.md`, `SECURITY.md`; 项目必需其他扩展名或名称须登记精确路径及原因; archive 保留原名 | tutorials/local-setup.md, reference/api/user.yaml / Setup_Guide.md, api-v2.md, 2026-10-01-notes.md 位于 reference |
| HC-CONTEXT | Error | 每处 README.md 与 AGENTS.md 双向配对, AGENTS 严格少于 150 行且少于 16384 bytes | 149 行 / 150 行 |
| HC-BUDGET | Error | 每个文件祖先 AGENTS 加实际 skill 注入预算不超过 65536 bytes | 等于上限 / 超过 1 byte |
| HC-NOTES | Error | 委托 hx-agent-notes 的 AST 双链及同次 diff 配对检查 | 合法双向锚点 / 单边变化 |
| HC-TEST | Error | 业务模块内按层组织, affected 选择可靠, 缺命令/环境不能假 PASS | 正常执行 / 缺所需测试层 |
| HC-PERF | Error | 前端每个路由页面在 e2e/perf 中断言首屏加载, 后端每个契约端点在 backend/api/perf 中断言响应延迟与正确响应; 预算登记在 scripts/quality/perf.json, 缺预算条目/超预算/无法测量都失败 | 页面 p75 LCP 2400ms 且预算 2500ms / 新路由无预算或 p95 超预算 |
| HC-CONTRACT | Error | docs/reference/api 的 YAML 契约和实现匹配, 契约变化触发相关模块及契约测试 | 同步类型 / 只改 YAML |
| HC-CI | Error | GitHub 三个 push/PR 入口, diff 质量/文档, push affected 与 PR 全量测试, 非短路汇总 | 后续 job 仍运行 / 首错中断其他检查 |
| HC-COLLAB | Error | GitHub Bug/Feature Issue 模板, PR 模板, CODEOWNERS, CONTRIBUTING 有实际内容和有效归属 | 有效 owner / 猜造用户名 |
| HC-META | Error | 稳定 ID/等级/独立入口/正反探针/稳定输出, 注册与接线覆盖, 缺失报错 | 探针检测出违规 / 永远 PASS |

## 固定解释

- 格式化能力以工具支持为准, 不能为套用 formatter 而将 4 空格改成 2 空格. Python 缩进由语法决定, 大括号规则只用于有该语法的语言; 超长 URL/不可拆 token 如需例外, 登记精确范围
- 连续单行注释右对齐解释为代码右侧尾注释的标记起始列对齐, 独立注释保持所在语法层缩进. 用 formatter 或 token-aware 补充检查, 不按文本正则重写字符串
- 不强制每个简单函数写冗余注释. 若无文档且无公开接口文档要求, HC-DOCSIG 不凭空造注释
- HC-DOCS 中的语义要求由 HC-DOC-REVIEW 汇总, 可机械认定的问题保留 Error. HC-DIR-MIX 不能凭 AI 直觉变成阻断
- Python 推荐不能变成强制迁移旧项目的授权. 记录存量栈, 新前端采用 React + TS 的要求不被静默豁免; 用户另有明确约束时写明差异
- HC-PERF 的测量方法与默认预算见 references/testing.md 的性能一节; 放宽预算与 baseline 同等对待, 由元门禁从可信基准差分发现
- 目录豁免用 `{ "path": "src/user", "reason": "同一职责", "expires_on_change": true }`, 同时保存批准时内容摘要. 目录再次变更即失效并重新检查, 不能自动刷新摘要

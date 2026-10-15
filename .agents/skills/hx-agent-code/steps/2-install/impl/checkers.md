# Checker 实现

先读 `references/rules.md` 和 `references/runtime.md` 的完整判据, 把每个项目 checker 注册为稳定 ID. 脚本禁止 js/mjs/cjs, 通用调度用 TS, Python 原生 AST 适配器可用 py 并统一 uv 执行. 门禁脚本自身 (scripts/quality 下的代码文件, 不含 JSON 配置) 每个目录不超过 6 个文件, 文件不超过 300 行, 不通过压缩代码规避; 业务目录的文件数按 HC-DIR Warning 处理

Python 复用 Ruff + 已有类型工具, TS 复用项目的 Prettier/Biome/ESLint + tsc. 未有工具时按 `steps/1-discover/impl/proposals.md` 产出候选比较与推荐, 已授权的选型直接实施. 格式配置使用 `references/rules.md` 阈值, 不以工具默认覆盖

导入/参数/函数范围用语言 AST 或编译器 API, 不用正则匹配源码判断结构. 解析 alias, package exports 和 index/__init__ 公共边界, 计算循环时定位完整路径. 动态导入无法静态解析就标出未知边及需 review 证据, 影响测试选择必须保守全量

HC-PY-CONST 包括 Final 注解, 普通不可变局部变量不一律当常量. HC-PY-IMPORT 检查模块头部导入区, 除允许的头部 TYPE_CHECKING 块, 禁止函数/类/条件内局部导入

HC-DOCSIG 按项目采用的 JSDoc/Google/NumPy/Sphinx 等语法解析, 支持位置参数/关键字参数/self/cls/generator/void. HC-DOCSYNC 将 diff hunk 映射到函数, 内容语义留给 Warning review

API 使用 `docs/reference/api/<module>.yaml` 作为统一契约, 生成或提取路由/请求清单进行集合及 schema 对账. 生成时不得 import 一个会连接数据库或启动服务的应用入口, 必须拆出无副作用 schema 或采用 AST

建立 base/head 图, 将 modules/inputs/contracts/global 转换成 selector 输入. 工具已提供可靠 affected 功能则复用, 同样验证未知路径/公共类型/契约触发和 PR 全量

HC-LITERAL 与 HC-ABSPATH 由项目 lexer/AST 适配器产出 `scripts/rules/tokens.ts` 定义的 token JSON, 再交给技能的 literals/abspath 子命令, 不用正则扫描源码. 适配器标出 import 说明符, 类型字面量, 对象键, 路由与 URL (route/url) 以及文件路径语境 (path: fs API 参数, 路径调用参数, 配置与纯文本中的路径字段) 的 role, 并给每个 token 一个不依赖行号与遍历顺序的 anchor, 未覆盖的语言或解析失败输出 complete 为 false 并失败. 修复重复字面量时放进登记的常量目录, 已存在同值常量就复用; 常量目录与计数范围写入 scripts/quality/literals.json. HC-ABSPATH 对 yaml/json/md 等纯文本中的路径字段标 path 后按值判断, 代码中 join/resolve/Path/os.path.join 等调用由适配器产出 call token 并附首个字面量参数

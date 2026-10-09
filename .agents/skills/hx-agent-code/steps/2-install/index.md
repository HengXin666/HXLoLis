# 本地安装契约

只构建目标项目可执行的规则、快照读取、报告、测试入口和元门禁. 一轮完成实现与配置后再统一验证

产物是 scripts/quality 下单一入口与注册表、版本化模块图/基线/豁免、规则正反 fixture、页面/API 性能预算与案例、格式/lint/type 配置、统一测试入口、API YAML 契约及 docs/reference/quality 当前事实

通过条件是所有适用规则都有独立可调用 checker, 缺命令会失败, Warning/Error 输出 MD/JSON, 测试选择能保守兜底. 本步骤完成代码后交第 4 步统一测试, 不在开发中逐条反复跑测试

- `impl/checkers.md`: 选择解析器及实现语言规则时读
- `impl/context.md`: 实现文档、上下文和 notes 检查时读

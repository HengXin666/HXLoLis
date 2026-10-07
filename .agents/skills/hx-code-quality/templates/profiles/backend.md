# backend 候选规则模板

后端项目必读. 原例是 Python 后端, 非 Python 项目保留判据维度并替换解析器/工具, 不强行安装 Ruff

来源: assets/source/reference-params.md 第 1 节. 下表是原仓参考条目, 不是目标仓已验证状态, 空白探针列也不是验证通过. 每行稳定编号为 REF-加原表序号; 逐条写采用/替换/不适用/待确认及证据, 不能漏行. 工具可替换, 覆盖面必须保留或明确裁决

|#|group|参考规则|判据/真源(原仓)|原仓探针备注|
|-|-|-|-|-|
|1|backend|ruff check|linter 自身配置|棘轮覆盖|
|2|backend|ruff format --check|同上|—|
|3|backend|mypy|mypy 配置|—|
|4|backend|arch-check(行数 / 目录文件数 / `_` 前缀 / 中文命名 / 分层依赖)|`check_arch.py` 常量 + 白名单||
|5|backend|check-arch-debt(架构白名单条目只许降不许涨)|`arch-debt-baseline.json`||
|6|backend|check-api-surface(路由与请求/响应契约快照)|`api-surface.json`||
|7|backend|check-field-constants(字段名棘轮: 拦新增裸用)|`field-constants-baseline.json`||
|8|backend|check-config-catalog(配置目录与源码不漂移)|生成器 + diff||
|9|backend|check-local-imports(标准库/app.core 的 import 必须在模块顶部)|扫描式||
|10|backend|check-registration-wiring(router 必须被挂载 / 工具必须被导入)|扫描式||
|11|backend|check-docstrings(`@param`/`@returns` 必须匹配签名)|`docstring-baseline.json`||
|12|backend|check-inline-secrets(凭据只准出现在白名单文件里)|`ALLOWED_FILES` 3 条||
|13|backend|check-lint-ratchet(被 ignore 的 ruff 规则: 只拦新增)|`lint-ratchet-baseline.json`||
|14|backend|pytest(含覆盖率采集, 供 coverage 门禁读取)|`-n 4` 写死||
|15|backend|coverage(严格集合必须 100%)|`coverage-baseline.json`||

参数参考: assets/source/reference-params.md 第 2–8 节给出原仓阈值、基线、白名单、指纹与重算命令; 在目标仓重算. 用户明确的硬标准优先于快照和统计; 300 行的 Python 要求及 docstring/导入细则见 steps/2-local/impl/python-standards.md. 原仓 @param/@returns 风格要与目标仓已有风格逐项裁决, 不静默丢掉签名一致性检查

# frontend 候选规则模板

前端项目必读. 原例是 TS/TSX; 替换为宿主 Vue/React 等真实工具链, 保留静态类型、死代码、架构、API 对账和测试维度

来源: assets/source/reference-params.md 第 1 节. 下表是原仓参考条目, 不是目标仓已验证状态, 空白探针列也不是验证通过. 每行稳定编号为 REF-加原表序号; 逐条写采用/替换/不适用/待确认及证据, 不能漏行. 工具可替换, 覆盖面必须保留或明确裁决

|#|group|参考规则|判据/真源(原仓)|原仓探针备注|
|-|-|-|-|-|
|16|frontend|biome ci|biome 配置|棘轮覆盖|
|17|frontend|tsc --noEmit|tsconfig|—|
|18|frontend|knip(死代码)|knip 配置|—|
|19|frontend|check-lint-ratchet(biome 的 warning 级规则: 只拦新增)|同上基线||
|20|frontend|arch-check(行数 `.tsx` / `.ts`, 目录文件数, 分层依赖)|`check-front-arch.mjs` 常量 + 白名单||
|21|frontend|api-surface(前端 URL ↔ 后端路由对账 + e2e mock 反向校验)|生成 + diff||
|22|frontend|vitest(单测: api 契约 / 展示件 / 数据 hook)|vitest 配置|—|

参数参考: assets/source/reference-params.md 第 2–8 节给出原仓阈值、基线、白名单、指纹与重算命令; 在目标仓重算. 用户明确的硬标准优先于快照和统计; 300 行的 Python 要求及 docstring/导入细则见 steps/2-local/impl/python-standards.md. 原仓 @param/@returns 风格要与目标仓已有风格逐项裁决, 不静默丢掉签名一致性检查

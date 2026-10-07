# shared 候选规则模板

所有项目审查公共项. notes 组委托 hx-agent-notes, 未使用该机制时遵循宿主记录约定; 其余按适用性裁决

来源: assets/source/reference-params.md 第 1 节. 下表是原仓参考条目, 不是目标仓已验证状态, 空白探针列也不是验证通过. 每行稳定编号为 REF-加原表序号; 逐条写采用/替换/不适用/待确认及证据, 不能漏行. 工具可替换, 覆盖面必须保留或明确裁决

|#|group|参考规则|判据/真源(原仓)|原仓探针备注|
|-|-|-|-|-|
|23|notes|check-notes(决策记录格式)|闭集 + 骨架||
|24|notes|check-note-links(代码 ↔ 决策记录 双向链接 + 管辖闭合)|`note-citation-baseline.json`||
|25|risk|check-risk-surfaces(风险展示面登记: 漏一个界面就红)|`risk-surfaces.json`||
|26|notes|check-doc-budgets(注入上下文的体量预算)|`doc-budgets.manifest.json`||
|27|notes|check-defensive-patterns(事故规则 ↔ 测试/门禁 绑定)|`docs/defensive-patterns.md`||
|28|guard|check-gate-fingerprint(阈值/白名单指纹, 防静默放松)|`gate-fingerprint.json`|(接线探针)|
|29|guard|check-hooks(hook 可运行性冒烟 + lane 覆盖)|hook 脚本||
|30|gates|probe-gates(负向验证: 门禁真的会红)|自身|—|
|31|e2e|playwright e2e(mock 后端; `E2E_MODE=real` 才起真实后端)|playwright 配置||

REF-26 只量了字节, 没答"这条规则该在哪一层". 分层与覆盖的判据、自带脚本与降级顺序见 templates/context-layers.md  每次裁决 REF-26 时一并读, 缺了它这一项等于只做了一半

参数参考: assets/source/reference-params.md 第 2–8 节给出原仓阈值、基线、白名单、指纹与重算命令; 在目标仓重算. 用户明确的硬标准优先于快照和统计; 300 行的 Python 要求及 docstring/导入细则见 steps/2-local/impl/python-standards.md. 原仓 @param/@returns 风格要与目标仓已有风格逐项裁决, 不静默丢掉签名一致性检查

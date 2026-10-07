# 模板总入口: 先逐项裁决, 再分层建设

本目录路径均相对 skill 根目录; 原件只作来源证据, 执行以这里的适配说明、用户硬标准及宿主约定为准. 模板要给实际代码和配置提供起点, 不以"先取证"为由只输出审查提纲

## 必审候选与项目裁决

- templates/profiles/backend.md  存在后端时读: 完整 15 条后端参考规则; 其他后端语言替换工具, 不丢检查维度
- templates/profiles/frontend.md  存在前端时读: 完整 7 条前端参考规则; 类型、死代码、架构、API 对账和测试都要裁决
- templates/profiles/shared.md  每次读: 9 条公共参考规则, 覆盖记录、风险、体量、事故、指纹、hook、探针和端到端
- templates/context-layers.md  裁决 REF-26 或任何改动常驻文档时读: 入口文档的分层与体量判据、自带门禁与降级顺序. 它把 REF-26 从可选骨架提升为本轮必审项, 二者一起裁决
- assets/source/reference-params.md  确定参数时读第 2–8 节: 阈值、基线、白名单、测量口径与重算命令, 带原仓日期及版本
- assets/source/artifacts.md  决定目录与交付物时读: 原版全量目录、每件职责和缺失后果

在目标项目生成裁决表, 至少保留所有 REF-1..31 的状态. 某一端不存在时, 可用一个明确编号范围归为不适用, 附扫描证据; 存在的端逐项裁决. 表头: 规则 ID | 原版参考 | 项目适配 | 路径/工具/阈值 | 证据 | 采用/替换/不适用/待确认 | 阶段 | 实际判据/检查点/自证. 另加入 PY-01..04 与宿主新增约束, 不用它们替代原版 31 项. 待确认项留在全景中, 不冒充已经部署

## 建设层次(是验收增量, 不是三个强制套餐)

|层|从模板得到什么|结束条件|
|---|---|---|
|A 最小可用闭环|复用或创建一个入口、首条有效判据、违规/控制组、实际本地检查点; 对本轮接线和严格度作最小验证|真实入口可运行、合规 PASS、违规 FAIL, 写出本轮未覆盖的规则|
|B 标准建设|前后端已选规则、路径 lane 并集、存量棘轮和细粒度白名单、双向决策链接、事故绑定; 需要的 PR/Issue 协作字段|选中条目逐一实现与自证, 未选条目有理由; 两端契约能对账, 未知路径不会静默免检|
|C 完整覆盖|适用的 GitHub CI/聚合检查、完整探针、端到端、契约/配置快照、上下文预算、全景导览|本地与远程调用同一真源; 有真实运行证据才称远程已验证, branch protection 另核实|

常驻上下文的**分层**不属于 C 层: `templates/context-layers.md` 给出判据, 从 A 层起就要求裁决一次, 只是存量的补齐可以分轮进行

每层结束都更新全景文档, 并列出下一层收益与成本; 经用户确认再扩建. 只有一条检查的仓库可止于 A, 复杂项目也可以先修 B 中的一条, 不为凑满模板创建空检查

## 骨架索引

- templates/skeletons/01-bus.md  多检查需要共享入口时: 唯一注册表和调度机制
- templates/skeletons/02-check.md  写单条判据时: 扫描根、退出码、只读模式和失败信息
- templates/skeletons/03-probes.md  自证时: 违规、合规及接线探针
- templates/skeletons/04-fingerprint.md  防止规则放松时: 严格度和执行接线双组指纹
- templates/skeletons/05-ratchet.md  接纳存量时: 水位只降不升、降后重录
- templates/skeletons/06-whitelist.md  少数必要例外时: 条目语法、上限、陈旧项对账
- templates/skeletons/07-lanes.md  前后端分流时: 所有命中 lane 的并集、未知路径保守执行与覆盖校验
- templates/skeletons/08-agent-hooks.md  目标 runtime 支持 hook 时: 按实测协议注册, 带崩溃冒烟
- templates/skeletons/09-git-hooks.md  本地提交/推送接线时: 复用宿主工具, 保护部分暂存内容
- templates/skeletons/10-ci.md  远程自动化设计时: 保留原 CI 职责骨架, GitHub 用下列专用模板
- templates/skeletons/11-notes.md  需要决策记录时: 委托 hx-agent-notes, 不复制另一套实现
- templates/skeletons/12-incidents.md  复盘事故时: 规则必须绑定测试、门禁或明确人工检查
- templates/skeletons/13-context-budget.md  常驻上下文增长时: UTF-8 字节预算与清单. 它只给体量; 分层与覆盖由 templates/context-layers.md 补齐, 两者一起读
- templates/skeletons/14-guide.md  输出导览时: 原版章节骨架加项目全景证据

## GitHub 两类远程模板

- templates/remote/github-docs.md  协作文档: PR、Issue 和贡献约定的输入骨架, 不冒充阻断门禁
- templates/remote/github-actions.md  工作流: 两端和元门禁 job、聚合检查与权限; 先适配实际命令

## 来源与完整性

- assets/source/index.md  维护 skill 时读: 四份原件、迁移映射与适配边界
- scripts/verify-templates.ts  维护模板后运行: 核对原件哈希、14 节覆盖、31 条规则及入口可达性; 不是目标项目的代码质量检查器

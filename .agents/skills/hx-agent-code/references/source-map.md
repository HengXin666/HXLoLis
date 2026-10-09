# 原文覆盖与实施证据

原文是 HXLoLi/blog/2026/10/07/01-AI代码质量.md, 以下按章节核对, 原文无需随技能安装. 规则目录是逐项判据权威, 此表只提供来源路由

| 原文章节 | 技能中的契约 | 验收方式 |
|---|---|---|
| 一 总览 性能测试 | HC-PERF, testing 性能一节 | 页面 LCP/CLS/ready 与端点 p95/p99 预算, 缺预算即失败 |
| 一 总览 | SKILL 完成边界, runtime 检查点/等级 | 显式触发, 一次施工, Warning/Error MD/JSON |
| 2.1 栈与复用 | HC-STACK/EXT/REUSE/DEPS, 取证推荐方案 | 架构与依赖候选比较, 逐级复用证据, 授权依据与迁移验收 |
| 2.1.1 架构 | HC-BOUNDARY/DATA/CYCLE/DIR/DIR-MIX/PAIR | 公共接口, fake/real, AST 图, 目录豁免, 请求/路由集合 |
| 2.1.2 格式 | HC-FORMAT/COMMENT-SPACE/SIZE, runtime 缓存 | 阈值正反例, 写入/Bash 与 commit 接线, commit 清缓存 |
| 2.1.3 lint | HC-LINT/TYPE | 成熟工具与严格类型实际执行 |
| 2.1.4 自定义 | HC-PY-IMPORT/PY-CONST/DOCSIG/DOCSYNC | AST 参数/返回值与函数 diff |
| 2.1.5 注释 | HC-COMMENT/WHY/NOTES | 10 行上限, Why review, 双链 |
| 2.1.6 库 | HC-DEPS, 取证审批单 | 包变化 Warning, 标注审批单 ID 或 unapproved |
| 2.2 文档 | HC-TEXT/DOCS/DOC-REVIEW/DOCSIZE/DOCNAME/CONTRACT | 单主题、目录、ASCII 标点、1500 行、YAML 契约 |
| 2.3 上下文 | HC-CONTEXT/BUDGET, context 实现 | 配对、严格小于阈值、祖先加注入预算 |
| 2.4 CI | HC-CI, github 契约 | 三入口, 非短路, 构建产物, 兼容性, 五层测试 |
| 2.4 AI CR | github 未启用扩展 | 按原文 TODO 保留, 不假装已实现 |
| 2.5 协作 | HC-COLLAB | Bug/Feature/PR/CODEOWNERS/CONTRIBUTING |
| 三 测试 | HC-TEST/CONTRACT, testing 契约 | 按业务分层、统一入口、影响图、最终一轮、push/PR |
| 四 元门禁 | HC-META, meta 契约 | 每 ID 独立正反探针、稳定结果、接线自证 |
| 五 细节 | runtime 快照/Baseline | 全文件上下文、历史身份隔离、新增不借额度 |

## 本 bundle 验证边界

core helper 的隔离 Git 测试覆盖首次提交、index/worktree、多提交范围、rename/delete、特殊路径; 选择器覆盖反向依赖、契约、全量兜底; 报告覆盖等级、基线身份、稳定排序、损坏输入; audit 覆盖缺项、重复、blocked 和证据缺失

fresh agent 实际使用场景为已有检查器的契约 Diff、影响图、批准基线及诊断列表, 产出 local/PR 计划和双格式报告. 此验证证明通用入口可用, 不证明未知目标项目的所有 AST checker 或远程 CI 已安装

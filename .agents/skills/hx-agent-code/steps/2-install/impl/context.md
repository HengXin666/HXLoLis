# 文档与上下文

文档按 tutorials/reference/architecture/decisions/archive 单主题维护, 既有资料就地更新. notes 仍以 hx-agent-notes 所管理的位置为权威, docs/decisions 只放指引, 不复制第二份决策

扫描每个存在 README 或 AGENTS 的目录做双向配对, 只注入该目录所需内容. 按 UTF-8 字节计数, 每条从仓库根到文件的祖先路径累加 AGENTS 和 skill 注入. 根 AGENTS、任何子层 AGENTS、skill 注入声明修改都使对应后代重算

注入预算必须包含常驻 skill L1 和会同时加载的 L2/L3 上界, 记录路径/hash/bytes 和宿主实际注入方式. 不把任意 skill 目录总大小当上下文, 也不把未知预算当 0. 并发加载组合未知时报告 Error 并补宿主配置或保守上界

源文档说所有地方禁止 emoji/中文标点, 用 Unicode punctuation 与 emoji 检查, 中文正文允许. 代码/配置内容按 lexer/token 保留语法, 本地化字符串/外部原文需要精确例外, 不用整目录忽略掩盖注释违规

非平凡改动由 hx-agent-notes 建立一个决策的双向锚点, 每目录代表文件只引用一次, 不用无关 note 或 NOTE-EXEMPT 替代检查. 根 AGENTS 仅保留简短入口, 细节放作用目录. 安装时将 notes 检查的结果适配到总报告, 不改其等级

把已安装规则精简成 `.agents/coding-rules.md`, 不超过 25 行, 以 `assets/coding-rules.md` 为起点, 删去不适用行并替换占位为项目实际阈值, 常量目录与自查命令. 根 AGENTS.md 用单独一行 `@.agents/coding-rules.md` 导入, 计入祖先注入预算. 项目的 HC-CONTEXT 适配器同时校验该文件不超过 25 行, 导入行存在且路径不以 `./` 或 `../` 开头; 宿主是否真正加载正文由验收按实际上下文确认

notes 引用, `## Code` 路径, AGENTS 导入与配置路径统一相对项目根 (`.agents/` 所在目录) 书写, 如 `.agents/notes/implemented/process/<note>.md`. 发现 `./` 或 `../` 开头的 notes 与 `.agents` 路径时改写为项目根相对路径, 不保留两种写法

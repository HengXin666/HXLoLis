# 安装契约

只把本项目的测试约定写进根 AGENTS.md, 不写测试, 不改实现

根 AGENTS.md 已有 `<!-- hx-tdd:start -->` 段且与项目实际一致时跳过本步. 缺失或过时时, 从项目实际读取测试目录与分层, runner, 单条测试 ID 命令, affected 入口与测试 ID 登记位置, 按 `assets/agents-section.md` 写入或就地改写该段, 删去不适用行, 占位全部替换为实际值. 已装 hx-agent-code 时分层, 入口与登记位置取自 coverage.json, 影响图与 `scripts/quality/ci.json`; 未安装时只记项目已有的目录, runner 与入口, 不新建框架, 入口或依赖

段内只写事实与命令, 不复制编码规范或本技能正文, 不超过 10 行, 计入 AGENTS.md 的大小预算. 写入后的段每次会话随 AGENTS.md 自动注入, 后续步骤不再重复探测这些事实. runner, 入口或目录变化时同次更新该段

产物是根 AGENTS.md 中的 hx-tdd 段, 随本次 diff 提交

通过条件是该段存在, 无占位残留, 段中单条测试命令与 affected 命令都能在项目中找到对应入口

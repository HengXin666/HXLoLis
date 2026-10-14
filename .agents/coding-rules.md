# HXLoLis 编码规范

门禁在完成改动的回合结束, 提交前和 CI 运行, 编辑文件过程中不逐次运行. 以下规则取自本仓现有门禁, 违反即失败, 写代码时直接遵守

- 技能代码只写 `.ts`, 不写 `.js` `.mjs` `.cjs`, Python 门禁脚本统一经 uv 执行
- 技能代码每个目录不超过 6 个文件, 单文件不超过 300 行, 连续注释不超过 10 行, 超限拆模块而不是压缩
- 阈值, 规则 ID, 状态目录等常量集中在一个模块, 其余文件 import, 不在两处写同一组数字
- 技能文本只用英文标点, 标点后接内容补一个空格, 正文行末不留 `. , ; : !`, 一个句子不折成多行
- 改声明前先读其顶部注释引用的 note, 代码与 note 在同一 diff 配对修改, 同目录兄弟代码也算代码端
- note 路径为 `.agents/notes/<implemented|proposed|rejected>/<class>/YYYY-MM-DD-topic.md`, 含唯一 Decision-ID
- note 必须有 Problem, Code, Decision, Alternatives considered, Consequences, 备选含什么都不做 / 复用现有
- `## Code` 逐行列精确文件路径, 每个直接父目录一个代表文件, 不用 glob, 花括号或文件头占位
- 锚点写在代表声明紧邻上方的多行块注释, Python 用至少两行 `#` 或函数首条 docstring
- notes 与 `.agents` 路径一律相对项目根 (`.agents/` 所在目录) 书写, 不用 `./` 或 `../`
- 修改 hx-code-quality 的决策记录交接时, SKILL.md 与对应 note 的 Decision 必须互相引用
- 门禁先保存完整诊断, 问题超过 10 条只展示数量与类型, 子进程输出写文件不透传
- 默认不编写测试, 测试由 hx-tdd 负责, hx-agent-code 只负责规范

自查: `uv run scripts/redlines/agent_notes.py --diff`, 提交前加 `--staged`; 改技能后运行 hx-make-skill 的 validate_skill, prose_rules --check, check_layout

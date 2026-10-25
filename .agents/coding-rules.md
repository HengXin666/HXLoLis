# HXLoLis 编码规范

编辑文件过程中不逐次运行门禁, 完成改动的回合结束及提交前统一自查. 下列规则按实际执行方式分组, 不代表未接线的规则会自动失败

自动拦截 (`scripts/redlines/agent_notes.py` 本地非零退出, agent-notes 工作流在 CI 评论诊断)
- 改声明前先读其顶部注释引用的 note, 代码与 note 在同一 diff 配对修改, 同目录兄弟代码也算代码端
- note 路径为 `.agents/notes/<implemented|proposed|rejected>/<class>/YYYY-MM-DD-topic.md`, 含唯一 Decision-ID
- note 必须有 Problem, Code, Decision, Alternatives considered, Consequences, 备选含什么都不做 / 复用现有
- `## Code` 逐行列精确文件路径, 每个直接父目录一个代表文件, 不用 glob, 花括号或文件头占位
- 锚点写在代表声明紧邻上方的多行块注释, Python 用至少两行 `#` 或函数首条 docstring
- notes 与 `.agents` 路径一律相对项目根 (`.agents/` 所在目录) 书写, 不用 `./` 或 `../`

改技能后手动运行 hx-make-skill 校验, 退出非 0 即未完成 (尚无 hook 或 CI 接线)
- 技能目录单文件不超过 300 行, 连续注释不超过 10 行, 单目录超过 6 个文件需拆分或登记预算
- 技能文本只用英文标点, 标点后接内容补一个空格, 正文行末不留 `. , ; : !`, 一个句子不折成多行

约定, 尚无自动 checker
- hx-agent-code 的 scripts 只写 `.ts`, 不写 `.js` `.mjs` `.cjs`; 其他技能沿用各自已有语言, Python 经 uv 执行
- 修改 hx-code-quality 的决策记录交接时, SKILL.md 与对应 note 的 Decision 必须互相引用
- 改 `.agents/skills` 下本仓技能的内容须同次提高 `metadata.version`, PR CI 由 `scripts/skills/sync.py version-check` 检查
- 默认不编写测试, 只在调用 hx-tdd 时按约定接缝以红绿循环编写, hx-agent-code 只负责规范与门禁

自查: `uv run scripts/redlines/agent_notes.py --diff`, 提交前加 `--staged`; 改技能后运行 hx-make-skill 的 validate_skill, prose_rules --check, check_layout

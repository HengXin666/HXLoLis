# 取证契约

只确定目标仓库、可复用工具、适用规则和依赖, 不从技能所在仓库推断目标项目

产物是 docs/reference/quality/inventory.md 和 scripts/quality/coverage.json 初稿, 包含实际路径/工具版本/命令/技术栈/模块/API/测试/Agent hook 能力/GitHub 状态, 并列出每条规则的适用证据

通过条件是全部规则都有裁决, 未知项有定位步骤, 且架构与依赖均有推荐结论, 需授权的选择已记录实际授权或 proposed 状态. 项目扩展规则使用 PROJECT-<NAME>, 不替代内置 HC 规则. 用户已经决定的依赖不重复询问, 其他缺信息只问会阻塞实现的最小问题

已有 scripts/quality/coverage.json 时是补装: 只对未 implemented 的规则做差集取证, 已实现项只核对接线与证据仍然有效

- `.agents/skills/hx-agent-code/steps/1-discover/impl/repository.md`: 首次安装和补齐旧门禁时读取的取证方法
- `.agents/skills/hx-agent-code/steps/1-discover/impl/proposals.md`: 需要推荐架构, 技术栈或第三方库时读, 规定推荐产物与授权边界

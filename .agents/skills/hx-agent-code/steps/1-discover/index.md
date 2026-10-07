# 取证契约

只确定目标仓库、可复用工具、适用规则和依赖, 不从技能所在仓库推断目标项目

产物是 docs/reference/quality/inventory.md 和 coverage.json 初稿, 包含实际路径/工具版本/命令/技术栈/模块/API/测试/Agent hook 能力/GitHub 状态, 并列出每条规则的适用证据

通过条件是全部规则都有裁决, 未知项有定位步骤, 且新第三方库方案已整理到 Warning review 清单. 用户已经决定的依赖不重复询问, 其他缺信息只问会阻塞实现的最小问题

- `impl/repository.md`: 首次安装和补齐旧门禁时读取的取证方法

# 远程质量契约

只处理项目真实使用的托管平台; 使用 GitHub 时把协作文档和工作流分成两个独立维度. 先查 . github/ 中实际存在的内容与仓库规则/运行记录; 无远程访问时以本地可见配置为界, 不推测仓库设置、分支保护或 workflow 成败

按需读 impl/github-docs.md: PR、Issue、贡献/评审文档与协作模板; 读 impl/github-workflows.md: Actions 工作流、权限、事件、失败传播及分支保护证据. 两份文件不是安装清单

模板路径相对 skill 根: templates/remote/github-docs.md  生成 PR/Issue/贡献字段时使用; templates/remote/github-actions.md  接入实际自动化命令和聚合检查时使用. 原版 templates/skeletons/10-ci.md 只提供职责与设计意图, 不直接保存为 Actions. 按 templates/index.md 的 B/C 层选增量, 不在文档层冒充机器门禁

产物: 两张现状表及缺口, 文档约束与机器检查分开; 列出本地与远程重用同一判据的调用路径. 过关: 每一项都能指出真实文件或运行证据; 未验证的托管端设置必须标未知

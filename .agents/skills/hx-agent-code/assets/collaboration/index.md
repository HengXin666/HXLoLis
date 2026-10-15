# 协作模板

安装时更新已有文件, 不覆盖项目事实. 各模板需要按目标项目补充实际命令与身份

- `bug.yml`: 复制到 .github/ISSUE_TEMPLATE/bug.yml, 采集复现/预期/实际/环境
- `feature.yml`: 复制到 .github/ISSUE_TEMPLATE/feature.yml, 采集问题/行为/边界
- `PULL_REQUEST_TEMPLATE.md`: 复制到 `.github/PULL_REQUEST_TEMPLATE.md`, 记录范围/契约/验证/review
- `CODEOWNERS.template`: 替换为已验证 owner 后写入 `.github/CODEOWNERS`, 不允许保留占位身份
- `CONTRIBUTING.md`: 复制到仓库根并加入已安装的具体入口, 不把通用说明冒充项目操作命令

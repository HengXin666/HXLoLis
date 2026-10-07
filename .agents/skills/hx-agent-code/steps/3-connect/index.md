# 检查点接线契约

只将已实现的单一入口接到 Agent、Git 和适用的 GitHub 检查点

产物是实际 hook 配置、Git hook 委托、三个 GitHub 入口和可复用测试流程、协作文件以及缓存清理规则

通过条件是写入后仅格式化、完成时测试、pre-commit 精确 index、pre-push 精确待推范围、CI 不短路且 push affected/PR 全量. 不支持的运行时或缺远程权限必须列出限制, 不冒充接线生效

- `impl/adapters.md`: 连接具体宿主及保护现有 hook 时读

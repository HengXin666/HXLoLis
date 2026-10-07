# 适配宿主

先读目标宿主的当前 hook schema 和项目已有配置, 用实际支持的事件挂接. 保留已有命令, 用组合入口避免覆盖, 命令使用绝对解析根或仓库相对路径, 用带空格路径验证. 格式化必须防重入

Git 已有 core.hooksPath 或 hook 管理器时原位组合, 不抢占它. pre-commit 只读 index 版本检查; formatter 要改 index 时显示需要重新暂存的文件, 不自动纳入整个工作树

pre-push 读取 Git 提供的每个 local/remote ref 与 SHA, 多 ref 分别计算范围并合并结果. 新远程分支从可信远端基点计算, 无法证明增量范围则保守全量, 不使用工作区替代

post-commit 从该 commit 路径清理格式缓存, 剩余未提交内容仍重新 hash. 缓存/报告文件加入目标 gitignore 的标记区, 幂等更新且不覆盖其他行

GitHub 项目完整执行 references/github.md, 非 GitHub 项目对 HC-CI/HC-COLLAB 记录可验证的不适用理由. workflow 与协作文件先在本地完成, 发布评论/修改远程权限另按已有授权执行

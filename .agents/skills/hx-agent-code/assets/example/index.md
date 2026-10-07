# 可运行接线示例

此示例用于证明 CI runner、真实命令、影响计划、构建产物和报告能串起来, 不是 33 条项目规则的实现. 只有一个文本值检查和一个测试, 不用它替代目标项目适配器

- `ci.json`: 复制到临时 Git 仓库的 scripts/quality/ci.json, 定义各组命令与 test ID
- `task.ts`: 复制到临时仓库的 scripts/quality/task.ts, 执行示例 checker/build/test/graph

临时仓库准备 src/value.txt, 内容为 ready, 再准备 docs/guide.md. 提交基准后修改并提交, 将 before/after 完整 SHA 写入 event.json, 设置 GITHUB_EVENT_NAME=push 与 GITHUB_EVENT_PATH 为该文件绝对路径, 从临时仓库调用本技能 scripts/ci.ts 的 code/docs/build/compatibility/tests 分组

构建写入 HX_QUALITY_BUILD, 测试只读该目录中的本次产物. 把 src/value.txt 改成其他值后提交, code 和 tests 会产生 Error. PR 事件使用 pull_request.base.sha 与 pull_request.head.sha, 测试计划自动全量

隔离示例的完整准备和验证由维护测试 scripts/tests/ci.test.ts 执行, 路径相对技能根. 正式项目的 config 必须使用真实模块图、checker 和分层测试命令

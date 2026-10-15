# 验收执行

一次性运行 formatter check, lint, type, 自定义规则, 文档/context/notes, 项目构建和 affected 测试, 所有结果汇总后判定退出. 再运行 `references/meta.md` 规定的正反及集成探针, 这些探针由 hx-tdd 编写, 属于门禁自身的测试, 只在验收时运行, 不挂到编辑文件的 hook

运行 audit 校验 coverage 完整, 检查每条 checker/fixture/evidence 路径确实存在且日志来自当前最终内容. 插入违规使对应检查点失败, 再用合规输入确认恢复. 不接受仅存在配置的证据

目标项目的文本与代码产物由项目自己安装的 HC-TEXT/HC-DOCNAME/HC-DOCSIZE/HC-SIZE 等 checker 校验, hx-make-skill 的 prose-rules 与 check_layout 只用于修改本技能自身. 确认 Agent Note 的 Code 与函数顶部锚点配对, 遵循宿主当前 notes 命令. 旧配置不兼容明确报告, 不绕开门禁制造通过

交付列出生效文件/命令、执行结果、历史问题和待 review Warning、blocked 及远程状态. 要求用户决定时给出具体可审查的方案, 不让确认替代已授权的本地实现工作

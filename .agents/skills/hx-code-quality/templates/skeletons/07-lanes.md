# 模板 7：lane 表 + Stop hook

来源：assets/source/skeletons.md 第 7 节。以下是占位骨架，不是可运行脚本；项目落地前替换路径/工具并跑正反验证。

适配要求：对跨前后端的改动取所有命中 lane 的并集，不只跑一条。未知路径保守执行并要求登记；仓库级依赖与共享契约覆盖受影响的两端。退出码和 JSON 按当前 runtime 实测，原文 exit 0 不是跨宿主协议。

<!-- source-section:start -->
## 7. lane 表 + Stop hook

```js
// scripts/gates/shared/hook-lanes.mjs  独立成模块, 好让 check-hooks 能测它
export const LANES = {
    backend:  { title: '后端',     logFile: '/tmp/cc_verify.log', prefixes: ['backend/'],
                fixHint: '<报错时给模型的可操作修复动作>' },
    frontend: { title: '前端',     logFile: '/tmp/web_verify.log', prefixes: ['frontend/'], fixHint: '…' },
    notes:    { title: '决策记录', logFile: '/tmp/cc_notes.log',
                prefixes: ['.agents/', 'docs/', 'AGENTS.md', 'CLAUDE.md', 'README.md'], fixHint: '…' },
    e2e:      { title: '端到端',   logFile: '/tmp/cc_e2e.log', prefixes: ['tests/', 'playwright.config.ts'], fixHint: '…' },
    guard:    { title: '门禁脚本与工程配置', logFile: '/tmp/cc_guard.log',
                prefixes: ['scripts/', 'package.json', 'lefthook.yml', '.ci.yml', '.claude/'], fixHint: '…' },
}

// 明确"这些改了也不需要跑门禁"  名单本身要小, 且要写理由
export const NO_GATE_PREFIXES = ['ref/', 'docs/archive/', '.gitignore', 'package-lock.json']
```

前缀是**目录前缀不是 glob**(要能在人脑里一眼算出来, 也要能在 git 失败时安全退化)。
`hook-stop.mjs` 的三条兜底**一律偏向"照常跑"**:

- 算不出变更集(git 失败) → 跑整条 lane, 宁可慢不可漏
- 变更路径没被任何 lane 认领 → **不跳过**, 照常跑并提示登记
- `--fast` 只关掉"可选的那部分采集"(如覆盖率), 依赖它的门禁按 `requires` 声明自动跳过并打印原因 
  这是**节奏调整, 不是取消**; 严格路径由 push 与 CI 守

`hook-stop.mjs` 的退出码: **恒 exit 0**(hook 自身绝不炸), 非法 lane 才 exit 2;
lane 失败时输出 JSON `{ continue:false, reason, systemMessage }`, 把**摘要**注入上下文、
**完整日志**落到 `logFile`。

`check-hooks.mjs` 三道机器校验(缺一道就有一类静默失效):

1. **静态**: 遍历门禁脚本的相对 import, 逐个断言解析得到文件(改名会让整条门禁静默消失)
2. **动态冒烟**: 每条 hook 给一组真实入参, 断言退出码; 额外断言输出里**不含** `ERR_MODULE_NOT_FOUND` / `SyntaxError`
    崩溃的守卫等于静默失效
3. **lane 覆盖**: `git ls-files` 取每个路径的第一段得顶层条目集, 断言每个都被某条 lane 前缀或
   `NO_GATE_PREFIXES` 认领。失败文案要说清症状: "改它们会一条门禁都不跑"

<!-- source-section:end -->

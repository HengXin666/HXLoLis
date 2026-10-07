# 模板 1：`run.mjs`  门禁总线

来源：assets/source/skeletons.md 第 1 节。以下是占位骨架，不是可运行脚本；项目落地前替换路径/工具并跑正反验证。

<!-- source-section:start -->
## 1. `run.mjs`  门禁总线

```js
// scripts/gates/shared/run.mjs  门禁总线: 唯一注册表 + 唯一入口, 被所有检查点共用。
//
// 五条防"跑错"的机制(门禁最危险的失败形态是"它看起来跑了"):
//   1. 合法参数是闭集, 其余 exit 2  否则新 flag 会被静默当成组名, "我明明传了开关"变成"跑的是别的东西"
//   2. preflight: 门禁脚本文件不存在 → 立刻报错, 不是当成通过
//   3. produces/requires: 依赖产物的门禁只认"本次运行"产出的产物; 走 --fast 不记 produces
//      (漏这句会读到上一轮留在磁盘上的旧文件而静默变绿)
//   4. fail-fast: 第一条红就停, 并打印复现命令 `cd <cwd> && <cmd> <args>`
//   5. --dry-run: 只打印会跑哪些门禁 + 真实参数, 不执行(写文档、排查、code review 都要它)
//
// 输出约定: 每条前打序号、后打耗时; 全绿打印 `ALL PASS`;
//           失败打印 `FAIL <序号> <label> (exit N, X.Xs)` + 复现命令, 立即退出, 退出码沿用失败门禁。
// 语言分工: 分析 Python 用 Python(需要 ast), 其余胶水一律 Node, 不新增 shell。

export const GATES = [
    {
        group: 'backend',              // 分组 = 检查点账单的单位, 由命令行开关选
        label: '<这条拦什么>',          // 写"拦什么", 别复述命令  它会原样打进日志与上下文
        cmd: 'node',
        args: ['scripts/gates/<lang>/check_<x>.mjs'],
        cwd: '.',
        env: { CHECK_X_ROOT: '<绝对路径>' },   // 扫描根必须可被覆盖, 否则探针没有输入可喂
        fastArgs: null,                // 只在"慢的部分是可选"时给(加快档替换 args)
        produces: null,                // 本条在本次运行里产出的逻辑产物名
        requires: null,                // 依赖某个产物由本次运行产出; 没产出就跳过并打印原因
    },
]
```

分组开关的意义: 不同检查点各付各的账  Stop 跑一条 lane, push 跑几条, CI 跑全部分组。
**新增一条门禁 = 往 `GATES` 追加一行**, 不要另起调度脚本。

<!-- source-section:end -->

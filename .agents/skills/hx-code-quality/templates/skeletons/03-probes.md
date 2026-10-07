# 模板 3：负向探针骨架

来源：assets/source/skeletons.md 第 3 节。以下是占位骨架，不是可运行脚本；项目落地前替换路径/工具并跑正反验证。

<!-- source-section:start -->
## 3. 负向探针骨架

```js
// scripts/gates/shared/probe-gates.mjs  对每条判据构造故意违规 + 控制组。
// 夹具一律建在 mkdtempSync(join(tmpdir(), '<repo>-probe-')) 里, finally 里 rmSync 删掉,
// 绝不写真实仓库; 扫描根/白名单/基线路径全部通过环境变量指进临时目录。

const probes = [
    {
        name: '<用一句话说这个违规输入是什么>',
        gate: '<被验证的判据: 文件 + 规则名>',
        expect: 'fail',                            // 'fail' | 'pass'
        reason: '<防什么回归  例: 阈值被悄悄调大后, 这条会跟着变绿>',
        run: ({ tmp }) => {
            writeFiles(tmp, { '<relative/path>': '<故意违规的内容>' })
            return runXxx(tmp)                     // 返回 { status, output }
        },
        expectIn: ['<输出里必须出现的片段>'],        // 光看退出码不够, 还要看判据说出了正确理由
    },
    // 控制组同等重要: 只有违规组时, 一个"对任何输入都报红"的坏门禁会显得完美。
    {
        name: '控制组: <合规输入> -> PASS',
        gate: '<同上>', expect: 'pass',
        reason: '<防什么误报  只改文案 / 只重排格式这类不该报警的改动要显式钉住>',
        run: ({ tmp }) => { /* 合规夹具 */ },
    },
]
```

约定与数字(本仓实测, 换仓重算): 输出上限 `MAX_OUTPUT_BYTES = 8 MiB`(防 ENOBUFS 把"通过"伪装成"失败"),
单条打印上限 `MAX_PRINTED_LINES = 30`。夹具要**两条以上**, 控制组名字以 `控制组:` 开头。

**接线探针**(唯一能覆盖指纹第二组的机制, 至少四条):
1. 从 `GATES` 删掉一行 → 指纹必须 FAIL
2. 摘掉 settings 里的 Stop 注册 → 指纹必须 FAIL
3. 给 CI 的验证命令接 `|| true` → 指纹必须 FAIL
4. 控制组: 只改某条门禁的 `label` 文案 → 必须 PASS(否则所有人去跑 `--update`, 报警器退化成确认键)

探针要起几十个子进程, 所以**不进 Stop hook**; 承担者是 CI 的专门 job 与手动命令。

<!-- source-section:end -->

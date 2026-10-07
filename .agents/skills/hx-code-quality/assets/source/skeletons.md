# 骨架: 逐个交付物长什么样

围栏里的都是**骨架**(占位符 + 注释), 不是能跑的实现  抄的时候复制代码块、另存为注释第一行写的路径,
然后按本仓的工具链填空。`<...>` 是占位符。

刻意不放真 `.mjs` / `.yml` 文件的原因: 本仓 `check-inline-secrets.mjs` 会扫 `.py/.mjs/.js/.ts/.tsx/.sh/.yml/.yaml`
(且不跳过 `.agents/`), 骨架里带占位常量容易被当硬编码凭据误伤。放 `.md` 里两边都干净。

---

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

## 2. 一条判据(门禁脚本)骨架

```js
// scripts/gates/<lang>/check_<x>.mjs
//
// 拦什么: <一句话, 与 run.mjs 的 label 同源>
// 判据真源: <阈值常量 / 生成器 / 配置开关>  这里就是真源, 别在文档里抄第二份
// 豁免语义: <白名单文件路径 + 条目语法 + "陈旧条目 = FAIL">
// 扫描根: 环境变量 CHECK_X_ROOT(默认仓库根)  探针靠它把夹具指到临时目录
// 只读模式: --check 只校验不写; --list 只报告恒 exit 0
// 决策记录: <本仓记录位置 + 相对路径>

const ROOT = process.env.CHECK_X_ROOT ?? process.cwd()

// 退出码: 0 = PASS / 1 = FAIL / 2 = 用法错(部分脚本另有 3 = 扫描或导出失败)
// 状态行: `ok  ` / `OVER` / `BAD ` / `MISS`(体量类), 逐行 width 对齐, 便于人一眼扫
// 失败信息必须可操作: 打印修复动作(如"拆到 impl/ 子目录"), 而不是只说"不符合规范"
```

Python 侧(需要 `ast` 时): 用 Python 脚本 + `ast`，**不要用正则**分析语法结构 
字符串里的 `fetch(`、注释里的示例代码都会变成误报。头部注释按同样六行写。

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

## 4. 指纹快照

```json
{
  "version": 1,
  "algorithm": "sha256",
  "thresholds":  { "<常量名>": "<值>" },        // 各判据脚本里写死的阈值
  "whitelists":  { "<文件>": { "sha256": "<…>", "entries": ["<有效条目>"] } },
  "ratchets":    { "<基线文件>": { "sha256": "<…>", "entries": { "<键>": "<数>" } } },
  "relaxations": { "<linter 配置>": ["<生效的规则开关行>"] },
  "wiring":      { "run.mjs": ["<group|cmd|cwd|args|env|produces|requires|fastArgs=yes|no>"], "settings": ["<event|matcher|cmd>"] },
  "fingerprint": "<以上全部序列化后的 sha256>"
}
```

四类来源的回答:**thresholds / whitelists / ratchets / relaxations = "有多严"**, **wiring = "还跑不跑"**。
抽取口径的三条经验:

- **只抽"决定严格度"的字段, 不抽显示名**。改 `label` 文案、换个排版都不该动指纹;
  加一条豁免、删一条门禁、给某检查接上 `|| true` 必须 FAIL。
- `fastArgs` / `produces` / `requires` 只记**存在与否**, 不记内容  它们决定的是"这条在快档跑不跑"。
- 环境变量 `CHECK_..._ROOT` 让指纹脚本自己也能被指向临时目录(探针要用)。

`--update` 的语义是 **"承认这次变化", 不是"让门禁通过"**: 只负责重录, 不接受 `--tool` 这类局部开关
(局部重录 = 静默放松)。`SCHEMA_VERSION` 与文件里的 `version` 不一致要报错, 否则旧指纹会被当成有效。

## 5. 棘轮基线

```json
{
  "note": "<这份基线是什么、为什么只许降>",
  "<工具或维度>": { "<规则名或文件路径>": 0 }
}
```

- 涨了 → FAIL;降了 → 提示重录(**必须重录**, 否则基线里留着虚高的数, 下次又能偷偷涨回去)。
- **基线同时记方向和数字**。只记总数的棘轮, 靠"删一条豁免 + 补一条新违规"(总数不变)就能绕过;
  记条目集的棘轮(白名单/依赖清单)才拦得住。
- **基线文件必须进指纹**, 否则它可以被改大而没人知道。

## 6. 白名单语法与两条铁律

```
# 整行注释; 空行忽略
<path>                  # 行数豁免(只对行数规则生效)
<path>::<funcname>      # 只豁免这一个私有函数
dir:<path>              # 目录文件数豁免
layer:<path>::<module>  # 只豁免该文件对这一个模块的依赖方向  推荐的粒度
layer:<path>            # 毯子式: 该文件全部分层依赖都豁免(不要新增这种)
<path>|<N>              # 行数豁免必须带登记上限 N: 挂上之后文件长过 N 依然 FAIL
```

两条铁律:

- **双向校验**: 条目一次都没拦下违规(目标已拆分 / 改名 / 已删)= **陈旧条目 → FAIL**, 删掉它。
  只查单向(白名单里的文件存不存在)的机制一定会积累一堆没人敢删的死条目。
- **粒度尽可能细**: 豁免一条违规是还债, 豁免一个文件是又签一张空白支票。
  畸形条目(缺 `|N`、`N` 不是正整数、`N` 不高于扩展名档位)直接 FAIL。

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

## 8. agent hook 注册

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "node \"$PROJECT_DIR\"/scripts/gates/shared/hook-guard.mjs", "timeout": 10 }]
    }],
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{ "type": "command", "command": "node \"$PROJECT_DIR\"/scripts/gates/shared/hook-format.mjs",
                  "timeout": 180, "statusMessage": "清理 + 格式化" }]
    }],
    "Stop": [{
      "hooks": [
        { "type": "command", "command": "node \"$PROJECT_DIR\"/scripts/gates/shared/hook-stop.mjs --backend",
          "timeout": 600, "statusMessage": "运行后端门禁(无变更则跳过)" }
        /* …每个分组一条… */
      ]
    }]
  }
}
```

- **每个 runtime 一份**配置文件, 目录变量名不同(Claude 系是 `$CLAUDE_PROJECT_DIR`, 其它 runtime 各有各的);
  内容同源, 但**只在支持该事件语义的 runtime 里注册**  不支持 PreToolUse 拦截的 runtime 硬塞 `hook-guard`,
  结果是一个永不生效的守卫。
- hook 的统一协议: 从 stdin 读一个 JSON, 用退出码表达决策。**`0` 放行 / `2` 阻塞并把 stderr 回灌给模型 /
  其它非零码 = 非阻塞错误**  脚本路径写错、解释器不对、语法错误全落在最后这档,
  也就是 **hook 静默失效的表现和"没发现问题"完全一样**。所以每个 hook 必须有冒烟测试。
- 能内置就不 hook: 能用 settings 的 permission `deny` 表达的规则优先用它(hook 适合"要看内容才能判断"的规则)。
- hook 脚本 / settings / CI 配置本身属于**受保护路径**, 改它们要有人审批。

## 9. `lefthook.yml`

```yaml
pre-commit:
  jobs:
    # 顺序执行(并行会让 whitespace 读到大修前的索引, 产生假失败)
    - name: <formatter>
      root: <子目录>/            # 让 {staged_files} 相对它解析, 别用 cd(会拼出 <子目录>/<子目录>/…)
      glob: "<子目录>/**/*.{ts,tsx,js,jsx,json}"
      run: node node_modules/<formatter>/bin/<tool> check --write --no-errors-on-unmatched {staged_files}
      stage_fixed: true          # 自动回填暂存区
    - name: whitespace
      run: git diff --cached --check   # 只检查, 不修

pre-push:
  parallel: true                 # 各条互不依赖, 受最慢那条支配
  jobs:
    - name: verify:<组>
      run: npm run verify:<组>    # 与本地/CI 跑同一条命令, 不另写一套
```

分工: **pre-commit 只做"快 + 能自动修"的事**(失败时人能自己改好再提交, 预算 <5s);
贵的(覆盖率、e2e、全部负向探针)在 push 与 CI 各付一次。markdown 通常**刻意不进** formatter
(会强按列宽 padding 表格)。

## 10. `.ci.yml`

```yaml
version: v2.0
stages: [{ name: verify, label: 代码验证 }]
# 触发: push 与 MR 的所有分支, 不只主干  主干才发现问题太晚
jobs:
  verify-<组>:                 # 每个分组一个 job, 各自装依赖
    runs-on: <runner>
    steps: [checkout, <装依赖>, `npm run verify:<组>`]
  verify-gates:                # 门禁自检: 指纹 + 全部负向探针(最贵, 只在 CI 与手动)
    steps: [checkout, <装依赖>, `npm run verify:gates`]
```

- **禁用 `continue-on-error` / `|| true`**: 它们把失败伪装成通过, 比没有门禁更危险。
- 增删 job 不要让分支保护规则跟着改: 用**一个聚合 job** 把各 lane 作为 `needs`, 分支保护只要求聚合项。
- 上传产物(测试报告 / 截图 / 覆盖率)并在 PR 里贴链接  人和 agent 都要能看到证据。
- CI 时长是 agent 回路的一部分: 超过 15 分钟, 长任务会大量空等。

## 11. 决策记录骨架

```markdown
# Agent Note: <标题>

Status: <proposed | implemented | rejected — <一行理由> | archived 另有 Archived: 行>
管辖: <被它管的代码路径, 逗号分隔; 无则 `管辖: 无 — <理由≥8字>`>

## Problem

<为什么需要这个决定>

## Decision

<决定了什么>

## Alternatives considered

<被否的方案 + 否决理由; 确实没记过时用 `<!-- alternatives-not-recorded: <原因> -->` 显式声明>

## Consequences

<代价、有效期、什么条件下重估>
```

目录即分类(闭集, 新增一类要同时改门禁的闭集):
`{proposed,implemented,rejected,archived}/{architecture,bug-fix,feature,process,testing,simplification}/yyyy-mm-dd-topic.md`。

两条最容易被忽略、也最值钱的约束:

- **每条 Note 必须被引用**  被代码引用(`决策记录: <note 路径>` 一行, 放在它管辖的代码处),
  或被事故规则表引用。没人引用的 Note 是孤儿, 代码改了它不会红。存量孤儿显式登记, **只减不增**。
- **`管辖:` 必须与"引用它的代码文件"集合逐条相等**  漏登记是范围漏报, 多登记是范围虚报, 两边都 FAIL。
  所以"补引用"和"改 `管辖:`"必须同一次做完, 且两者的口径要一起定义(哪些目录算代码根、哪些后缀算代码文件)。

刻意**不建 `INDEX.md`**: 集中索引会腐烂成第二份真相, 而且和 `grep` 完全重复。

## 12. 事故规则表

```markdown
## <规则标题>

现象: <哪次事故 / 工单 / 复盘, 尽量带可查的标识>
规则: <可执行约束, 不是"要注意">
证据: <代码路径 / commit / 决策记录链接>
钉住: <三选一>
```

```
钉住: 测试: <path>.py::<test_name>[, <path2>.py::<test2>]
钉住: 门禁: <repo-relative 门禁路径>          # 该门禁必须同时有负向探针
钉住: 无门禁 — <为什么现在钉不住, 以及靠什么替代(理由≥8字)>
```

理由: 覆盖率只证明"这些行被执行过", 不证明"这个行为被验证过"。把规则绑到一个没有负向验证的门禁上,
只是把"没有门禁"伪装成"有门禁"。校验实现可以很朴素  读探针文件的全文, 断言门禁文件名出现在里面
(子串包含, 弱校验但够用)。

## 13. 文档体量预算

```json
{
  "_note": "<口径: 单位是 UTF-8 字节而不是 wc -w, 因为中文没有空格; 抬任何一条上限都是放松>",
  "CLAUDE.md": 200,
  "AGENTS.md": 3000,
  "<子目录>/AGENTS.md": 3000
}
```

- **单位必须是字节**。按空白切词的口径会把一整段中文数成几十个 word, 等于放过十几倍的增长。
- **双向校验**: 新增的入口文档没登记 → FAIL; 清单里的文件不存在(改名/删了)→ FAIL。
- 入口文档可以**自动发现**(递归找文件名恰为 `AGENTS.md` / `CLAUDE.md` 的文件), 清单只记上限。
- 常驻清单(如技能条数与单条 description 上限)也归这里: 它们每轮对话都付一次。
- **只有每文件上限, 没有总量档**;按需加载的东西(`SKILL.md` 正文、`docs/**`、决策记录)不纳入。
- 红了怎么处置写进子目录文档, 顺序固定: ① 搬走 → ② 压缩 → ③ 抬上限(并说明理由, 会被指纹拦下要求 `--update`)。

## 14. 导览文档

```markdown
# <这套基建的名字>

本文是**导览**, 不是真源: 每条规则的判据在门禁脚本里, 每个决策的**为什么**在决策记录里。
这里只回答三个问题  一共几道关卡、每道关卡拦什么、这套东西靠什么保证"它自己不会烂掉"。

真源位置:                       # 一张"想知道 X → 去哪"的表。别抄门禁清单。
|想知道|去|
|-|-|
|门禁定义(唯一一份)|<注册表文件>|
|各条规则的实现与豁免语义|<门禁脚本的文件头注释>|
|阈值 / 白名单 / 基线现状|<指纹文件>|
|为什么这么设计、放弃过什么|<决策记录目录>|

## 一、检查点(改动的一生)   # mermaid: 写文件 → PostToolUse → Stop 选 lane → 各 verify → commit → pre-commit → pre-push → CI
## 二、门禁总线             # 怎么跑、五机制、`--dry-run`
## 三、门禁清单             # 只在**新仓首版**手写一次;此后一律"给命令不给数"
## 四、三层防守             # 棘轮 / 指纹 / 探针 各管什么、各管不了什么
## 五、注入上下文的体量预算
## 六、测试基建             # 各层所有者与边界, 以及"哪些不进默认验证"
## 七、决策记录制度
## 八、事故规则表
## 九、现状水位             # 这一节给命令, 不给数  抄下来的水位表当天就会过期
```

**"门禁清单"与"现状水位"两节是这套导览最容易腐烂的地方**: 手抄的清单没有任何机制会提醒它更新。
首版可以抄一次(让读者知道大概有几类), 但要在旁边写明"清单真源是注册表, 看现状跑 `--dry-run`",
并且之后的维护动作是**删表换命令**, 不是同步数字。

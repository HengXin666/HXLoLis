# 最小复现: argo initialize 在 scripts/ 目录下超时

## 现象

**同一份 193 行代码**，只是所在目录不同，行为完全不同：

| 文件 | 目录 | 相对导入 | initialize 超时数 |
|---|---|---|---|
| `scripts/_a.ts` | `scripts/` | `../src/…` | **11** |
| `scripts/diag/minimal-repro.ts` | `scripts/diag/` | `../../src/…` | **0** |

而 `node --experimental-strip-types` 下，**两者的模块解析 URL 完全相同**：

```
scripts/ 下解析成: file:///…/HX-Sagasu/src/fetchers.ts
diag/ 下解析成:    file:///…/HX-Sagasu/src/fetchers.ts
相同? true
```

另有 `minimal-control.mjs`（28 行，绝对路径导入）**在任何位置都是 0**。

## 复现

```bash
cd components/HX-Sagasu

# 11 个超时
cp scripts/diag/minimal-repro.ts scripts/_probe.ts
sed -i "s|'../../src/|'../src/|g" scripts/_probe.ts
node --experimental-strip-types scripts/_probe.ts search "Rust 所有权" --min-hits 40 | grep -c method=initialize
rm scripts/_probe.ts

# 0 个超时
node --experimental-strip-types scripts/diag/minimal-repro.ts search "Rust 所有权" --min-hits 40 | grep -c method=initialize
```

## 已排除的方向（23 个）

见 `.agents/notes/implemented/architecture/2026-09-18-argo-concurrency-unresolved.md`、
`2026-09-18-gate-and-missing-code.md`、`2026-09-18-timeline-diagnosis.md`、
`2026-09-18-reproduction-asset.md`。

**本轮新排除的**（在目录假设之前）:

- **shebang**（`#!/usr/bin/env node`） 加上/去掉都不改变结果
- **`export` 存在与否**  两边都是 0 个 export
- **`recall` 首参是 `argv[1]` 还是字面量**  改成字面量后仍 11
- **绝对路径导入**  改成绝对路径后仍 11
- **文件名**  在 `diag/` 下换任意文件名都是 0

## 尚未验证的

**为什么"目录深度"会改变行为，而解析后的模块 URL 相同。**

可能的方向（未验证）:

1. **Node 的 `--experimental-strip-types` 对不同路径深度的处理**（它要做类型剥离与缓存，
   缓存键可能是**源路径**而非解析后 URL）
2. **`node_modules` 向上查找的起点**不同，导致某个依赖被解析成两个实例
3. **进程的 cwd 与模块路径的关系**（但两次运行的 cwd 相同）

## 影响

**不影响可用性**: `sagasu.ts` 仍然 `exit=0`、第 0 层完整（15-18 条）、总命中 21-24 条。
**影响能力**: 第 1 层的 argo 来源只有前 2 个能用（`juejin`/`bilibili`），其余 10 个失败。

---

## 已验证排除（2026-09-19）

**假设: "同一模块在不同路径深度下被实例化两次"**
（于是模块级 `gate` 有两份，闸门形同虚设  那会完美解释"11 个同时超时"）

**实测否决**:

```
两种导入（../src/… 与绝对路径）是否同一模块对象: true
diag 深度与绝对路径同一对象: true
```

**这是最可疑的假设，而它不成立。**

## 下一个该做的实验（唯一还没做过的"直接观测"）

**在失败的一侧与正常的一侧各打印 `process.env` 与 `process.cwd()`，逐键对比。**

前 27 个方向**全是推断**（读代码、改代码、看行为），而这个实验是**直接看两个进程的初始状态差**。

三个待查项:
1. `--experimental-strip-types` 的**类型剥离缓存**（缓存键可能是源路径 → 同一模块被剥离两次）
2. 从 `scripts/` 与 `scripts/diag/` 向上查找 `node_modules` 的**起点是否不同**
3. **子进程继承的环境**（`npm_config_*` 等）在两个路径下是否有差异


## 第 28 个方向: 进程初始状态（**已排除**，2026-09-19）

用**直接观测**替代推断  在两侧各 dump 一次 `process.env` / `cwd` / `argv`:

```
cwd 相同: True
env 键数: 142 vs 142
键集合差异: (无)
npm_ 键差异数: 0 []
npm_ 值差异: (无)
```

**两侧进程的初始状态逐键相同。**

（过程中注意到 `npm_config_local_prefix` 指向一个**不相关项目**
`/home/hx/Loli/code/AI-Code/gpt-json-to-token`  这是 `npx` 启动的痕迹，
但**两侧都一样**，所以不是差异源。）

## 累计已排除 28 个方向

全部有实测数据，见四篇 note。**每一个都指向"代码没问题、环境没问题"**。

**而现象仍然稳定**: `scripts/_a.ts` = 11 个超时，`scripts/diag/minimal-repro.ts` = 0 个，
**同一份代码、同一个 URL、同一个模块对象、同一份环境。**

## 剩下的可能（未验证）

1. **`--experimental-strip-types` 的类型剥离阶段**  它发生在模块解析**之后**、
   执行**之前**。缓存键若为源路径，同一模块会被剥离两次，产生**两份函数闭包**
   （而非两份模块对象  后者已排除）
2. **Node 内部的模块加载顺序**（`scripts/` 下 `sagasu.ts` 与 `_a.ts` 之外还有别的文件，
   而 `diag/` 下只有几个） 即**目录里其他文件的存在**可能影响加载
3. **V8 的代码缓存 / 编译时机**

**第 2 条有一个便宜的可测推论**: 把 `scripts/` 下的**其他文件临时移走**，
只留复现文件，看是否变正常。


---

## ⚠ 结论修正（2026-09-19）: "目录决定论"已被推翻

本 README 早先写下的结论  **"决定因素是文件在 `scripts/` 还是 `scripts/diag/`"** 
**不成立**。

**推翻它的实验**: 同一份 `scripts/_purejs.mjs`（在 `scripts/` 下、用 `../src/`）**连跑 6 次**:

```
#1: 0   #2: 0   #3: 0   #4: 0   #5: 0   #6: 0
```

**而它在更早的一次运行里给出过 11。** 所以那组"目录 vs 结果"的对照
**被一次偶发失败污染了**  偶发被当成了稳定。

**同期稳定的事实**（各有 3-6 次重复）:

| 文件 | 结果 |
|---|---|
| `scripts/sagasu.ts` | **11, 11, 11, 11, 11** |
| `scripts/diag/minimal-repro.ts` | 0, 0, 0 |
| `scripts/_purejs.mjs` | 0, 0, 0, 0, 0, 0 |

## 这个失败带"偶发分量"  本轮最重要的新认识

`_purejs.mjs` 曾失败一次、之后 6 次全好；而 `sagasu.ts` 5 次全坏。

**它不是"某个代码结构必然导致"的确定性缺陷**，而是
**"某个尚未定位的触发条件 + 一定的时序/环境窗口"**。

**这解释了为什么 31 个方向的排除全部落空**  一直在找"确定性差异"，
而这个现象**本身带随机性**。

## 判定方法的教训

**在这个问题上，单次运行不足以支持任何结论。**
任何"某变量导致失败"的断言都必须基于**多次重复**（至少 3 次，且两侧都要）。

## 本轮新排除（累计 31 个）

| # | 方向 | 实测 |
|---|---|---|
| 30 | **`--experimental-strip-types` 类型剥离** | 纯 JS（无类型标注）版在 `scripts/` 下**仍 11** |
| 31 | **`--explain` 采集块** | 给正常脚本加上 → **仍 0** |

**第 30 条原本是最被看好的假设，被一次干净的单变量实验否决。**


# Agent Note: argo 引擎路由必须被实测  声明 148 个 ok 不等于 148 个可用

Status: implemented

- 影响: `components/HX-Sagasu/scripts/engine_probe.py`

## Problem

M0（"观测面可信"）一直挂着"需要重启验收"的状态：profile patch 里的 argo 接线只在 DSH 启动时读取，本会话内 `argo_search` 依然报 `EALLOWGIT`。这一轮我换了条路**绕过 DSH 插件，直连 argo 运行时**，结果发现真正值得记录的东西不在那里。

直连成功之后（argo v2.8.6，`scripts/mcp_server.py` 正常应答），我按声明去核对引擎能力，实测发现**三类与声明不符**的情况：

1. **L2 缓存的键不含 engine（最严重，已确认复现）**：同一查询先用 `engine=zhihu` 查过，再用 `engine=juejin` 查**同一个查询**，会直接拿回**知乎的缓存结果**：

   ```
   q = "Rust 所有权 cache-key-test"
   engine=zhihu  → used=['zhihu']  cached=False   ← 真实取数
   engine=juejin → used=['zhihu']  cached=True    ← 拿到知乎的缓存
   （换全新查询）
   engine=juejin → used=['juejin'] cached=False   ← 这时才是真的掘金
   ```

   危害不是"响应在撒谎"`engines_used` 是**诚实的**，它如实报告了缓存来自 zhihu。危害是**调用方要的引擎没被查询，却拿到了看似成功的结果**。在"证据必须可追溯"的前提下，这足以让一份调研报告引用错来源。

2. **我一度以为"请求被静默路由到别的引擎"**：探针首轮显示 `engine=juejin → used=['zhihu']`、`engine=bilibili → used=['zhihu']`，看起来像 argo 把请求转发了。**用真正唯一的查询复测后，juejin 与 bilibili 都正确路由了**（`used=['juejin']`、`used=['bilibili']`）。那个"转发"是**级联缓存**造成的假象：一个被缓存污染的查询会让后续所有引擎都返回同一份缓存。**差一点就据此写下一个错误的结论。**

3. **`auto` 模式做语言自适应**：中文查询 → `['anysearch','local_bing']`；英文查询 → `['crates','anysearch']`。这是真实行为，值得记录。

另外确认：`engine` 参数**不支持逗号分隔的多引擎**（`engine=wikipedia,github` → 日志 `未知引擎`，但**仍返回了结果**因为又命中了缓存）。

## Decision

**把"引擎能力"变成一个可复查的产物，而不是散在对话里的印象：新增 `scripts/engine_probe.py`。**

它对每个引擎用**唯一查询**（毫秒时间戳 + 进程内计数器）逐引擎比对「请求的 engine」与「实际 `engines_used`」，把状态分成五类：

| 状态 | 含义 |
|---|---|
| `ok` | 按请求路由且有产出 |
| `empty` | 按请求路由但 0 条 |
| `rerouted` | 请求被送去了**别的**引擎 |
| `cached` | 命中了别的引擎留下的缓存  **本次探测没有验证任何东西，不算通过** |
| `error` | 抛错或超时 |

有任一非 `ok` 时退出码为 1。探针**不做修复**，它只把"声明 vs 实际"的差额变成数字。

## Alternatives considered

- **什么都不做，信任 `engine_registry.yaml` 的 148 个 `status: ok`**：那是 argo 自己生成的注册表，看起来是权威声明。**实测否决**：注册表说 ok，但"请求 juejin 拿到知乎缓存"这件事它一个字都不会说。声明与可用性是两回事这正是本项目在别的组件上反复踩过的同一个坑。
- **据首轮探针结果判定"juejin/bilibili 被静默转发"并上报**：这是我差一点写下的结论，而且它有"实测"支撑。**复测否决**：用真正唯一的查询后两者都正常路由。**教训写进 note：一次被缓存污染的测量会产出一个听起来很具体的错误结论，而"有实测数据"会让它显得可信。**探针因此把 `cached` 单列，就是为了让这种情形**显式地不算通过**，而不是混进 ok 或 rerouted。
- **在探针里绕过缓存**（清缓存、或改 argo 源码让缓存键含 engine）：能拿到更"干净"的测量结果。否决理由：清缓存是**修改被测对象的状态**，改上游源码是**把补丁层做到 argo 内部**（补丁层已有的 P1 是针对崩溃，性质不同）。探针的职责是**如实报告**，包括如实报告"这次没验证成"。把"绕过"写进调用方（`--no-cache` 若是可用参数）比写进探针更合适。
- **只测 `anysearch`（DSH 默认走的那一个）**：最省事，而且它确实正常。否决理由：本组件的第 1、2 层依赖**具体平台引擎**（zhihu/juejin/bilibili/github），如果它们不能按请求路由，分层召回的地基就是空的。测一个引擎等于不测。
- **把探针做成测试套件的一部分**（`node --test`）：能与现有 132 项测试一起跑。否决理由：它需要 argo 安装 + 网络 + 几十秒，而现有测试套件是**离线、毫秒级**的。把它塞进去会让"跑测试"从 2 秒变成 1 分钟，进而让人不想跑测试。它是**探针**（按需运行、产出报告），不是单元测试。

## Consequences

- `engine_probe.py` 是**本组件第一个能自查 argo 侧的产物**。此前所有关于 argo 的判断都来自一次性的手工试验，无法复现。
- 探针的输出是 JSON（`--out`），可以随架构文档一起留存，形成"引擎能力随时间变化"的记录。
- **探针本身依赖 `mcp_server.execute_tool` 这个内部接口**  它是直连后的实测入口，不是 argo 的公开 API。argo 升级后这个入口若改名，探针会响亮报 `import fail` 而不是静默给出空报告。
- **"重启验收 M0"这件事被重新定义了**：原先它是"等一次重启来证明补丁生效"。现在有了直连路径，M0 拆成了两半(a) **argo 运行时本身是否可用**：已在本会话验证（v2.8.6，`anysearch`/本地 bing 都出结果）；(b) **DSH 是否在启动时加载了 profile patch**：仍然只能靠重启验证。**（a）的答案是好消息：DSH 那条线即使没生效，argo 本身是活的，而且有本地引擎兜底。**
- 缓存不带 engine 这个缺陷**没有修**（那是 argo 上游的事，不是本组件能改的）。本组件能做的是：任何依赖"指定引擎"的取数都必须**不接受 cached 结果**，或至少把它标出来。这条约束尚未落到 `recall.ts` 的取数层  **是下一个待办**。

## Verification

- `python3 components/HX-Sagasu/scripts/engine_probe.py` → 首轮 `{"ok":10,"cached":2}`（juejin/bilibili 被缓存污染），复测稳定复现
- **缓存缺陷有可复现实验**（写在 note 与脚本注释里）：同一查询先 zhihu 后 juejin → `used=['zhihu'] cached=True`；换全新查询 → `used=['juejin'] cached=False`
- **"juejin/bilibili 被转发"这个错误结论被复测推翻**，两条路径都记录在案
- argo 直连可用性：`initialize` + `tools/list` 正常，`tool` 数正常返回；`argo_search` 对中文查询返回相关中文结果（`Rust 程序设计语言 中文版`、知乎专栏、`rustcc.cn`）
- `auto` 模式的语言自适应：中文 → `['anysearch','local_bing']`；英文 → `['crates','anysearch']`
- 脚本语法经 `ast.parse` 校验，已 `chmod +x`

# Agent Note: 现状评测报告就地重写  "3 个全坏"已全部修复

Status: implemented

- 影响: `research-output/hx-sagasu/2026-09-16-baseline-capability-audit.md`（就地重写）

## Problem

目标点名要求一份"**现状机制评测报告**（当前 argo_search/argo_fetch/wide_research/web_search
是否足以支撑）"。仓库里有一份，日期是 **2026-09-16**，标题写着：

> 结论先行：**不能支撑**。……当前 agent 的实际处境：宿主暴露了 3 个搜索工具，**3 个全坏**。

**而它列的根因已全部修复，报告没有跟着更新。** 它现在在说谎。

## Decision

**就地重写（按本仓库规则"事实就地重写，不追加变更历史"），并本轮逐条复验。**

### 复验结果：四条通道全部实测

| 通道 | 09-16 结论 | **09-18 实测** | 证据 |
|---|---|---|---|
| A `argo_search` | ❌ `EALLOWGIT` | ✅ **可用** | 工具调用返回 **5 条真实结果** |
| A `argo_fetch` | ❌ 同上 | ✅ **可用** | `success:true` + 正文 116 字符 |
| B `web_search`/`web_fetch` | ❌ 落 DeepSeek 402 | 🚫 **本项目不用** | 见下 |
| C `wide_research` | ❌ `tools.restrict` 抛错 | ✅ **可用** | **4 轨道跑完、2 完成、9 个来源** |
| D argo CLI 直连 | ✅ 唯一可通 | ✅ **可用** | `results: 5` |

**通道 C 是这轮最有价值的复验**  基线说它"**创建即失败（不是降级，是建轨道就炸）**"，
而实测它完整跑完了一次多轨道调研。

### 三条根因的修法都在 profile patch 里

`~/.dsh/profiles/web/cordis.patch.yml`：

1. `searchCommand: /usr/bin/python3` + `searchArgs: [<绝对路径>/mcp_server.py]`
    绕开 `npx + github:` 触发的 `EALLOWGIT`
2. `childToolAllow` **只列真正注册的原生工具名**（`argo_search`/`argo_fetch`/`web_search`/`web_fetch`）
    修掉"双写 `mcp__argo__*` 而宿主未装载 MCP 形态 → `tools.restrict()` 抛错"
3. patch 里还写着"**patch 按 key 整体替换**，`config.searchArgs` 必须写全，
   否则插件回落到 npx 默认值"  一个具体的坑，记在注释里

## Alternatives considered

- **保留原报告，只加一个"2026-09-18 更新"章节**：更省事，且能保留历史。**否决理由**：那正是本仓库明令禁止的形态（"**事实就地重写，不要追加变更历史**"）。第 16 轮就是被这个坑害过  一份 700 行文档里并存两个互相矛盾的诊断，"**上面那个诊断本身是错的**"成了标题。**一份指导决策的文档变成十份快照按时间堆叠，就没有任何一份可信了。**
- **删掉原报告，写一份全新的**：更干净。**否决理由**：**原始实测记录有价值**  它的价值不是"当时做对了什么"，而是"**同类误判长什么样**"（三条根因的分析本身是准确的）。所以重写正文、把历史留在 `2026-09-16-evolution-log.md`。
- **把通道 B/C 写成"已修好"**：patch 确实改了。**否决理由**：**改过 ≠ 验证过**。所以本轮**真的去跑了一次** `wide_research`（4 轨道 / 9 来源），而不是看 patch 就下结论。**这正是本项目反复记着的教训**（"测试全绿不等于功能可用"）。
- **复验通道 B**：能补全四条。**否决理由**：已确认的跨项目规则明写"**本机一切搜索/取网页都必须走 argo MCP，不要用宿主 web_search / web_fetch**"（`m3c02caa593c84acc`）。**即使它修好了，本项目也不该走它**  复验一个我们不会使用的通道，是纯粹的浪费。改为在报告里标注"本项目不用"并给出规则出处。
- **不复验，只改文字描述**：最快。**否决理由**：那会把"我认为修好了"写成"已修好"，与本项目一贯拒绝的形态同形。**四条通道的每一条都有本轮的实际调用记录。**

## Consequences

- **报告从"不能支撑"改为"3 条可用、1 条不用"**  而目标要求的正是这份现状评测。
- **§二逐条对照三条根因**（哪条已修、修在哪） 比原报告更有用，因为**它给出了修复位置**。
- **§三改为"未复验的两条"** → 实际复验后已无此项（B 归入"本项目不用"）。
- **§五新增四条需求的现状表**，把第 (1)-(4) 项的载体与状态逐条列出。
- **§六保留第 (2) 项 2/12 的诚实标注**（唯一未达标）。

## Verification

- **通道 A**：`argo_search` 返回 5 条（`engines_used: ["anysearch","local_bing"]`）；
  `argo_fetch` 返回 `success:true` + 116 字符正文
- **通道 C**：`wide_research` **完整跑完**  `{plannedTracks:4, completedTracks:2, failedTracks:2, sourceCount:9}`
- **通道 D**：`python3 scripts/search.py "Rust 所有权" --no-cache --json` → `results: 5`
- **Profile patch 实测存在且已配好**（`~/.dsh/profiles/web/cordis.patch.yml`，含三条根因的修法与注释）
- **本轮 26 次引擎探测全部返回**（18 有产出 / 8 合法空 / 0 失败） 不可能来自
  `npx` 路径（本机 `allow-git=none`），进一步印证 patch 生效

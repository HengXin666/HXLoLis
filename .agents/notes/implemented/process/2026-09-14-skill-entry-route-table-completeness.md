# Agent Note: skill 入口路由表必须登记全部子技能

Status: implemented

- 影响: `.agents/skills/hx-to-ai-docs/SKILL.md` (L1 `description` 与 L2 子技能表)

## Problem

`hx-to-ai-docs` 是 ai-docs 沉淀流水线的路由入口, 它有两份"有哪些子技能"的陈述:

1. frontmatter 的 `description` (L1, 每次会话预载, 也是人类口述调度时唯一的可见面);
2. 正文 `## 子技能分工` 表 (L2, 只在触发之后才读)。

两份**漂移**了: L2 表里写着 7 个子技能, 而 L1 `description` 只列了 5 个  `hx-look-video` 与 `archify` 缺失。

这不是排版问题。该 skill 设了 `disable-model-invocation: true`, 意味着**模型永远不会自动加载它**, 路由只能由人类发起; 而人类能看到的就是 `description` 那一行。清单少了谁, 就有一条路径在调度时被静默跳过  你说"把这个视频沉淀成笔记", 入口不会把 `hx-look-video` 摆到台面上。

同时暴露了一个更根本的隐患: 子技能表把**不同层次的东西平铺成了一张表**。`hx-look-video` (媒体 → transcript) 与 `archify` (描述 → 可交互图) 是**能力层**, 对非 ai-docs 场景同样成立; 其余五个是**沉淀层**。不写明这条分界, 下一个人(或模型)看到"视频转写既在 `hx-docs-sediment` 的视频路径里、又在 `hx-look-video` 里", 会合理地判断职责重叠并提议删掉其中一个。

## Decision

**两份陈述都补齐并互相钉死, 同时显式写下层次分界。**

1. `description` 补入两个缺失条目: `hx-look-video` (视频/音频/字幕 → transcript, 视频沉淀的转写前置)、`archify` (架构/流程/时序/状态图 → 可交互 HTML)。补后 494 字符, 远低于 1024 上限。
2. 正文在 `**术语对照**` 之后新增 `**层次差异**` 一段: 声明这两个是能力层 skill, 不做沉淀; 排版/命名/落盘归沉淀层; 两者对非 ai-docs 场景独立可用, **不并入沉淀层**。

关键取舍:

| 决策 | 结论 | 理由 |
|---|---|---|
| 是否删掉 `hx-look-video` | **不删** | 它是唯一的"媒体 → transcript"能力; 删掉会同时失去非 ai-docs 场景(纯问"这视频讲了啥")的入口, 而那个场景由它自己的 `description` + `allow_implicit_invocation: true` 承接, 入口 skill 恰好不覆盖 |
| 是否把 `hx-look-video` 并进 `hx-docs-sediment` | **不并** | `hx-docs-sediment` 的视频路径是**消费方**, 已显式引用 `hx_look_video_prepare.py` 与其三文件契约; 合并会让"转写"绑定到"沉淀", 纯对话场景被迫加载整条笔记规范 |
| `archify` 是否改名 `hx-archify` | **不改** | 目录名与 skill 名不一致是 vendored 上游的既有状态 (校验器对 `hx-archify` 报 ERROR), 且 `hx-docs-ppt` / `hx-docs-layout` 都按 `archify` 引用。改名是 vendoring 策略问题, 与本次入口登记正交 |
| 是否只改 L2 表 (或只改 L1) | **两个都改** | 只改一处就是把漂移从"两份都不全"变成"两份不一致", 问题原样保留 |

## Alternatives considered

- **什么都不做**: 最有吸引力的选项  功能上确实没有东西是坏的, 视频沉淀今天也能跑通(因为 `hx-docs-sediment` 内部有硬引用兜底)。否决理由: 漂移已经在真实调度面上咬人了  入口的 L1 清单是唯一可见面, 而它恰好漏掉了视频这条路; 且不写明层次分界, 这个问题会被反复重新提出(同一个疑问在 HX-Memory 里已出现过一次)。
- **把两个漏项补进 L1, 不动 L2**: 改动最小。否决理由: 补完 L1 之后 L1 变成 7 项而 L2 的表格仍然是平铺的, 读表的人依然看不出"为什么这两条不是沉淀路径", 下一个人的"职责重叠"疑问照旧。
- **在入口里删掉 `hx-look-video` 一行, 只让视频路径内部调用它**: 能让入口更短。否决理由: 被隐藏的依赖不会消失, 只是从路由表挪进了 reference; 人类调度时反而更不可能知道视频要走两跳, 与"入口保持简单明了"这条红线背道而驰。
- **把 `hx-look-video` 与其重复资产 `ref/HX-Video-Summary/py/transcribe.py` 合并**: 能真正减少重复(两者都是 FunASR 转写)。否决理由: 那是**能力实现**的去重, 与入口路由登记是两件事; 混进来会让本次改动无法用"两份清单是否一致"这一个判据验收。

## Consequences

- 入口的 L1 与 L2 两份子技能清单从此一致, 可以用肉眼比对(这是本次唯一被引入的约束, 没有自动门禁  `validate_skill.py` 只校验格式, 不能校验两份清单是否同步)。
- `hx-look-video` 与 `archify` 在人类调度面上的可见性从"藏在正文"变为"写在 description"。
- 层次分界被写进入口后, "视频/图表职责重叠, 是不是该删" 这个疑问有了就地答案, 不必每次重新推导。
- `hx-look-video` 与 `ref/HX-Video-Summary` (FunASR 转写) 的**实现**重复仍然存在, 只是不再被误认成职责重叠。

## Verification

- `uv run .agents/skills/hx-make-skill/scripts/validate_skill.py hx-to-ai-docs`  PASS (0 errors, 0 warnings), 确认补写后的 `description` 未破坏 frontmatter 契约;
- 逐行比对 `description` 的子技能清单与正文 `## 子技能分工` 表  均为 7 项且同名;
- `node .agents/skills/hx-agent-notes/scripts/cli/verify-all.ts`  格式与覆盖门禁。

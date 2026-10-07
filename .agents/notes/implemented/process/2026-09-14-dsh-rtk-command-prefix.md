# Agent Note: DSH 侧接入 rtk 只能走指令前缀, 不能装钩子

Status: implemented

- 影响: `~/.dsh/AGENTS.md` (新增, 宿主外的用户全局指令文件) 与后续所有会话的 shell 调用纪律

## Problem

`rtk` (Rust Token Killer, 已装在 `~/.local/bin/rtk`, v0.43.0) 在本机的实测账本是 43799 条命令里
省下 273.8M / 313.5M token (87.3%)。它给 Claude Code 和 Codex CLI 都做了接入: 前者是
`~/.claude/settings.json` 的 `PreToolUse` 钩子 (`rtk hook claude`), 后者是 `~/.codex/AGENTS.md`
里一行 `@RTK.md` 加"命令一律加 `rtk` 前缀"的约定。

把这两条照搬到 DSH 都会得到一个**看起来装好了、实际一个字节都不省**的空转:

1. **Claude Code 钩子路走不通。** 那个钩子的机制是让 `PreToolUse` 返回
   `hookSpecificOutput.updatedInput.command` 来改写命令 (`rtk hook claude` 实测输出正是这个形状)。
   而 DSH 的 `tools/pre-execute` 水位线返回类型 `PreToolDecision` 只有 `allow | deny | ask` 三个分支,
   **没有改写输入的分支**; 官方桥 `@deepseek-ai/dsh-hooks-claude-code` 也把 `updatedInput` 显式记为
   "logged and warned but not honored", 然后**照原样执行**。
2. **Codex 路是冗余的。** DSH 的 Codex 桥只认 `decision: deny` (只阻断, 不改写), 而 Codex 侧之所以
   能生效, 靠的是模型读到 `RTK.md` 后自觉加前缀  那正是 DSH 本来就有的指令注入能力, 不需要任何插件。

不做的代价是可量化的: 同一批命令在 DSH 里按原生输出进上下文, 就是放弃那 87% 的压缩率。

## Decision

**在宿主外新增 `~/.dsh/AGENTS.md`, 用指令约定接入 rtk。不装插件, 不碰 `~/.claude` 与
`~/.codex` 已有的两条接入。**

该文件写五条规则: 只读冗长命令加 `rtk` 前缀; 写操作/交互式命令保持原生; 拿不准时加前缀
(rtk 对不认识的命令原样透传, 实测 `rtk echo/sed/python3` 与原生无差); `find` 一律原生
(见下); 前缀执行失败就退回原生重跑。

其中第 4 条来自实测缺陷而不是偏好: `rtk find . -name '*.md'` 在本仓库根 (含中文文件名) 直接
panic  `find_cmd.rs:326` 在非字符边界切片, exit 134; 换成纯 ASCII 目录同一条命令正常返回。
因此 `find` 被单独排除在前缀约定之外, 而不是笼统地"全都加前缀"。

加载路径: `dsh-agent-instructions` 把 `$DSH_HOME/AGENTS.md` 当作 **user-global baseline** 收进来
(实现里就是 `join(dshHome, USER_GLOBAL_FILE)`), 与项目 `AGENTS.md` **合并而非覆盖**, 共享
65536 字节渲染预算。它每个会话只读一次  **改完要新开会话才生效**。

## Alternatives considered

- **什么都不做, 靠模型自觉用 `rtk`**: 最强理由是 `rtk` 本来就在 PATH 上, 想用随时能用。
  否决理由: 这正是 `rtk gain` 自己在统计的那条不确定线  没有声明式约定时, 采纳率由模型每一轮
  重新决定; 同一台机器上 HX-Memory 的双线对照已经量过这个差 (声明式注入 10/10 vs 靠自觉 6/10)。
- **写 DSH 插件, 在 `tools/pre-execute` 里改写命令**: 这是最接近 Claude Code 钩子、也最"自动化"的
  形态, 模型完全不用改行为。否决理由: **该水位线在类型上就不允许改写** (见 Problem 第 1 条), 要做得
  先改 DSH 宿主并长期背一个补丁; 而它换来的只是一个前缀, 同样的前缀一行指令就能拿到。
- **装 `dsh-hooks-claude-code`, 配上 `rtk hook claude`**: 成本最低, 直接复用现成的桥和现成的钩子
  命令。否决理由: 桥会把改写请求记成一条 warning 然后照原样执行  这是最坏形态的"装好了":
  日志里有钩子, 账单上没省钱, 而且下次排查要重新读一遍桥的源码才知道它不生效。
- **把约定写进 HX-Memory 的全局规则**: 与指令文件同为无条件注入通道, 还额外跨宿主 (Codex 也能读到),
  并且能吃到"规则永不被机器改"的治理闸门。否决理由: 这条约定只对 DSH 的 bash 工具有意义, 塞进
  跨项目规则会让每个无关任务的规则清单都长一段; 而且它必须与 rtk 子命令集同步, 两份声明必然漂移 
  Codex 侧已经有自己的 `RTK.md`, DSH 侧一份 native 指令文件就够。
- **反过来改 `~/.codex/AGENTS.md` 让 Codex 也指向 DSH**: 不属于本次范围, 且那两条接入本来就在工作,
  动它们只有回归风险没有收益。

## Consequences

- 换来的是 rtk 在 DSH 会话里的压缩率; 代价是一份**必须跟着 rtk 版本走**的指令文件  rtk 改了子命令、
  或修掉 `find` 的 panic, 这份文件不会自动更新, 需要人工回改。
- `rtk` 被卸载或不在 PATH 时, 加前缀会让命中规则的那批命令全部失败。文件里因此写了前置检查
  (`rtk --version` / `rtk gain`) 和"失败即退回原生"的兜底, 但这条依赖仍然存在。
- `~/.dsh/AGENTS.md` 在仓库之外、不受版本控制: 它是一条**环境**决策而不是仓库资产, 换机器要重新放一份。
  本 note 是它唯一的仓库内足迹。
- 前缀约定只覆盖读命令, 写操作 (commit/push/rm) 完全不经 rtk 滤波器, 因此那些命令的退出码与输出格式
  与原生逐一相同 (实测 `rtk git` 本身也保真, 但写操作不走它仍是有意选择)。

## Verification

- `rtk --version` → `rtk 0.43.0`; `rtk gain --format json` → 273.78M / 313.49M saved (87.3%), 基线取自
  43799 条历史命令;
- `rtk hook check <cmd>` 逐条确认改写面: `git status → rtk git status`、`cat → rtk read`、
  `grep/rg/ls/docker/curl → rtk <same>`; `rm -rf` / `echo` / `sed -n` / `python3` / `jq` 一律原样透传;
- 退出码抽查 (与原生逐条对照): `rtk ls /nonexistent` = 2, `rtk grep -q zzz` = 1,
  `rtk git status --badflag` = 129  三者与原生相同;
- `rtk find . -name '*.md'` 在仓库根 → exit 134 panic (已写入规则第 4 条); 在纯 ASCII 目录下同命令正常;
- `node .agents/skills/hx-agent-notes/scripts/cli/verify-all.ts`  分类/格式/覆盖/锚点门禁。

# Agent Note: 项目级 skill 扫描根必须镜像真实 skill 目录

Status: implemented

- 影响: `/home/hx/Loli/code/HXLoLis/.agents/skills/` (根工作区的软链注册表) 与 `HXLoLi/.agents/skills/hx-note/` 内部的跨 skill 引用

## Problem

HXLoLis 是一个**多仓库工作区**: 根目录本身是 git 仓库, `HXLoLi` 是它的子模块。而 DSH 的项目级
skill 扫描根是「包含 `.git` 的最近祖先目录」下的 `.agents/skills`  在本工作区里就是
**根目录**那份, 不是子模块里的那份。并且扫描**不递归** (`**/SKILL.md` 刻意不被发现), 只认扫描根
**一级目录**下的 `<name>/SKILL.md`。

于是根工作区的 `.agents/skills/` 是一张**注册表**: 绝大多数条目是指向子模块真身的软链，
项目自有的手动技能也可以是实体目录。这张表由 `e0e207c [skills] 注册整理技能链` 建立。

问题出在之后的重构: HXLoLi 侧把 `hx-to-ai-docs` + 5 个 `hx-docs-*` 合并成了单个 `hx-note`
(九步状态机 + 两条独立入口)。**磁盘上的目录名变了, 注册表没跟着变**  结果是:

- 根 `.agents/skills/` 下 7 条软链 (`hx-docs-grill`/`layout`/`organize`/`ppt`/`sediment`,
  `hx-to-ai-docs`, `hx-look-video`) 全部断链  目标目录已被合并删除;
- 合并后的真身 `hx-note` **从未登记**, 因此整个知识沉淀流水线对 agent 不可见。

这是**静默失效**: 断链不报错, 缺失也不报错, skill 只是从目录里消失。会话里能看到的只剩
`archify` / `hx-agent-notes` / `hx-make-skill`  沉淀流程一个字都读不到。
更麻烦的是软链的 target 是**相对路径** (`../../HXLoLi/...`), 所以它只在工作区布局下解析;
`readlink -f` 会把断链"解析"成一个不存在的路径而不报错, 肉眼扫一眼目录列表看不出坏了。

## Decision

**注册表以磁盘真身为准, 逐条对齐: 删掉 7 条断链, 登记 `hx-note`。**

```
根 .agents/skills/           ->  HXLoLi/.agents/skills/
  hx-note                    ->    hx-note        (新登记)
  hx-agent-notes             ->    hx-agent-notes
  hx-archify                 ->    hx-archify
  hx-make-skill              ->    hx-make-skill
```

同时清掉合并遗留的**跨 skill 悬空引用**: `hx-note` 内部有 7 处指向已删 skill 的路径
(`hx-docs-ppt` 的 `references/tsx-deck.md`、`hx-docs-organize` 的 `references/migration.md` 等),
全部改指本 skill 内的对应文件  `steps/6-derive/impl/tsx-deck.md`、`entries/organize/index.md`、
`entries/organize/impl/migration.md`。这些文件在合并时**已经搬进来了**, 只是引用还写着旧地址。

## Alternatives considered

- **什么都不做, 只把断链留着** — 最强理由: 断链本身不消耗任何东西, 而且 `hx-docs-*` 那一代 skill
  已被合并掉, 留着这些名字至少保留了"曾经有过这些 skill"的痕迹。否决理由: 这是**失效的私有痕迹**,
  不是历史  真正的历史在 git log 和 note 里。留着只会让下一个人(或模型)以为这几条路是通的,
  而 DSH 每次扫描都要对 7 个死条目做一次无意义的 stat。
- **把 `hx-note` 直接放在根 `.agents/skills/` 下, 不做软链** — 最强理由: 少一层间接, 不依赖
  相对路径解析, `readlink -f` 那类陷阱直接消失。否决理由: 会**复制**一份到根仓库, 与 HXLoLi 子模块
  里的真身形成两个源; 两边必然漂移, 而漂移的失效模式同样是静默的。既有 4 条链已经确立了
  "根是注册表、HXLoLi 是仓库" 的分工, 破坏它要付的是一致性成本。
- **改用用户级 `~/.agents/skills` 或 `~/.dsh/skills` 注册** — 最强理由: 一次登记, 所有项目可用,
  且不受子模块布局影响。否决理由: 那会把这些 skill 变成**全局**的  别的项目会莫名其妙多出
  HXLoLi 的知识沉淀流水线; 而 skill 的正文全是相对 `ai-docs/` 的路径, 换个仓库就是错的。
- **让 DSH 递归扫描 `**/SKILL.md`** — 最强理由: 从根上消除"注册表要跟目录同步"这件事。否决理由:
  那是宿主行为, 不在本仓库可控范围; 且官方文档已明确**刻意不支持**嵌套发现 (monorepo 里
  同名 skill 会互相覆盖)。要绕过它就只能自己写提供方插件, 成本远大于维护一张软链表。

## Consequences

- 沉淀流水线对 agent 重新可见, 且是**唯一入口** `hx-note`  与磁盘真身一一对应。
- 代价: 注册表与磁盘之间**没有自动门禁**。新增/改名/删除 skill 时, 根 `.agents/skills/` 必须手工同步,
  否则重现同一个静默失效。这条约束是本次唯一的持续性成本。
- 软链的相对 target (`../../HXLoLi/...`) 使注册表**绑定于当前工作区布局**。仓库被移动、
  或 `HXLoLi` 子模块未初始化时, 全部条目一起失效  且失效是静默的。
- 注册表以软链为主；通用的手动技能 `hx-code-quality` 是当前工作区自有的实体目录，
  全局 `~/.agents/skills/hx-code-quality` 只链接到该目录。这个例外的理由见
  `../process/2026-10-02-code-quality-skill-project-specific-landscape.md`。曾经的 `de-ai` 已删除，
  理由见 `implemented/simplification/2026-09-27-de-ai-removed-as-redundant.md`。
  扫描器不区分软链与实体目录: 扫描根一级目录下有可用的 SKILL.md 即可。

## Verification

- `cd .agents/skills && for l in *; do [ -e "$l" ] && echo OK || echo BROKEN; done`
  → 当前各软链均有可用目标；根目录的实体技能可直接检查 SKILL.md。
- 会话技能目录在修复后即时刷新, `hx-note` 出现在 `<available_skills>` 中 (提供方带 watcher,
  新增/改名无需重启);
- `uv run .agents/skills/hx-make-skill/scripts/validate_skill.py .agents/skills/hx-note` → PASS (0 errors, 0 warnings);
- `grep -rn 'hx-docs-\|hx-to-ai-docs\|hx-look-video' .agents/skills/hx-note/` → 无残留;
- `node .agents/skills/hx-agent-notes/scripts/cli/verify-all.ts` → 五道门禁全绿 (tree/format/backlinks/archive/coverage)。

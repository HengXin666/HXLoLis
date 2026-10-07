# Agent Note: 常驻上下文的分层判据与 REF-26 的补全

Status: implemented

- 影响: .agents/skills/hx-code-quality/SKILL.md, templates/context-layers.md, templates/index.md, templates/profiles/shared.md, steps/, scripts/check-context-layers.ts, scripts/verify-templates.ts, scripts/verify-note-links.ts

## Problem

REF-26 (`check-doc-budgets`) 只量注入上下文的**字节数**, 不回答"这条规则该在哪一层". 实测本仓 68 个 `AGENTS.md`, 去掉 `.agents/notes/` 机制文件与参考物后, 真正带内容的 9 个全部落在各仓库根: HXLoLi 3326 个文件、内部 0 份, HX-Memory 518 个文件、内部 0 份. 宿主 dsh-agent-instructions 从项目根到工作目录逐级加载, 读到更深目录时下一次请求才纳入新适用的文件  机制本来就在, 缺的是那些文件. 结果是模型只读到根那一篇, 子目录的规则无处可读, 而根文档只装得下最宽泛的几条.

这一条在原版 `code-quality-redlines/SKILL.md` 的判断原则里有原文: "上下文也是预算……优先放 lint 报错信息、子目录文档、按需加载的技能  而不是根级常驻文件". 改写为 hx-code-quality 时它没有被迁移, 分层从**原则**降级成 13 号骨架里的一行例子, 而 13 号骨架被归入 C 完整覆盖层、触发条件写作"常驻上下文增长时". 体量上限因此存在但永不触发, 分层则完全没有判据.

## Decision

分层与体量由 `.agents/skills/hx-code-quality/SKILL.md` 下的必审项约束, 契约落在 `.agents/skills/hx-code-quality/templates/context-layers.md`; 两者一起裁决, 并从 A 层起就要求裁决一次, 不再属于 C 层; `scripts/check-context-layers.ts` 是同名判据的本体, 复制进目标项目即可运行. 它同时判两件反作用力的事: 每个入口文档的 UTF-8 字节上限, 以及权重达标的目录必须自带入口文档. 权重按递归计, 源码文件与 `.md` 文档都算, 于是 `docs/` 这类纯文档目录与纯代码目录共用一条阈值; 含项目根标记的目录无条件要求入口文档. 存量欠账用棘轮基线过渡, 基线条目在不再缺失时判红, 防止棘轮反向掩盖已完成的修复. 降级顺序固定为搬层、压缩、最后抬上限.

`templates/profiles/shared.md` 在 REF-26 处直接指向这份契约: 只量字节等于只做了一半. `steps/1-evidence/impl/evidence.md` 要求取证时记录入口文档的**分布**而不只是存在性  只看根目录有一份就收工, 正是本项最常见的漏检形态. `SKILL.md` 恢复原版那句原则并给出 token 成本的理由, 使它在触发时立即可见, 而不是埋在 C 层.

元门禁由 `scripts/verify-templates.ts` 承担: 它断言契约文件被模板入口路由, 并实际调用 `check-context-layers.ts --self-test`; `--self-test` 新增两组探针 (契约未路由、判据脚本被删), 使这条新判据本身也会因改名或删除而红. `scripts/verify-note-links.ts` 从核对单一 note 扩展为核对 note 列表, 本 note 与原 2026-10-02 note 各自双向互链, 二者管不同的决策.

## Alternatives considered

- **沿用外部脚本形态, 不把判据放进本 skill** — 最强理由是目标项目各自的目录约定不同, 自带脚本可能诱导照搬阈值. 否决理由是可运行判据是本 skill 全部主张的落点, 只给方法不给脚本, 就等于回到"写到文档里但从不执行"; 阈值与排除项都是命令行参数, 照搬风险由默认值之外必须填写本仓实测值这条约束兜住.
- **只补分层, 不补覆盖 (该有而缺失)** — 最强理由是缺失是存量的常态, 加了必然全仓红, 和维护成本不成比例. 否决理由是只判体量时, 根文档删到阈值内即可全绿, 而"子目录没有规则可读"这个真实故障完全不受影响; 棘轮基线正是为承接这批存量而存在.
- **沿用 13 号骨架, 只把它的触发条件从 C 层挪到必审** — 最强理由是改动最小, 也保留了原件与骨架的哈希对应关系. 否决理由是该骨架是原仓的逐字节切片, 加适配注记会破坏 `verify-templates.ts` 核对的 `sourceSectionSha256`; 独立契约文件把"原仓证据"与"本 skill 的判断"分开, 骨架仍可原样保留.
- **把覆盖判据设成"每个目录都要有入口文档"** — 最强理由是最彻底, 不会漏. 否决理由是安装到任何真实仓库都会全红, 触发整条规则被忽略, 这正是原版"禁止照搬"一节点名的失败方式; 权重阈值加棘轮让第一批就能全绿.

## Consequences

任何项目调用本 skill 时都会多出一项必须裁决的内容, 存量仓库首次运行会得到一份按权重排序的缺失清单, 补齐可以分轮进行. 默认阈值 3000 字节来自 REF-26 的参考快照量级, 15 的权重阈值是本 skill 首次给出的值, 两者都必须在目标仓重算, 照抄会在分布不同的仓库上误伤. 判据的盲区是它只判"有没有", 不判内容是否与代码一致  后者需要读文件, 无法机械化, 仍留在取证阶段的人工复核里.

## Verification

- 判据自证: `node .agents/skills/hx-code-quality/scripts/check-context-layers.ts --self-test`  11 组探针全过, 覆盖超预算、根缺失、子目录缺失、文档型目录、嵌套项目标记、棘轮容忍、棘轮陈旧项、vendor 剪枝与排除剪枝.
- 元门禁: `node .agents/skills/hx-code-quality/scripts/verify-templates.ts --self-test`  10 组探针全过, 含契约未路由与判据脚本缺失两组.
- 实仓取证: 对 components/HX-Memory 运行该判据得到 13 处缺失 (含根目录本身), 对父仓运行得到按权重排序的完整缺失清单; 两侧均未修改任何源文件.
- 文本与规范: `validate_skill.py`, `prose_rules.py --check`, `check_layout.py` 退出码均为 0; `node .agents/skills/hx-agent-notes/scripts/cli/verify-all.ts` 全绿.
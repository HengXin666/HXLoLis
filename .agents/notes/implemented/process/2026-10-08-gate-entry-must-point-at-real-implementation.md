# Agent Note: 门禁入口必须指向真实实现

Status: implemented

Decision-ID: gate-entry-must-point-at-real-implementation


## Code

- `scripts/redlines/agent_notes.py`

## Problem

本仓的 CI 与 HXLoLi 的 CI、npm 脚本都在调用 `scripts/cli/verify-all.ts`, 而该文件早已改成 v2 红线的委托壳; 两个仓库的配置却仍是 v1 (`{"root": ...}` 没有 `version`), 红线只能在 v2 配置下工作, 于是每次运行都只输出 `ERROR .agents/notes.config.json:1 [gate-error] Expected version 2 config with only version and guarded; migrate legacy config explicitly` 并以 1 退出。**入口写的是一个已经不再承担该职责的文件**, 门禁的实际状态从"全绿"变成了"永远红", 而红的原因与本次提交的内容无关, 于是它不再是判据, 只是噪声。

同一次排查还暴露两种同源形态:

1. 入口指向**不存在的文件**: workflow 调 `hx-code-quality/scripts/verify-note-links.mjs` 与 `verify-templates.mjs`, 而该技能里只有 `.ts`. 该步骤从未成功过。
2. 入口指向**已漂移的门禁**: `verify-templates` 的基线是 `assets/source/manifest.json` 里的 sha256, 实测 4 份原始文档与 14 段骨架中有 11 段对不上, 它自身 exit 1, `--self-test` 也在第一组探针就抛错。

这两种都不是"代码坏了", 而是**声明与实物脱节**: 调用方按名字信任入口, 名字却没保证后面还有东西。

## Decision

入口登记与配置版本匹配的真实实现. 本仓与 HXLoLi 已显式迁移到 v2, 项目入口 `scripts/redlines/agent_notes.py` 委托 vendored AST 红线, npm 与 hook 统一调用同一实现. 不再登记只检查 v1 结构和格式的替代入口

GitHub 工作流使用 Diff / Full 收集器和可信 Report, 对应代码片段评论并保存完整诊断, 始终容错完成. 本地扫描保持严格退出码. 完整迁移范围由 [v2 adoption](2026-10-08-repository-agent-notes-v2-adoption.md) 拥有; 收集与评论行为由 [advisory comments](2026-10-08-agent-notes-advisory-comments.md) 拥有

根工作流的独立 `hx-code-quality` 引用检查保留为容错步骤, 入口使用真实 `.ts` 路径. 模板基线漂移需要由其自身的质量门禁决策处理, 不拿旧 Agent Notes 放行器掩盖它

## Alternatives considered

- **什么都不做 / 复用现有入口**: 最省事, 且 CI 红着也不影响本地提交 (hook 走的是另一条路径)。否决理由: 一个永远失败的 required check 比没有 check 更糟  它把"看 CI 结果"变成无意义动作, 真正的失败会混在同一条红色里, 这正是本仓反复踩的"信号被稀释"形态。
- **保留 `verify-all.ts` 入口, 直接把配置迁到 v2 让它跑起来**: 一步到位, 不用回头删代码, 还能顺带拿到 AST 双向图。否决理由: v2 要求每篇 active note 有 `## Code` 精确路径 + 源码函数锚点双向配对; 实测本仓 77 篇里只有 1 篇带 `## Code`, 且 69 篇引用的代码根本不在本仓 (在被 .gitignore 的 `ref/` 与未纳入的子目录里), HXLoLi 与 Music 的引用大量是 glob 和花括号。**先迁配置等于当场把门禁变成 77 篇 note 的失败清单**, 那不是迁移, 是把噪声换了个来源。
- **把 `verify-all.ts` 改成版本感知的分发器 (v1 跑旧三件套, v2 跑红线)**: 入口名字不用变, 未来迁移时不用改 CI; 而且"`verify-all` 就该跑全部门禁"是它的原始语义。否决理由: 这会在门禁实现里加一层永久存在的版本分支 (v1 的三件套里有两条已委托红线, 分支必须逐仓判断哪些是真实现), 复杂度落在**最不该有复杂度的地方**  门禁自己。入口分流是每个仓库一次的机械改动, 分发器则是长期维护的抽象。
- **只删掉报错的那一步, 不管另外两个不存在的路径**: 改动最小, 只让 CI 变绿。否决理由: `.mjs` 与 `verify-templates` 基线漂移是同类问题, 留着它们等于把"入口指向不存在的东西"这条错误继续登记在仓库里, 下次还会有人照着它去调用。

## Consequences

入口与配置成对维护, 新鲜 checkout 使用本仓 vendored 实现即可运行. 旧配置只在明确迁移的 diff 中参与基线比较并请求审核, 不再作为常驻分发分支. CI 的成功状态不代替双链诊断

## Verification

完整图与精确 Git 树检查覆盖路径, AST 锚点, 唯一性和目录归属. 实际 GitHub 评论需要仓库启用新版工作流, 本地采用模拟 API 检查

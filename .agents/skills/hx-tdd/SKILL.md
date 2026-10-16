---
name: hx-tdd
description: "以红绿循环为目标项目编写测试: 先与用户确认测试接缝, 每轮只写一条失败测试和让它通过的最小实现, 只经公共接口断言行为, 只在系统边界使用替身, 用例按 hx-agent-code 的业务分层目录落地并登记测试 ID. 同时承接 hx-agent-code 登记的规则正反探针, 性能案例与契约测试. Use when 用户主动调用 $hx-tdd 或 /hx-tdd, 要求测试先行开发功能或修 bug, 要求补测试骨架, 或 hx-agent-code 把所需用例交给本技能编写; 普通编码请求不自动触发, 不为每次改动补测试"
disable-model-invocation: true
metadata:
  author: Heng_Xin
  version: "1.0"
---

# hx-tdd

测试先行的施工技能. 测试只覆盖与用户约定的接缝骨架, 属于代码质量规范的一部分, 不是每次编码后的必做项. 没有调用本技能的普通编码任务不写新测试, 只在回合结束运行项目已有的 affected 测试

好测试只经公共接口验证行为, 读起来像规格: 内部实现整体重写后它仍然成立. 判据与正反例见 `references/tests.md`, 替身边界见 `references/mocking.md`

## 步骤

| 步骤 | 只负责 | 契约 |
|---|---|---|
| 接缝 | 读项目约定, 列出待测接缝并一次确认 | `steps/1-seams/index.md`: 开始时读 |
| 循环 | 每轮一条失败测试加最小实现 | `steps/2-loop/index.md`: 写第一条测试前读 |
| 交付 | 登记测试 ID, 末轮统一运行一次, 报告 | `steps/3-deliver/index.md`: 所有切片变绿后读 |

## 与本仓规范的边界

- 运行时机: 红绿循环中只运行当前这一条测试, 这是 "禁止一边开发一边测试" 的唯一例外, 因为先红后绿本身就是这一轮的证据. affected 测试, formatter, lint 与 notes 门禁都在交付步骤按最终 diff 统一跑一次, 完整测试集只在 affected 选择兜底全量时或 PR CI 中运行, 不挂到编辑文件的 hook
- 测试布局: 以目标项目存在 `scripts/quality/coverage.json` 作为已装 hx-agent-code 的唯一判据, 各步骤同用此判据. 已装时, 用例按它的业务分层目录, 统一入口与影响图落地; 未安装时沿用项目已有测试目录, runner 与检查入口, 不新建测试框架, 入口或新增依赖
- 确认次数: 全程最多在接缝步骤确认一次. 承接 hx-agent-code 登记清单时清单即为已授权接缝, 不再询问, 清单外新出现的接缝标 blocked 并在交付时列出
- 决策记录: 改动带 Agent Note 锚点的声明前先读该 note, 按 hx-agent-notes 的规则在同一 diff 配对修改. 本技能不为测试另立 note
- 依赖查找: hx-agent-code 与 hx-agent-notes 按顺序查找第一个 `SKILL.md` 可读的安装, 悬空 symlink 不算: 本技能同级目录, 目标仓库 `.agents/skills` 或 `.dsh/skills`, 用户级 `~/.dsh/skills`, `~/.agents/skills` 或 `${CODEX_HOME:-~/.codex}/skills`

## 按需资料

- `references/tests.md`: 写或审每条测试前读, 好测试判据, 反模式与正反例
- `references/mocking.md`: 需要替身或测试数据时读, 系统边界清单与各测试层的数据来源
- `references/handoff.md`: 承接 hx-agent-code 登记的规则探针, 性能案例或契约测试时读, 输入字段, 判据与回交格式

## 产物约束

- 本技能目录内的文本遵守 hx-make-skill 的 `references/prose-rules.md`. hx-make-skill 按上面相同顺序查找, 修改本技能后在技能目录执行下面三条, 全部退出 0 才算完成, `<make>` 为查找到的 hx-make-skill 目录的绝对路径

```sh
uv run <make>/scripts/validate_skill.py .
uv run <make>/scripts/prose_rules.py --check .
uv run <make>/scripts/check_layout.py .
```

- 写入目标项目的测试代码与 fixture 遵守目标项目 `.agents/coding-rules.md` 和它已安装的门禁, 不因属于测试而豁免文件大小, 字面量, 绝对路径等规则

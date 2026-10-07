---
name: hx-agent-code
description: "为目标项目一次性安装和补齐代码质量红线, 定制 AST 规则、文档与 AI 上下文检查、Diff 测试选择、Agent/Git hooks、GitHub CI 和元门禁, 输出 MD/JSON review 报告. Use when 用户主动调用 $hx-agent-code 或 /hx-agent-code, 要求按 AI 代码质量规范完成项目门禁安装或完善; 不因普通代码编辑自动触发"
disable-model-invocation: true
metadata:
  author: Heng_Xin
  version: "1.0"
---

# hx-agent-code

针对用户指定项目, 完成取证、适配、安装和验收. 先复用项目已有能力, 再补确定性脚本, 不以建议清单代替已授权的实现. 以当前目标仓库为边界, 多仓分别取证

这是一次性施工技能, 安装后由项目脚本和 hook 持续执行红线, 不要求每次开发重新加载完整技能. 补装时读取已有 coverage, 只实现缺项并核对接线, 不重复创建配置或覆盖用户改动

必须依赖 `../hx-agent-notes/SKILL.md`: 开始非平凡改动前读取, 由它负责决策记录、AST 锚点、双链和配对 diff. 若目标有另一安装位置, 读取目标的真身; 依赖缺失时明确报告并准备安装, 不复制其实现来假装依赖已满足

## 步骤

| 步骤 | 只负责 | 契约 |
|---|---|---|
| 取证 | 目标项目、复用顺序、适用性、缺失信息 | `steps/1-discover/index.md`: 开始时读 |
| 安装 | 规则、报告、测试选择、上下文、元门禁 | `steps/2-install/index.md`: 落地本地工具时读 |
| 接线 | Agent/Git 检查点、CI、协作文件 | `steps/3-connect/index.md`: 连接实际宿主时读 |
| 验收 | 最终 Diff 一轮测试、正反证据、交付 | `steps/4-verify/index.md`: 实现完成后读 |

## 完成边界

逐项落实规则目录. 默认 Error, 只有明确标为 Warning 或静态无法裁决的语义项交人工 review. Warning 不拦截, Error 阻止任务完成、push 和 CI. 各扫描不短路, 独立失败全部进入同一份 MD/JSON 报告

本地以最终工作区 Diff 为入口, 允许完整文件/函数/依赖上下文. 不边开发边测试, 修改完成后统一执行 affected 测试; 修复失败后重跑受影响项. Push affected, PR 全量测试, 质量与文档仍按 Diff. 旧项目用可信 baseline 区分历史与新增, 不自动批准当前违规

内置脚本只提供跨项目通用的 scope、selection、report、coverage 算法. 语言 checker、hook 配置与 CI 必须按目标项目实现并验证, 未完成的适用项标 blocked, 不把示例或空壳计作已安装. 新第三方库需用户决定, 已有授权不重复确认

## 按需资料

- `references/rules.md`: 安装前逐项读取的规则 ID、等级、阈值及正反例
- `references/runtime.md`: 实现本地检查点、快照适配、缓存、MD/JSON 与 baseline 时读
- `references/testing.md`: 建立业务模块测试层、依赖影响图和统一入口时读
- `references/github.md`: 项目使用 GitHub 时读, 覆盖工作流、可选 bot 与协作文件
- `references/meta.md`: 为项目编写规则探针及最终交付验收时读
- `references/source-map.md`: 维护技能或对照原文时读, 核查章节覆盖与验证边界

## 可执行件

- `scripts/cli.ts`: 运行 scope、affected、report、audit 时使用, 未知参数退出 2
- `scripts/ci.ts`: GitHub 模板实际调用的 code/docs/build/compatibility/tests 入口
- `scripts/ci/index.md`: 接入 CI runner 时读, 配置、模块职责、命令输出及构建产物契约
- `scripts/core/model.ts`: 给项目适配器接入 JSON 时读, 定义输入与验证函数
- `scripts/core/scope.ts`: 调试 worktree/index/commit-tree 范围时读, 只采集路径不代替内容快照
- `scripts/core/affected.ts`: 接入 AST 依赖图时读, 反向依赖闭包及全量兜底
- `scripts/core/report.ts`: 适配 checker 输出时读, 稳定指纹、基线分类及 Markdown/JSON
- `scripts/core/audit.ts`: 核查逐条安装证据时读, 规则目录为期望清单
- `assets/impact.example.json`: 建立项目图适配器时参考, 路径与测试 ID 需替换, 不能直接证明图完整
- `assets/coverage.example.json`: 填写逐规则证据时参考, 故意不完整, 直接 audit 应失败
- `assets/github/index.md`: 安装 GitHub 流程时读, 四个可复制 YAML 的索引
- `assets/collaboration/index.md`: 安装协作文件时读, Issue/PR/CODEOWNERS/CONTRIBUTING 模板索引
- `assets/example/index.md`: 验证 CI 接线或适配项目命令时读, 可运行最小示例

运行环境为 Git 和 Node 22.18+ 的原生 TypeScript 执行, 无 npm 运行期依赖. 安装复制 CLI/core 时也复制 references/rules.md 到相同相对位置, audit 从该目录读取. 图未匹配当前快照时必须设置 complete 为 false

## 产物约束

本技能及其生成的所有文本遵守 `../hx-make-skill/references/prose-rules.md`, 脚本遵守 `../hx-make-skill/references/code-quality.md`. 代码保持 4 空格、120 列、300 行与每目录 6 文件上限; Python AST 适配器是语言原生解析所需例外, 通过 uv 执行. 产物按相同要求验证, 不能因模板生成而豁免

- `README.md`: 仅维护本技能时读取, 包含验证命令、测试索引、来源和决策记录

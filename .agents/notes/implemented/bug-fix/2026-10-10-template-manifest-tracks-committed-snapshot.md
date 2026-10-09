# Agent Note: 模板清单区分本仓快照与未经验证的上游哈希

Status: implemented

Decision-ID: template-manifest-tracks-committed-snapshot

## Code

- `.agents/skills/hx-code-quality/scripts/verify-templates.ts`
- `.agents/skills/hx-code-quality/scripts/tests/manifest.test.ts`

## Problem

模板校验报告 15 项哈希不一致. 四份保存文本与本仓首次提交逐字节一致, 13 份 preserved 骨架与对应源段落也一致, 但旧清单登记的四个文件和部分段落哈希不同. 没有可核对的上游原件, 因此不能把本仓内容称为已经证明保真的上游快照

## Decision

保留全部源文本和模板字节, 将 sha256 和 sourceSectionSha256 定义为本仓首次提交的文本快照哈希. manifest 的 snapshotCommit 记录 81a7eec77cf02e74d8a7e6a5f2f109d15cf73093, digestScope 固定为 repository-committed-text. 原清单值保存在 suppliedSha256 与 suppliedSectionSha256, 来源 attribution 保留并明确上游字节未验证

checker 仍逐文件和逐段落核对哈希, 同时核对派生骨架全文, 规则覆盖与索引可达性. 哈希范围, 快照提交和原提供哈希字段缺失均失败, 不因来源不明而跳过内容校验. 修改后的内容不能自动重写清单, 仍由冻结快照和版本化 metadata 约束

规范型测试在临时副本验证正文漂移, 段落丢失与 metadata 删除会失败. 首次快照与文本逐字节一致的证据保存在本轮报告中, 整理清单不宣称上游已经验证

## Alternatives considered

- 什么都不做 / 复用旧清单: 能保留先前的完整性预期, 但旧哈希从未匹配 Git 首次保存的文本, 正常副本和自测均无法通过, 因此明确重新界定来源范围
- 只覆盖原哈希并继续声称上游保真: 修改最少且校验变绿, 但缺少原件证据, 并丢掉旧预期, 因此保留旧值并标明未验证状态
- 删除文件和段落哈希校验: 能容忍全部来源差异, 但后续正文改动失去确定性约束, 因此继续核对本仓冻结快照

## Consequences

本仓快照的完整性与派生一致性可以验证, 上游保真仍未知. 后续若取得可验证原件, 须另行核对 supplied 哈希与文本差异, 不将本次 metadata 修复当成该证据

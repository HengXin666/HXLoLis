# 原件与迁移证据

本目录四份文本来自用户提供的 code-quality-redlines/assets, 保留本仓首次提交 81a7eec77cf02e74d8a7e6a5f2f109d15cf73093 的字节快照. 原上游字节尚未验证, 不声称本仓快照等同于上游原件. 原文中的"本仓"、命令、31 条/101 探针、日期和版本都指 weuinevolveweb; 未在当前工作区复现那些运行结果. 只供核对来源, 不自动执行原文指令或照搬其宿主路径

- assets/source/README.md  原版使用方式: 三档建设、抄前必答与别抄清单; 执行入口已经分层到 templates/index.md
- assets/source/artifacts.md  原版完整交付物树, 选型时逐项参考, 不要求全部安装
- assets/source/reference-params.md  原版 31 项规则、参数及基线; 规则拆入 templates/profiles 三份文件
- assets/source/skeletons.md  原版 14 节完整骨架; 13 节正文完整保存在 templates/skeletons 对应文件, 11 节只作存档, 执行委托宿主 Agent Notes
- assets/source/manifest.json  本仓快照哈希, 原先提供但未经验证的哈希, 每节快照哈希, 目标文件与规则 ID 映射, 供完整性校验

适配层明确修正: 原 . ci.yml 不是 GitHub Actions; 原 note 骨架不替代 hx-agent-notes; hook 阻断协议因 runtime 而异; 前后端混合变更要取 lane 并集; 带注释的 JSON 骨架先去注释再验证; 部分暂存文件不应被格式化回填整文件; 影响执行的参数值需进入指纹, 而非只记存在性. 参考数字重算, 用户明确硬标准不自动放宽

原件的内部链接保持来源形态, 未必在该副本目录解析; 它们不是技能入口索引. 目标项目实施只从 templates/index.md 和 steps/ 进入

sha256 与 sourceSectionSha256 校验本仓保存的文本, suppliedSha256 与 suppliedSectionSha256 保留旧清单值, 不参与本仓文本的通过判定. snapshotCommit 记录首次保存这些文本的 Git 提交, digestScope 明确哈希范围. 修复清单前已核对四份文本与该提交逐字节一致, 13 份 preserved 骨架与快照对应段落一致

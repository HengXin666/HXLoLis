# Agent Note: 已安装技能通过锁文件与扇出 PR 跟随上游更新

Status: implemented

Decision-ID: vendored-skill-sync-fanout

## Code

- `scripts/skills/sync.py`

## Problem

hx-agent-code 与 hx-agent-notes 安装时把整个技能按固定版本 vendor 到目标仓库, 之后上游再更新, 已安装的仓库既不知道也不会跟着变. 实测 HengXin666 名下有 6 个仓库 vendor 了本仓技能, 其中 hx-pxy 的 hx-agent-notes 仍是 1.0, HX-UI 的 hx-agent-code 仍是 1.0, 没有任何记录说明它们落后多少, 本地是否改过

## Decision

固定版本 vendor 不变, 改为显式, 可审阅的升级

- 本仓技能内容改动必须提高 `metadata.version`, PR CI 用 `sync.py version-check` 检查, 不加 commit hook. 缺版本号或删掉现有技能的 `SKILL.md` 同样报错; 每次先写完整 JSON 报告 (含成功结果与工具故障) 并作为 artifact 上传, 超过 10 条只打印按规则的计数
- 目标仓库用 `.agents/skills.lock.json` 记录每个技能的来源, 版本, 上游 commit 与目录哈希, 由 `sync.py adopt` 为已 vendor 的技能补建, 由 `sync.py update` 在升级时改写; 内容已与上游一致但锁缺失或过期时也刷新锁. 目录哈希包含文件路径, 可执行位与内容
- `sync.py update` 整目录替换并更新锁文件; 哈希与锁不符 (本地改过) 或无锁且版本不低于上游时拒绝覆盖, 需 `--force`. 技能可选提供 `references/upgrade.md`, 按 `## <版本>` 分节写升级后需重新生成的产物, update 打印跨越版本的各节
- 本仓 main 上技能变动或每周一次时, `Skills Fanout` 工作流运行 `fanout.py`: 扫描仓库所有者名下全部未归档且非 fork 的仓库 (所有者即令牌账号时用 `/user/repos` 以包含私有仓库; 加 `.agents/skills-consumers.json` 列出的额外仓库), 凡 `.agents/skills` 下有同名技能目录的即为使用方, 逐仓克隆, 执行 update, 以工作树实际差异 (含仅补锁) 判断是否需要提交. 已有打开的同步 PR 时在其分支上叠加并只做快进推送, 不覆盖 PR 上的人工提交, PR 内改过的技能按本地改动跳过; 没有时从默认分支重建 `hx-skills/sync` 并新建 PR. 单个仓库的克隆, 网络或推送失败记入报告并让工作流失败, 不中断其余仓库. 令牌取 `HX_SKILLS_TOKEN`, 未配置时只告警跳过

## Alternatives considered

- **什么都不做 / 复用现有**: 各仓库自行想起来时重新安装技能. 最强理由是零维护, 安装步骤本来就能覆盖旧目录. 否决: 实测已有仓库落后一个大版本无人察觉, 重新安装也会无提示地覆盖本地改动
- **symlink 或 submodule 直连上游**: 使用方始终拿到最新技能, 无需同步工具. 否决: hx-agent-code 的 CI 模板与 audit 依赖 vendor 内固定版本, 直接跟随上游不会迁移已生成的产物, 会悄悄失配; 也让使用方的 CI 依赖另一个仓库的可用性
- **使用方各自安装定时工作流, 本仓用 repository_dispatch 通知**: 权限各仓自理, 本仓只需发通知. 否决: 每个使用方都要额外安装并维护工作流, 未安装的仓库依旧发现不了; 通知本身同样需要对目标仓库有写权限的令牌, 并不省权限
- **只用 GitHub 代码搜索 `skills.lock.json` 发现使用方**: 一次请求即可. 否决: 代码搜索不索引 fork, 有延迟, 且尚未建锁的存量仓库搜不到

## Consequences

使用方的升级以 PR 形式到达, 合并前按升级说明重新生成产物并手动跑门禁, 大版本迁移 (如 hx-agent-notes v1 到 v2) 不会在合并前生效. 无锁的存量仓库首个同步 PR 会补建锁文件, 本地改过的技能被跳过并在 PR 中列出. 扇出令牌对所有者名下仓库有写权限, 只存为仓库 secret, 日志中的令牌被替换为 `***`. 本仓通过 symlink 引用的子模块技能不在扇出范围, 由其所在仓库各自处理

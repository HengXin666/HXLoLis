# HX-ANiMe Tag 重构交互设计

> 状态: 设计稿, 本轮只出方案, 不改业务代码, 不实际清空 tag.
> 范围: `HXLoLi-ANiMe` (数据子仓库) 的标注流水线 + `HXLoLi` 主站番剧页的展示入口 + bgm (Bangumi) 双向同步.

## 1. 现状 (读仓库得出)

| 位置 | 现在做什么 | 问题 |
|------|-----------|------|
| `HXLoLi-ANiMe/scripts/crawler/Tags.py` → `data/ANiMeTags.json` | 用 AOD / AniList / bangumi-data 打分自动上墙 (wallScore=2), 产出 ロリ/百合/妹控/异世界/校园/日常/恋爱/搞笑/战斗/催泪/悬疑 | 规则推断, 误标多 (例: 《我推的孩子》被标 妹控+异世界+日常), 用户觉得"乱来" |
| `HXLoLi/data/animeTags.ts` | 手工分类定义 + 与 `user_status.tags` 合并去重 | 三处来源 (自动推断 / 手工表 / bgm 随手标签) 混在一起, 无法追溯谁标的 |
| `HXLoLi/data/animeOverlay.json` | 站内覆盖 watched_eps / tags | 又一处 tag 来源 |
| `.github/workflows/anime-pipeline.yaml` | 爬虫直接 push main → 打 CDN Tag → 向 HXLoLi 发 PR | 只有一条流, 数据更新与分类混在同一次提交 |
| `ANiMeType.py` `WatchStatus` | 1 想看 / 2 看过 / 3 在看 / 4 搁置 / 5 抛弃 | 已具备检测"状态变化"的数据基础 (`user_status.last_update`) |

结论: 爬虫已经能稳定给出 新增番剧 和 状态变化 两个事件, 缺的是"人工标注"这一环和单一可信的标注源.

## 2. 目标

1. 把现有 HX-ANiMe 的 tag 全部清空, 以后只认人工标注 (issue 标注 或 PR 评论/勾选标注).
2. 拆成两条提交流:
   - **data 更新流**: 爬虫数据, 自动合入.
   - **tag 标注流**: 开专门的 PR, 等待标注, 用户标完后合入.
3. 触发: 新增番剧; 以及 观后感 模式 (【正在看】→ 搁置 / 已看完 / 抛弃) 邀请评分 + 标注.
4. 标注 PR 用户可能很久不理, 一个月后自动关闭.
5. PR 要有 tag (GitHub label) 区分流向与状态.
6. 标注要非常轻松: 打开就能看到 番剧名 + 封面, 点勾即可, 不用打字.
7. 标注结果通过 bgm api 同步到 bgm, 不只停留在 HXLoLi 站内.

## 3. 标签体系

### 3.1 推荐分类 (最强分类, 有专属页面)

| 标签 | 含义 | 专属页面 | 说明 |
|------|------|---------|------|
| 物凄い | 我最喜欢的番剧, 最强分类 | `/anime/susume/monosugoi` | 只在 观后感 模式中邀请勾选 (没看完不谈最爱) |
| ロリ | 萝莉为卖点 | `/anime/susume/loli` | 判定口径沿用 animeTags.ts 现有 rule 文案 |
| シスコン | 妹控 | `/anime/susume/imouto` | 旧名 妹控 废弃, 不做自动迁移 |

这三个页面不是 `?tag=` 筛选结果, 而是独立路由:
- 番剧首页 `/anime` 顶部放三张大入口卡 (封面拼贴 + 数量), 一眼可见.
- 详情页上这三个标签渲染为特殊徽章, 点击进入对应 susume 页面, 而不是筛选.
- 访问 `/anime?tag=物凄い` 等旧式链接时 301/客户端重定向到对应 susume 页面, 避免两套入口.
- susume 页面按 用户评分 降序, 附观后感一句话 (若有).

### 3.2 普通标注 (走 `?tag=` 筛选)

异世界 / 热血 / 战斗 / 推理 / 校园 / 日常 / 搞笑 / 恋爱 / 致郁

旧标签 百合 / 催泪 / 悬疑 不在新词表中, 清空后不再出现; 若以后要加, 只改词表一处 (见 3.3).

### 3.3 唯一词表

新建 `HXLoLi-ANiMe/data/labelVocab.json` 作为唯一词表 (分组 `susume` / `genre`, 每项含显示名, bgm 同步名, 专属页 slug). 标注表单, 解析器, 主站渲染, bgm 同步都只读它.

## 4. 数据落点

- 每部番一个文件: `HXLoLi-ANiMe/data/labels/<bgm_subject_id>.json`
  ```json
  { "id": 517057, "tags": ["推理", "致郁"], "rate": 9, "review": "一句话观后感",
    "mode": "new|review", "by": "pr#123", "labeledAt": "2026-11-04T20:00+08:00",
    "bgmSynced": true }
  ```
- 一部番一个文件 → 多个标注 PR 并行时不会冲突; data 更新流永远不碰 `data/labels/`, 两条流天然隔离.
- 未标注 = 没有文件. 清空 tag 等价于: 主站只读 `data/labels/`, 不再读 `ANiMeTags.json` / `animeTags.ts` 的分配表 / `animeOverlay.json.tags` / `user_status.tags`.

## 5. 两条提交流

### 5.1 data 更新流 (自动合入)

```
定时爬虫 → 有变化 → 推到分支 bot/data-<日期> → 开 PR
  label: flow:data
  → 检查通过 → gh pr merge --auto --squash  (自动合入)
  → 合入后打 CDN Tag → 向 HXLoLi 发 cdnVersion PR (沿用现有逻辑)
  → 同时产出事件清单 events.json: 新增番剧 id 列表 + 状态变化列表
```

- 由直接 push main 改为 PR + auto-merge, 让两条流在 PR 列表里都可见, 可用 label 一键筛选.
- 事件检测复用 pipeline 现有的 `comm -23` 新增 id 逻辑; 状态变化 = 同 id 的 `user_status.watch_status` 从 3 (在看) 变为 2 / 4 / 5.

### 5.2 tag 标注流 (等待标注后合入)

由 data 流合入后的 `workflow_run` 触发, 读取 events.json, 每个事件开 (或更新) 一个标注 PR:

```
分支 label/<id> → 新增 data/labels/<id>.json 草稿 (tags 为空)
  PR 标题: [标注] 《中文名》 / [观后感] 《中文名》
  label: flow:label + mode:new 或 mode:review + state:等待标注
→ 用户勾选 / 评论
→ bot 把结果写回分支上的草稿文件 (每次勾选都会更新一次 commit)
→ 用户勾【标注完成】或评论 /done → 自动合入 → 触发 bgm 同步
```

规则:
- 一部番同时最多一个开着的标注 PR. 新增番剧的 PR 还开着时状态变成搁置/已看完, 则原 PR 升级为 观后感 模式 (改标题, 换 label, 正文追加评分区), 不另开.
- 已标注过的番剧再次触发 观后感 时, 草稿预填已有标签, 用户只需补评分或改动.

## 6. 标注交互 (核心: 要非常轻松)

### 6.1 PR 正文模板 (勾选即标注)

```markdown
<img src="https://<CDN>/<tag>/data/anime/517057.jpg" width="180" align="right">

## 《【我推的孩子】 第三季》
推しの子 第3期 · 2026-01 · [bgm 条目](https://bgm.tv/subject/517057) · 状态: 在看 → 看过

**推荐分类**
- [ ] 物凄い (最爱, 进 /anime/susume/monosugoi)
- [ ] ロリ
- [ ] シスコン

**标注**
- [ ] 异世界 - [ ] 热血 - [ ] 战斗 - [ ] 推理 - [ ] 校园
- [ ] 日常 - [ ] 搞笑 - [ ] 恋爱 - [ ] 致郁

**评分 (观后感 模式)**  1 · 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10  (勾一个)
**一句话观后感** (可选, 回复本 PR 即可)

- [ ] 同步到 bgm (默认勾上)
- [ ] ✅ 标注完成, 合入
- [ ] 🚫 跳过这部, 关闭
```

- 有番剧名 + 封面: 封面取自 data 流已下载的 `data/anime/<id>.jpg`, 经 CDN tag 地址显示; 同时给中日文名, 年份, bgm 链接.
- GitHub 任务列表在 PR 正文里可直接点选, 手机 App 也能点, 零打字.
- 新增番剧 模式只显示 推荐分类 (不含 物凄い) + 标注; 观后感 模式显示全部, 并把 物凄い 和 评分 放最上面.

### 6.2 评论快捷指令 (可选, 给键盘党)

| 指令 | 作用 |
|------|------|
| `/tag 推理 致郁` | 追加标签 (只接受词表内的词, 不合法即回复提示) |
| `/untag 致郁` | 移除标签 |
| `/rate 9` | 评分 1-10 |
| `/review 这部真的好看` | 观后感一句话 |
| `/done` | 等同勾【标注完成】 |
| `/skip` | 跳过并关闭 |
| `/nobgm` | 本次不同步到 bgm |

bot 每次处理后编辑同一条"当前结果"置顶评论 (标签预览 + 评分), 不刷屏.

### 6.3 issue 标注 (备用入口)

- 想主动给某部番标注 (例如老番回填), 用 issue 表单 `标注番剧`: 填 bgm id 或从下拉选中文名, 其余同样是勾选框.
- issue 提交后 bot 开对应标注 PR 并把 issue 关联 (`Closes #n`), 合入时 issue 自动关闭. 也就是说 issue 只是入口, 最终仍走 PR 合入, 保证单一落点.
- 可提供一次性 `回填` issue: 列出未标注番剧 (封面缩略图 + 名字), 每行一个勾选 "帮我开标注 PR".

## 7. PR 的 tag (GitHub label) 设计

| label | 颜色 | 含义 |
|-------|------|------|
| `flow:data` | 灰 | data 更新流, 自动合入 |
| `flow:label` | 紫 | tag 标注流 |
| `mode:new` | 蓝 | 新增番剧触发 |
| `mode:review` | 粉 | 观后感 触发 |
| `state:等待标注` | 黄 | 等用户 |
| `state:已标注` | 绿 | 已合入 |
| `state:expired` | 暗红 | 一个月无人理, 自动关闭 |
| `susume:物凄い` / `susume:ロリ` / `susume:シスコン` | 金 | 合入时按结果打, 方便日后检索 |
| `bgm:synced` / `bgm:sync-failed` | 绿/红 | 同步结果 |

## 8. 一个月自动关闭

- 每日定时任务扫描 `flow:label` + `state:等待标注` 的 PR, 以 创建时间 或 最后一次用户交互 (勾选/评论) 较晚者起算, 满一个月未完成则:
  1. 评论: "一个月没有标注, 先关掉啦. 评论 /reopen 或在 issue 里重新发起即可."
  2. 关闭 PR, 删除分支, 打 `state:expired`.
- 第 25 天可选发一次提醒评论 (只发一次).
- 过期不写任何标注文件; 之后若该番状态再变化 (例如搁置 → 看过), 观后感 仍会重新邀请.
- 已勾选但未点完成的部分结果: 过期时丢弃 (保守, 不替用户做决定), 评论里列出当时勾过的内容便于手动恢复.

## 9. bgm 同步

- 合入后触发 `label-sync-bgm` 作业, 调用 bgm api `POST /v0/users/-/collections/{subject_id}` (带 `BGM_TOKEN`, 需有收藏写权限):
  - `tags`: (bgm 上现有 tags − 词表管理的标签) ∪ 本次标注的标签. 只增删词表内的词, 用户在 bgm 上手打的其他标签原样保留.
  - `rate`: 仅当本次给了评分.
  - `comment`: 仅当写了观后感且勾选同步; 已有吐槽不覆盖, 改为在 PR 里提示冲突.
  - 不改 `type` (观看状态以 bgm 为准, 我们只是读).
- 失败重试 3 次, 仍失败打 `bgm:sync-failed` 并在 PR 评论报错; 标注文件照常保留, 下次可 `/resync`.
- 防回环: 爬虫下次把 bgm 的 tags 拉回 `user_status.tags`, 但主站展示只读 `data/labels/`, 不会因为同步回来而被二次计算.
- bgm tag 不允许空格, 词表中的同步名需预先校验.

## 10. 清空现有 tag 的迁移步骤 (后续实施时用, 本轮不执行)

1. 加入 `labelVocab.json` 与空的 `data/labels/`, 主站切到只读 labels → 站内分类视觉上即被清空.
2. 停用 `Tags.py` 自动上墙, `ANiMeTags.json` 标记废弃后删除; `animeTags.ts` 只保留词表渲染所需部分或改为读 vocab.
3. `animeOverlay.json` 的 tags 字段移除.
4. bgm 上已有的旧随手标签不自动删除 (可选一次性脚本, 需用户单独确认).
5. 按仓库红线, 每步代码改动配对 `.agents/notes/` 决策 note, 跑 `uv run scripts/redlines/agent_notes.py --diff`.

## 11. 边界情况

- 爬虫一次新增很多番 (例如首次接入): 超过 5 部合并为一个"批量标注"PR, 正文每部一节, 每节独立勾选, 支持部分完成后合入已完成部分.
- 番剧被从 bgm 收藏删除: 关闭对应标注 PR, 保留已合入的标注文件, 主站不展示.
- 同一部番 观后感 触发多次 (看过 → 在看 → 看过): 每次都邀请, 但预填上次结果.
- 未看完就想标 物凄い: 允许通过 `/tag 物凄い` 手动加, 表单不主动展示.

## 12. Alternatives considered

- **什么都不做 / 复用现有 Tags.py 自动推断**: 最强理由是零维护且覆盖率高 (154/160); 否决: 误标正是这次重构的起因, 规则调参无法反映个人口味.
- **只在 bgm 上打标签, 爬虫拉回**: 最强理由是 bgm 已有标注 UI 且天然同步; 否决: bgm 标签是自由文本, 无法约束词表, 无封面化的批量入口, 也没有审阅/过期机制.
- **只用 issue 不用 PR**: 最强理由是 issue 表单更像问卷; 否决: 标注结果最终要进仓库文件, PR 才能自动合入并留 diff, 所以 issue 只作入口.
- **单一 JSON 汇总所有标注**: 否决: 多个标注 PR 并行必冲突, 改为一番一文件.

## 13. 验收要点 (实施时)

- data 流 PR 不含 `data/labels/` 改动, 且自动合入.
- 新增番剧 后 1 次流水线内出现带封面的标注 PR, label 为 `flow:label` + `mode:new` + `state:等待标注`.
- 在看 → 看过 触发 观后感 PR, 含 物凄い 与评分.
- 勾选完成后自动合入, `/anime/susume/monosugoi` 等专属页出现该番, bgm 条目 tags 同步更新.
- 满一个月未理的 PR 被自动关闭并打 `state:expired`.

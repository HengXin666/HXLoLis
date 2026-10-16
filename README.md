# HXLoLis

HXLoLis 是本地总览目录, 用来把 HXLoLi 站点以及它依赖的内容仓库放在同一个父目录下。这里不是 monorepo, 子目录里的项目仍然各自拥有独立的 Git 仓库。

## 目录结构

```text
HXLoLis/
├── HXLoLi/          # 主站点, Docusaurus 博客/笔记/知识库
├── HXLoLi-imouto/   # 私有内容仓库, 本地可明文编辑, 部署时加密
├── HXLoLi-Music/    # 音乐和字幕相关资源
└── HXLoLi-ANiMe/    # 动画数据相关资源
```

## 本地预览私有内容

在 `HXLoLis/HXLoLi` 中执行:

```bash
npm run dev:private
```

脚本会优先识别同级目录 `../HXLoLi-imouto`, 并把其中的 `docs/`、`blog/`、`ai-docs/` 映射到主站对应目录。映射后在主站中打开或编辑这些文件, 实际修改会写回 `HXLoLi-imouto`, 不再是一次性的临时克隆副本。

如需清理映射:

```bash
npm run clean:private
```

## 私有内容部署

部署时使用 `HXLoLi/scripts/encrypt-private.mjs` 读取 `HXLoLi-imouto`, 将 `docs/`、`blog/`、`ai-docs/` 的 Markdown 内容替换为加密占位页面。CI 只需要 RSA 公钥:

```bash
HXLOLI_RSA_PUBLIC_KEY="$(cat hxloli_public.pem)" \
node scripts/encrypt-private.mjs -s ../HXLoLi-imouto -m deploy
```

公钥只负责加密, 解密用的私钥不要提交到公开仓库或 CI 日志。

## 提交方式

因为这里的子目录是独立仓库, 提交通常要进入对应子仓库分别提交:

```bash
cd HXLoLi
git status
git add .
git commit -m "update site"

cd ../HXLoLi-imouto
git status
git add .
git commit -m "update private notes"
```

在 `HXLoLis` 根目录执行 `git add .` 只会提交总览库自己的文件, 例如本 README 和 `.gitignore`; 不会替你把 `HXLoLi`、`HXLoLi-imouto` 等子仓库内部修改提交掉。

## 技能同步

`.agents/skills` 下的本仓技能会被其他仓库按固定版本 vendor. 为了让这些仓库跟上更新:

- 改技能内容时同次提高 `SKILL.md` 的 `metadata.version`, PR CI 会检查. 需要使用方重新生成产物时, 在技能的 `references/upgrade.md` 按 `## <版本>` 写明
- main 上技能变动后 (以及每周一次), `Skills Fanout` 工作流扫描仓库所有者名下的全部仓库, 对 vendor 了同名技能的仓库逐个提同步 PR. 需要在本仓配置 secret `HX_SKILLS_TOKEN` (对这些仓库有 Contents 与 Pull requests 写权限的 fine-grained token), 并在 Actions 里手动运行一次 dry-run 确认范围
- 使用方也可以手动检查与升级:

```bash
uv run https://raw.githubusercontent.com/HengXin666/HXLoLis/main/scripts/skills/sync.py adopt    # 首次: 为已 vendor 的技能建锁
uv run https://raw.githubusercontent.com/HengXin666/HXLoLis/main/scripts/skills/sync.py check
uv run https://raw.githubusercontent.com/HengXin666/HXLoLis/main/scripts/skills/sync.py update [<skill>]
```

本地改过的技能不会被覆盖, 需人工合并后加 `--force`. 升级后照常手动运行 lint 与 notes 门禁

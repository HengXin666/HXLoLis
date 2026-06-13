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

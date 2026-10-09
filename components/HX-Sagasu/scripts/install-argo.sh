#!/usr/bin/env bash
# HX-Sagasu · argo 运行时安装器
#
# 为什么需要它: DSH 插件 @taxueseek/argo-dsh 默认走 `npx -y github:taxueseek/argo`,
# 而本机 npm 的 allow-git=none 会让 npx 拒绝拉取 git 规格 (EALLOWGIT)  结果是
# argo_search / argo_fetch / argo_fetch / web seam / wide_research 的 worker 取证
# 全部一起失效 (2026-09-16 基线审计 §3)。本脚本把 argo 落到一个稳定绝对路径,
# 供 profile patch 用 python3 + scripts/mcp_server.py 直连, 彻底绕开 npx。
#
# 用法:  bash scripts/install-argo.sh [目标目录]
# 默认目标: $HX_SAGASU_ARGO_DIR 或 ~/.local/share/hx-sagasu/argo
#
# 幂等: 已存在且含 scripts/mcp_server.py 时直接退出 0。

set -euo pipefail

DEST="${1:-${HX_SAGASU_ARGO_DIR:-$HOME/.local/share/hx-sagasu/argo}}"
DEST="${DEST/#\~/$HOME}"

# 幂等: 目录已就绪时**仍然要跑一次补丁层**  否则升级 argo 之后重跑本脚本
# 会直接退出, 补丁悄悄失效而安装"看起来成功"。
if [[ -f "$DEST/scripts/mcp_server.py" ]]; then
  echo "[hx-sagasu] argo 已就绪: $DEST"
  if [[ -f "$(dirname "$0")/apply_patches.py" ]]; then
    python3 "$(dirname "$0")/apply_patches.py" --argo "$DEST" || {
      echo "[hx-sagasu] 补丁层报告 drift: 补丁锚点可能已随上游更新失效, 需人工检查" >&2
    }
  fi
  exit 0
fi

# 1) 优先复用本机 npx 缓存里已经解开的 argo (最大概率命中, 零网络)
SRC=""
for d in "$HOME"/.npm/_npx/*/node_modules/argo-search; do
  [[ -f "$d/scripts/mcp_server.py" ]] || continue
  # 取版本号最大的那个
  if [[ -z "$SRC" ]] || [[ "$(basename "$(dirname "$(dirname "$d")")")" > "$(basename "$(dirname "$(dirname "$SRC")")")" ]]; then
    SRC="$d"
  fi
done

if [[ -n "$SRC" ]]; then
  echo "[hx-sagasu] 从 npx 缓存复制 argo: $SRC"
  mkdir -p "$DEST"
  # 只复制运行时需要的部分 (跳过 __pycache__ 与缓存)
  tar -C "$SRC" --exclude='__pycache__' --exclude='*.pyc' -cf - . | tar -C "$DEST" -xf -
else
  # 2) 回退: npm pack git 规格。allow-git=none 时这条会失败  那是有意为之的响亮失败,
  #    不要在这里静默返回空目录 (否则插件启动后才发现没有产物)。
  echo "[hx-sagasu] npx 缓存中无 argo, 尝试 npm pack ..." >&2
  TMP="$(mktemp -d)"
  if npm pack github:taxueseek/argo --pack-destination "$TMP" >/dev/null 2>&1; then
    mkdir -p "$DEST"
    tar -xzf "$TMP"/*.tgz -C "$TMP"
    tar -C "$TMP/package" --exclude='__pycache__' -cf - . | tar -C "$DEST" -xf -
    rm -rf "$TMP"
  else
    rm -rf "$TMP"
    echo "[hx-sagasu] 无法获取 argo。" >&2
    echo "  本机 npm allow-git=none 会拒绝 git 规格; 请改用:" >&2
    echo "    npm_config_allow_git=all npm pack github:taxueseek/argo   # 或" >&2
    echo "    git clone --depth 1 https://github.com/taxueseek/argo \"$DEST\"" >&2
    exit 1
  fi
fi

[[ -f "$DEST/scripts/mcp_server.py" ]] || { echo "[hx-sagasu] 安装后仍缺 scripts/mcp_server.py: $DEST" >&2; exit 1; }
echo "[hx-sagasu] argo 安装完成: $DEST"
python3 -c "import yaml" 2>/dev/null || echo "[hx-sagasu] 警告: python3 缺 pyyaml, 请 pip install pyyaml" >&2

# 补丁层: 直接改第三方包的文件会在升级/reinstall 时被覆盖, 所以我们的修改必须
# 可重放、可检测。drift (上游改了补丁锚点所在的代码) 会非零退出  那需要人看,
# 不允许静默跳过 (静默跳过 = 补丁悄悄失效, 而界面显示一切正常)。
if [[ -f "$(dirname "$0")/apply_patches.py" ]]; then
  python3 "$(dirname "$0")/apply_patches.py" --argo "$DEST" || {
    echo "[hx-sagasu] 补丁层报告 drift: 补丁锚点可能已随上游更新失效, 需人工检查" >&2
  }
fi

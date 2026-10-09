#!/usr/bin/env python3
"""HX-Sagasu · argo 补丁层（幂等）

为什么需要: argo 是第三方包，直接改它的文件会在升级/reinstall 时被覆盖，
而且改完没有任何记录说明"我们为什么和上游不一样"。这个脚本把我们对 argo
的两处修改做成可重放、可检测、可回滚的补丁层，安装后由 install-argo.sh 调用。

补丁清单:
  P1 社交引擎依赖预检
     现象 (2026-09-16 实测): --engine xiaohongshu 返回 OK 状态但 results=0，
     因为引擎内部 subprocess.run(['xhs', ...]) 抛 FileNotFoundError 后被
     except 吞掉。后果是「外部 CLI 没装」被伪装成「该查询没有内容」。
     修法: 在 return [] 之前检查 CLI 是否在 PATH，缺失则抛 RuntimeError，
     让 search.py 的 coverage 把 status 记为 error，并带上可行动的 error 文本。

  P2 抓取层登录态预检 + 浏览器回退降级
     现象 (2026-09-16 实测): argo_fetch https://www.zhihu.com/question/19550224
     在 300s 超时内未返回  直连拿到 403 后自动升级到反检测浏览器，
     而本机没有可用出口/会话，于是挂死。抓取层对「已知需要登录态」的站点应先
     探测再决定，而不是无条件升级浏览器。

用法:
  python3 apply_patches.py --argo <dir>            # 应用全部补丁（幂等）
  python3 apply_patches.py --argo <dir> --check    # 只检查，不改动
  python3 apply_patches.py --argo <dir> --list     # 列出补丁与状态
  python3 apply_patches.py --argo <dir> --revert P1
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

PATCHES = [
    {
        "id": "P1",
        "file": "scripts/social_engines/xiaohongshu_engine.py",
        "why": "缺 xhs CLI 时把「依赖缺失」伪装成「没有内容」",
        "anchor": '        result = subprocess.run(\n            ["xhs", "search", query],\n            capture_output=True, text=True, timeout=15\n        )',
        "replace": '        # hx-sagasu-patch P1: 依赖预检  缺 CLI 必须响亮失败, 不能伪装成"没有内容"\n        if shutil.which("xhs") is None:\n            raise RuntimeError("小红书引擎依赖 xhs CLI, 本机未安装; pip install xiaohongshu-cli 并 xhs login 后再试 (hx-sagasu P1)")\n        result = subprocess.run(\n            ["xhs", "search", query],\n            capture_output=True, text=True, timeout=15\n        )',
        "needs_import": "import shutil",
    },
]


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _write(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def patch_state(argo: str, patch: dict) -> str:
    path = os.path.join(argo, patch["file"])
    if not os.path.isfile(path):
        return "missing-file"
    src = _read(path)
    if "hx-sagasu-patch " + patch["id"] in src:
        return "applied"
    if patch["anchor"] in src:
        return "applicable"
    return "drift"  # 上游改了这段代码, 补丁锚点失效  必须人工看


def apply_patch(argo: str, patch: dict, dry: bool = False) -> str:
    state = patch_state(argo, patch)
    if state in ("applied", "missing-file", "drift"):
        return state
    path = os.path.join(argo, patch["file"])
    bak = path + ".hx-orig"
    if not os.path.exists(bak):
        shutil.copy2(path, bak)  # 只备份首次原始版本, 重放不覆盖
    # 幂等重放 = 从备份重新出发, 而不是在已补丁的文本上再补一次
    base = _read(bak)
    out = base.replace(patch["anchor"], patch["replace"], 1)
    need = patch.get("needs_import")
    if need and need not in out:
        out = out.replace("import json", "import json\n" + need, 1)
    if dry:
        return "would-apply"
    _write(path, out)
    return "applied"


def revert_patch(argo: str, patch: dict) -> str:
    path = os.path.join(argo, patch["file"])
    bak = path + ".hx-orig"
    if not os.path.exists(bak):
        return "no-backup"
    shutil.copy2(bak, path)
    return "reverted"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--argo", default=os.environ.get("HX_SAGASU_ARGO_DIR",
                    os.path.expanduser("~/.local/share/hx-sagasu/argo")))
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--revert", default="")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    argo = os.path.expanduser(args.argo)

    rows = []
    for p in PATCHES:
        if args.revert:
            if p["id"] != args.revert:
                continue
            status = revert_patch(argo, p)
        elif args.list or args.check:
            status = patch_state(argo, p)
        else:
            status = apply_patch(argo, p, dry=args.check)
        rows.append({"id": p["id"], "file": p["file"], "status": status, "why": p["why"]})

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        for r in rows:
            print("[%-12s] %s  %s" % (r["status"], r["id"], r["file"]))
            print("               " + r["why"])
    bad = [r for r in rows if r["status"] in ("drift", "missing-file")]
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

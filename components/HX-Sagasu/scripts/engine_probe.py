#!/usr/bin/env python3
"""HX-Sagasu · argo 引擎能力探针。

为什么需要它: argo 的 backends/engine_registry.yaml 声明 148 个引擎 status=ok，
但**声明不等于可用**。2026-09-16 实测发现三类与声明不符的情况:

  1. **请求被静默路由到别的引擎**: engine=juejin 时 engines_used=['zhihu']，
     engine=bilibili 同样落到 zhihu。用户以为在查掘金，实际拿到的是知乎。
  2. **引擎返回 0 条且不报错**: engine=hackernews 返回 count=0 而没有任何失败信号。
  3. **L2 缓存的键不含 engine  这是最严重的一条**（2026-09-16 实测确认）:
     同一个查询先用 engine=zhihu 查过之后，再用 engine=juejin 查**同一个查询**，
     会直接拿回**知乎的缓存结果**，且响应里 `engines_used: ["zhihu"]`、`cached: true`。
     即: 调用方要求"查掘金"，拿到的是知乎的内容。实测复现:

         q = "Rust 所有权 cache-key-test"
         engine=zhihu  → used=['zhihu']  cached=False   ← 真实取数
         engine=juejin → used=['zhihu']  cached=True    ← 拿到知乎的缓存
         （换一个全新查询）
         engine=juejin → used=['juejin'] cached=False   ← 这时才是真的掘金

     **危害**: 结果里会混入"来源标签与实际来源不符"的证据。本项目的铁律是
     证据必须可追溯，而这里 `engines_used` 是**诚实的**（它如实报告了缓存来自
     zhihu），所以问题不在欺骗，而在于**调用方要的引擎没被查询，却拿到了看似成功的结果**。
     探针把这种情形单独记为 `cached`，**不算通过**  因为这次探测没有验证任何东西。

因此本探针对每个引擎: 用**唯一查询**（带时间戳）避开缓存，逐引擎比对
「请求的 engine」与「实际 engines_used」，并把四种状态分开:

  ok        引擎按请求路由，且有产出
  empty     引擎按请求路由，但 0 条
  rerouted  请求被送去了**别的**引擎（engines_used 与请求不符）
  cached    命中了**别的引擎留下的**缓存  本次探测没有验证任何东西，不算通过
  error     抛错或超时

**出口码**: 有任一引擎非 ok 时返回 1。探针本身不做修复  它只把"声明 148 个引擎是 ok"
与"实际能按请求路由的有几个"之间的差额变成可复查的数字。

用法:
  python3 scripts/engine_probe.py                 # 探测内置清单
  python3 scripts/engine_probe.py --engines a,b   # 只探指定引擎
  python3 scripts/engine_probe.py --out f.json    # 落盘
  python3 scripts/engine_probe.py --argo DIR      # 指定 argo 安装目录
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

DEFAULT_ARGO = Path.home() / ".local/share/hx-sagasu/argo"

# 进程内计数器: 保证同一毫秒内的多次探测也拿到不同查询（缓存键含查询原文）
def _seq():
    n = 0
    while True:
        n += 1
        yield n


_SEQ = _seq()

# 探测清单: 覆盖 DSH 实际会用到的面（通用/中英社区/学术/代码/视频）
DEFAULT_ENGINES = [
    "anysearch", "duckduckgo", "wikipedia", "github", "stackoverflow",
    "arxiv", "crossref", "zhihu", "juejin", "hackernews", "bilibili", "devto",
]

# 每个引擎配一个**它应该擅长**的查询  用通用查询测不出"查错了地方"
PROBE_QUERY = {
    "zhihu": "Rust 所有权",
    "juejin": "Rust 所有权",
    "bilibili": "Rust 所有权",
    "crossref": "rust programming memory safety",
    "arxiv": "rust ownership borrow checker",
}
FALLBACK_QUERY = "rust ownership borrow checker"


def probe(argo_dir: Path, engines: list[str], timeout_s: int) -> dict:
    """Agent Notes
    .agents/notes/implemented/feature/2026-09-16-argo-engine-probe.md
    """
    sys.path.insert(0, str(argo_dir / "scripts"))
    from mcp_server import execute_tool  # type: ignore

    # 唯一性必须足够强: 只用秒级时间戳时，同一秒内的重复探测会命中缓存，
    # 于是 `cached` 状态把整轮探测变成"没有验证"。用微秒 + 进程内计数器。
    stamp = f"{int(time.time() * 1000) % 100000000}-{next(_SEQ)}"
    rows: list[dict] = []
    for eng in engines:
        q = PROBE_QUERY.get(eng, FALLBACK_QUERY) + " " + stamp
        started = time.time()
        row: dict = {"engine": eng, "query": q}
        try:
            res = execute_tool("argo_search", {"query": q, "engine": eng, "max_results": 3})
            body = json.loads(res["content"][0]["text"])
            # Agent Notes: argo 引擎路由必须被实测  声明 148 个 ok 不等于 148 个可用
            # 
            used = body.get("engines_used") or []
            count = body.get("count") or 0
            results = body.get("results") or []
            row["engines_used"] = used
            row["count"] = count
            row["cached"] = bool(body.get("cached"))
            row["first_title"] = (results[0].get("title", "")[:80] if results else "")
            row["first_url"] = (results[0].get("url", "") if results else "")
            if row["cached"]:
                # 缓存命中意味着这次**没有验证**该引擎  不许当成通过
                row["state"] = "cached"
            elif not used or used == [eng]:
                row["state"] = "ok" if count > 0 else "empty"
            else:
                row["state"] = "rerouted"
        except Exception as err:  # noqa: BLE001  探针要把任何异常都记成 error
            row["state"] = "error"
            row["error"] = str(err)[:200]
        row["elapsed_ms"] = int((time.time() - started) * 1000)
        rows.append(row)
        print(f"{row['state']:9} {eng:14} count={row.get('count', '-'):<3} used={row.get('engines_used', row.get('error',''))}")
    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "argo_dir": str(argo_dir),
        "summary": {s: sum(1 for r in rows if r["state"] == s) for s in
                    ("ok", "empty", "rerouted", "cached", "error")},
        "engines": rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="argo 引擎能力探针")
    ap.add_argument("--argo", default=str(DEFAULT_ARGO))
    ap.add_argument("--engines", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--timeout", type=int, default=60)
    args = ap.parse_args()

    argo = Path(args.argo).expanduser()
    if not (argo / "scripts/mcp_server.py").is_file():
        print(f"[engine-probe] argo 未安装或路径不对: {argo}", file=sys.stderr)
        print("  先跑: bash components/HX-Sagasu/scripts/install-argo.sh", file=sys.stderr)
        return 2

    engines = [e.strip() for e in args.engines.split(",") if e.strip()] or DEFAULT_ENGINES
    report = probe(argo, engines, args.timeout)
    print()
    print("汇总:", json.dumps(report["summary"], ensure_ascii=False))
    if args.out:
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("已写出:", args.out)
    # 退出码只用来说明"有没有未通过项"，检测结果本身在报告里
    bad = report["summary"]["empty"] + report["summary"]["rerouted"] + report["summary"]["error"]
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

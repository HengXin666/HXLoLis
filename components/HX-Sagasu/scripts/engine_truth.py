#!/usr/bin/env python3
"""HX-Sagasu · 引擎真值表（M1）

基线审计的决定性反例: wechat_sogou 同一次调用里 coverage 报 status=ok/returned=10,
而 results=0 且 errors=[]  引擎抓到了数据被丢光, 对外还说 ok。166 个引擎里有多少
个是这种"有壳无实"的状态, 靠 --list-engines 看不出来 (admission 字段全为 null,
env_ready 只跟踪环境变量、跟踪不到外部 CLI 依赖)。

本工具只做一件事: **真发请求, 然后按四态判定**, 禁止把不同性质的空压成一个"没有结果"。

四态:
  ok           真跑过且拿到结果
  empty        真跑过, 确实没有内容 (可接受)
  anomaly      coverage 说拿到了, 最终 results 却是 0  数据在管线里丢了 (要修)
  unavailable  依赖缺失/被限流/超时 (要区分出来, 不是"没搜到")

用法:
  python3 engine_truth.py                      # 默认探测目标平台清单
  python3 engine_truth.py --engines bilibili,zhihu
  python3 engine_truth.py --json               # 机器可读
  python3 engine_truth.py --out <路径>          # 落盘真值表
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

DEFAULT_ARGO = os.path.expanduser("~/.local/share/hx-sagasu/argo")

# 目标平台 → (argo 引擎 id, 探测查询)。探测查询要选「该平台一定有内容」的词,
# 否则「真跑过但没内容」与「坏了」无法区分  这正是四态判定的前提。
TARGETS: list[tuple[str, str, str]] = [
    ("B站", "bilibili", "原神 剧情 解析"),
    ("X.com", "twitter", "DeepSeek"),
    ("小红书", "xiaohongshu", "美食"),
    ("微博", "weibo", "大模型"),
    ("微信公众号", "wechat_sogou", "人工智能"),
    ("知乎", "zhihu", "程序员"),
    ("V2EX", "v2ex", "开源"),
    ("HackerNews", "hackernews", "linux"),
    ("Reddit", "reddit", "python"),
    ("通用聚合(对照)", "anysearch", "AI agent"),
]


def load_engine_state(argo: str) -> dict:
    """--list-engines --detail: 环境/准入真值 (enabled/env_ready/missing_env/routable)。"""
    try:
        out = subprocess.run(
            ["python3", os.path.join(argo, "scripts", "search.py"), "--list-engines", "--detail", "--json"],
            capture_output=True, text=True, timeout=180, cwd=argo,
        )
        data = json.loads(out.stdout)
    except Exception as exc:  # noqa: BLE001 - 环境探测失败本身就是一个状态
        return {"_error": str(exc)}
    rows = data if isinstance(data, list) else next(iter(data.values()), [])
    return {r.get("engine_id"): r for r in rows if isinstance(r, dict)}


# argo 的 safe_search 装饰器把引擎内部异常统一吞成 [] (engines_base.py:51-69),
# CLI builder 的 _run 也把非零退出吞成 "" (engines_base.py:72-88)  因此
# "引擎崩了" 与 "确实没内容" 在结果里长得一模一样。唯一留下的痕迹是 stderr
# 上的这两行 warning。自检必须抓它们, 否则四态判定会系统性误报成 empty。
_FAIL_SIGNS = (
    "命令不存在", "CLI 缺失", "失败 (rc=", "超时 (", "HTTP 错误",
    "解析错误", "未预期异常", "Traceback",
)


def _stderr_failures(stderr: str) -> list[str]:
    return [ln.strip()[:160] for ln in (stderr or "").splitlines()
            if any(s in ln for s in _FAIL_SIGNS)]


def probe(argo: str, engine: str, query: str, n: int = 3, timeout: int = 120) -> dict:
    """单引擎真发一次请求。--no-cache 是必须的: 缓存会把一次旧的空结果固化。"""
    cmd = ["python3", os.path.join(argo, "scripts", "search.py"),
           "--json", "-n", str(n), "--no-cache", "--engine", engine, query]
    t0 = time.time()
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=argo)
    except subprocess.TimeoutExpired:
        return {"state": "unavailable", "reason": f"timeout>{timeout}s", "n": 0}
    elapsed = int((time.time() - t0) * 1000)
    try:
        d = json.loads(out.stdout)
    except Exception:  # noqa: BLE001
        return {"state": "unavailable", "reason": ("stdout 非 JSON: " + (out.stderr or out.stdout)[:160]).strip(), "n": 0}

    failures = _stderr_failures(out.stderr)
    results = d.get("results") or []
    coverage = d.get("coverage") or []
    errors = d.get("errors") or []
    cov_returned = sum(int(c.get("returned") or 0) for c in coverage)

    if results:
        return {"state": "ok", "n": len(results), "elapsed_ms": elapsed,
                "engines_used": d.get("engines_used"), "sample": results[0].get("title", "")[:60]}
    if cov_returned > 0:
        # 抓到了却被丢光  唯一一个「不能说没搜到」的状态
        return {"state": "anomaly", "n": 0, "elapsed_ms": elapsed, "coverage_returned": cov_returned,
                "detail": "coverage 报抓到 %d 条, 最终 results=0 且 errors=%s" % (cov_returned, errors)}
    if errors:
        return {"state": "unavailable", "n": 0, "elapsed_ms": elapsed, "reason": "; ".join(map(str, errors))[:160]}
    if failures:
        # 引擎先崩了 → 那个空结果什么也不能证明
        return {"state": "unavailable", "n": 0, "elapsed_ms": elapsed, "reason": failures[0]}
    cov_status = ",".join(sorted({str(c.get("status")) for c in coverage})) or "无 coverage"
    return {"state": "empty", "n": 0, "elapsed_ms": elapsed, "coverage_status": cov_status}


# 外部依赖真值: env_ready 只跟踪环境变量, 跟踪不到 CLI / 上游端点。
# 这些是 2026-09-16 一手探测得到的结论, 出处见 baseline audit §4。
# 类型: cli=本机命令; endpoint=上游 HTTP 端点; env=环境变量
DEPS: dict[str, list[tuple[str, str]]] = {
    "xiaohongshu": [("cli", "xhs")],
    "twitter": [("cli", "tw"), ("endpoint", "https://api.fxtwitter.com/2/search")],
    "reddit": [("cli", "rdt"), ("endpoint", "https://www.reddit.com/search.json")],
    "zhihu": [("env", "ARGO_ZHIHU_ACCESS_SECRET")],
}


def check_deps(engine: str) -> list[dict]:
    """逐项验证外部依赖; 返回 [{kind, ref, ok, note}]。"""
    import shutil
    out = []
    for kind, ref in DEPS.get(engine, []):
        if kind == "cli":
            ok = shutil.which(ref) is not None
            out.append({"kind": kind, "ref": ref, "ok": ok,
                        "note": "" if ok else "本机未安装  引擎会静默返回空"})
        elif kind == "env":
            ok = bool(os.environ.get(ref))
            out.append({"kind": kind, "ref": ref, "ok": ok,
                        "note": "" if ok else "未配置  引擎不可路由"})
        elif kind == "endpoint":
            try:
                import urllib.request
                req = urllib.request.Request(ref, headers={"User-Agent": "hx-sagasu/1.0"})
                urllib.request.urlopen(req, timeout=12)
                out.append({"kind": kind, "ref": ref, "ok": True, "note": ""})
            except Exception as exc:  # noqa: BLE001
                code = getattr(exc, "code", None)
                out.append({"kind": kind, "ref": ref, "ok": False,
                            "note": f"HTTP {code}" if code else str(exc)[:80]})
    return out


def classify(engine: str, res: dict, state: dict) -> dict:
    """把探测结果与引擎准入状态合成最终判定。"""
    st = state.get(engine) or {}
    missing = st.get("missing_env") or []
    if res["state"] in ("ok", "anomaly"):
        final = res["state"]
    elif missing:
        final = "unavailable"
        res["reason"] = "缺环境变量: " + ",".join(missing)
    else:
        final = res["state"] if engine in state else "unavailable"
        if engine not in state:
            res["reason"] = "引擎未注册（--list-engines 里没有它）"
    # 外部 CLI 依赖: env_ready 跟踪不到, 这里显式标注出来供人工确认
    res["env_ready"] = st.get("env_ready")
    res["routable"] = st.get("routable")
    deps = check_deps(engine)
    res["deps"] = deps
    broken = [d["ref"] for d in deps if not d["ok"]]
    # 空结果 + 依赖烂 = 「根本拿不到」, 不是「确实没有内容」 这是四态判定的关键修正
    if final in ("empty", "anomaly") and broken:
        res["reason"] = "依赖不可用: " + ", ".join(broken)
        final = "unavailable"
    res["final"] = final
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--argo", default=os.environ.get("HX_SAGASU_ARGO_DIR", DEFAULT_ARGO))
    ap.add_argument("--engines", default="", help="逗号分隔的 argo 引擎 id（默认跑目标平台清单）")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out", default="")
    ap.add_argument("--ingest", default="", help="把非 ok 的行沉淀进 Evidence Ledger (JSONL 路径)")
    ap.add_argument("--ingest-index", default="", help="顺带把派生索引写到该路径")
    args = ap.parse_args()
    if args.ingest and not args.out:
        print("[engine-truth] --ingest 需要同时给 --out (沉淀读的是真值表文件)", file=sys.stderr)
        return 2

    targets = TARGETS
    if args.engines:
        want = [e.strip() for e in args.engines.split(",") if e.strip()]
        targets = [(e, e, q) for _, e, q in TARGETS if e in want] or [(e, e, "test") for e in want]

    argo = os.path.expanduser(args.argo)
    if not os.path.isfile(os.path.join(argo, "scripts", "search.py")):
        print(f"[engine-truth] argo 未安装: {argo}\n  先跑 components/HX-Sagasu/scripts/install-argo.sh", file=sys.stderr)
        return 2

    state = load_engine_state(argo)
    rows = []
    for label, engine, query in targets:
        res = classify(engine, probe(argo, engine, query), state)
        rows.append({"label": label, "engine": engine, "query": query, **res})
        mark = {"ok": "✅", "empty": "⚪", "anomaly": "❗", "unavailable": "❌"}.get(res["final"], "?")
        print(f"{mark} {label:16} {engine:16} {res['final']:12} n={res.get('n', 0):<3} "
              f"{res.get('reason') or res.get('detail') or res.get('sample', '')}", file=sys.stderr)

    summary = {k: sum(1 for r in rows if r["final"] == k) for k in ("ok", "empty", "anomaly", "unavailable")}
    payload = {"generatedAt": int(time.time() * 1000), "argo": argo,
               "argoVersion": json.load(open(os.path.join(argo, "package.json"))).get("version"),
               "summary": summary, "rows": rows}
    if args.out:
        with open(os.path.expanduser(args.out), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        print(f"[engine-truth] 已写入 {args.out}", file=sys.stderr)

    # --ingest: 把**非 ok** 的行沉淀进 Evidence Ledger。
    # 为什么默认不做: 真值表是每次发布刷新的一次性观测, 而 Ledger 的语义是**跨会话
    # 长期真相**。未经调用方同意就往长期资产里写, 是在替别人做决定。需要长期记住
    # 时才显式加 --ingest。调用方负责传绝对路径 (脚本不做 cwd 猜测)。
    if args.ingest:
        script = os.path.join(os.path.dirname(os.path.realpath(__file__)), "ingest-truth.ts")
        if not os.path.isfile(script):
            print(f"[engine-truth] 找不到 {script}", file=sys.stderr)
            return 2
        cmd = ["node", script, os.path.expanduser(args.out or "/tmp/engine-truth.json"),
               "--out", os.path.expanduser(args.ingest)]
        if args.ingest_index:
            cmd += ["--index", os.path.expanduser(args.ingest_index)]
        print("[engine-truth] 沉淀: " + " ".join(cmd), file=sys.stderr)
        return subprocess.run(cmd).returncode
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"[engine-truth] 汇总: {summary}", file=sys.stderr)
    # 有 anomaly 就以非零退出  这是「数据在管线里丢了」, 不该被静默放过
    return 1 if summary["anomaly"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

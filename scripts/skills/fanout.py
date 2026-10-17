#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""Discover repos that vendor this repo's skills and open one sync PR per repo."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import sync  # noqa: E402

API = "https://api.github.com"
BRANCH = "hx-skills/sync"
REGISTRY = Path(".agents/skills-consumers.json")
BOT = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"]


def call(token: str, method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body else None)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise RuntimeError(f"{method} {path}: {err.code} {err.read()[:300]!r}") from err


def owner_repos(token: str, owner: str, forks: bool) -> list[str]:
    if (call(token, "GET", f"/users/{owner}") or {}).get("type") == "Organization":
        url = f"/orgs/{owner}/repos?per_page=100"
    elif (call(token, "GET", "/user") or {}).get("login", "").lower() == owner.lower():
        url = "/user/repos?affiliation=owner&per_page=100"
    else:
        url = f"/users/{owner}/repos?type=owner&per_page=100"
    repos, page = [], 1
    while True:
        batch = call(token, "GET", f"{url}&page={page}") or []
        repos += [r["full_name"] for r in batch
                  if r["owner"]["login"].lower() == owner.lower() and not r["archived"] and (forks or not r["fork"])]
        if len(batch) < 100:
            return repos
        page += 1


def discover(token: str, root: Path, owners: list[str], source: str, skills: set[str], forks: bool) -> list[str]:
    registry = root / REGISTRY
    extra = json.loads(registry.read_text(encoding="utf-8")) if registry.is_file() else []
    found = []
    for repo in sorted({r for o in owners for r in owner_repos(token, o, forks)} | set(extra)):
        if repo.lower() == source.lower():
            continue
        listing = call(token, "GET", f"/repos/{repo}/contents/{sync.SKILLS.as_posix()}")
        if isinstance(listing, list) and skills & {e["name"] for e in listing if e["type"] == "dir"}:
            found.append(repo)
    return found


def pr_body(rows: list[dict], source: str, commit: str) -> str:
    lines = [f"上游 `{source}@{commit[:7]}` 的技能有更新, 本 PR 由技能扇出流水线自动生成", "",
             "| 技能 | 版本 | 结果 |", "|---|---|---|"]
    for row in rows:
        if row["status"] == "current":
            continue
        result = "已更新" if row["applied"] else "跳过: " + sync.describe(row).strip(" ()")
        lines.append(f"| {row['skill']} | {row['have']} -> {row['want']} | {result} |")
    if all(row["status"] == "current" for row in rows):
        lines.append("| (全部技能已是上游内容) | - | 仅补建或刷新 `.agents/skills.lock.json` |")
    notes = [(r["skill"], n) for r in rows if r["applied"] for n in r.get("notes", [])]
    if notes:
        lines += ["", "## 升级后需重新生成的产物", ""] + [f"- {s}: {n}" for s, n in notes]
    lines += ["", "## 合并前", "",
              "- [ ] 按上面的升级说明调用对应技能重新生成产物 (无说明则跳过)",
              "- [ ] 手动运行项目的 lint 与 notes 门禁",
              "- [ ] 本地改动过而被跳过的技能, 人工合并后执行 `sync.py update <skill> --force`"]
    return "\n".join(lines)


def sync_repo(token: str, repo: str, source_root: Path, source: str, ref: str, commit: str, dry: bool) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "repo"
        sync.git("clone", "--quiet", "--depth", "1", f"https://x-access-token:{token}@github.com/{repo}.git", str(dst))
        base = sync.git("rev-parse", "--abbrev-ref", "HEAD", cwd=dst)
        owner = repo.split("/")[0]
        open_prs = call(token, "GET", f"/repos/{repo}/pulls?state=open&head={owner}:{BRANCH}") or []
        if open_prs:
            # 已有同步 PR 时在其分支上叠加, 保留 PR 上的人工提交; PR 内改过的技能按本地改动跳过
            sync.git("fetch", "-q", "--depth", "50", "origin", f"{BRANCH}:{BRANCH}", cwd=dst)
            sync.git("checkout", "-q", BRANCH, cwd=dst)
        rows = sync.plan(dst, source_root, None, source)
        rows = sync.apply(dst, source_root, rows, source, ref, commit, force=False)
        changed = bool(sync.git("status", "--porcelain", cwd=dst))
        result = {"repo": repo, "rows": rows, "changed": changed, "pr": None}
        if not changed or dry:
            return result
        sync.git("checkout", "-q", "-B", BRANCH, cwd=dst)
        sync.git("add", "-A", cwd=dst)
        sync.git(*BOT, "commit", "-qm", f"[chore] skills: 同步 {source}@{commit[:7]}", cwd=dst)
        # 无打开的同步 PR 时分支只属于流水线, 可从默认分支重建; 有 PR 时只做快进推送, 被抢先更新则报错不覆盖
        sync.git("push", "-q", *([] if open_prs else ["--force"]), "origin", BRANCH, cwd=dst)
        title, body = f"[chore] 同步上游技能 {source}@{commit[:7]}", pr_body(rows, source, commit)
        if open_prs:
            pr = call(token, "PATCH", f"/repos/{repo}/pulls/{open_prs[0]['number']}", {"title": title, "body": body})
        else:
            pr = call(token, "POST", f"/repos/{repo}/pulls", {"title": title, "body": body, "head": BRANCH, "base": base})
        result["pr"] = pr["html_url"]
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description="扫描使用本仓技能的仓库并逐仓提同步 PR")
    parser.add_argument("--owner", action="append", default=[], help="扫描该账号或组织的全部仓库, 可重复")
    parser.add_argument("--source", default=os.environ.get("GITHUB_REPOSITORY", sync.DEFAULT_SOURCE))
    parser.add_argument("--ref", default=sync.DEFAULT_REF)
    parser.add_argument("--include-forks", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="只列出将要改动的仓库, 不推送")
    parser.add_argument("--report", default="skills-fanout-report.json")
    args = parser.parse_args()
    token = os.environ.get("HX_SKILLS_TOKEN")
    if not token:
        print("ERROR 未设置 HX_SKILLS_TOKEN, 需要对目标仓库有 contents 与 pull-requests 写权限的令牌")
        return 2
    root = sync.repo_root(Path.cwd())
    commit = sync.git("rev-parse", "HEAD", cwd=root)
    owners = args.owner or [args.source.split("/")[0]]
    repos = discover(token, root, owners, args.source, set(sync.manifest(root)), args.include_forks)
    results, failures = [], 0
    for repo in repos:
        try:
            results.append(sync_repo(token, repo, root, args.source, args.ref, commit, args.dry_run))
        except (RuntimeError, OSError, subprocess.CalledProcessError) as err:
            results.append({"repo": repo, "error": str(err).replace(token, "***")})
            failures += 1
    Path(args.report).write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    changed = [r for r in results if r.get("changed")]
    print(f"扫描 {len(repos)} 个仓库, 需同步 {len(changed)} 个, 失败 {failures} 个, 完整报告 {args.report}")
    if len(changed) + failures <= 10:
        for r in results:
            if r.get("changed") or r.get("error"):
                print(f"- {r['repo']}: {r.get('pr') or r.get('error') or '待同步 (dry-run)'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""Vendored skill lock, check and update; fanout.py reuses it for cross-repo PRs."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LOCK = Path(".agents/skills.lock.json")
SKILLS = Path(".agents/skills")
UPGRADE = Path("references/upgrade.md")
DEFAULT_SOURCE = "HengXin666/HXLoLis"
DEFAULT_REF = "main"


def git(*args: str, cwd: Path | None = None) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


def repo_root(start: Path) -> Path:
    return Path(git("-C", str(start), "rev-parse", "--show-toplevel"))


def skill_version(skill: Path) -> str:
    text = (skill / "SKILL.md").read_text(encoding="utf-8")
    head = text.split("\n---", 1)[0]
    found = re.search(r"^\s+version:\s*[\"']?([0-9][0-9.]*)", head, re.M)
    return found.group(1) if found else "0"


def version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split(".") if part.isdigit())


def tree_hash(skill: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in skill.rglob("*") if p.is_file()):
        digest.update(path.relative_to(skill).as_posix().encode() + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()


def manifest(root: Path) -> dict[str, dict[str, str]]:
    result = {}
    for skill in sorted((root / SKILLS).iterdir()):
        if skill.is_symlink() or not (skill / "SKILL.md").is_file():
            continue
        result[skill.name] = {"version": skill_version(skill), "hash": tree_hash(skill)}
    return result


def read_lock(root: Path) -> dict:
    path = root / LOCK
    if not path.is_file():
        return {"version": 1, "skills": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def write_lock(root: Path, lock: dict) -> None:
    (root / LOCK).write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_source(repo: str, ref: str, into: Path) -> tuple[Path, str]:
    url = f"https://github.com/{repo}.git"
    git("clone", "--quiet", "--depth", "1", "--branch", ref, "--filter=blob:none", "--sparse", url, str(into))
    git("sparse-checkout", "set", str(SKILLS), cwd=into)
    return into, git("rev-parse", "HEAD", cwd=into)


def upgrade_notes(skill: Path, old: str, new: str) -> list[str]:
    path = skill / UPGRADE
    if not path.is_file():
        return []
    notes, keep = [], False
    for line in path.read_text(encoding="utf-8").splitlines():
        head = re.match(r"^##\s+([0-9][0-9.]*)", line)
        if head:
            keep = version_key(old) < version_key(head.group(1)) <= version_key(new)
        elif keep and line.strip():
            notes.append(line.strip())
    return notes


def plan(root: Path, source_root: Path, names: list[str] | None, source: str) -> list[dict]:
    lock = read_lock(root)["skills"]
    upstream = manifest(source_root)
    rows = []
    for name in names or sorted(set(lock) | {n for n in upstream if (root / SKILLS / n).is_dir()}):
        entry = lock.get(name, {})
        if entry.get("source", source) != source or name not in upstream:
            continue
        local = root / SKILLS / name
        if local.is_symlink():
            continue
        have = skill_version(local) if (local / "SKILL.md").is_file() else entry.get("version", "0")
        modified = None if not entry else (local.is_dir() and tree_hash(local) != entry.get("hash"))
        want = upstream[name]["version"]
        if local.is_dir() and tree_hash(local) == upstream[name]["hash"]:
            status = "current"
        elif entry or version_key(want) > version_key(have):
            status = "outdated"
        else:
            status = "diverged"
        rows.append({"skill": name, "have": have, "want": want, "status": status, "modified": modified})
    return rows


def apply(root: Path, source_root: Path, rows: list[dict], source: str, ref: str, commit: str, force: bool) -> list[dict]:
    lock = read_lock(root)
    for row in rows:
        row["applied"] = False
        blocked = row["modified"] or row["status"] == "diverged"
        if row["status"] == "current":
            dst = root / SKILLS / row["skill"]
            lock["skills"].setdefault(row["skill"], {
                "source": source, "ref": ref, "commit": commit,
                "version": row["want"], "hash": tree_hash(dst),
            })
            continue
        if blocked and not force:
            continue
        src, dst = source_root / SKILLS / row["skill"], root / SKILLS / row["skill"]
        if dst.is_symlink() or dst.is_file():
            dst.unlink()
        elif dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        lock["skills"][row["skill"]] = {
            "source": source, "ref": ref, "commit": commit,
            "version": row["want"], "hash": tree_hash(dst),
        }
        row["notes"] = upgrade_notes(dst, row["have"], row["want"])
        row["applied"] = True
    write_lock(root, lock)
    return rows


def adopt(root: Path, names: list[str], source: str, ref: str) -> None:
    lock = read_lock(root)
    for name in names:
        skill = root / SKILLS / name
        lock["skills"][name] = {
            "source": source, "ref": ref, "commit": None,
            "version": skill_version(skill), "hash": tree_hash(skill),
        }
    write_lock(root, lock)


def version_check(root: Path, base: str) -> int:
    changed = git("diff", "--name-only", f"{base}...HEAD", "--", str(SKILLS), cwd=root).splitlines()
    errors = 0
    for name in sorted({Path(p).parts[2] for p in changed if len(Path(p).parts) > 3}):
        skill = root / SKILLS / name
        if skill.is_symlink() or not (skill / "SKILL.md").is_file():
            continue
        try:
            old_text = git("show", f"{base}:{SKILLS / name / 'SKILL.md'}", cwd=root)
        except subprocess.CalledProcessError:
            continue
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "SKILL.md").write_text(old_text, encoding="utf-8")
            old = skill_version(Path(tmp))
        new = skill_version(skill)
        if new == "0":
            print(f"WARNING {name}: SKILL.md 缺 metadata.version, 下游无法判断是否需要升级")
        elif version_key(new) <= version_key(old):
            print(f"ERROR {name}: 技能内容已改动, metadata.version 仍为 {new}, 需高于 {old}")
            errors += 1
    return 1 if errors else 0


def describe(row: dict) -> str:
    if row["status"] == "current":
        return ""
    if row.get("applied"):
        return " 已更新"
    if row["status"] == "diverged":
        return " (无锁记录且版本不低于上游, 无法区分本地改动, 需 --force)"
    if row["modified"]:
        return " (本地有改动, 需 --force)"
    return ""


def with_source(args: argparse.Namespace, root: Path, work) -> object:
    if args.source_dir:
        source_root = Path(args.source_dir).resolve()
        return work(source_root, git("rev-parse", "HEAD", cwd=source_root))
    with tempfile.TemporaryDirectory() as tmp:
        source_root, commit = fetch_source(args.source, args.ref, Path(tmp) / "src")
        return work(source_root, commit)


def main() -> int:
    """
    Agent Notes: 已安装技能通过锁文件与扇出 PR 跟随上游更新
    .agents/notes/implemented/process/2026-10-17-vendored-skill-sync-fanout.md
    """
    parser = argparse.ArgumentParser(description="已 vendor 技能的锁定, 检查与升级")
    parser.add_argument("command", choices=["manifest", "adopt", "check", "update", "version-check"])
    parser.add_argument("skills", nargs="*")
    parser.add_argument("--repo", default=".", help="目标仓库, 默认当前目录")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="上游 owner/repo")
    parser.add_argument("--ref", default=DEFAULT_REF)
    parser.add_argument("--source-dir", help="使用本地上游检出, 不克隆")
    parser.add_argument("--base", default="origin/main", help="version-check 的比较基准")
    parser.add_argument("--force", action="store_true", help="覆盖本地改动过的技能")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = repo_root(Path(args.repo))
    if args.command == "manifest":
        print(json.dumps(manifest(root), ensure_ascii=False, indent=2))
        return 0
    if args.command == "version-check":
        return version_check(root, args.base)
    if args.command == "adopt":
        names = args.skills or sorted(p.name for p in (root / SKILLS).iterdir() if (p / "SKILL.md").is_file())
        adopt(root, names, args.source, args.ref)
        print(f"已写入 {LOCK}: {', '.join(names)}")
        return 0

    def work(source_root: Path, commit: str):
        rows = plan(root, source_root, args.skills or None, args.source)
        if args.command == "update":
            rows = apply(root, source_root, rows, args.source, args.ref, commit, args.force)
        return rows

    rows = with_source(args, root, work)
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        for row in rows:
            print(f"{row['skill']}: {row['have']} -> {row['want']} {row['status']}{describe(row)}")
            for note in row.get("notes", []):
                print(f"    {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

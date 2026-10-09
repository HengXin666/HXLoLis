import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectScope, parseChanges } from "../core/scope.ts";

function repository() {
    const root = mkdtempSync(join(tmpdir(), "hc-scope-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Quality fixture");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", "/dev/null");
    return { root, git };
}

/**
 * Exercise Git snapshots in independent temporary repositories
 *

 * .agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md
 */
function withRepository(run: (repo: ReturnType<typeof repository>) => void): void {
    const repo = repository();
    try {
        run(repo);
    } finally {
        rmSync(repo.root, { recursive: true, force: true });
    }
}

test("initial index, ignored files and Unicode filenames", () => {
    withRepository(({ root, git }) => {
        writeFileSync(join(root, "added 名字.ts"), "export const value = 1;\n");
        writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
        writeFileSync(join(root, "ignored.txt"), "private");
        git("add", "added 名字.ts");
        assert.deepEqual(collectScope(root, "staged").changes, [{ status: "A", path: "added 名字.ts" }]);
        const paths = collectScope(root, "worktree").changes.map((entry) => entry.path);
        assert(paths.includes(".gitignore"));
        assert(!paths.includes("ignored.txt"));
        mkdirSync(join(root, "nested"));
        writeFileSync(join(root, "nested/new.ts"), "new");
        assert(collectScope(join(root, "nested"), "worktree").changes.some((item) => item.path === "nested/new.ts"));
    });
});

test("staged scope stays separate and worktree preserves canceled staged changes", () => {
    withRepository(({ root, git }) => {
        writeFileSync(join(root, "a.ts"), "export const value = 1;\n");
        git("add", ".");
        git("commit", "-qm", "base");
        writeFileSync(join(root, "a.ts"), "export const value = 2;\n");
        git("add", "a.ts");
        writeFileSync(join(root, "a.ts"), "export const value = 1;\n");
        writeFileSync(join(root, "only-worktree.ts"), "new");
        assert.deepEqual(collectScope(root, "staged").changes, [{ status: "M", path: "a.ts" }]);
        assert(collectScope(root, "worktree").changes.some((entry) => entry.path === "a.ts"));
    });
});

test("explicit multi-commit range retains renames and deletes", () => {
    withRepository(({ root, git }) => {
        writeFileSync(join(root, "old name.ts"), "export const value = 1;\n");
        writeFileSync(join(root, "deleted.ts"), "export const gone = 1;\n");
        git("add", ".");
        git("commit", "-qm", "base");
        const base = git("rev-parse", "HEAD");
        renameSync(join(root, "old name.ts"), join(root, "new name.ts"));
        git("add", "-A");
        git("commit", "-qm", "rename");
        rmSync(join(root, "deleted.ts"));
        git("add", "-A");
        git("commit", "-qm", "delete");
        const scope = collectScope(root, "range", base, "HEAD");
        assert(scope.changes.some((entry) => entry.oldPath === "old name.ts" && entry.path === "new name.ts"));
        assert(scope.changes.some((entry) => entry.status === "D" && entry.path === "deleted.ts"));
        assert(collectScope(root, "range", "EMPTY", "HEAD").changes.every((entry) => entry.status === "A"));
        assert.throws(() => collectScope(root, "range", "missing", "HEAD"));
        assert.throws(() => collectScope(root, "worktree", base));
    });
});

test("NUL parser rejects truncation and preserves embedded line breaks", () => {
    assert.deepEqual(parseChanges("M\0odd\nfile.ts\0"), [{ status: "M", path: "odd\nfile.ts" }]);
    assert.throws(() => parseChanges("R100\0old\0"));
    assert.throws(() => parseChanges("M\0file"));
});

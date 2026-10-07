import { execFileSync } from "node:child_process";
import type { Change, Scope } from "./model.ts";

function git(root: string, args: string[], input?: string): string {
    return execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
    });
}

function resolveTree(root: string, ref: string): string {
    return git(root, ["rev-parse", "--verify", "--end-of-options", ref + "^{tree}"]).trim();
}

export function parseChanges(raw: string): Change[] {
    const tokens = raw.split("\0");
    if (tokens.pop() !== "") {
        throw new Error("Expected NUL terminated Git output");
    }
    const changes: Change[] = [];
    for (let index = 0; index < tokens.length;) {
        const status = tokens[index++];
        const first = tokens[index++];
        if (!status || !first || !/^(?:[ACDMRTUXB]|[RC]\d+)$/.test(status)) {
            throw new Error("Invalid Git name-status output");
        }
        if (/^[RC]/.test(status)) {
            const next = tokens[index++];
            if (!next) {
                throw new Error("Missing rename destination");
            }
            changes.push({ status, path: next, oldPath: first });
        } else {
            changes.push({ status, path: first });
        }
    }
    return changes;
}

/**
 * Preserve all snapshot inputs before project adapters read file contents
 * .agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md
 */
export function collectScope(root: string, mode: string, base?: string, head?: string): Scope {
    root = git(root, ["rev-parse", "--show-toplevel"]).trim();
    const empty = git(root, ["hash-object", "-t", "tree", "--stdin"], "").trim();
    if (!["worktree", "staged", "range"].includes(mode)) {
        throw new Error("Unknown scope mode: " + mode);
    }
    let baseTree: string;
    if (mode === "range") {
        if (!base || !head) {
            throw new Error("range requires base and head; use base EMPTY for an initial push");
        }
        baseTree = base === "EMPTY" ? empty : resolveTree(root, base);
    } else {
        if (base || head) {
            throw new Error("Only range accepts explicit endpoints");
        }
        try {
            baseTree = resolveTree(root, "HEAD");
        } catch {
            const symbolic = git(root, ["symbolic-ref", "-q", "HEAD"]).trim();
            const refs = git(root, ["for-each-ref", "--format=%(refname)", symbolic]).trim();
            if (refs) {
                throw new Error("HEAD exists but cannot be read");
            }
            baseTree = empty;
        }
    }
    const prefix = ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames"];
    const headTree = mode === "range" ? resolveTree(root, head!) : mode;
    let changes: Change[];
    if (mode === "range") {
        changes = parseChanges(git(root, [...prefix, baseTree, headTree, "--"]));
    } else if (mode === "staged") {
        changes = parseChanges(git(root, [...prefix, "--cached", baseTree, "--"]));
    } else {
        changes = parseChanges(git(root, [...prefix, baseTree, "--"]));
        changes.push(...parseChanges(git(root, [...prefix, "--cached", baseTree, "--"])));
        changes.push(...parseChanges(git(root, [...prefix, "--"])));
        const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
        changes.push(...untracked.split("\0").filter(Boolean).map((path) => ({ status: "A", path })));
    }
    const unique = new Map(changes.map((item) => [JSON.stringify(item), item]));
    changes = [...unique.values()].sort((a, b) => {
        const left = JSON.stringify([a.path, a.oldPath, a.status]);
        const right = JSON.stringify([b.path, b.oldPath, b.status]);
        return left < right ? -1 : left > right ? 1 : 0;
    });
    return { mode, base: baseTree, head: headTree, changes };
}

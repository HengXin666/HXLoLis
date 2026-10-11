import { execFileSync } from "node:child_process";
import { EMPTY_BASE, GIT_MAX_BUFFER, UTF8 } from "./constants.ts";
import type { Change, Scope } from "./model.ts";

export function git(root: string, args: string[], input?: string): string {
    return execFileSync("git", ["-C", root, ...args], {
        encoding: UTF8, input, maxBuffer: GIT_MAX_BUFFER, stdio: ["pipe", "pipe", "pipe"],
    });
}

export function gitLine(root: string, ...args: string[]): string {
    return git(root, args).trim();
}

export function gitSucceeds(root: string, ...args: string[]): boolean {
    try {
        git(root, args);
        return true;
    } catch {
        return false;
    }
}

export function repositoryRoot(directory: string): string {
    try {
        return gitLine(directory, "rev-parse", "--show-toplevel");
    } catch {
        return directory;
    }
}

function resolveTree(root: string, ref: string): string {
    return gitLine(root, "rev-parse", "--verify", "--end-of-options", ref + "^{tree}");
}

function firstPerPath(groups: Change[][]): Change[] {
    const seen = new Set<string>();
    const result: Change[] = [];
    for (const change of groups.flat()) {
        const paths = change.oldPath ? [change.path, change.oldPath] : [change.path];
        if (!paths.some((item) => seen.has(item))) {
            paths.forEach((item) => seen.add(item));
            result.push(change);
        }
    }
    return result;
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
 *
 * .agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md
 */
export function collectScope(root: string, mode: string, base?: string, head?: string): Scope {
    root = gitLine(root, "rev-parse", "--show-toplevel");
    const empty = git(root, ["hash-object", "-t", "tree", "--stdin"], "").trim();
    if (!["worktree", "staged", "range"].includes(mode)) {
        throw new Error("Unknown scope mode: " + mode);
    }
    let baseTree: string;
    if (mode === "range") {
        if (!base || !head) {
            throw new Error("range requires base and head; use base EMPTY for an initial push");
        }
        baseTree = base === EMPTY_BASE ? empty : resolveTree(root, base);
    } else {
        if (base || head) {
            throw new Error("Only range accepts explicit endpoints");
        }
        try {
            baseTree = resolveTree(root, "HEAD");
        } catch {
            const symbolic = gitLine(root, "symbolic-ref", "-q", "HEAD");
            const refs = gitLine(root, "for-each-ref", "--format=%(refname)", symbolic);
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
        const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
        changes = firstPerPath([
            parseChanges(git(root, [...prefix, baseTree, "--"])),
            untracked.split("\0").filter(Boolean).map((path) => ({ status: "A", path })),
            parseChanges(git(root, [...prefix, "--cached", baseTree, "--"])),
            parseChanges(git(root, [...prefix, "--"])),
        ]);
    }
    const unique = new Map(changes.map((item) => [JSON.stringify(item), item]));
    changes = [...unique.values()].sort((a, b) => {
        const left = JSON.stringify([a.path, a.oldPath, a.status]);
        const right = JSON.stringify([b.path, b.oldPath, b.status]);
        return left < right ? -1 : left > right ? 1 : 0;
    });
    return { mode, base: baseTree, head: headTree, changes };
}

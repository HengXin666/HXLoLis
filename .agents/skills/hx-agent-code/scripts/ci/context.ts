import { readFileSync } from "node:fs";
import { EMPTY_BASE, EVENT_PR, EVENT_PUSH, UTF8 } from "../core/constants.ts";
import { record, string } from "../core/model.ts";
import { collectScope, gitLine, gitSucceeds } from "../core/scope.ts";
import type { Scope } from "../core/model.ts";

type EventScope = { scope: Scope; event: typeof EVENT_PUSH | typeof EVENT_PR };

function sha(value: unknown): string {
    const result = string(value);
    if (!/^[a-f0-9]{40,64}$/.test(result)) {
        throw new Error("Expected a full Git object ID from the event");
    }
    return result;
}

function defaultBase(root: string, data: Record<string, unknown>, head: string): string | undefined {
    const repository = data.repository === undefined ? {} : record(data.repository);
    if (typeof repository.default_branch !== "string" || !repository.default_branch) {
        return undefined;
    }
    const branch = repository.default_branch;
    if (data.ref === "refs/heads/" + branch) {
        return undefined;
    }
    for (const ref of ["refs/remotes/origin/" + branch, "refs/heads/" + branch]) {
        if (gitSucceeds(root, "rev-parse", "--verify", "--quiet", ref)) {
            try {
                return gitLine(root, "merge-base", ref, head) || undefined;
            } catch {
                return undefined;
            }
        }
    }
    return undefined;
}

function pushBase(root: string, data: Record<string, unknown>, head: string): { base: string; fallback?: string } {
    const before = sha(data.before);
    const created = /^0+$/.test(before);
    if (!created && gitSucceeds(root, "cat-file", "-e", before + "^{commit}")) {
        return { base: before };
    }
    const reason = created ? "New branch push" : "Push before commit is unavailable, likely a force push";
    const base = defaultBase(root, data, head);
    if (base) {
        return { base };
    }
    const repository = data.repository === undefined ? {} : record(data.repository);
    const branch = typeof repository.default_branch === "string" ? repository.default_branch : "";
    const rootCommit = !gitSucceeds(root, "rev-parse", "--verify", "--quiet", head + "^");
    if (created && (data.ref === "refs/heads/" + branch || (!branch && rootCommit))) {
        return { base: EMPTY_BASE };
    }
    return { base: EMPTY_BASE, fallback: reason + " without a reachable default branch, scanning everything" };
}

export function eventScope(root: string, eventName: string, event: unknown): EventScope {
    const data = record(event);
    let base: string;
    let head: string;
    let fallback: string | undefined;
    if (eventName === EVENT_PUSH) {
        if (data.deleted === true) {
            throw new Error("Deleted branch events must be skipped by the workflow");
        }
        head = sha(data.after);
        ({ base, fallback } = pushBase(root, data, head));
    } else if (eventName === "pull_request") {
        const pull = record(data.pull_request);
        head = sha(record(pull.head).sha);
        base = gitLine(root, "merge-base", sha(record(pull.base).sha), head);
    } else {
        throw new Error("Only push and pull_request events are supported");
    }
    if (gitLine(root, "rev-parse", "HEAD") !== head) {
        throw new Error("Checkout does not match the event head");
    }
    const scope = collectScope(root, "range", base, head);
    if (fallback) {
        scope.fallback = fallback;
    }
    return { scope, event: eventName === EVENT_PUSH ? EVENT_PUSH : EVENT_PR };
}

export function githubScope(root: string): EventScope {
    const name = process.env.GITHUB_EVENT_NAME;
    const path = process.env.GITHUB_EVENT_PATH;
    if (!name || !path) {
        throw new Error("GITHUB_EVENT_NAME and GITHUB_EVENT_PATH are required; run cli.ts scope for local checks");
    }
    return eventScope(root, name, JSON.parse(readFileSync(path, UTF8)));
}

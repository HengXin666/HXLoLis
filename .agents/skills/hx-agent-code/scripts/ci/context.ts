import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { record, string } from "../core/model.ts";
import { collectScope } from "../core/scope.ts";
import type { Scope } from "../core/model.ts";

function git(root: string, ...args: string[]): string {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function sha(value: unknown): string {
    const result = string(value);
    if (!/^[a-f0-9]{40,64}$/.test(result)) {
        throw new Error("Expected a full Git object ID from the event");
    }
    return result;
}

export function eventScope(root: string, eventName: string, event: unknown): { scope: Scope; event: "push" | "pr" } {
    const data = record(event);
    let base: string;
    let head: string;
    if (eventName === "push") {
        if (data.deleted === true) {
            throw new Error("Deleted branch events must be skipped by the workflow");
        }
        head = sha(data.after);
        base = sha(data.before);
        if (/^0+$/.test(base)) {
            base = "EMPTY";
        }
    } else if (eventName === "pull_request") {
        const pull = record(data.pull_request);
        head = sha(record(pull.head).sha);
        base = git(root, "merge-base", sha(record(pull.base).sha), head);
    } else {
        throw new Error("Only push and pull_request events are supported");
    }
    if (git(root, "rev-parse", "HEAD") !== head) {
        throw new Error("Checkout does not match the event head");
    }
    return { scope: collectScope(root, "range", base, head), event: eventName === "push" ? "push" : "pr" };
}

export function githubScope(root: string): { scope: Scope; event: "push" | "pr" } {
    const name = string(process.env.GITHUB_EVENT_NAME);
    const event = JSON.parse(readFileSync(string(process.env.GITHUB_EVENT_PATH), "utf8"));
    return eventScope(root, name, event);
}

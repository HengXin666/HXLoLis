export type Change = { status: string; path: string; oldPath?: string };
export type Scope = { mode: string; base: string; head: string; changes: Change[] };
export type Severity = "error" | "warning";
export type Finding = {
    ruleId: string;
    severity: Severity;
    path: string;
    line: number;
    message: string;
    evidence: string;
    fingerprint: string;
};
export type Baseline = { ruleId: string; path: string; fingerprint: string; reason: string; approvedBy: string };
export type Module = { paths: string[]; tests: string[]; dependsOn: string[]; contracts: string[] };
export type Graph = {
    complete: boolean;
    inputs: Record<string, string[]>;
    modules: Record<string, Module>;
    global: string[];
};
export type Plan = { full: boolean; modules: string[]; tests: string[]; reasons: string[] };

export function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Expected an object");
    }
    return value as Record<string, unknown>;
}

export function string(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error("Expected a nonempty string");
    }
    return value;
}

export function list(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error("Expected an array");
    }
    return value;
}

export function strings(value: unknown): string[] {
    return list(value).map(string);
}

export function path(value: unknown): string {
    const result = string(value);
    if (result.startsWith("/") || result.includes("\\") || result.includes("\0") || /[*?\[\]]/.test(result)) {
        throw new Error("Expected an exact repository path: " + result);
    }
    if (result.split("/").some((part) => part === ".." || part === "." || part === "")) {
        throw new Error("Unsafe repository path: " + result);
    }
    return result;
}

export function sorted(values: Iterable<string>): string[] {
    return [...new Set(values)].sort();
}

export function parseScope(value: unknown): Scope {
    const data = record(value);
    const mode = string(data.mode);
    if (!["worktree", "staged", "range"].includes(mode)) {
        throw new Error("Unknown scope mode");
    }
    const changes = list(data.changes).map((raw) => {
        const item = record(raw);
        const change: Change = { status: string(item.status), path: string(item.path) };
        if (!/^(?:[ACDMRTUXB]|[RC]\d+)$/.test(change.status)) {
            throw new Error("Unknown change status");
        }
        if (item.oldPath !== undefined) {
            change.oldPath = string(item.oldPath);
        }
        return change;
    });
    return { mode, base: string(data.base), head: string(data.head), changes };
}

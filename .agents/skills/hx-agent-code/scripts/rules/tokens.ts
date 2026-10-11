import { list, path, record, string } from "../core/model.ts";

export type Token = {
    path: string;
    line: number;
    kind: "string" | "number" | "call";
    role: "value" | "path" | "route" | "url" | "import" | "type" | "key";
    value: string;
    module?: string;
    symbol?: string;
    anchor?: string;
    args?: (string | null)[];
};

export type Allowance = { path: string; value: string; reason: string };

const KINDS = ["string", "number", "call"];
const ROLES = ["value", "path", "route", "url", "import", "type", "key"];
const COUNTED_ROLES = ["value", "path", "route", "url"];

function optional(value: unknown): string | undefined {
    return value === undefined ? undefined : string(value);
}

function token(raw: unknown): Token {
    const item = record(raw);
    const kind = string(item.kind);
    const role = item.role === undefined ? "value" : string(item.role);
    if (!KINDS.includes(kind) || !ROLES.includes(role)) {
        throw new Error("Unknown token kind or role: " + kind + "/" + role);
    }
    if (!Number.isInteger(item.line) || Number(item.line) < 1) {
        throw new Error("Token line must be a positive integer");
    }
    if (typeof item.value !== "string") {
        throw new Error("Token value must be the literal source text or decoded string");
    }
    const result: Token = {
        path: path(item.path), line: Number(item.line), kind: kind as Token["kind"],
        role: role as Token["role"], value: item.value, module: optional(item.module), symbol: optional(item.symbol),
        anchor: optional(item.anchor),
    };
    if (item.args !== undefined) {
        result.args = list(item.args).map((arg) => arg === null ? null : String(arg));
    }
    return result;
}

export function parseTokens(value: unknown): Token[] {
    const data = record(value);
    if (data.complete !== true) {
        throw new Error("Token input must declare complete: true; partial lexing cannot pass");
    }
    return list(data.tokens).map(token);
}

export function directories(value: unknown): string[] {
    return value === undefined ? [] : list(value).map(path);
}

export function allowances(value: unknown): Allowance[] {
    return value === undefined ? [] : list(value).map((raw) => {
        const item = record(raw);
        return { path: path(item.path), value: String(item.value), reason: string(item.reason) };
    });
}

export function inside(file: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => file === prefix || file.startsWith(prefix + "/"));
}

export function allowed(item: Token, allow: Allowance[]): boolean {
    return allow.some((entry) => entry.path === item.path && entry.value === item.value);
}

export function isValueRole(item: Token): boolean {
    return COUNTED_ROLES.includes(item.role);
}

/** Occurrence identity from the adapter's stable anchor, or the line so edits fail closed */
export function occurrence(item: Token): string {
    return item.anchor ? "anchor:" + item.anchor : "line:" + item.line;
}

import { ABSPATH_RULE, ERROR } from "../core/constants.ts";
import { record } from "../core/model.ts";
import { fingerprint } from "../core/report.ts";
import type { Finding } from "../core/model.ts";
import { allowances, allowed, occurrence, parseTokens } from "./tokens.ts";
import type { Token } from "./tokens.ts";

const SEPARATORS = /^[\/\\]+$/;
const DRIVE_ROOT = /^[A-Za-z]:[\/\\]?$/;
const UNAMBIGUOUS = /^(?:[A-Za-z]:[\/\\]|\\\\[^\\]|~[\/\\]|~$)/;
const ROOTED = /^[\/\\~]|^[A-Za-z]:(?:[\/\\]|$)/;

/** Drive, UNC and home paths are never routes or patterns, so they count in any value position */
export function isUnambiguousPath(value: string): boolean {
    return UNAMBIGUOUS.test(value);
}

/** Inside a path context any rooted value is absolute, except a bare separator */
export function isAbsoluteValue(value: string): boolean {
    return ROOTED.test(value) && !SEPARATORS.test(value);
}

export function isRootArgument(value: string | null | undefined): boolean {
    return typeof value === "string" && (SEPARATORS.test(value) || DRIVE_ROOT.test(value) || value === "~");
}

function violation(item: Token): string | undefined {
    const absolute = item.role === "path" ? isAbsoluteValue(item.value)
        : item.role === "value" && isUnambiguousPath(item.value);
    if (item.kind === "string" && absolute) {
        return "Absolute path literal " + JSON.stringify(item.value);
    }
    if (item.kind === "call" && isRootArgument(item.args?.[0])) {
        return "Path call " + item.value + " starts from the filesystem root " + JSON.stringify(item.args?.[0]);
    }
    return undefined;
}

/** Reject absolute path literals while allowing roots obtained at runtime, routes and URLs */
export function checkAbsolutePaths(tokens: unknown, config: unknown = {}): Finding[] {
    const allow = allowances(record(config).allow);
    const findings: Finding[] = [];
    for (const item of parseTokens(tokens)) {
        const message = !allowed(item, allow) ? violation(item) : undefined;
        if (message) {
            const identity = item.value + "@" + occurrence(item);
            findings.push({
                ruleId: ABSPATH_RULE, severity: ERROR, path: item.path, line: item.line, message,
                evidence: "Use a repository relative path or a runtime root such as git toplevel or tmpdir",
                fingerprint: fingerprint(ABSPATH_RULE, item.path, item.symbol ?? "", identity),
            });
        }
    }
    return findings;
}

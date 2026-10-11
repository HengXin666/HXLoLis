import { ABSPATH_RULE, ERROR } from "../core/constants.ts";
import { isAbsoluteLiteral, record } from "../core/model.ts";
import { fingerprint } from "../core/report.ts";
import type { Finding } from "../core/model.ts";
import { allowances, allowed, parseTokens } from "./tokens.ts";
import type { Token } from "./tokens.ts";

const SEPARATORS = /^[\/\\]+$/;
const DRIVE_ROOT = /^[A-Za-z]:[\/\\]?$/;

export function isAbsoluteValue(value: string): boolean {
    return isAbsoluteLiteral(value) && !SEPARATORS.test(value);
}

export function isRootArgument(value: string | null | undefined): boolean {
    return typeof value === "string" && (SEPARATORS.test(value) || DRIVE_ROOT.test(value) || value === "~");
}

function violation(item: Token): string | undefined {
    if (item.kind === "string" && isAbsoluteValue(item.value)) {
        return "Absolute path literal " + JSON.stringify(item.value);
    }
    if (item.kind === "call" && isRootArgument(item.args?.[0])) {
        return "Path call " + item.value + " starts from the filesystem root " + JSON.stringify(item.args?.[0]);
    }
    return undefined;
}

/** Reject absolute path literals while allowing roots obtained at runtime */
export function checkAbsolutePaths(tokens: unknown, config: unknown = {}): Finding[] {
    const allow = allowances(record(config).allow);
    const findings: Finding[] = [];
    for (const item of parseTokens(tokens)) {
        const message = item.role === "value" && !allowed(item, allow) ? violation(item) : undefined;
        if (message) {
            findings.push({
                ruleId: ABSPATH_RULE, severity: ERROR, path: item.path, line: item.line, message,
                evidence: "Use a repository relative path or a runtime root such as git toplevel or tmpdir",
                fingerprint: fingerprint(ABSPATH_RULE, item.path, item.symbol ?? "", item.value),
            });
        }
    }
    return findings;
}

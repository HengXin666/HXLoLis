import { ERROR, LITERAL_RULE, LITERAL_THRESHOLD } from "../core/constants.ts";
import { record } from "../core/model.ts";
import { fingerprint } from "../core/report.ts";
import type { Finding } from "../core/model.ts";
import { allowances, allowed, directories, inside, isValueRole, occurrence, parseTokens } from "./tokens.ts";
import type { Token } from "./tokens.ts";

const TRIVIAL = new Set(["", "0", "1", "-1"]);

type LiteralConfig = {
    scope: "module" | "repository";
    threshold: number;
    constantsDirs: string[];
    exemptDirs: string[];
};

export function parseLiteralConfig(value: unknown): LiteralConfig & { allow: ReturnType<typeof allowances> } {
    const data = record(value);
    const scope = data.scope === undefined ? "module" : data.scope;
    if (scope !== "module" && scope !== "repository") {
        throw new Error("Literal scope must be module or repository");
    }
    const threshold = data.threshold === undefined ? LITERAL_THRESHOLD : Number(data.threshold);
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > LITERAL_THRESHOLD) {
        throw new Error("Literal threshold may only tighten the default of " + LITERAL_THRESHOLD);
    }
    const constantsDirs = directories(data.constantsDirs);
    if (constantsDirs.length === 0) {
        throw new Error("At least one constants directory must be registered");
    }
    return {
        scope, threshold, constantsDirs, exemptDirs: directories(data.exemptDirs), allow: allowances(data.allow),
    };
}

function group(item: Token, scope: LiteralConfig["scope"]): string {
    if (scope === "module" && !item.module) {
        throw new Error("Module scoped literal counting needs a module on every token: " + item.path);
    }
    return JSON.stringify([scope === "module" ? item.module : "", item.kind, item.value]);
}

/**
 * Report repeated literals that belong in a registered constants directory
 *
 * .agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md
 */
export function checkLiterals(tokens: unknown, config: unknown): Finding[] {
    const settings = parseLiteralConfig(config);
    const counted = parseTokens(tokens).filter((item) => {
        return isValueRole(item) && item.kind !== "call" && !TRIVIAL.has(item.value)
            && !inside(item.path, [...settings.constantsDirs, ...settings.exemptDirs])
            && !allowed(item, settings.allow);
    });
    const groups = new Map<string, Token[]>();
    for (const item of counted) {
        const key = group(item, settings.scope);
        groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const findings: Finding[] = [];
    for (const items of groups.values()) {
        if (items.length < settings.threshold) {
            continue;
        }
        for (const item of items) {
            const identity = item.value + "@" + occurrence(item);
            findings.push({
                ruleId: LITERAL_RULE, severity: ERROR, path: item.path, line: item.line,
                message: `${item.kind} literal ${JSON.stringify(item.value)} appears ${items.length} times; `
                    + "move it to a registered constants directory and import it",
                evidence: "Token count in " + (settings.scope === "module" ? "module " + item.module : "repository"),
                fingerprint: fingerprint(LITERAL_RULE, item.path, item.symbol ?? "", identity),
            });
        }
    }
    return findings;
}

import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPORTS_DIR, UTF8 } from "./core/constants.ts";
import { collectScope, repositoryRoot } from "./core/scope.ts";
import { parseScope } from "./core/model.ts";
import type { Finding } from "./core/model.ts";
import { parseGraph, selectTests } from "./core/affected.ts";
import { consoleReport, makeReport, parseBaseline, parseFindings, saveToolError } from "./core/report.ts";
import { auditCoverage, parseCatalog } from "./core/audit.ts";
import { checkLiterals } from "./rules/literal.ts";
import { checkAbsolutePaths } from "./rules/abspath.ts";

const USAGE = "Usage: cli.ts scope|affected|report|audit|literals|abspath --key value; see references/runtime.md";

function read(path: string): unknown {
    return JSON.parse(readFileSync(path, UTF8));
}

function write(path: string, value: unknown): void {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 4) + "\n");
}

function options(args: string[], allowed: string[], required: string[]): Record<string, string> {
    const result: Record<string, string> = Object.create(null);
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index].replace(/^--/, "");
        if (!args[index].startsWith("--") || !allowed.includes(key) || Object.hasOwn(result, key)) {
            throw new Error("Unknown or duplicate option: " + args[index]);
        }
        const value = args[index + 1];
        if (!value || value.startsWith("--")) {
            throw new Error("Missing value: " + args[index]);
        }
        result[key] = value;
    }
    for (const key of required) {
        if (!result[key]) {
            throw new Error("Missing --" + key);
        }
    }
    return result;
}

function report(findings: Finding[], out: string, baseline?: string): number {
    const result = makeReport(findings, baseline ? parseBaseline(read(baseline)) : []);
    write(out + ".json", result.json);
    write(out + ".md", result.markdown);
    consoleReport(findings, resolve(out + ".json"));
    return result.exitCode;
}

function findings(command: string, rest: string[]): number {
    if (command === "report") {
        const flags = options(rest, ["input", "baseline", "out"], ["input", "out"]);
        return report(parseFindings(read(flags.input)), flags.out, flags.baseline);
    }
    if (command === "audit") {
        const flags = options(rest, ["manifest", "out"], ["manifest", "out"]);
        const catalog = parseCatalog(readFileSync(new URL("../references/rules.md", import.meta.url), UTF8));
        return report(auditCoverage(read(flags.manifest), catalog, flags.manifest), flags.out);
    }
    const flags = options(rest, ["tokens", "config", "baseline", "out"], ["tokens", "out"]);
    const config = flags.config ? read(flags.config) : {};
    const found = command === "literals" ? checkLiterals(read(flags.tokens), config)
        : checkAbsolutePaths(read(flags.tokens), config);
    return report(found, flags.out, flags.baseline);
}

/**
 * Keep portable analysis separate from project-specific installation
 *
 * .agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md
 */
export function main(args: string[]): number {
    const [command, ...rest] = args;
    if (command === "scope") {
        const flags = options(rest, ["root", "mode", "base", "head", "out"], ["root", "mode", "out"]);
        write(flags.out + ".json", collectScope(flags.root, flags.mode, flags.base, flags.head));
        return 0;
    }
    if (command === "affected") {
        const flags = options(rest, ["scope", "graph", "event", "out"], ["scope", "graph", "event", "out"]);
        const plan = selectTests(parseScope(read(flags.scope)), parseGraph(read(flags.graph)), flags.event);
        write(flags.out + ".json", plan);
        return 0;
    }
    if (["report", "audit", "literals", "abspath"].includes(command)) {
        return findings(command, rest);
    }
    throw new Error(USAGE);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    try {
        process.exitCode = main(args);
    } catch (error) {
        const value = args[args.indexOf("--out") + 1];
        const requested = args.includes("--out") && value && !value.startsWith("--") ? value : undefined;
        const out = requested ?? join(repositoryRoot(process.cwd()), REPORTS_DIR, "cli-error");
        for (const suffix of [".json", ".md"]) {
            rmSync(out + suffix, { force: true });
        }
        saveToolError(error, out);
        process.exitCode = 2;
    }
}

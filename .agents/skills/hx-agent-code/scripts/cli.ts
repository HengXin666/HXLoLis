import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectScope } from "./core/scope.ts";
import { parseScope } from "./core/model.ts";
import { parseGraph, selectTests } from "./core/affected.ts";
import { makeReport, parseBaseline, parseFindings } from "./core/report.ts";
import { auditCoverage, parseCatalog } from "./core/audit.ts";

function read(path: string): unknown {
    return JSON.parse(readFileSync(path, "utf8"));
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

/**
 * Keep portable analysis separate from project-specific installation
 * .agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md
 */
export function main(args: string[]): number {
    const [command, ...rest] = args;
    if (command === "scope") {
        const flags = options(rest, ["root", "mode", "base", "head", "out"], ["root", "mode", "out"]);
        write(flags.out, collectScope(flags.root, flags.mode, flags.base, flags.head));
        return 0;
    }
    if (command === "affected") {
        const flags = options(rest, ["scope", "graph", "event", "out"], ["scope", "graph", "event", "out"]);
        write(flags.out, selectTests(parseScope(read(flags.scope)), parseGraph(read(flags.graph)), flags.event));
        return 0;
    }
    if (command === "report" || command === "audit") {
        const allowed = command === "report" ? ["input", "baseline", "out"] : ["manifest", "out"];
        const required = command === "report" ? ["input", "out"] : ["manifest", "out"];
        const flags = options(rest, allowed, required);
        const catalogPath = new URL("../references/rules.md", import.meta.url);
        const findings = command === "report" ? parseFindings(read(flags.input))
            : auditCoverage(read(flags.manifest), parseCatalog(readFileSync(catalogPath, "utf8")));
        const baseline = flags.baseline ? parseBaseline(read(flags.baseline)) : [];
        const report = makeReport(findings, baseline);
        write(flags.out + ".json", report.json);
        write(flags.out + ".md", report.markdown);
        return report.exitCode;
    }
    throw new Error("Usage: cli.ts scope|affected|report|audit --key value; see references/runtime.md");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
        process.exitCode = 2;
    }
}

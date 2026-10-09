import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { list, record, string } from "./model.ts";
import type { Baseline, Finding } from "./model.ts";

export function fingerprint(ruleId: string, path: string, symbol: string, violation: string): string {
    return createHash("sha256").update(JSON.stringify([ruleId, path, symbol, violation])).digest("hex");
}

export function parseFindings(value: unknown): Finding[] {
    return list(value).map((raw) => {
        const item = record(raw);
        if (item.severity !== "warning" && item.severity !== "error") {
            throw new Error("Unknown severity");
        }
        if (!Number.isInteger(item.line) || Number(item.line) < 1) {
            throw new Error("Finding line must be a positive integer");
        }
        return {
            ruleId: string(item.ruleId), severity: item.severity, path: string(item.path),
            line: Number(item.line), message: string(item.message), evidence: string(item.evidence),
            fingerprint: string(item.fingerprint),
        };
    });
}

export function parseBaseline(value: unknown): Baseline[] {
    return list(value).map((raw) => {
        const item = record(raw);
        return {
            ruleId: string(item.ruleId), path: string(item.path), fingerprint: string(item.fingerprint),
            reason: string(item.reason), approvedBy: string(item.approvedBy),
        };
    });
}

function identity(item: Finding | Baseline): string {
    return JSON.stringify([item.ruleId, item.path, item.fingerprint]);
}

function escape(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        .replaceAll("|", "&#124;").replaceAll("`", "&#96;").replaceAll("[", "&#91;")
        .replaceAll("]", "&#93;").replaceAll("\r", " ").replaceAll("\n", " ");
}

/**
 * Summarize diagnostics after their complete report has been saved
 * .agents/notes/implemented/process/2026-10-10-gates-save-full-reports.md
 */
export function consoleReport(findings: Finding[], output: string): void {
    const types: Record<string, number> = Object.create(null);
    for (const item of findings) types[item.ruleId] = (types[item.ruleId] ?? 0) + 1;
    if (findings.length <= 10) {
        for (const item of findings) console.log(`${item.severity} [${item.ruleId}] ${item.path}:${item.line} ${item.message}`);
    }
    console.log(`Quality: ${findings.length} 项问题`);
    if (findings.length) console.log("类型: " + Object.keys(types).sort().map((rule) => `${rule}=${types[rule]}`).join(", "));
    console.log("完整报告: " + output);
}

export function saveToolError(error: unknown, output: string): void {
    const message = error instanceof Error ? error.message : String(error);
    const finding: Finding = { ruleId: "tool-error", severity: "error", path: "", line: 1,
        message, evidence: "CLI", fingerprint: fingerprint("tool-error", "", "CLI", message) };
    const report = makeReport([finding], []);
    try {
        mkdirSync(dirname(resolve(output)), { recursive: true });
        writeFileSync(output + ".json", JSON.stringify(report.json, null, 4) + "\n");
        writeFileSync(output + ".md", report.markdown);
        consoleReport([finding], resolve(output + ".json"));
    } catch (failure) {
        console.error("Quality: 1 项错误, 类型 report-write-error, " + String(failure));
    }
}

export function makeReport(findings: Finding[], baseline: Baseline[]) {
    const approved = new Set(baseline.map(identity));
    const ordered = [...findings].sort((a, b) => {
        if (a.path !== b.path) {
            return a.path < b.path ? -1 : 1;
        }
        if (a.line !== b.line) {
            return a.line - b.line;
        }
        const left = JSON.stringify([a.ruleId, a.fingerprint, a.severity, a.message, a.evidence]);
        const right = JSON.stringify([b.ruleId, b.fingerprint, b.severity, b.message, b.evidence]);
        return left < right ? -1 : left > right ? 1 : 0;
    });
    const results = ordered.map((item) => ({ ...item, origin: approved.has(identity(item)) ? "historical" : "new" }));
    const errors = results.filter((item) => item.severity === "error" && item.origin === "new").length;
    const warnings = results.filter((item) => item.severity === "warning").length;
    const historical = results.filter((item) => item.origin === "historical").length;
    const json = { version: 1, errors, warnings, historical, findings: results };
    const rows = results.map((item) => {
        return [item.severity, item.origin, item.ruleId, item.path + ":" + item.line, item.message, item.evidence]
            .map(escape).join(" | ");
    });
    const markdown = [
        "# Quality review", "", `Errors: ${errors}, warnings: ${warnings}, historical: ${historical}`, "",
        "| Severity | Origin | Rule | Location | Message | Evidence |", "|---|---|---|---|---|---|",
        ...rows.map((row) => "| " + row + " |"), "",
    ].join("\n");
    return { json, markdown, exitCode: errors > 0 ? 1 : 0 };
}

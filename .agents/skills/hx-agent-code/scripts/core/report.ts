import { createHash } from "node:crypto";
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

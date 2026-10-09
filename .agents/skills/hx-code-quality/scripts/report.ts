import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Issue = { rule: string; severity: string; message: string; path?: string; line?: number };

/**
 * Save every diagnostic before displaying a bounded summary
 * .agents/notes/implemented/process/2026-10-10-gates-save-full-reports.md
 */
export function saveReport(label: string, issues: Issue[], root = process.cwd()): void {
    const output = resolve(process.env.HX_GATE_REPORT ?? resolve(root, ".gate-reports", label + ".json"));
    const types: Record<string, number> = Object.create(null);
    for (const issue of issues) types[issue.rule] = (types[issue.rule] ?? 0) + 1;
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify({ version: 1, gate: label, issues, types }, null, 2) + "\n");
    if (issues.length <= 10) {
        for (const issue of issues) {
            console.log(`${issue.severity} [${issue.rule}] ${issue.path ?? ""}:${issue.line ?? 1} ${issue.message}`);
        }
    }
    console.log(`${label}: ${issues.length} 项问题`);
    if (issues.length) console.log("类型: " + Object.keys(types).sort().map((rule) => `${rule}=${types[rule]}`).join(", "));
    console.log("完整报告: " + output);
}

export function captureFailure(label: string, root = process.cwd()): void {
    process.on("uncaughtException", (error) => {
        try {
            saveReport(label, [{ rule: "tool-error", severity: "error", message: error.message }], root);
        } catch (failure) {
            console.error(`${label}: 1 项错误, 类型 report-write-error, ${String(failure)}`);
        }
        process.exitCode = 2;
    });
}

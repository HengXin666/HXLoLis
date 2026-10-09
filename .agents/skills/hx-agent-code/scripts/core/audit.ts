import { list, record, string, strings } from "./model.ts";
import { fingerprint } from "./report.ts";
import type { Finding, Severity } from "./model.ts";

export function parseCatalog(markdown: string): Map<string, Severity> {
    const entries = [...markdown.matchAll(/^\| (HC-[A-Z-]+) \| (Error|Warning) \|/gm)];
    const rows = markdown.match(/^\s*\|[^|\n]*HC-/gm) ?? [];
    if (rows.length !== entries.length) {
        throw new Error("Malformed catalog rows: " + rows.length + " rows, " + entries.length + " parsed");
    }
    const rules = new Map<string, Severity>();
    for (const entry of entries) {
        if (rules.has(entry[1])) {
            throw new Error("Duplicate catalog rule: " + entry[1]);
        }
        rules.set(entry[1], entry[2].toLowerCase() as Severity);
    }
    if (rules.size === 0) {
        throw new Error("Rule catalog is empty");
    }
    return rules;
}

export function auditCoverage(value: unknown, catalog: Map<string, Severity>): Finding[] {
    const rows = list(value);
    const seen = new Set<string>();
    const findings: Finding[] = [];
    function fail(id: string, message: string): void {
        findings.push({
            ruleId: "HC-META", severity: "error", path: "coverage.json", line: 1,
            message: id + ": " + message, evidence: "Installation coverage audit",
            fingerprint: fingerprint("HC-META", "coverage.json", id, message),
        });
    }
    for (const raw of rows) {
        const row = record(raw);
        const id = string(row.id);
        if (seen.has(id)) {
            fail(id, "Duplicate rule ID");
        }
        seen.add(id);
        if (!catalog.has(id) && !/^PROJECT-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(id)) {
            fail(id, "Unknown rule ID");
        }
        if (row.status === "not-applicable") {
            try {
                string(row.reason);
                string(row.evidence);
            } catch {
                fail(id, "Not-applicable requires reason and repository evidence");
            }
        } else if (row.status === "implemented") {
            try {
                if (row.severity !== "warning" && row.severity !== "error") {
                    throw new Error("Missing severity");
                }
                if (catalog.has(id) && catalog.get(id) !== row.severity) {
                    throw new Error("Severity differs from the rule catalog");
                }
                if (strings(row.checker).length === 0 || strings(row.checkpoints).length === 0) {
                    throw new Error("Checker and checkpoints must be nonempty");
                }
                const probes = record(row.probes);
                const positive = string(probes.positive);
                const negative = string(probes.negative);
                if (positive === negative) {
                    throw new Error("Positive and negative probes must differ");
                }
                string(row.evidence);
            } catch (error) {
                fail(id, error instanceof Error ? error.message : "Invalid implementation evidence");
            }
        } else {
            fail(id, "Rule remains blocked or has an invalid status");
        }
    }
    for (const id of catalog.keys()) {
        if (!seen.has(id)) {
            fail(id, "Missing rule disposition");
        }
    }
    return findings;
}

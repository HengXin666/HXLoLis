import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint, makeReport, parseFindings, parseBaseline } from "../core/report.ts";
import { auditCoverage, parseCatalog } from "../core/audit.ts";
import { main } from "../cli.ts";
import type { Finding } from "../core/model.ts";

function finding(message: string, severity: "warning" | "error" = "error"): Finding {
    return {
        ruleId: "HC-TYPE", severity, path: "src/a.ts", line: 1, message,
        evidence: "Type checker output", fingerprint: fingerprint("HC-TYPE", "src/a.ts", "f", message),
    };
}

test("warnings do not block and every error survives aggregation", () => {
    assert.equal(makeReport([finding("review", "warning")], []).exitCode, 0);
    const result = makeReport([finding("wrong return"), finding("wrong argument")], []);
    assert.equal(result.exitCode, 1);
    assert.equal(result.json.errors, 2);
});

test("baseline only exempts exact identities, not matching totals or moved paths", () => {
    const old = finding("old mismatch");
    const baseline = [{ ...old, reason: "Migration budget", approvedBy: "owner" }];
    const result = makeReport([old, finding("new mismatch")], baseline);
    assert.equal(result.json.historical, 1);
    assert.equal(result.json.errors, 1);
    assert.equal(makeReport([{ ...old, path: "src/b.ts" }], baseline).exitCode, 1);
    assert.equal(makeReport([old], baseline).exitCode, 0);
    assert.throws(() => parseBaseline([{ ...old }]));
});

test("reports are deterministic, escape Markdown, and reject malformed results", () => {
    const a = finding("a | <img> [link]\nnext");
    const b = finding("b");
    assert.deepEqual(makeReport([a, b], []), makeReport([b, a], []));
    const numbered = makeReport([{ ...a, line: 10 }, { ...b, line: 2 }], []);
    assert.deepEqual(numbered.json.findings.map((item) => item.line), [2, 10]);
    assert(makeReport([a], []).markdown.includes("&#124; &lt;img&gt; &#91;link&#93; next"));
    assert.throws(() => parseFindings([{ ...a, severity: "info" }]));
    assert.throws(() => parseFindings([{ ...a, line: 0 }]));
});

test("coverage catches missing, duplicate, blocked and evidence-free rules", () => {
    const catalog = parseCatalog(readFileSync(new URL("../../references/rules.md", import.meta.url), "utf8"));
    const rows = [...catalog].map(([id, severity]) => ({
        id, severity, status: "implemented", checker: ["node", "check.ts", id],
        checkpoints: ["task-complete"], probes: { positive: "positive", negative: "negative" }, evidence: "run.json",
    }));
    assert.equal(auditCoverage(rows, catalog).length, 0);
    assert(auditCoverage(rows.slice(1), catalog).some((item) => item.message.includes("Missing")));
    assert(auditCoverage([...rows, rows[0]], catalog).some((item) => item.message.includes("Duplicate")));
    assert(auditCoverage([{ ...rows[0], status: "blocked" }, ...rows.slice(1)], catalog).length > 0);
    assert(auditCoverage([{ ...rows[0], evidence: "" }, ...rows.slice(1)], catalog).length > 0);
    assert(auditCoverage([{ ...rows[0], severity: "warning" }, ...rows.slice(1)], catalog).length > 0);
    assert.throws(() => parseCatalog(""));
});

test("CLI writes both report formats and rejects unknown options", () => {
    const root = mkdtempSync(join(tmpdir(), "hc-report-"));
    try {
        const input = join(root, "findings.json");
        writeFileSync(input, JSON.stringify([finding("review", "warning")]));
        const out = join(root, "review");
        assert.equal(main(["report", "--input", input, "--out", out]), 0);
        assert.equal(JSON.parse(readFileSync(out + ".json", "utf8")).warnings, 1);
        assert(readFileSync(out + ".md", "utf8").includes("HC-TYPE"));
        assert.throws(() => main(["report", "--input", input, "--out", out, "--force", "yes"]));
        assert.throws(() => main(["report", "--input", input]));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

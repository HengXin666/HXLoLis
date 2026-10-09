import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCI, runTasks } from "../ci/run.ts";
import { eventScope } from "../ci/context.ts";
import { parseConfig } from "../ci/config.ts";
import { fixture } from "./ci-fixture.ts";

test("runnable example builds once, push selects no docs tests and PR selects all", () => {
    const repo = fixture();
    try {
        repo.write("docs/guide.md", "# Updated guide\n");
        const head = repo.push();
        for (const group of ["code", "docs", "build", "compatibility", "tests"]) {
            assert.equal(runCI(repo.root, group), 0, group);
        }
        assert.deepEqual(repo.json("scripts/.hx_code_quality/reports/test-plan.json").tests, []);
        repo.write("event.json", JSON.stringify({ pull_request: { base: { sha: repo.base }, head: { sha: head } } }));
        process.env.GITHUB_EVENT_NAME = "pull_request";
        assert.equal(runCI(repo.root, "tests"), 0);
        assert.deepEqual(repo.json("scripts/.hx_code_quality/reports/test-plan.json").tests, ["value:unit"]);
        assert.equal(repo.json("scripts/.hx_code_quality/reports/test-plan.json").full, true);
    } finally {
        repo.cleanup();
    }
});

test("multiple failures, malformed output and a missing command are all reported", () => {
    const root = process.cwd();
    const results = runTasks(root, [
        { id: "a", command: [process.execPath, "-e", "process.exit(1)"], format: "exit" },
        { id: "b", command: [process.execPath, "-e", "process.exit(2)"], format: "exit" },
        { id: "c", command: [process.execPath, "-e", "process.stdout.write('not json')"], format: "findings" },
        { id: "d", command: ["/missing/hc-checker"], format: "exit" },
    ], 5000, process.env);
    assert.equal(results.length, 4);
    assert(results.every((item) => item.severity === "error"));
});

test("artifact corruption and invalid config cannot pass", () => {
    const repo = fixture();
    try {
        repo.push();
        assert.equal(runCI(repo.root, "build"), 0);
        repo.write("scripts/.hx_code_quality/build/value.txt", "corrupt");
        assert.equal(runCI(repo.root, "tests"), 1);
        assert(repo.json("scripts/.hx_code_quality/reports/tests.json").findings[0].message.includes("manifest"));
        const config = repo.json("scripts/quality/ci.json");
        config.groups.code.tasks = [];
        assert.throws(() => parseConfig(config));
        repo.write("scripts/quality/ci.json", "{}");
        assert.equal(runCI(repo.root, "code"), 1);
        assert(repo.json("scripts/.hx_code_quality/reports/code.json").errors > 0);
    } finally {
        repo.cleanup();
    }
});

test("first push works and a mismatched checkout is rejected", () => {
    const repo = fixture();
    try {
        const head = repo.push();
        assert(eventScope(repo.root, "push", { before: "0".repeat(40), after: head }).scope.changes.length > 0);
        assert.throws(() => eventScope(repo.root, "push", { before: head, after: repo.base }));
        assert.throws(() => eventScope(repo.root, "workflow_dispatch", {}));
    } finally {
        repo.cleanup();
    }
});

test("CI ignores a baseline introduced in the same untrusted change", () => {
    const repo = fixture();
    try {
        repo.write("src/value.txt", "broken");
        writeFileSync(join(repo.root, "scripts/quality/baseline.json"), JSON.stringify([{
            ruleId: "PROJECT-VALUE", path: "src/value.txt", fingerprint: "value:broken",
            reason: "Cannot self-approve this change", approvedBy: "claimed-owner",
        }]));
        repo.push();
        assert.equal(runCI(repo.root, "code"), 1);
        assert.equal(repo.json("scripts/.hx_code_quality/reports/code.json").historical, 0);
    } finally {
        repo.cleanup();
    }
});

test("runner preserves child output in files without streaming it", () => {
    const repo = fixture();
    const messages: string[] = [];
    const original = [process.stdout.write, process.stderr.write];
    process.stdout.write = process.stderr.write = ((text: string) => {
        messages.push(String(text));
        return true;
    }) as typeof process.stdout.write;
    try {
        const results = runTasks(repo.root, [{ id: "verbose", format: "exit", command: [process.execPath, "-e",
            "process.stdout.write('raw output'); process.stderr.write('raw error'); process.exit(1)"] }], 5000, process.env);
        assert.equal(results.length, 1);
        assert.deepEqual(messages, []);
        const saved = JSON.parse(readFileSync(join(repo.root, "scripts/.hx_code_quality/reports/tasks/verbose.json"), "utf8"));
        assert.equal(saved.stdout, "raw output");
        assert.equal(saved.stderr, "raw error");
        assert.equal(saved.status, 1);
    } finally {
        [process.stdout.write, process.stderr.write] = original;
        repo.cleanup();
    }
});

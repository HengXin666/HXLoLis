import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCI, runTasks } from "../ci/run.ts";
import { eventScope } from "../ci/context.ts";
import { parseConfig } from "../ci/config.ts";
import { fixture } from "./ci-fixture.ts";

const PLAN = "scripts/.hx_code_quality/reports/test-plan.json";

test("runnable example builds once, push selects no docs tests and PR selects all", () => {
    const repo = fixture();
    try {
        repo.write("docs/guide.md", "# Updated guide\n");
        const head = repo.push();
        for (const group of ["code", "docs", "build", "compatibility", "tests"]) {
            assert.equal(runCI(repo.root, group), 0, group);
        }
        assert.deepEqual(repo.json(PLAN).tests, []);
        repo.write("event.json", JSON.stringify({ pull_request: { base: { sha: repo.base }, head: { sha: head } } }));
        process.env.GITHUB_EVENT_NAME = "pull_request";
        assert.equal(runCI(repo.root, "tests"), 0);
        assert.deepEqual(repo.json(PLAN).tests, ["value:unit"]);
        assert.equal(repo.json(PLAN).full, true);
    } finally {
        repo.cleanup();
    }
});

test("multiple failures, malformed output and a missing command are all reported", () => {
    const repo = fixture();
    try {
        const results = runTasks(repo.root, [
            { id: "a", command: [process.execPath, "-e", "process.exit(1)"], format: "exit" },
            { id: "b", command: [process.execPath, "-e", "process.exit(2)"], format: "exit" },
            { id: "c", command: [process.execPath, "-e", "process.stdout.write('not json')"], format: "findings" },
            { id: "d", command: ["hc-missing-checker-command"], format: "exit" },
        ], 5000, process.env);
        assert.equal(results.length, 4);
        assert(results.every((item) => item.severity === "error"));
        const kinds = results.map((item) => item.message.slice(0, 8));
        assert.deepEqual(kinds, ["[task] a", "[task] b", "[runner]", "[runner]"]);
    } finally {
        repo.cleanup();
    }
});

test("artifact corruption and invalid config cannot pass", () => {
    const repo = fixture();
    try {
        repo.push();
        assert.equal(runCI(repo.root, "build"), 0);
        repo.write("scripts/.hx_code_quality/build/value.txt", "corrupt");
        assert.equal(runCI(repo.root, "tests"), 1);
        const report = repo.json("scripts/.hx_code_quality/reports/tests.json");
        assert(report.findings[0].message.includes("manifest"));
        assert.equal(report.runnerErrors, 1);
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
        const zero = "0".repeat(40);
        const first = eventScope(repo.root, "push", { before: zero, after: head }).scope;
        assert(first.changes.length > 0);
        assert(first.fallback);
        assert.throws(() => eventScope(repo.root, "push", { before: head, after: repo.base }));
        assert.throws(() => eventScope(repo.root, "workflow_dispatch", {}));
    } finally {
        repo.cleanup();
    }
});

test("new branch and force push compare with the default branch instead of the empty tree", () => {
    const repo = fixture();
    try {
        const main = repo.git("rev-parse", "--abbrev-ref", "HEAD");
        repo.git("checkout", "-qb", "feature");
        repo.write("src/value.txt", "ready\n");
        repo.write("docs/guide.md", "# Feature guide\n");
        const head = repo.push();
        const repository = { default_branch: main };
        const created = eventScope(repo.root, "push", {
            before: "0".repeat(40), after: head, ref: "refs/heads/feature", repository,
        }).scope;
        assert.deepEqual(created.changes.map((item) => item.path), ["docs/guide.md"]);
        assert.equal(created.fallback, undefined);
        const forced = eventScope(repo.root, "push", {
            before: "1".repeat(40), after: head, ref: "refs/heads/feature", repository,
        }).scope;
        assert.deepEqual(forced.changes.map((item) => item.path), ["docs/guide.md"]);
    } finally {
        repo.cleanup();
    }
});

test("orphan pushes and missing default branches fall back to a full scan instead of a runner fault", () => {
    const repo = fixture();
    try {
        const main = repo.git("rev-parse", "--abbrev-ref", "HEAD");
        repo.git("checkout", "-q", "--orphan", "orphan");
        const head = repo.push();
        const event = {
            before: "0".repeat(40), after: head, ref: "refs/heads/orphan", repository: { default_branch: main },
        };
        assert(eventScope(repo.root, "push", event).scope.fallback);
        repo.write("event.json", JSON.stringify({ ...event, repository: { default_branch: "missing" } }));
        assert.equal(runCI(repo.root, "code"), 0);
        const report = repo.json("scripts/.hx_code_quality/reports/code.json");
        assert.equal(report.runnerErrors, 0);
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
        const script = "process.stdout.write('raw output'); process.stderr.write('raw error'); process.exit(1)";
        const command = [process.execPath, "-e", script];
        const results = runTasks(repo.root, [{ id: "verbose", format: "exit", command }], 5000, process.env);
        assert.equal(results.length, 1);
        assert.deepEqual(messages, []);
        const log = join(repo.root, "scripts/.hx_code_quality/reports/tasks/verbose.json");
        const saved = JSON.parse(readFileSync(log, "utf8"));
        assert.equal(saved.stdout, "raw output");
        assert.equal(saved.stderr, "raw error");
        assert.equal(saved.status, 1);
    } finally {
        [process.stdout.write, process.stderr.write] = original;
        repo.cleanup();
    }
});

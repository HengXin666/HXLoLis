import { test } from "node:test";
import assert from "node:assert/strict";
import { path } from "../../core/model.ts";
import { checkLiterals } from "../literal.ts";
import { checkAbsolutePaths, isAbsoluteValue } from "../abspath.ts";

const CONFIG = { scope: "module", constantsDirs: ["src/shared/constants"] };

function literal(file: string, value: string, line = 1, extra: Record<string, unknown> = {}) {
    return { path: file, line, kind: "string", value, module: "user", ...extra };
}

/**
 * Probe both user added rules with adapter shaped token input
 *
 * .agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md
 */
function tokens(items: unknown[]) {
    return { complete: true, tokens: items };
}

test("HC-LITERAL passes two repeats and fails the third", () => {
    const two = [literal("src/user/a.ts", "pending"), literal("src/user/b.ts", "pending")];
    assert.deepEqual(checkLiterals(tokens(two), CONFIG), []);
    const three = [...two, literal("src/user/c.ts", "pending", 4)];
    const findings = checkLiterals(tokens(three), CONFIG);
    assert.equal(findings.length, 3);
    assert(findings.every((item) => item.ruleId === "HC-LITERAL" && item.severity === "error"));
    assert.equal(new Set(findings.map((item) => item.fingerprint)).size, 3);
});

test("HC-LITERAL ignores constants, trivial values, imports and types", () => {
    const items = [
        literal("src/shared/constants/user.ts", "pending"),
        literal("src/user/a.ts", "pending"),
        literal("src/user/b.ts", "pending"),
        ...["", "0", "1", "-1"].flatMap((value) => [1, 2, 3].map((line) => literal("src/user/a.ts", value, line))),
        ...[1, 2, 3].map((line) => literal("src/user/a.ts", "node:fs", line, { role: "import" })),
        ...[1, 2, 3].map((line) => literal("src/user/a.ts", "error", line, { role: "type" })),
    ];
    assert.deepEqual(checkLiterals(tokens(items), CONFIG), []);
});

test("HC-LITERAL rejects incomplete input and looser thresholds", () => {
    assert.throws(() => checkLiterals({ complete: false, tokens: [] }, CONFIG));
    assert.throws(() => checkLiterals(tokens([]), { ...CONFIG, threshold: 4 }));
    assert.throws(() => checkLiterals(tokens([]), { scope: "module", constantsDirs: [] }));
});

test("HC-ABSPATH flags roots, home and drives but allows runtime roots", () => {
    for (const value of ["/x", "~/x", "C:\\\\x", "C:/x", "\\\\\\\\host\\\\share", "/tmp/x"]) {
        assert(isAbsoluteValue(value), value);
    }
    for (const value of ["src/x", "./x", "/", "\\\\", "a:b"]) {
        assert(!isAbsoluteValue(value), value);
    }
    const items = [
        literal("src/user/a.ts", "/tmp/x"),
        { path: "src/user/a.ts", line: 2, kind: "call", value: "join", args: ["/", null] },
        { path: "src/user/a.ts", line: 3, kind: "call", value: "join", args: [null, "cache"] },
        literal("src/user/a.ts", "/var/run/allowed.sock", 4),
    ];
    const config = { allow: [{ path: "src/user/a.ts", value: "/var/run/allowed.sock", reason: "Host socket" }] };
    const findings = checkAbsolutePaths(tokens(items), config);
    assert.deepEqual(findings.map((item) => item.line), [1, 2]);
});

test("repository paths reject drive letters and home prefixes", () => {
    for (const value of ["C:/x", "~/x", "/x", "c:"]) {
        assert.throws(() => path(value), value);
    }
    assert.equal(path("src/x.ts"), "src/x.ts");
});

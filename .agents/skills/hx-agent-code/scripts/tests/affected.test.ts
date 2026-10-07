import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGraph, selectTests } from "../core/affected.ts";
import type { Scope } from "../core/model.ts";

function scope(path: string, oldPath?: string): Scope {
    return { mode: "worktree", base: "base", head: "worktree", changes: [{ status: "M", path, oldPath }] };
}

function graph() {
    return parseGraph({
        complete: true,
        inputs: { "web/user.ts": ["api/public.ts"], "api/public.ts": ["api/impl/db.ts"] },
        global: ["shared", "build.json"],
        modules: {
            api: { paths: ["api"], tests: ["api:mock", "api:real"], dependsOn: [], contracts: ["contract/user.yaml"] },
            web: { paths: ["web"], tests: ["web:api", "web:ui"], dependsOn: [], contracts: ["contract/user.yaml"] },
            e2e: { paths: ["e2e"], tests: ["e2e:user"], dependsOn: ["web"], contracts: [] },
            order: { paths: ["order"], tests: ["order:api"], dependsOn: [], contracts: [] },
            docs: { paths: ["docs"], tests: [], dependsOn: [], contracts: [] },
        },
    });
}

test("implementation diff follows reverse dependencies and module closure", () => {
    const result = selectTests(scope("api/impl/db.ts"), graph(), "push");
    assert.equal(result.full, false);
    assert.deepEqual(result.modules, ["api", "e2e", "web"]);
    assert(result.tests.includes("api:real"));
    assert(!result.tests.includes("order:api"));
});

test("contract change selects both ends and deleted/renamed paths are retained", () => {
    assert.deepEqual(selectTests(scope("contract/user.yaml"), graph(), "local").modules, ["api", "e2e", "web"]);
    assert.deepEqual(selectTests(scope("order/new.ts", "api/old.ts"), graph(), "local").modules,
        ["api", "e2e", "order", "web"]);
});

test("unknown/global paths, PR and incomplete graphs select all tests", () => {
    for (const path of ["unknown.ts", "shared/type.ts", "build.json", "api-other/file.ts"]) {
        const result = selectTests(scope(path), graph(), "local");
        assert.equal(result.full, true);
        assert(result.tests.includes("order:api"));
    }
    assert.equal(selectTests(scope("docs/guide.md"), graph(), "pr").full, true);
    const incomplete = graph();
    incomplete.complete = false;
    assert.equal(selectTests(scope("api/a.ts"), incomplete, "push").full, true);
});

test("owned docs may select zero tests but unknown event and broken graphs fail", () => {
    assert.deepEqual(selectTests(scope("docs/a.md"), graph(), "local").tests, []);
    assert.throws(() => selectTests(scope("api/a.ts"), graph(), "pull"));
    const broken = graph();
    broken.modules.api.dependsOn = ["missing"];
    assert.throws(() => parseGraph(broken));
    assert.throws(() => parseGraph({ ...graph(), complete: undefined }));
});

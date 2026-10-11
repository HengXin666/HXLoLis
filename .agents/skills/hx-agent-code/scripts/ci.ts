import { join } from "node:path";
import { runCI } from "./ci/run.ts";
import { REPORTS_DIR } from "./core/constants.ts";
import { saveToolError } from "./core/report.ts";
import { repositoryRoot } from "./core/scope.ts";

const root = repositoryRoot(process.cwd());
try {
    if (process.argv.length !== 3) {
        throw new Error("Usage: node scripts/ci.ts code|docs|build|compatibility|tests");
    }
    process.exitCode = runCI(root, process.argv[2]);
} catch (error) {
    saveToolError(error, join(root, REPORTS_DIR, "ci-error"));
    process.exitCode = 2;
}

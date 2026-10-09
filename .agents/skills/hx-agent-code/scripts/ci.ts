import { runCI } from "./ci/run.ts";
import { saveToolError } from "./core/report.ts";

try {
    if (process.argv.length !== 3) {
        throw new Error("Usage: node scripts/ci.ts code|docs|build|compatibility|tests");
    }
    process.exitCode = runCI(process.cwd(), process.argv[2]);
} catch (error) {
    saveToolError(error, "scripts/.hx_code_quality/reports/ci-error");
    process.exitCode = 2;
}

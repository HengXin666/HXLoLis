import { runCI } from "./ci/run.ts";

try {
    if (process.argv.length !== 3) {
        throw new Error("Usage: node scripts/ci.ts code|docs|build|compatibility|tests");
    }
    process.exitCode = runCI(process.cwd(), process.argv[2]);
} catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 2;
}

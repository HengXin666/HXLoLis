import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseConfig } from "./config.ts";
import type { Config, Task } from "./config.ts";
import { githubScope } from "./context.ts";
import { sealArtifact, verifyArtifact } from "./artifact.ts";
import { trustedBaseline } from "./baseline.ts";
import { parseGraph, selectTests } from "../core/affected.ts";
import { fingerprint, makeReport, parseFindings } from "../core/report.ts";
import type { Baseline, Finding, Scope } from "../core/model.ts";

function failure(id: string, message: string): Finding {
    return {
        ruleId: "HC-CI", severity: "error", path: "scripts/quality/ci.json", line: 1,
        message: id + ": " + message, evidence: "CI runner",
        fingerprint: fingerprint("HC-CI", "scripts/quality/ci.json", id, message),
    };
}

function execute(root: string, task: Task, timeout: number, env: NodeJS.ProcessEnv) {
    const [command, ...args] = task.command;
    return spawnSync(command, args, {
        cwd: root, env, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024, shell: false,
    });
}

export function runTasks(root: string, tasks: Task[], timeout: number, env: NodeJS.ProcessEnv): Finding[] {
    const findings: Finding[] = [];
    for (const task of tasks) {
        const result = execute(root, task, timeout, env);
        if (result.error || result.signal || result.status === null) {
            findings.push(failure(task.id, String(result.error?.message ?? result.signal ?? "No exit status")));
            continue;
        }
        if (task.format === "findings") {
            try {
                const output = parseFindings(JSON.parse(result.stdout));
                findings.push(...output);
                if (result.status !== 0 && !output.some((item) => item.severity === "error")) {
                    findings.push(failure(task.id, "Nonzero exit without an Error finding"));
                }
            } catch {
                findings.push(failure(task.id, "Invalid or missing findings JSON"));
            }
        } else if (result.status !== 0) {
            findings.push(failure(task.id, "Command exited " + result.status));
        }
        if (task.format === "exit" && result.stdout) {
            process.stdout.write(result.stdout);
        }
        if (result.stderr) {
            process.stderr.write(result.stderr);
        }
    }
    return findings;
}

function tests(root: string, config: Config, scope: Scope, event: string, env: NodeJS.ProcessEnv): Task[] {
    const impact = execute(root, config.impact, config.timeoutMs, env);
    if (impact.error || impact.status !== 0) {
        throw new Error("Impact graph command failed");
    }
    const graph = parseGraph(JSON.parse(impact.stdout));
    const registered = new Map(config.tests.map((task) => [task.id, task]));
    const mapped = new Set(Object.values(graph.modules).flatMap((module) => module.tests));
    if ([...registered.keys()].some((id) => !mapped.has(id)) || [...mapped].some((id) => !registered.has(id))) {
        throw new Error("Impact graph and test registry have different test IDs");
    }
    const plan = selectTests(scope, graph, event);
    writeFileSync(join(root, ".hx-quality/reports/test-plan.json"), JSON.stringify(plan, null, 4) + "\n");
    return plan.tests.map((id) => registered.get(id)!);
}

/**
 * Execute independent checks without dropping failures from later tasks
 * .agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md
 */
export function runCI(root: string, group: string): number {
    if (!["code", "docs", "build", "compatibility", "tests"].includes(group)) {
        throw new Error("Unknown CI group: " + group);
    }
    const reports = join(root, ".hx-quality/reports");
    const build = join(root, ".hx-quality/build");
    mkdirSync(reports, { recursive: true });
    const findings: Finding[] = [];
    let notApplicable: string | undefined;
    let baseline: Baseline[] = [];
    try {
        const config = parseConfig(JSON.parse(readFileSync(join(root, "scripts/quality/ci.json"), "utf8")));
        const { scope, event } = githubScope(root);
        baseline = trustedBaseline(root, scope.base);
        const scopePath = join(reports, "scope-" + group + ".json");
        writeFileSync(scopePath, JSON.stringify(scope, null, 4) + "\n");
        const env = { ...process.env, HX_QUALITY_SCOPE: scopePath, HX_QUALITY_BUILD: build };
        findings.push(...runTasks(root, config.setup, config.timeoutMs, env));
        if (findings.some((item) => item.severity === "error")) {
            findings.push(failure(group, "Blocked by dependency setup"));
        } else if (group === "tests") {
            verifyArtifact(build, scope.head);
            findings.push(...runTasks(root, tests(root, config, scope, event, env), config.timeoutMs, env));
        } else {
            const selected = config.groups[group];
            notApplicable = selected.notApplicable;
            if (group === "build") {
                rmSync(build, { recursive: true, force: true });
                mkdirSync(build, { recursive: true });
            }
            findings.push(...runTasks(root, selected.tasks, config.timeoutMs, env));
            if (group === "build" && !findings.some((item) => item.severity === "error")) {
                sealArtifact(build, scope.head, notApplicable);
            }
        }
    } catch (error) {
        findings.push(failure(group, error instanceof Error ? error.message : String(error)));
    }
    const report = makeReport(findings, baseline.filter((item) => item.ruleId !== "HC-CI"));
    writeFileSync(join(reports, group + ".json"), JSON.stringify({ ...report.json, notApplicable }, null, 4) + "\n");
    writeFileSync(join(reports, group + ".md"), report.markdown
        + (notApplicable ? "\nNot applicable: " + notApplicable.replace(/[\r\n]/g, " ") + "\n" : ""));
    return report.exitCode;
}

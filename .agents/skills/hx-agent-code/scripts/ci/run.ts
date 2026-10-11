import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseConfig } from "./config.ts";
import type { Config, Task } from "./config.ts";
import { githubScope } from "./context.ts";
import { sealArtifact, verifyArtifact } from "./artifact.ts";
import { trustedBaseline } from "./baseline.ts";
import { parseGraph, selectTests } from "../core/affected.ts";
import {
    BUILD_DIR, CI_CONFIG, CI_GROUPS, CI_RULE, ERROR, OUTPUT_MAX_BUFFER, REPORTS_DIR, TEST_GROUP, TEST_PLAN, UTF8,
} from "../core/constants.ts";
import { consoleReport, fingerprint, makeReport, parseFindings } from "../core/report.ts";
import type { Baseline, Finding, Scope } from "../core/model.ts";

type FailureKind = "runner" | "task";

function failure(id: string, message: string, kind: FailureKind): Finding {
    const text = "[" + kind + "] " + id + ": " + message;
    return {
        ruleId: CI_RULE, severity: ERROR, path: CI_CONFIG, line: 1,
        message: text, evidence: kind === "runner" ? "CI runner fault" : "Checker task failure",
        fingerprint: fingerprint(CI_RULE, CI_CONFIG, id, text),
    };
}

function hasError(findings: Finding[]): boolean {
    return findings.some((item) => item.severity === ERROR);
}

function json(value: unknown): string {
    return JSON.stringify(value, null, 4) + "\n";
}

function execute(root: string, task: Task, timeout: number, env: NodeJS.ProcessEnv) {
    const [command, ...args] = task.command;
    return spawnSync(command, args, {
        cwd: root, env, encoding: UTF8, timeout, maxBuffer: OUTPUT_MAX_BUFFER, shell: false,
    });
}

export function runTasks(root: string, tasks: Task[], timeout: number, env: NodeJS.ProcessEnv,
    logs = join(root, REPORTS_DIR, "tasks")): Finding[] {
    mkdirSync(logs, { recursive: true });
    const findings: Finding[] = [];
    for (const task of tasks) {
        const result = execute(root, task, timeout, env);
        writeFileSync(join(logs, encodeURIComponent(task.id) + ".json"), json({
            task: task.id, command: task.command, status: result.status, signal: result.signal,
            error: result.error?.message, stdout: result.stdout, stderr: result.stderr,
        }));
        if (result.error || result.signal || result.status === null) {
            const reason = String(result.error?.message ?? result.signal ?? "No exit status");
            findings.push(failure(task.id, reason, "runner"));
            continue;
        }
        if (task.format === "findings") {
            try {
                const output = parseFindings(JSON.parse(result.stdout));
                findings.push(...output);
                if (result.status !== 0 && !hasError(output)) {
                    findings.push(failure(task.id, "Nonzero exit without an Error finding", "task"));
                }
            } catch {
                findings.push(failure(task.id, "Invalid or missing findings JSON", "runner"));
            }
        } else if (result.status !== 0) {
            findings.push(failure(task.id, "Command exited " + result.status, "task"));
        }
    }
    return findings;
}

function tests(root: string, config: Config, scope: Scope, event: string, env: NodeJS.ProcessEnv): Task[] {
    const reports = join(root, REPORTS_DIR);
    const impact = execute(root, config.impact, config.timeoutMs, env);
    writeFileSync(join(reports, "test-impact.json"), json({
        command: config.impact.command, status: impact.status, signal: impact.signal,
        error: impact.error?.message, stdout: impact.stdout, stderr: impact.stderr,
    }));
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
    writeFileSync(join(reports, TEST_PLAN), json(plan));
    return plan.tests.map((id) => registered.get(id)!);
}

function runGroup(root: string, group: string, findings: Finding[]): { baseline: Baseline[]; notApplicable?: string } {
    const reports = join(root, REPORTS_DIR);
    const build = join(root, BUILD_DIR);
    const logs = join(reports, group + "-tasks");
    const config = parseConfig(JSON.parse(readFileSync(join(root, CI_CONFIG), UTF8)));
    const { scope, event } = githubScope(root);
    const baseline = trustedBaseline(root, scope.base);
    const scopePath = join(reports, "scope-" + group + ".json");
    writeFileSync(scopePath, json(scope));
    const env = { ...process.env, HX_QUALITY_SCOPE: scopePath, HX_QUALITY_BUILD: build };
    findings.push(...runTasks(root, config.setup, config.timeoutMs, env, logs));
    if (hasError(findings)) {
        findings.push(failure(group, "Blocked by dependency setup", "runner"));
        return { baseline };
    }
    if (group === TEST_GROUP) {
        verifyArtifact(build, scope.head);
        findings.push(...runTasks(root, tests(root, config, scope, event, env), config.timeoutMs, env, logs));
        return { baseline };
    }
    const selected = config.groups[group];
    if (group === "build") {
        rmSync(build, { recursive: true, force: true });
        mkdirSync(build, { recursive: true });
    }
    findings.push(...runTasks(root, selected.tasks, config.timeoutMs, env, logs));
    if (group === "build" && !hasError(findings)) {
        sealArtifact(build, scope.head, selected.notApplicable);
    }
    return { baseline, notApplicable: selected.notApplicable };
}

/**
 * Execute independent checks without dropping failures from later tasks
 *
 * .agents/notes/implemented/process/2026-10-07-agent-code-installation-contract.md
 */
export function runCI(root: string, group: string): number {
    if (!(CI_GROUPS as readonly string[]).includes(group)) {
        throw new Error("Unknown CI group: " + group);
    }
    const reports = join(root, REPORTS_DIR);
    mkdirSync(reports, { recursive: true });
    rmSync(join(reports, group + "-tasks"), { recursive: true, force: true });
    const findings: Finding[] = [];
    let baseline: Baseline[] = [];
    let notApplicable: string | undefined;
    try {
        ({ baseline, notApplicable } = runGroup(root, group, findings));
    } catch (error) {
        findings.push(failure(group, error instanceof Error ? error.message : String(error), "runner"));
    }
    const report = makeReport(findings, baseline.filter((item) => item.ruleId !== CI_RULE));
    const runnerErrors = findings.filter((item) => item.message.startsWith("[runner]")).length;
    writeFileSync(join(reports, group + ".json"), json({ ...report.json, runnerErrors, notApplicable }));
    writeFileSync(join(reports, group + ".md"), report.markdown
        + (runnerErrors ? "\nRunner faults: " + runnerErrors + "\n" : "")
        + (notApplicable ? "\nNot applicable: " + notApplicable.replace(/[\r\n]/g, " ") + "\n" : ""));
    consoleReport(findings, join(reports, group + ".json"));
    return report.exitCode;
}

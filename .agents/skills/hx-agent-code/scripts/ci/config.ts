import { list, record, string, strings } from "../core/model.ts";

export type Task = { id: string; command: string[]; format: "findings" | "exit" };
export type Group = { tasks: Task[]; notApplicable?: string };
export type Config = {
    setup: Task[];
    groups: Record<string, Group>;
    impact: Task;
    tests: Task[];
    timeoutMs: number;
};

function task(value: unknown): Task {
    const item = record(value);
    const command = strings(item.command);
    if (command.length === 0 || !["findings", "exit"].includes(String(item.format))) {
        throw new Error("Each task needs a command array and findings/exit format");
    }
    return { id: string(item.id), command, format: item.format as Task["format"] };
}

export function parseConfig(value: unknown): Config {
    const data = record(value);
    const groups: Record<string, Group> = Object.create(null);
    for (const id of ["code", "docs", "build", "compatibility"]) {
        const raw = record(record(data.groups)[id]);
        const tasks = list(raw.tasks).map(task);
        const notApplicable = raw.notApplicable === undefined ? undefined : string(raw.notApplicable);
        if ((!tasks.length && !notApplicable) || (tasks.length && notApplicable)) {
            throw new Error(id + " requires tasks or an explicit notApplicable reason");
        }
        if (["code", "docs"].includes(id) && notApplicable) {
            throw new Error(id + " cannot be disabled");
        }
        groups[id] = { tasks, notApplicable };
    }
    const setup = list(data.setup).map(task);
    const tests = list(data.tests).map(task);
    const all = [...setup, ...Object.values(groups).flatMap((group) => group.tasks), ...tests];
    const ids = all.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
        throw new Error("Task IDs must be unique across groups");
    }
    const timeoutMs = Number(data.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) {
        throw new Error("timeoutMs must be an integer from 1 to 3600000");
    }
    return { setup, groups, tests, impact: task(data.impact), timeoutMs };
}

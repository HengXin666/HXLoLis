import { list, path, record, sorted, strings } from "./model.ts";
import type { Graph, Module, Plan, Scope } from "./model.ts";

export function parseGraph(value: unknown): Graph {
    const raw = record(value);
    if (typeof raw.complete !== "boolean") {
        throw new Error("Graph completeness must be explicit");
    }
    const modules: Record<string, Module> = Object.create(null);
    for (const [id, value] of Object.entries(record(raw.modules))) {
        const item = record(value);
        modules[id] = {
            paths: list(item.paths).map(path), tests: strings(item.tests),
            dependsOn: strings(item.dependsOn), contracts: list(item.contracts).map(path),
        };
        if (!id || modules[id].paths.length === 0) {
            throw new Error("Each module requires an ID and at least one owned path");
        }
    }
    for (const module of Object.values(modules)) {
        if (module.dependsOn.some((id) => !Object.hasOwn(modules, id))) {
            throw new Error("Unknown module dependency");
        }
    }
    const inputs: Record<string, string[]> = Object.create(null);
    for (const [file, imports] of Object.entries(record(raw.inputs))) {
        inputs[path(file)] = list(imports).map(path);
    }
    return { complete: raw.complete, modules, inputs, global: list(raw.global).map(path) };
}

function within(file: string, prefix: string): boolean {
    return file === prefix || file.startsWith(prefix + "/");
}

export function selectTests(scope: Scope, graph: Graph, event: string): Plan {
    if (!["local", "push", "pr"].includes(event)) {
        throw new Error("Unknown test event: " + event);
    }
    const reasons = new Set<string>();
    const files = new Set(scope.changes.flatMap((change) => {
        return change.oldPath ? [change.path, change.oldPath] : [change.path];
    }));
    let full = event === "pr" || !graph.complete;
    if (event === "pr") {
        reasons.add("PR requires all tests");
    }
    if (!graph.complete) {
        reasons.add("Incomplete dependency graph");
    }
    for (let previous = -1; previous !== files.size;) {
        previous = files.size;
        for (const [file, imports] of Object.entries(graph.inputs)) {
            if (imports.some((dependency) => files.has(dependency))) {
                files.add(file);
            }
        }
    }
    const selected = new Set<string>();
    for (const file of files) {
        if (graph.global.some((prefix) => within(file, prefix))) {
            full = true;
            reasons.add("Global dependency: " + file);
        }
        let mapped = false;
        for (const [id, module] of Object.entries(graph.modules)) {
            if ([...module.paths, ...module.contracts].some((prefix) => within(file, prefix))) {
                mapped = true;
                selected.add(id);
                reasons.add("Affected module: " + id);
            }
        }
        if (!mapped) {
            full = true;
            reasons.add("Unmapped path: " + file);
        }
    }
    for (let previous = -1; previous !== selected.size;) {
        previous = selected.size;
        const contracts = new Set([...selected].flatMap((id) => graph.modules[id].contracts));
        for (const [id, module] of Object.entries(graph.modules)) {
            if (module.dependsOn.some((id) => selected.has(id)) || module.contracts.some((p) => contracts.has(p))) {
                selected.add(id);
            }
        }
    }
    const modules = full ? Object.keys(graph.modules).sort() : sorted(selected);
    const tests = sorted(modules.flatMap((id) => graph.modules[id].tests));
    return { full, modules, tests, reasons: sorted(reasons) };
}

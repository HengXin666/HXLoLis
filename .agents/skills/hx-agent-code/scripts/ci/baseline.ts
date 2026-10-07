import { execFileSync } from "node:child_process";
import { parseBaseline } from "../core/report.ts";
import type { Baseline } from "../core/model.ts";

export function trustedBaseline(root: string, tree: string): Baseline[] {
    const path = "scripts/quality/baseline.json";
    const options = { encoding: "utf8" as const, maxBuffer: 16 * 1024 * 1024 };
    const exists = execFileSync("git", ["-C", root, "ls-tree", tree, "--", path], options).trim();
    if (!exists) {
        return [];
    }
    const text = execFileSync("git", ["-C", root, "show", tree + ":" + path], options);
    return parseBaseline(JSON.parse(text));
}

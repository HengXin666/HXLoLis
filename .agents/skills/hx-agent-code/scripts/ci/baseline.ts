import { BASELINE_FILE } from "../core/constants.ts";
import { parseBaseline } from "../core/report.ts";
import { git } from "../core/scope.ts";
import type { Baseline } from "../core/model.ts";

export function trustedBaseline(root: string, tree: string): Baseline[] {
    if (!git(root, ["ls-tree", tree, "--", BASELINE_FILE]).trim()) {
        return [];
    }
    return parseBaseline(JSON.parse(git(root, ["show", tree + ":" + BASELINE_FILE])));
}

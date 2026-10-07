import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { record, string } from "../core/model.ts";

function files(directory: string, prefix = ""): Record<string, string> {
    const result: Record<string, string> = {};
    for (const name of readdirSync(directory).sort()) {
        if (!prefix && name === "quality-artifact.json") {
            continue;
        }
        const file = join(directory, name);
        const stat = lstatSync(file);
        if (stat.isSymbolicLink()) {
            throw new Error("Build artifacts must not contain symlinks");
        }
        if (stat.isDirectory()) {
            Object.assign(result, files(file, prefix + name + "/"));
        } else if (stat.isFile()) {
            result[prefix + name] = createHash("sha256").update(readFileSync(file)).digest("hex");
        } else {
            throw new Error("Unsupported artifact entry: " + file);
        }
    }
    return result;
}

export function sealArtifact(directory: string, head: string, notApplicable?: string): void {
    const hashes = files(directory);
    if (Object.keys(hashes).length === 0 && !notApplicable) {
        throw new Error("Build succeeded without producing any files");
    }
    writeFileSync(join(directory, "quality-artifact.json"), JSON.stringify({ head, hashes, notApplicable }));
}

export function verifyArtifact(directory: string, head: string): void {
    const manifest = record(JSON.parse(readFileSync(join(directory, "quality-artifact.json"), "utf8")));
    if (string(manifest.head) !== head) {
        throw new Error("Build artifact belongs to another source tree");
    }
    const expected = record(manifest.hashes);
    const actual = files(directory);
    if (Object.keys(expected).length !== Object.keys(actual).length
        || Object.entries(expected).some(([path, hash]) => actual[path] !== hash)) {
        throw new Error("Build artifact contents do not match their manifest");
    }
    if (Object.keys(actual).length === 0) {
        string(manifest.notApplicable);
    }
}

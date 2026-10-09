import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function fixture() {
    const root = mkdtempSync(join(tmpdir(), "hc-ci-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    const write = (path: string, text: string) => writeFileSync(join(root, path), text);
    const json = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));
    git("init", "-q");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Quality fixture");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", "/dev/null");
    mkdirSync(join(root, "scripts/quality"), { recursive: true });
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "docs"));
    const example = fileURLToPath(new URL("../../assets/example/", import.meta.url));
    cpSync(join(example, "task.ts"), join(root, "scripts/quality/task.ts"));
    cpSync(join(example, "ci.json"), join(root, "scripts/quality/ci.json"));
    write("src/value.txt", "ready\n");
    write("docs/guide.md", "# Guide\n");
    write(".gitignore", "scripts/.hx_code_quality/\nevent.json\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    const before = { event: process.env.GITHUB_EVENT_NAME, path: process.env.GITHUB_EVENT_PATH };
    const push = () => {
        git("add", "-A");
        git("commit", "--allow-empty", "-qm", "change");
        const head = git("rev-parse", "HEAD");
        write("event.json", JSON.stringify({ before: base, after: head }));
        process.env.GITHUB_EVENT_NAME = "push";
        process.env.GITHUB_EVENT_PATH = join(root, "event.json");
        return head;
    };
    const cleanup = () => {
        if (before.event === undefined) {
            delete process.env.GITHUB_EVENT_NAME;
        } else {
            process.env.GITHUB_EVENT_NAME = before.event;
        }
        if (before.path === undefined) {
            delete process.env.GITHUB_EVENT_PATH;
        } else {
            process.env.GITHUB_EVENT_PATH = before.path;
        }
        rmSync(root, { recursive: true, force: true });
    };
    return { root, git, write, json, push, cleanup, base };
}

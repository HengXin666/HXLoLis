#!/usr/bin/env node
/**
 * 前后端契约门禁: 保证「类型定义」与「实现」不会各走各的.
 * 判据: 契约文件成对 (shared/contract-<域>.ts 的通道在 api 层与 server 层都被引用);
 *       前端不得手写通道字符串, 必须 import 契约常量; 响应类型必须带运行时校验.
 * 用法: node scripts/check-contract.ts [项目根]   (默认 .)
 */
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";
const abs = path.resolve(root);
const SKIP = new Set(["node_modules", "dist", "build", ".git", ".next"]);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const errors = [];
const warns = [];
const rel = (p) => path.relative(abs, p) || p;

// ── 1. 契约文件成对 ──
const contractDir = path.join(abs, "shared");
const contracts = fs.existsSync(contractDir)
  ? fs.readdirSync(contractDir).filter((f) => /^contract-.*\.ts$/.test(f))
  : [];

if (contracts.length === 0) {
  warns.push({
    rule: "no-contract-file",
    msg: "没找到 shared/contract-*.ts。前后端共用的通道名与载荷类型必须有一个共享定义处, 否则两边各写一份必然漂移。",
  });
}

for (const f of contracts) {
  const src = fs.readFileSync(path.join(contractDir, f), "utf8");
  const domain = f.replace(/^contract-|\.ts$/g, "");
  // 该契约应被前端与后端同时引用
  const usedBy = [];
  for (const file of walk(abs)) {
    if (path.dirname(file) === contractDir) continue;
    const s = fs.readFileSync(file, "utf8");
    if (new RegExp(`from ["'][^"']*contract-${domain}`).test(s)) usedBy.push(file);
  }
  const hasClient = usedBy.some((p) => /(^|\/)(src\/)?(api|client|renderer)/.test(rel(p)));
  const hasServer = usedBy.some((p) => /(^|\/)(server|api\/routes|routes)/.test(rel(p)));
  if (!hasClient) errors.push({ rule: "contract-unused-client", msg: `${f} 没有被前端引用。契约只有两边都用才有意义。` });
  if (!hasServer) errors.push({ rule: "contract-unused-server", msg: `${f} 没有被后端引用。契约只有两边都用才有意义。` });
}

// ── 2. 前端不得手写通道字符串 ──
const CHANNEL_LITERAL = /["'`][a-z][a-z0-9-]*:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*["'`]/;
for (const file of walk(path.join(abs, "src"))) {
  const r = rel(file);
  if (r.includes("shared/")) continue;          // 契约文件自身允许
  for (const { text, line } of fs.readFileSync(file, "utf8").split("\n").map((t, i) => ({ text: t, line: i + 1 }))) {
    if (CHANNEL_LITERAL.test(text) && !/import/.test(text)) {
      errors.push({
        rule: "handwritten-channel",
        msg: `${r}:${line} 手写了通道字符串。必须 import shared/contract-*.ts 的常量  手写时改一处漏一处, 且编译期发现不了。`,
      });
    }
  }
}

// ── 3. 响应类型必须有运行时校验 ──
const apiDir = path.join(abs, "src", "api");
if (fs.existsSync(apiDir)) {
  for (const file of walk(apiDir)) {
    const src = fs.readFileSync(file, "utf8");
    const hasFetch = /\b(?:fetch|axios|request)\s*\(/.test(src);
    const hasGuard = /\b(?:z\.|zod|parse|safeParse|is[A-Z]\w*\(|assert\w*\()/.test(src);
    if (hasFetch && !hasGuard) {
      warns.push({
        rule: "no-runtime-validation",
        msg: `${rel(file)} 调了后端接口但没有运行时校验。TS 类型在运行期不存在, 后端字段改名时不会报错  用 zod 或手写 guard 收一遍。`,
      });
    }
  }
}

const fmt = (l) => l.map((e) => `  ✗ ${e.rule}\n      ${e.msg}`).join("\n");
if (errors.length) console.error("ERROR (" + errors.length + "):\n" + fmt(errors));
if (warns.length) console.warn("\nWARN (" + warns.length + "):\n" + fmt(warns));
if (!errors.length && !warns.length) console.log("contract: 通过 (" + abs + ")");
else console.log("\n合计 " + errors.length + " 错误, " + warns.length + " 警告");
process.exit(errors.length ? 1 : 0);

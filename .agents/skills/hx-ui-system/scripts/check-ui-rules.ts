#!/usr/bin/env node
/**
 * 界面规范门禁: 机械检查, 会失败, 不是文字规范.
 * 判据来自 open-vetta 的 DESIGN.md §9 lint checklist, 逐条可机械验证.
 * 用法: node scripts/check-ui-rules.ts [扫描目录...]   (默认 src)
 * 退出码: 0 通过, 1 有 ERROR, 2 用法错误
 */
import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) roots.push("src");

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".next", "coverage"]);

/** 收集文件。 */
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (SOURCE_EXT.has(path.extname(e.name))) acc.push(full);
  }
  return acc;
}

/** 去掉注释与字符串? 不去  注释里出现 hex 也常常是要清理的残留。 */
function lines(file) {
  return fs.readFileSync(file, "utf8").split("\n").map((text, i) => ({ text, line: i + 1 }));
}

const errors = [];
const warns = [];
const report = (level, file, line, rule, msg) => {
  const item = { file, line, rule, msg };
  (level === "E" ? errors : warns).push(item);
};

/**
 * 规则表。每条给出: 匹配什么、为什么禁止、怎么改。
 * 判据对应 open-vetta DESIGN.md 的 §1 / §2 / §3 / §5 / §8。
 */
const RULES = [
  {
    id: "no-hex-color",
    level: "E",
    /** 硬编色值。允许 CSS 自定义属性的定义处 (那是 token 的唯一来源)。 */
    test: (t) => /#[0-9a-fA-F]{3,8}\b/.test(t) && !/--[\w-]+\s*:/.test(t),
    msg: "硬编色值。改用语义 token (bg-card / text-muted-foreground / var(--primary)), 透明混合用 color-mix(in srgb, var(--primary) 10%, transparent)。",
    ext: new Set([".ts", ".tsx", ".js", ".jsx"]),
  },
  {
    id: "no-rgb-hsl-literal",
    level: "E",
    test: (t) => /\b(?:rgb|hsl)a?\(/.test(t) && !/color-mix/.test(t) && !/--[\w-]+\s*:/.test(t),
    msg: "硬编 rgb()/hsl()。同上, 走 token。",
    ext: new Set([".ts", ".tsx", ".js", ".jsx"]),
  },
  {
    id: "no-default-palette",
    level: "E",
    /** Tailwind 默认调色盘。白名单只放 emerald / amber 两种语义色 (对应规范 §1.3)。 */
    test: (t) =>
      /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|yellow|lime|green|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(t),
    msg: "用了 Tailwind 默认调色盘。语义色走 token; 只允许 emerald (成功/运行)、amber (警告/可更新) 两种原色, 错误用 destructive token。",
    ext: new Set([".ts", ".tsx", ".js", ".jsx"]),
  },
  {
    id: "thick-lines",
    level: "E",
    test: (t) => /\b(?:border|ring|outline|divide)-[248]\b/.test(t) || /\b(?:border|ring|outline)-\[\d+px\]/.test(t),
    msg: "线条超过 1px。全局约定线条统一 1px; 想加重分隔就改颜色深度 (border-border/40 -> border-border), 不要加粗。",
    ext: new Set([".ts", ".tsx", ".js", ".jsx", ".css"]),
  },
  {
    id: "big-radius",
    level: "E",
    test: (t) => /\brounded-(?:3xl|\[\d+px\]|\[\d+rem\])/.test(t),
    msg: "圆角超出允许档位。只允许 rounded-md / lg / xl / full, 以及唯一的 rounded-2xl。",
    ext: new Set([".ts", ".tsx", ".js", ".jsx"]),
  },
  {
    id: "transition-all",
    level: "E",
    test: (t) => /\btransition-all\b/.test(t),
    msg: "禁止 transition-all。它会把没预料到的属性一起拉长, 是廉价动画感的主要来源。写具体属性: transition-colors / transition-transform / transition-[border-color,background-color]。",
    ext: new Set([".ts", ".tsx", ".js", ".jsx"]),
  },
  {
    id: "shadow-arbitrary",
    level: "E",
    test: (t) => /\bshadow-\[/.test(t),
    msg: "自定义阴影任意值。阴影是白名单制: 只有 popover/dropdown/dialog 用 shadow-md|lg, 拖拽元素用 shadow-lg, 普通卡片一律无阴影。",
    ext: new Set([".ts", ".tsx", ".js", ".jsx"]),
  },
  {
    id: "raw-button",
    level: "W",
    /** 手写 <button> 一般说明绕过了 Button 组件。允许 asChild 场景与 ToolCall 这类原语内部。 */
    test: (t) => /<button\b/.test(t) && !/<Button\b/.test(t),
    msg: "手写 <button>。优先用共享 <Button> + variant; 需要微调只传 className, 不要自拼一整套视觉。",
    ext: new Set([".tsx"]),
  },
];

for (const root of roots) {
  for (const file of walk(root)) {
    const ext = path.extname(file);
    for (const { text, line } of lines(file)) {
      // 跳过纯注释行里的说明性内容? 不跳过  注释里的违规样式同样是残留。
      for (const rule of RULES) {
        if (rule.ext && !rule.ext.has(ext)) continue;
        if (rule.test(text)) report(rule.level, file, line, rule.id, rule.msg);
      }
    }
  }
}

// ── 契约层检查: 前端不得绕过 api 层直接拼 URL ──
const API_FETCH = /\bfetch\s*\(\s*["'`]\//;
for (const root of roots) {
  for (const file of walk(root)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    for (const { text, line } of lines(file)) {
      if (API_FETCH.test(text)) {
        report("E", file, line, "no-raw-fetch",
          "组件里直接 fetch 相对路径。所有后端调用必须走 src/api/ 的封装层, 否则前面的错误处理、鉴权、类型都对不上。");
      }
    }
  }
}

// ── 输出 ──
const fmt = (list) => list.map((e) => `  ${e.level === "E" ? "✗" : "!"} ${e.rule}  ${e.file}:${e.line}\n      ${e.msg}`).join("\n");

if (errors.length) {
  console.error("ERROR (" + errors.length + "):\n" + fmt(errors));
}
if (warns.length) {
  console.warn("\nWARN (" + warns.length + "):\n" + fmt(warns));
}
if (!errors.length && !warns.length) {
  console.log("ui-rules: 通过 (" + roots.join(", ") + ")");
} else {
  console.log("\n合计 " + errors.length + " 错误, " + warns.length + " 警告");
}
process.exit(errors.length ? 1 : 0);

#!/usr/bin/env node
// LoC analyser for BeThere. Counts lines across the monorepo, split by
// area (api / mobile / shared / infra / docs / root) and by kind
// (source vs test vs config vs docs/assets), with a code/blank/comment
// breakdown per language.
//
// Source of truth is `git ls-files`, so anything gitignored (node_modules,
// build output, .expo) is excluded for free, and untracked scratch files
// do not pollute the numbers.
//
// Usage:
//   node scripts/loc.mjs            # the report
//   node scripts/loc.mjs --all      # include archive/ (excluded by default)
//   node scripts/loc.mjs --by-ext   # add a per-extension breakdown
//   node scripts/loc.mjs --json     # machine-readable, no colour
//   node scripts/loc.mjs --no-color # plain text

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = process.cwd();
const argv = new Set(process.argv.slice(2));
const OPT = {
  all: argv.has("--all"),
  byExt: argv.has("--by-ext"),
  json: argv.has("--json"),
  noColor: argv.has("--no-color") || argv.has("--json") || !process.stdout.isTTY,
};

// ---- palette -------------------------------------------------------------
const C = (code) => (s) => (OPT.noColor ? String(s) : `\x1b[${code}m${s}\x1b[0m`);
const dim = C("2");
const bold = C("1");
const cyan = C("36");
const green = C("32");
const yellow = C("33");
const magenta = C("35");
const blue = C("34");
const red = C("31");

// ---- classification ------------------------------------------------------
// Languages we count as "code" lines, with their comment syntax.
const LANG = {
  ".ts": { name: "TypeScript", line: "//", block: ["/*", "*/"] },
  ".tsx": { name: "TSX", line: "//", block: ["/*", "*/"] },
  ".js": { name: "JavaScript", line: "//", block: ["/*", "*/"] },
  ".mjs": { name: "JavaScript", line: "//", block: ["/*", "*/"] },
  ".cjs": { name: "JavaScript", line: "//", block: ["/*", "*/"] },
  ".sql": { name: "SQL", line: "--", block: ["/*", "*/"] },
  ".sh": { name: "Shell", line: "#", block: null },
  ".yml": { name: "YAML", line: "#", block: null },
  ".yaml": { name: "YAML", line: "#", block: null },
  ".json": { name: "JSON", line: null, block: null },
  ".md": { name: "Markdown", line: null, block: null },
  ".html": { name: "HTML", line: null, block: ["<!--", "-->"] },
};

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".sql", ".sh"]);
const DOC_EXT = new Set([".md", ".txt"]);
const ASSET_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico"]);

// Map a repo-relative path to a top-level area.
function areaOf(path) {
  if (path.startsWith("apps/api/")) return "api";
  if (path.startsWith("apps/mobile/")) return "mobile";
  if (path.startsWith("packages/shared/")) return "shared";
  if (path.startsWith("archive/")) return "archive";
  if (path.startsWith("docs/")) return "docs";
  if (path.startsWith("infra/") || path.startsWith("scripts/")) return "infra";
  return "root";
}

const isTest = (p) => /(\.test\.|\.spec\.|__tests__\/|\/test\/|\/__mocks__\/)/.test(p);

// Bucket a file into one of the report's "kind" rows.
function kindOf(path, ext) {
  if (ASSET_EXT.has(ext)) return "asset";
  if (DOC_EXT.has(ext)) return "docs";
  if (CODE_EXT.has(ext)) return isTest(path) ? "test" : "source";
  return "config"; // json / yml / env / dotfiles / etc.
}

// ---- line counting -------------------------------------------------------
// Heuristic code/blank/comment split. Not a full parser (no string-aware
// scanning), but plenty accurate for a project dashboard.
function countLines(abs, ext) {
  const lang = LANG[ext] ?? { line: null, block: null };
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return { total: 0, code: 0, blank: 0, comment: 0 };
  }
  if (text.length === 0) return { total: 0, code: 0, blank: 0, comment: 0 };

  const lines = text.split("\n");
  // A trailing newline yields a phantom empty final element - drop it.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  let code = 0;
  let blank = 0;
  let comment = 0;
  let inBlock = false;
  const [bOpen, bClose] = lang.block ?? [null, null];

  for (const raw of lines) {
    const t = raw.trim();
    if (t === "") {
      blank++;
      continue;
    }
    if (inBlock) {
      comment++;
      if (bClose && t.includes(bClose)) inBlock = false;
      continue;
    }
    if (bOpen && t.startsWith(bOpen)) {
      comment++;
      if (!t.includes(bClose) || t.indexOf(bClose) < t.indexOf(bOpen)) inBlock = true;
      continue;
    }
    if (lang.line && t.startsWith(lang.line)) {
      comment++;
      continue;
    }
    code++;
  }
  return { total: lines.length, code, blank, comment };
}

// ---- gather --------------------------------------------------------------
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((p) => OPT.all || !p.startsWith("archive/"));

const blank = () => ({ files: 0, total: 0, code: 0, blank: 0, comment: 0 });
const add = (acc, n) => {
  acc.files += 1;
  acc.total += n.total;
  acc.code += n.code;
  acc.blank += n.blank;
  acc.comment += n.comment;
};

const areas = {}; // area -> kind -> stats
const byExt = {}; // ext -> stats
const grand = blank();
const codeOnly = blank(); // source + test only, the "real" LoC

for (const path of tracked) {
  const ext = extname(path).toLowerCase();
  const abs = join(ROOT, path);
  let st;
  try {
    st = statSync(abs);
  } catch {
    continue; // tracked but missing (e.g. submodule placeholder)
  }
  if (!st.isFile()) continue;

  const area = areaOf(path);
  const kind = kindOf(path, ext);
  // Binary assets have no meaningful line count - tally the file, skip lines.
  const n = ASSET_EXT.has(ext) ? { total: 0, code: 0, blank: 0, comment: 0 } : countLines(abs, ext);

  areas[area] ??= {};
  areas[area][kind] ??= blank();
  add(areas[area][kind], n);

  byExt[ext || "(none)"] ??= blank();
  add(byExt[ext || "(none)"], n);

  add(grand, n);
  if (kind === "source" || kind === "test") add(codeOnly, n);
}

// ---- json out ------------------------------------------------------------
if (OPT.json) {
  console.log(JSON.stringify({ areas, byExt, grand, codeOnly }, null, 2));
  process.exit(0);
}

// ---- rendering helpers ---------------------------------------------------
const AREA_ORDER = ["api", "mobile", "shared", "infra", "docs", "root", "archive"];
const num = (x) => x.toLocaleString("en-US");
const pad = (s, w) => String(s).padStart(w);
const padr = (s, w) => String(s).padEnd(w);

function bar(value, max, width = 24) {
  if (max <= 0) return "";
  const filled = Math.round((value / max) * width);
  return "█".repeat(filled) + dim("·".repeat(width - filled));
}

function pct(part, whole) {
  if (whole <= 0) return "0.0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

const line = (ch = "─", w = 72) => dim(ch.repeat(w));

// ---- report --------------------------------------------------------------
console.log("");
console.log(bold(cyan("  BeThere · Lines of Code")));
console.log(
  dim(`  tracked files via git ls-files${OPT.all ? "" : "  ·  archive/ excluded (use --all)"}`),
);
console.log("");

// 1) Code LoC by area (source vs test), the headline.
console.log(bold("  ▍Code by area") + dim("   (source + test, .ts/.tsx/.js/.sql/.sh)"));
console.log("");
const areaCodeTotals = AREA_ORDER.map((a) => {
  const k = areas[a] ?? {};
  const src = k.source ?? blank();
  const tst = k.test ?? blank();
  return { area: a, src: src.code, test: tst.code, total: src.code + tst.code };
}).filter((r) => r.total > 0);
const maxAreaCode = Math.max(...areaCodeTotals.map((r) => r.total), 1);

console.log(
  dim(
    `    ${padr("area", 9)}${pad("source", 9)}${pad("test", 8)}${pad("total", 9)}  ${padr("test%", 7)}`,
  ),
);
for (const r of areaCodeTotals) {
  console.log(
    `    ${cyan(padr(r.area, 9))}${green(pad(num(r.src), 9))}${yellow(pad(num(r.test), 8))}${bold(pad(num(r.total), 9))}  ${dim(padr(pct(r.test, r.total), 7))} ${bar(r.total, maxAreaCode)}`,
  );
}
const totSrc = areaCodeTotals.reduce((s, r) => s + r.src, 0);
const totTest = areaCodeTotals.reduce((s, r) => s + r.test, 0);
console.log(line());
console.log(
  `    ${bold(padr("ALL", 9))}${green(pad(num(totSrc), 9))}${yellow(pad(num(totTest), 8))}${bold(pad(num(totSrc + totTest), 9))}  ${dim(padr(pct(totTest, totSrc + totTest), 7))}`,
);
console.log("");

// 2) Source code internals: code / comment / blank, with a ratio.
console.log(bold("  ▍Source composition") + dim("   (non-test code files)"));
console.log("");
let sCode = 0;
let sComment = 0;
let sBlank = 0;
let sFiles = 0;
for (const a of AREA_ORDER) {
  const s = areas[a]?.source;
  if (!s) continue;
  sCode += s.code;
  sComment += s.comment;
  sBlank += s.blank;
  sFiles += s.files;
}
const sTotal = sCode + sComment + sBlank || 1;
const compRow = (label, val, colour) =>
  console.log(
    `    ${padr(label, 9)}${pad(num(val), 9)}  ${dim(padr(pct(val, sTotal), 7))} ${colour(bar(val, sTotal, 30))}`,
  );
compRow("code", sCode, green);
compRow("comments", sComment, blue);
compRow("blank", sBlank, dim);
console.log(line());
console.log(
  dim(`    ${sFiles} files · comment-to-code ratio `) +
    bold(`${(sComment / (sCode || 1)).toFixed(2)}`),
);
console.log("");

// 3) Test investment: test LoC vs source LoC per code area.
console.log(bold("  ▍Test coverage signal") + dim("   (test LoC ÷ source LoC)"));
console.log("");
for (const a of ["api", "mobile", "shared"]) {
  const src = areas[a]?.source?.code ?? 0;
  const tst = areas[a]?.test?.code ?? 0;
  if (src + tst === 0) continue;
  const ratio = src > 0 ? tst / src : 0;
  const flag = ratio >= 0.5 ? green("●") : ratio >= 0.2 ? yellow("●") : red("●");
  console.log(
    `    ${flag} ${cyan(padr(a, 9))}${dim("ratio ")}${bold(pad(ratio.toFixed(2), 5))}  ${dim(`${num(tst)} test / ${num(src)} src`)}`,
  );
}
console.log("");

// 4) Optional per-extension breakdown.
if (OPT.byExt) {
  console.log(bold("  ▍By file type") + dim("   (total lines, all kinds)"));
  console.log("");
  const rows = Object.entries(byExt)
    .map(([ext, s]) => ({ ext, ...s }))
    .sort((a, b) => b.total - a.total);
  const maxExt = Math.max(...rows.map((r) => r.total), 1);
  for (const r of rows) {
    console.log(
      `    ${magenta(padr(r.ext, 8))}${pad(num(r.total), 9)} ${dim(`(${r.files}f)`)}  ${bar(r.total, maxExt, 28)}`,
    );
  }
  console.log("");
}

// 5) Grand total footer.
const realLoc = codeOnly.code;
console.log(line("═"));
console.log(
  `  ${bold("TOTAL")}  ${bold(green(num(realLoc)))} ${dim("lines of code")}  ` +
    dim(`(${num(grand.total)} lines across ${num(grand.files)} tracked files)`),
);
console.log("");

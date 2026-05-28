#!/usr/bin/env node
// Fails if any code-quality escape hatch is present. These suppress the
// type checker or linter and hide real problems, so they are banned outright.
// Biome's lint separately handles explicit `any`, unused vars, etc.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SELF = fileURLToPath(import.meta.url);

const SCAN_DIRS = ["apps", "packages", "scripts"];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".expo",
  ".git",
  "android",
  "ios",
  "migrations",
]);

const BANNED = [
  { name: "as any cast", re: /\bas\s+any\b/ },
  { name: "@ts-ignore", re: /@ts-ignore\b/ },
  { name: "@ts-nocheck", re: /@ts-nocheck\b/ },
  { name: "@ts-expect-error", re: /@ts-expect-error\b/ },
  { name: "eslint-disable", re: /eslint-disable(?:-next-line|-line)?\b/ },
  { name: "biome-ignore", re: /biome-ignore\b/ },
];

const violations = [];

function scanFile(file) {
  if (file === SELF) return; // never flag this checker itself
  if (basename(file) === ".eslintignore") {
    violations.push({ file: relative(ROOT, file), line: 0, name: ".eslintignore file" });
    return;
  }
  if (!CODE_EXT.has(extname(file))) return;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((text, i) => {
    for (const { name, re } of BANNED) {
      if (re.test(text)) {
        violations.push({ file: relative(ROOT, file), line: i + 1, name });
      }
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      scanFile(join(dir, entry.name));
    }
  }
}

for (const dir of SCAN_DIRS) {
  const full = join(ROOT, dir);
  try {
    if (statSync(full).isDirectory()) walk(full);
  } catch {
    // directory absent - skip
  }
}

// A stray .eslintignore at the repo root would be outside the scanned dirs.
try {
  statSync(join(ROOT, ".eslintignore"));
  violations.push({ file: ".eslintignore", line: 0, name: ".eslintignore file" });
} catch {
  // none - good
}

if (violations.length > 0) {
  console.error(`\n✖ quality check failed - ${violations.length} banned pattern(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}${v.line ? `:${v.line}` : ""}  →  ${v.name}`);
  }
  console.error("\nThese escape hatches are not allowed. Fix the underlying issue instead.\n");
  process.exit(1);
}

console.log("✓ quality check passed - no banned patterns found.");

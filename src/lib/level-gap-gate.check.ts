// Grep gate — invariant 2, mechanized. Every view that shows a *measured* level
// value (reads `levelEstimate.label` or `levelEstimate.value`) must also mention
// `levelGapNote`: that is the one sentence that makes two different level values
// legal on one screen. A `.tsx` that puts a measured band on screen without it has
// no way to explain a disagreement with the declared level, so the gate fails loudly.
// Reading only `levelEstimate.sampleSize` (the "not yet measured" state) shows no
// measured value at all, so it is out of scope — that is invariant 26, not 2.
// Run: node --experimental-strip-types src/lib/level-gap-gate.check.ts
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root derived from this file's own location (src/lib/level-gap-gate.check.ts).
const ROOT = new URL("../../", import.meta.url);
const SRC = fileURLToPath(new URL("src", ROOT));

function isExcluded(p: string): boolean {
  // *.check.ts — the gate's own file and every sibling check are tests, not UI.
  return p.endsWith(".check.ts");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && (extname(p) === ".ts" || extname(p) === ".tsx")) out.push(p);
  }
  return out;
}

/** Crude comment stripper: keeps newlines so line numbers survive the strip. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/\/\/[^\n]*/g, "");
}

const files = walk(SRC).filter((p) => p.endsWith(".tsx"));
assert(files.length > 0, "the gate walked no .tsx files — a silent green is a lie");

const offenders: string[] = [];
for (const f of files) {
  if (isExcluded(f)) continue;
  const src = stripComments(readFileSync(f, "utf8"));
  const showsMeasured = /levelEstimate\.(label|value)/.test(src);
  if (showsMeasured && !src.includes("levelGapNote")) {
    offenders.push(f);
  }
}
if (offenders.length > 0) {
  assert.fail(
    "views showing a measured level must also mention levelGapNote (invariant 2):\n" + offenders.join("\n"),
  );
}

console.log("level-gap-gate.check OK");

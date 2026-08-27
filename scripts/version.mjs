// The version lives in three files and the updater compares it. A release that
// bumps two of the three ships an app that either never offers an update or
// offers one it already is — a bug with reach, since it lands on installed
// copies rather than waiting to be downloaded.
//
// Usage: node scripts/version.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// Cargo's own version is the first `version = "..."` at the start of a line:
// every dependency writes its version inside braces, never in column zero.
const cargo = read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m);

const found = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "src-tauri/Cargo.toml": cargo?.[1],
};

const versions = new Set(Object.values(found));

if (versions.size !== 1 || versions.has(undefined)) {
  console.error("version: the three files disagree");
  for (const [file, version] of Object.entries(found)) {
    console.error(`  ${version ?? "(not found)"}\t${file}`);
  }
  process.exit(1);
}

console.log(`✓ version ${[...versions][0]} in all three files`);

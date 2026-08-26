// Runs every *.check.ts under src/, each in its own OS process, and reports a
// summary. Exits 1 if any file fails — or if no check files are found at all
// (a runner that silently finds nothing lies green).
//
// Each file must run in its own process: settings.check.ts sets
// globalThis.localStorage, and importing everything into a single process
// would leak that setup into every other check file.
//
// Usage: node scripts/check.mjs
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Resolve everything relative to the repo root, not process.cwd() — the runner
// lives at scripts/check.mjs, so the root is one level up.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const srcDir = path.join(repoRoot, "src");

const checkFiles = readdirSync(srcDir, { recursive: true })
  .filter((entry) => typeof entry === "string" && entry.endsWith(".check.ts"))
  .sort();

if (checkFiles.length === 0) {
  console.error("check: no *.check.ts files found under src/ — refusing to report success");
  process.exit(1);
}

let failed = 0;

for (const rel of checkFiles) {
  const relPath = path.join("src", rel);
  const file = path.join(srcDir, rel);

  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", file],
    { stdio: "pipe", encoding: "utf8" },
  );

  if (result.error) {
    failed += 1;
    console.log(`✗ ${relPath}`);
    console.log(result.error.message);
  } else if (result.status === 0) {
    console.log(`✓ ${relPath}`);
  } else {
    failed += 1;
    console.log(`✗ ${relPath}`);
    const output = [result.stdout, result.stderr].filter(Boolean).join("");
    if (output) {
      process.stdout.write(output.endsWith("\n") ? output : output + "\n");
    }
  }
}

const total = checkFiles.length;
const passed = total - failed;
console.log(`${total} check files, ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

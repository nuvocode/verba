// Runnable check: `node --experimental-strip-types src/lib/choices.check.ts`
//
// The two menus setup and Settings → Learning share (lib/choices), and the rule
// that they really are shared. A second copy of either table would not throw
// anywhere — the two screens would simply start describing the same choice with
// different words, which is the exact failure §5.3 is written against. Issue #34.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LEVELS, TIMES, snapTime, timeName } from "./choices.ts";
import { CEFR_LEVELS } from "./model.ts";
import { defaultSettings, SKIP_DEFAULTS } from "./settings.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, ROOT)), "utf8");

// --- levels: every CEFR band, once, with a sentence -------------------------

assert.deepEqual(
  LEVELS.map(([l]) => l),
  [...CEFR_LEVELS],
  "the level menu must offer every CEFR band, in order, exactly once",
);
for (const [level, title, desc] of LEVELS) {
  assert(title.trim().length > 0, `${level} needs a name — a bare code is a code, not an answer`);
  assert(desc.trim().length > 12, `${level} needs a sentence saying what it means`);
  assert(!title.includes(level), `${level}'s name must not just repeat the code`);
}

// --- times: three named options, and no way to end up outside them ----------

assert.equal(TIMES.length, 3, "setup offers three session lengths, so Settings offers three");
for (const [n, name, desc] of TIMES) {
  assert(n > 0, "a session length is a real number of minutes");
  assert(name.trim().length > 0 && desc.trim().length > 12, `${n} minutes needs both a name and a sentence`);
}
assert.equal(new Set(TIMES.map(([n]) => n)).size, 3, "the three lengths are three different lengths");

// Both defaults are answers the picker can show as chosen. A default the menu has
// no row for renders with nothing selected and no way to explain why.
for (const [what, mins] of [
  ["defaultSettings", defaultSettings.dailyMinutes],
  ["SKIP_DEFAULTS", SKIP_DEFAULTS.dailyMinutes],
] as const)
  assert(TIMES.some(([n]) => n === mins), `${what}.dailyMinutes (${mins}) must be one of the three offered`);

// snapTime lands on one of the three, whatever it is handed, and leaves an answer
// that is already one of them alone.
for (const raw of [0, 1, 19, 20, 21, 33, 45, 60, 61, 75, 9999, -5]) {
  const snapped = snapTime(raw);
  assert(TIMES.some(([n]) => n === snapped), `snapTime(${raw}) → ${snapped}, which is not on the menu`);
  assert.equal(snapTime(snapped), snapped, `snapTime must be idempotent (${snapped})`);
}
for (const [n] of TIMES) assert.equal(snapTime(n), n, `snapTime must not move ${n}, which is already an answer`);
// It picks the nearest, not just any of them — a 21-minute record is the short day.
assert.equal(snapTime(21), 20);
assert.equal(snapTime(70), 75);
assert.equal(timeName(TIMES[0][0]), TIMES[0][1], "a stored length is shown under the name it was chosen by");

// --- the tables are shared, not copied --------------------------------------
// The whole point of this module: setup and Settings read one table. A local
// re-declaration in either screen would pass every assertion above and still
// break the promise, so the gate is on the files themselves.
for (const file of ["src/views/Onboarding.tsx", "src/views/settings/Learning.tsx"]) {
  const src = read(file);
  for (const table of ["LEVELS", "TIMES"]) {
    assert.doesNotMatch(
      src,
      new RegExp(`const ${table}\\s*[:=]`),
      `${file} declares its own ${table} — the menu must come from lib/choices`,
    );
    assert.match(src, new RegExp(`\\b${table}\\b`), `${file} should be reading ${table} from lib/choices`);
  }
  assert.match(src, /from "\.\.\/(\.\.\/)?lib\/choices"/, `${file} must import the shared menus`);
}

// The gate must be able to fail: a probe carrying a local table has to be caught.
assert.throws(
  () => assert.doesNotMatch('const LEVELS: [CEFRLevel, string][] = [];', /const LEVELS\s*[:=]/),
  "the shared-table gate must catch a local re-declaration",
);

console.log(`choices.check ✓ ${LEVELS.length} levels, ${TIMES.length} session lengths`);

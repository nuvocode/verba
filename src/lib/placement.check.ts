// Runnable self-check for the placement stage: what the model is asked for, what
// counts as a usable test, and where the ceiling lands.
// Run: node --experimental-strip-types src/lib/placement.check.ts
import assert from "node:assert";
import { defaultSettings, type Settings } from "./settings.ts";
import {
  clearPlacement,
  PLACEMENT_LADDER,
  placementPending,
  placementPrompt,
  primePlacement,
  parsePlacement,
  scorePlacement,
  type PlacementQ,
} from "./placement.ts";
import { poolFor, pooled } from "./packs/pools.ts";

const s: Settings = { ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "Spanish", nativeLanguage: "Turkish" } };

// ---- the ask: every level, the learner's languages, JSON only ----
const p = placementPrompt(s);
for (const lvl of ["A1", "A2", "B1", "B2", "C1", "C2"]) assert(p.includes(lvl), `${lvl} is on the ladder`);
assert(p.includes("Spanish") && p.includes("Turkish"), "the prompt names both languages");
assert(PLACEMENT_LADDER.length >= 5 && PLACEMENT_LADDER.length <= 10, "5–10 questions: long enough, short enough");

// ---- parsing: junk in, null out — never a half-built test ----
const q = (level: string, answer = 0) => ({ level, prompt: "¿…?", options: ["a", "b", "c"], answer });
const ok = JSON.stringify({ questions: PLACEMENT_LADDER.map((l) => q(l)) });
assert.equal(parsePlacement(ok)?.length, PLACEMENT_LADDER.length, "a well-formed test parses whole");
assert.equal(parsePlacement(`here you go: ${ok}`)?.length, PLACEMENT_LADDER.length, "prose around the JSON is fine");
assert.equal(parsePlacement("not json"), null, "junk is rejected");
assert.equal(parsePlacement(JSON.stringify({ questions: [q("A1"), q("A2")] })), null, "2 questions is not a placement");
assert.equal(
  parsePlacement(JSON.stringify({ questions: [...PLACEMENT_LADDER.map((l) => q(l)), q("Z9"), { level: "B1" }] }))
    ?.length,
  PLACEMENT_LADDER.length,
  "unusable questions are dropped, the good ones survive",
);
assert.equal(
  parsePlacement(JSON.stringify({ questions: PLACEMENT_LADDER.map((l) => ({ ...q(l), answer: 7 })) })),
  null,
  "an answer index outside the options is not a question",
);

// ---- scoring: climb while a level is at least half right, stop at the first that isn't ----
const quiz = parsePlacement(ok) as PlacementQ[]; // ladder A1 A1 A2 B1 B1 B2 C1 C2, correct answer always 0
const right = quiz.map((x) => x.answer);
const wrongAt = (...levels: string[]) => quiz.map((x, i) => (levels.includes(x.level) ? x.answer + 1 : right[i]));

assert.equal(scorePlacement(quiz, right), "C2", "everything right → C2");
assert.equal(scorePlacement(quiz, wrongAt("A1", "A2", "B1", "B2", "C1", "C2")), "A1", "nothing right → A1, the floor");
assert.equal(scorePlacement(quiz, wrongAt("B2", "C1", "C2")), "B1", "the ceiling is the last level they held");
assert.equal(scorePlacement(quiz, wrongAt("A2", "C2")), "A1", "a failed level stops the climb — later wins don't count");
assert.equal(scorePlacement(quiz, []), "A1", "an abandoned test places at the floor, never higher");

// half of a two-question level is still a pass; one wrong A1 out of two is survivable
const oneA1Wrong = quiz.map((x, i) => (x.level === "A1" && i === 0 ? x.answer + 1 : right[i]));
assert.equal(scorePlacement(quiz, oneA1Wrong), "C2", "half right at a level clears it");

// ---- the background write: safe to prime, safe to clear, no network needed ----
assert.equal(placementPending(), null, "nothing is pending before anything is primed");
// A settings object pointing at an unreachable host must not throw — the promise
// resolves to null instead, and clearing it leaves nothing behind.
primePlacement({ ...s, ollamaHost: "http://127.0.0.1:1" });
assert(placementPending() instanceof Promise, "priming starts a promise");
clearPlacement();
assert.equal(placementPending(), null, "clearing leaves nothing pending");

// ---- the curated pools: every one held to the same shape a generated test is ----
assert(poolFor("es") !== null, "es has a curated pool");
assert.equal(poolFor("kl"), null, "a language with no pool returns null");
assert.equal(poolFor(""), null, "an empty id returns null");

for (const id of pooled()) {
  const pool = poolFor(id)!;
  assert.deepEqual(
    pool.map((q) => q.level),
    PLACEMENT_LADDER,
    `${id}: the pool follows the ladder exactly`,
  );
  for (const q of pool) {
    assert.equal(q.options.length, 3, `${id}: exactly three options`);
    assert.equal(new Set(q.options).size, 3, `${id}: options are distinct`);
    assert(q.options.every((o) => o.trim().length > 0), `${id}: no empty option`);
    assert(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, `${id}: answer in range`);
    assert(q.prompt.trim().length > 0, `${id}: prompt is non-empty`);
  }
  assert(new Set(pool.map((q) => q.answer)).size >= 2, `${id}: the right answer moves around`);
  assert.equal(
    parsePlacement(JSON.stringify({ questions: pool }))?.length,
    pool.length,
    `${id}: the pool parses whole, like a generated test`,
  );
  assert.equal(scorePlacement(pool, pool.map((q) => q.answer)), "C2", `${id}: all right → the top`);
  assert.equal(scorePlacement(pool, pool.map(() => -1)), "A1", `${id}: all skipped → the floor`);
}

console.log("placement.check ✓");

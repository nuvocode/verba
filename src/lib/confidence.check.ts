// Runnable self-check for confidence: the unprompted-production rate, measured
// not seeded. `null` is the value that means "not measured yet" — never 0, never
// 50 (invariant 26). Run: node --experimental-strip-types src/lib/confidence.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { confidence, MEASURES_AT, type Turn } from "./confidence.ts";

const turn = (words: number, fromSuggestion = false, latencyMs: number | null = 1000): Turn => ({
  words,
  fromSuggestion,
  latencyMs,
});

// --- invariant 26: nothing before measurement starts ---
assert.equal(confidence([]), null, "no turns → null, not a placeholder number");
assert.equal(confidence([turn(5)]), null, "one turn → null");
assert.equal(confidence([turn(5), turn(6)]), null, "two turns → null");

// --- three turns → a number, and it says what it was computed from ---
const three = confidence([turn(5), turn(6), turn(7)]);
assert(three !== null, "three turns → a number");
assert.equal(three.turns, 3, "the screen can print how many turns it was computed from");
assert(three.value >= 0 && three.value <= 100, "the value is a 0–100 number");

// --- all-suggested scores strictly below all-unaided of the same length ---
const unaided = confidence([turn(5), turn(6), turn(7)], "B1")!;
const suggested = confidence([turn(5, true), turn(6, true), turn(7, true)], "B1")!;
assert(unaided.value > suggested.value, "all-unaided beats all-suggested of the same length");

// --- the recency component is real ---
// A learner who needed help early and stopped needing it scores higher than the
// reverse order: the last five turns count double.
const earlyHelp = confidence(
  [turn(5, true), turn(5, true), turn(5, true), turn(5), turn(5), turn(5), turn(5), turn(5)],
  "B1",
)!;
const lateHelp = confidence(
  [turn(5), turn(5), turn(5), turn(5, true), turn(5, true), turn(5, true), turn(5, true), turn(5, true)],
  "B1",
)!;
assert(earlyHelp.value > lateHelp.value, "help early, then unaided, scores higher than the reverse");

// --- all-null latencies do not drag the value down ---
// Same input with latencies removed gives a value within 5 points: the latency
// component drops out of the mean rather than scoring 0.
const withLatency = confidence([turn(5), turn(6), turn(7)], "B1")!;
const noLatency = confidence([turn(5, false, null), turn(6, false, null), turn(7, false, null)], "B1")!;
assert(Math.abs(withLatency.value - noLatency.value) <= 5, "null latencies do not drag the value down");

// --- source scan: invariant 26 mechanised ---
// useTalk.ts must contain no numeric literal assigned to confidence, and Talk.tsx
// must render `—` on the null branch. A slipped literal would fail here.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
const talk = readFileSync(join(ROOT, "src/views/Talk.tsx"), "utf8");
const face = readFileSync(join(ROOT, "src/views/talk/Face.tsx"), "utf8");

// No `setConfidence(...)` call remains — confidence is derived, never assigned.
assert(!/setConfidence\s*\(/.test(useTalk), "useTalk.ts must not assign confidence (no setConfidence)");
// No numeric literal is handed to a confidence setter or state initialiser.
assert(!/confidence\s*=\s*\d/.test(useTalk), "useTalk.ts must not seed confidence with a number");
assert(!/useState\s*\(\s*\d+\s*\)\s*;\s*\/\/.*confidence/.test(useTalk), "no numeric confidence initialiser");
// The face must not default confidence to a number either — `undefined` is the
// only honest default until MEASURES_AT turns exist (invariant 26). A slipped
// `confidence = 50` in Face.tsx would smile at a number that was never measured.
assert(
  !/confidence\s*=\s*\d/.test(face),
  "Face.tsx must not default confidence to a number — undefined until measured",
);
assert(
  !/confidence\s*:\s*number\s*=\s*\d/.test(face),
  "Face.tsx must not type-and-default confidence to a number",
);
// The screen renders `—` on the null branch — and it must sit on that branch, not
// anywhere in the file. Same window method as surfaces.check: find the confidence
// ternary and look for the em-dash within a window after it, so a `—` pasted at
// the top of the file cannot claim the null branch while the measured branch
// renders a placeholder.
const confAt = talk.indexOf("talk.confidence ?");
assert(confAt !== -1, "Talk.tsx must branch on talk.confidence");
const confWindowEnd = Math.min(talk.length, confAt + 1600);
const confNullBranch = talk.slice(confAt, confWindowEnd);
assert(/<b>—<\/b>/.test(confNullBranch), "Talk.tsx renders the em-dash on the null branch of the confidence ternary");

console.log("confidence.check: ok");

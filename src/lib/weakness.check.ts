// Runnable self-check for §1.5: what counts as evidence, what earns the name
// "weakness", and the promise Coach makes about it.
// Run: node --experimental-strip-types src/lib/weakness.check.ts
import assert from "node:assert";
import { MIN_WEAKNESS_EVIDENCE, isDeclaredWeakness, signalMiss } from "./model.ts";
import type { Signal, SignalKind } from "./model.ts";
import { weaknessesFrom, addressed } from "./weakness.ts";
import { buildDailyPlan, DRILL_SLOTS } from "./learn.ts";
import { defaultSettings } from "./settings.ts";

let n = 0;
const sig = (kind: SignalKind, payload: unknown, observedAt = ++n): Signal => ({
  id: `s${n}`,
  activityId: "talk",
  kind,
  observedAt,
  payload,
});
const miss = (label: string, kind: SignalKind = "comprehension") => sig(kind, { label, correct: false });
const hit = (label: string, kind: SignalKind = "comprehension") => sig(kind, { label, correct: true });

// --- what went badly ----------------------------------------------------------
assert(signalMiss(sig("correction", { label: "ser vs estar" })), "a correction is a miss by its nature");
assert(signalMiss(sig("comprehension", { label: "x", correct: false })), "a wrong answer is a miss");
assert(!signalMiss(sig("comprehension", { label: "x", correct: true })), "a right answer is not");
assert(signalMiss(sig("lexicalItem", { label: "la cuenta", grade: 0 })), 'a card graded "again" is a miss');
assert(!signalMiss(sig("lexicalItem", { label: "la cuenta", grade: 2 })), "an easy card is not");
assert(!signalMiss(sig("lexicalItem", { label: "la cuenta" })), "a word merely met is not a miss");
assert(!signalMiss(sig("unpromptedTurn", { label: "unaided turn", words: 5, sentences: 1, chars: 20 })), "a produced turn observes no failure");

// --- the threshold ------------------------------------------------------------
const below = weaknessesFrom([miss("a"), miss("a"), hit("a")]);
assert.deepEqual(below, [], `${MIN_WEAKNESS_EVIDENCE - 1} slips is not a weakness — it is a bad day`);

const one = weaknessesFrom([miss("a"), hit("a"), miss("a"), miss("a")]);
assert.equal(one.length, 1, "three slips on the same label is");
assert.equal(one[0].evidence.length, 3, "only the slips are evidence; the right answer is not");
assert(isDeclaredWeakness(one[0]), "and the model agrees it is declared");
assert.equal(one[0].category, "lexis", "a comprehension miss is filed under lexis");

// An unlabelled payload cannot be grouped with anything, so it is not evidence.
assert.deepEqual(weaknessesFrom([sig("comprehension", { correct: false }), sig("comprehension", { correct: false }), sig("comprehension", { correct: false })]), []);

// The same label under two kinds is two weaknesses: a word you cannot recall and a
// word you keep saying wrong are different problems with the same name.
const split = weaknessesFrom([
  ...[1, 2, 3].map(() => miss("la cuenta", "lexicalItem")),
  ...[1, 2, 3].map(() => miss("la cuenta", "correction")),
]);
assert.equal(split.length, 2, "kind is part of a weakness's identity");
assert.equal(new Set(split.map((w) => w.id)).size, 2, "…and of its id, which must survive recomputation");

// --- invariant 6 --------------------------------------------------------------
// invariant 6
// Every weakness Coach shows names activities that tomorrow's plan really has.
// The failure case this exists for: `memory` is only planned when cards are due, so
// a drill slot pointing at it would promise an activity that is not there.
const many = weaknessesFrom([
  ...[1, 2, 3, 4].flatMap(() => [miss("ser vs estar", "correction")]),
  ...[1, 2, 3].map(() => miss("reading comprehension")),
  ...[1, 2, 3, 4, 5].map(() => miss("la cuenta", "lexicalItem")),
  ...[1, 2, 3].map(() => miss("word order", "correction")),
]);
assert.equal(many.length, 4, "four labels cross the threshold");
assert.deepEqual(
  many.map((w) => w.severity),
  [5, 4, 3, 3],
  "strongest evidence first — that is the order the plan's drill slots are filled in",
);

const shown = addressed(many);
assert.equal(shown.length, DRILL_SLOTS.length, "the plan has three drill slots, so three weaknesses get one");
assert.deepEqual(many[3].addressedBy, [], "the fourth is real but unaddressed, and Coach must not show it");

const tomorrow = buildDailyPlan(defaultSettings, { date: "2026-08-27", dayIndex: 10, dueVocab: 0, weaknesses: many });
for (const w of shown) {
  assert(w.addressedBy.length > 0, `a shown weakness must name an activity (${w.label})`);
  for (const id of w.addressedBy)
    assert(
      tomorrow.activities.some((a) => a.id === id),
      `invariant 6: ${w.label} points at "${id}", which tomorrow's plan does not contain`,
    );
}
assert.deepEqual(
  tomorrow.targetedWeaknesses,
  shown.map((w) => w.id),
  "the plan names the weaknesses it set out to address",
);
// The drill has to actually reach the activity, not just be pointed at by it.
for (const w of shown)
  for (const id of w.addressedBy)
    assert.equal(tomorrow.activities.find((a) => a.id === id)?.goal, w.label, `${id} must carry ${w.label} as its goal`);

// A single weakness fills every slot rather than leaving two idle.
const solo = weaknessesFrom([1, 2, 3].map(() => miss("ser vs estar", "correction")));
assert.deepEqual(solo[0].addressedBy, [...DRILL_SLOTS], "one weak area is drilled three ways");

// --- trend --------------------------------------------------------------------
const at = (label: string, t: number) => ({ ...miss(label), observedAt: t });
assert.equal(weaknessesFrom([at("a", 1), at("a", 1), at("a", 1)])[0].trend, "new", "all at once is not a history");
assert.equal(weaknessesFrom([at("a", 1), at("a", 9), at("a", 10)])[0].trend, "worsening", "piling up lately");
assert.equal(weaknessesFrom([at("a", 1), at("a", 2), at("a", 10)])[0].trend, "improving", "thinning out");
assert.equal(weaknessesFrom([at("a", 1), at("a", 5), at("a", 6), at("a", 10)])[0].trend, "flat", "same on both sides");

console.log("weakness.check OK");

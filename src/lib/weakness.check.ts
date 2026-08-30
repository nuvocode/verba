// Runnable self-check for §1.5: what counts as evidence, what earns the name
// "weakness", and the promise Coach makes about it.
// Run: node --experimental-strip-types src/lib/weakness.check.ts
import assert from "node:assert";
import { MIN_WEAKNESS_EVIDENCE, isDeclaredWeakness, signalMiss } from "./model.ts";
import type { Signal, SignalKind, Weakness } from "./model.ts";
import { weaknessesFrom, addressed, weaknessCard } from "./weakness.ts";
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

// ---- the round trip: Coach's promise is Today's rationale (invariant 6) ----
// invariant 6 — one card, one argument
{
  // Four weaknesses across four categories, different trends and severities.
  const ws: Weakness[] = [
    { id: "correction:ser vs estar", label: "ser vs estar", category: "grammar", evidence: ["a", "b", "c"], severity: 3, addressedBy: ["talk", "read"], trend: "worsening" },
    { id: "lexicalItem:la cuenta", label: "la cuenta", category: "lexis", evidence: ["d", "e", "f", "g"], severity: 4, addressedBy: ["read"], trend: "improving" },
    { id: "pronunciation:schwa", label: "schwa", category: "pronunciation", evidence: ["h", "i", "j"], severity: 3, addressedBy: ["talk"], trend: "new" },
    { id: "pace:word order", label: "word order", category: "fluency", evidence: ["k", "l", "m"], severity: 3, addressedBy: ["listen"], trend: "flat" },
  ];
  const titles = { talk: "Conversation", read: "Reading", listen: "Listening" };
  const cards = ws.map((w) => weaknessCard(w, titles));

  // No two cards read alike — the failure this replaces was one template three times.
  assert.equal(new Set(cards.map((c) => c.observed)).size, cards.length, "invariant 6: each observed sentence is its own");
  assert.equal(
    new Set(cards.map((c) => c.evidence + " " + c.plan)).size,
    cards.length,
    "invariant 6: each evidence+plan pair is its own",
  );

  // Every part is non-empty and free of undefined/NaN/raw ids.
  for (const c of cards) {
    assert(c.observed.length > 0 && c.evidence.length > 0 && c.plan.length > 0, "invariant 6: every card part is non-empty");
    assert(!/undefined|NaN/.test(c.observed + c.evidence + c.plan), "invariant 6: no undefined or NaN leaks into a card");
    assert(!/talk|read|listen/.test(c.plan), "invariant 6: the plan names titles, not ids");
  }

  // Evidence counts and the "today" clause.
  assert.match(weaknessCard(ws[1], titles).evidence, /4 slips/, "invariant 6: three+ signals read as a plural count");
  assert.match(weaknessCard(ws[2], titles).evidence, /3 slips/, "invariant 6: three signals read as a plural count");
  assert.match(weaknessCard(ws[2], titles).evidence, /today/, "invariant 6: a new weakness says the first slip was today");
  assert(!/today/.test(weaknessCard(ws[0], titles).evidence), "invariant 6: a non-new weakness does not mention today");

  // A missing title falls back to the id rather than rendering undefined.
  const missing = weaknessCard(ws[0], { talk: "Conversation" });
  assert(missing.plan.includes("read"), "invariant 6: an untitled activity falls back to its id");

  // The round trip: a plan built from the declared weaknesses carries each label
  // in the rationale of the activity that addresses it. The weaknesses come from
  // weaknessesFrom so addressedBy is the planner's own rule — a hand-written
  // fixture could point at an activity the plan never actually drills.
  const derived = weaknessesFrom([
    ...[1, 2, 3].map(() => miss("ser vs estar", "correction")),
    ...[1, 2, 3].map(() => miss("la cuenta", "lexicalItem")),
    ...[1, 2, 3].map(() => miss("schwa", "pronunciation")),
  ]);
  const plan = buildDailyPlan(defaultSettings, { date: "2026-08-27", dayIndex: 10, dueVocab: 0, weaknesses: derived });
  for (const w of derived)
    for (const id of w.addressedBy) {
      const a = plan.activities.find((x) => x.id === id);
      assert(a, `invariant 6: ${w.label} points at ${id}, which the plan contains`);
      assert(a!.rationale.includes(w.label), `invariant 6: ${id}'s rationale names ${w.label}`);
    }
}

console.log("weakness.check OK");

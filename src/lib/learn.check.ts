// Runnable check: `node --experimental-strip-types src/lib/learn.check.ts`
import assert from "node:assert";
import { defaultSettings } from "./settings.ts";
import {
  buildDailyPlan,
  nextActivity,
  isLegacyPlanShape,
  type PlanContext,
} from "./learn.ts";

// helper: a valid context, with the field under test overridden on demand
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  date: "2026-08-26",
  dayIndex: 41,
  dueVocab: 0,
  ...over,
});

// S1 rename table: the six kinds map onto the shared ActivityKind values, in running order
const five = buildDailyPlan(defaultSettings, ctx({ dueVocab: 5 }));
assert.deepEqual(
  five.activities.map((a) => a.kind),
  ["talk", "read", "roleplay", "memory", "listen", "wrapup"],
  "conversation→talk, reading→read, scenario→roleplay, vocab→memory, listening→listen, summary→wrapup",
);

// #16: plan minutes equal the sum of the activity minutes
// invariant 4
assert.equal(
  five.estimatedMinutes,
  five.activities.reduce((n, a) => n + a.estimatedMinutes, 0),
  "estimatedMinutes is the sum of the activities",
);

// #17: every activity carries a non-empty rationale
// invariant 5
for (const a of five.activities) assert(a.rationale.trim().length > 0, `${a.kind} must have a rationale`);

// focus folds into the first activity's rationale
const focused = buildDailyPlan(defaultSettings, ctx({ focus: ["past tense"] }));
assert(focused.activities[0].rationale.includes("past tense"), "the first activity drills the focus");

// dueVocab gates the memory activity
const none = buildDailyPlan(defaultSettings, ctx({ dueVocab: 0 }));
assert(!none.activities.some((a) => a.kind === "memory"), "nothing due → no memory activity");
assert(five.activities.some((a) => a.kind === "memory"), "5 due → a memory activity");

// determinism: the same context builds the same plan
const a = buildDailyPlan(defaultSettings, ctx({ dueVocab: 5, focus: ["past tense"] }));
const b = buildDailyPlan(defaultSettings, ctx({ dueVocab: 5, focus: ["past tense"] }));
assert.deepEqual(a, b, "the same PlanContext yields the same plan");

// nextActivity skips completed activities and returns the first pending one
assert.equal(nextActivity(five, []), "talk", "an untouched day starts at talk");
assert.equal(nextActivity(five, ["talk"]), "read", "completed talk is skipped");
assert.equal(nextActivity(five, ["talk", "read", "roleplay"]), "memory", "the first pending is returned");
assert.equal(
  nextActivity(five, ["talk", "read", "roleplay", "memory", "listen", "wrapup"]),
  null,
  "a finished day has no next",
);

// a pre-model row ({blocks:[...]}) is treated as absent and rebuilt
assert.equal(isLegacyPlanShape({ blocks: [] }), true, "an old {blocks:[...]} row falls into the rebuild path");
assert.equal(isLegacyPlanShape({ activities: [] }), false, "a shared-model row is kept");

console.log("learn.check OK");

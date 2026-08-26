// Runnable check: `node --experimental-strip-types src/lib/model.check.ts`
import assert from "node:assert";
import {
  CEFR_LEVELS,
  makePlan,
  planActivity,
  levelOf,
  levelLabel,
  progressionSuggested,
  isDeclaredWeakness,
} from "./model.ts";
import type { DailyPlan, LearnerProfile, PlannedActivity, Weakness } from "./model.ts";

// helper: a valid planned activity
const activity = (id: string, estimatedMinutes: number): PlannedActivity =>
  planActivity({
    id,
    kind: "talk",
    title: `Activity ${id}`,
    rationale: `Because ${id} moves today's plan forward.`,
    estimatedMinutes,
  });

// #16: plan minutes equal the sum of the activity minutes
// invariant 4
const plan: DailyPlan = makePlan({
  date: "2026-08-26",
  dayIndex: 41,
  theme: "moving to Hamburg",
  targetedWeaknesses: ["w1"],
  activities: [activity("a1", 10), activity("a2", 15), activity("a3", 25)],
});
assert.equal(plan.estimatedMinutes, 50);
assert.equal(plan.activities.length, 3);

// empty activities -> 0
const emptyPlan = makePlan({
  date: "2026-08-26",
  dayIndex: 42,
  theme: "moving to Hamburg",
  targetedWeaknesses: [],
  activities: [],
});
assert.equal(emptyPlan.estimatedMinutes, 0);

// #17: empty or whitespace-only rationale is rejected
// invariant 5
assert.throws(() =>
  planActivity({ id: "x", kind: "read", title: "T", rationale: "", estimatedMinutes: 5 }),
);
assert.throws(() =>
  planActivity({ id: "x", kind: "read", title: "T", rationale: "   ", estimatedMinutes: 5 }),
);

// valid rationale passes through unchanged; fresh activity is pending with no signals
const a = planActivity({
  id: "a9",
  kind: "memory",
  title: "Deck",
  rationale: "  Because today is a good day.  ",
  estimatedMinutes: 7,
});
assert.equal(a.rationale, "  Because today is a good day.  ");
assert.equal(a.status, "pending");
assert.deepEqual(a.producedSignalIds, []);

// levelLabel is inclusive on both ends and monotonic across increasing values
assert.equal(levelLabel(0), "A1");
assert.equal(levelLabel(100), "C2");
const samples = [0, 20, 40, 60, 80, 100];
for (let i = 1; i < samples.length; i++) {
  const prev = levelLabel(samples[i - 1]);
  const cur = levelLabel(samples[i]);
  assert.ok(CEFR_LEVELS.indexOf(cur) >= CEFR_LEVELS.indexOf(prev), `${prev} -> ${cur}`);
}

// levelOf returns the profile's level verbatim
// invariant 3
const profile: LearnerProfile = {
  targetLanguage: "Spanish",
  nativeLanguage: "Turkish",
  level: "B1",
  levelEstimate: { value: 62, label: "B2", confidence: "medium", sampleSize: 9 },
  interests: [],
  goals: [],
  weaknesses: [],
  createdAt: 1_000_000_000_000,
  streak: 12,
  timezone: "Europe/Istanbul",
};
assert.equal(levelOf(profile), "B1");

// progressionSuggested: only low confidence blocks the suggestion
assert.equal(progressionSuggested({ ...profile.levelEstimate, confidence: "low" }), false);
assert.equal(progressionSuggested({ ...profile.levelEstimate, confidence: "medium" }), true);
assert.equal(progressionSuggested({ ...profile.levelEstimate, confidence: "high" }), true);

// isDeclaredWeakness: needs at least MIN_WEAKNESS_EVIDENCE signals
const weakness = (n: number): Weakness => ({
  id: `w${n}`,
  label: "unstressed schwa /ə/",
  category: "pronunciation",
  evidence: Array.from({ length: n }, (_, i) => `s${i}`),
  severity: 2,
  addressedBy: [],
  trend: "new",
});
assert.equal(isDeclaredWeakness(weakness(2)), false);
assert.equal(isDeclaredWeakness(weakness(3)), true);

console.log("model.check OK");

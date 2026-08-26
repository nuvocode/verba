// Runnable check: `node --experimental-strip-types src/lib/model.check.ts`
import assert from "node:assert";
import {
  CEFR_LEVELS,
  makePlan,
  planActivity,
  levelOf,
  levelLabel,
  levelGapNote,
  progressionSuggested,
  isDeclaredWeakness,
} from "./model.ts";
import type { DailyPlan, LearnerProfile, PlannedActivity, Weakness, LevelEstimate } from "./model.ts";
import { levelEstimateFrom } from "./metrics.ts";

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
  interests: [],
  goals: [],
  weaknesses: [],
  createdAt: 1_000_000_000_000,
  streak: 12,
  timezone: "Europe/Istanbul",
};
assert.equal(levelOf(profile), "B1");

// progressionSuggested: only low confidence blocks the suggestion
const est = (confidence: LevelEstimate["confidence"]): LevelEstimate => ({
  value: 60,
  label: "B2",
  confidence,
  sampleSize: 8,
});
assert.equal(progressionSuggested(est("low")), false);
assert.equal(progressionSuggested(est("medium")), true);
assert.equal(progressionSuggested(est("high")), true);

// levelGapNote: nothing to explain when the values agree, or nothing has been measured.
// invariant 2
{
  const agree = levelGapNote("B2", est("high"));
  assert.equal(agree, null, "agreeing values need no gap note");
  const unmeasured = levelGapNote("B1", { value: 0, label: "A1", confidence: "low", sampleSize: 0 });
  assert.equal(unmeasured, null, "an unmeasured estimate needs no gap note");
  const gap = levelGapNote("A2", { value: 70, label: "B2", confidence: "high", sampleSize: 8 });
  assert.ok(gap, "differing values must produce a gap note");
  assert.ok(gap.includes("A2") && gap.includes("B2"), "the gap note names both levels");
  // The note carries level *names*, not a numeric score — strip the CEFR labels
  // and no digit may remain.
  assert.ok(!/\d/.test(gap.replace(/A1|A2|B1|B2|C1|C2/g, "")), "the gap note must not carry a numeric score");
}

// levelEstimateFrom: the mean of scores (not the last), confidence from sample size,
// and a safe "not yet measured" state for an empty history.
assert.deepEqual(levelEstimateFrom([]), { value: 0, label: "A1", confidence: "low", sampleSize: 0 });
assert.equal(levelEstimateFrom([40, 60]).value, 50, "the estimate is the mean, not the last score");
assert.equal(levelEstimateFrom([50, 50]).confidence, "low");
assert.equal(levelEstimateFrom([50, 50, 50]).confidence, "medium");
assert.equal(levelEstimateFrom(Array.from({ length: 8 }, () => 50)).confidence, "high");

// levelLabel must agree with the old 6-band formula across the whole 0..100 range —
// (score/100)*6 and score/(100/6) are equal on paper but can drift apart in
// floating point at band boundaries. All 101 must agree.
for (let score = 0; score <= 100; score++) {
  const old = CEFR_LEVELS[Math.min(CEFR_LEVELS.length - 1, Math.floor(score / (100 / CEFR_LEVELS.length)))];
  assert.equal(levelLabel(score), old, `levelLabel(${score}) must equal the old banding`);
}

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

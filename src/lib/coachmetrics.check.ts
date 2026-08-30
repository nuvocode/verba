// Runnable self-check for §2.6 coach metrics: the six metrics, computed from
// signals and nothing else. Fixtures are built by hand — no DB, no clock beyond
// a fixed NOW constant.
// Run: node --experimental-strip-types src/lib/coachmetrics.check.ts
import assert from "node:assert";
import { coachMetrics, coachPanel, measured, WEEK_MS } from "./coachmetrics.ts";
import type { Signal, SignalKind } from "./model.ts";

const NOW = 1_000_000_000_000; // a fixed instant, well past the epoch

let n = 0;
const sig = (kind: SignalKind, payload: unknown, at = NOW): Signal => ({
  id: `s${n++}`,
  activityId: "a1",
  kind,
  observedAt: at,
  payload,
});

const turn = (words: number, sentences: number, at = NOW) =>
  sig("unpromptedTurn", { label: "turn", words, sentences, chars: words * 5 }, at);

// 1. Empty in, empty out.
{
  const m = coachMetrics([], NOW);
  assert.equal(m.length, 6, "six metrics, always");
  assert(m.every((x) => x.value === null && x.sample === 0), "empty window: every value null, sample 0");
  assert.deepEqual(measured(coachPanel([], NOW)), [], "nothing measured, nothing rendered");
}

// 2. Complexity — mean words per sentence over unprompted turns only.
{
  const m = coachMetrics([turn(4, 1), turn(10, 2), turn(6, 1)], NOW);
  const c = m.find((x) => x.id === "complexity")!;
  // 4/1 = 4, 10/2 = 5, 6/1 = 6 → mean = 5.0
  assert.equal(c.value, 5, "mean words per sentence is 5");
  assert.equal(c.sample, 3, "three turns stand on it");
  // a suggestionUsed turn in the same window does not move it
  const withSuggestion = coachMetrics([turn(4, 1), turn(10, 2), turn(6, 1), sig("suggestionUsed", { label: "s", words: 50, sentences: 1, chars: 250 })], NOW);
  assert.equal(withSuggestion.find((x) => x.id === "complexity")!.value, 5, "suggested turns are not complexity");
}

// 3. Accuracy.
{
  const ten = Array.from({ length: 10 }, () => turn(5, 1));
  const twoCorrections = [...ten, sig("correction", { label: "x" }), sig("correction", { label: "y" })];
  assert.equal(coachMetrics(twoCorrections, NOW).find((x) => x.id === "accuracy")!.value, 80, "10 turns, 2 corrections → 80");
  const zeroCorrections = coachMetrics(ten, NOW).find((x) => x.id === "accuracy")!;
  assert.equal(zeroCorrections.value, 100, "10 turns, 0 corrections → 100");
  assert.equal(zeroCorrections.sample, 10, "accuracy's sample is turns, not corrections");
  const correctionsOnly = coachMetrics([sig("correction", { label: "x" })], NOW).find((x) => x.id === "accuracy")!;
  assert.equal(correctionsOnly.value, null, "corrections with no turns is not measured");
}

// 4. Vocabulary — distinct labels.
{
  const m = coachMetrics(
    [sig("lexicalItem", { label: "la cuenta" }), sig("lexicalItem", { label: "la cuenta" }), sig("lexicalItem", { label: "la cuenta" })],
    NOW,
  );
  assert.equal(m.find((x) => x.id === "vocabulary")!.value, 1, "the same word met three times is 1");
}

// 5. Consistency — days, not signals.
{
  const oneDay = coachMetrics(Array.from({ length: 30 }, () => turn(5, 1)), NOW);
  assert.equal(oneDay.find((x) => x.id === "consistency")!.value, 1, "30 signals on one day is 1");
  const threeDays = coachMetrics(
    [turn(5, 1, NOW), turn(5, 1, NOW - 24 * 60 * 60 * 1000), turn(5, 1, NOW - 2 * 24 * 60 * 60 * 1000)],
    NOW,
  );
  assert.equal(threeDays.find((x) => x.id === "consistency")!.value, 3, "three local days is 3");
  const old = coachMetrics([turn(5, 1, NOW - 8 * 24 * 60 * 60 * 1000)], NOW);
  assert.equal(old.find((x) => x.id === "consistency")!.value, null, "a signal 8 days old is outside the window — nothing measured");
}

// 6. Comprehension — 4 correct, 1 wrong → 80.
{
  const m = coachMetrics(
    [
      sig("comprehension", { label: "c", correct: true }),
      sig("comprehension", { label: "c", correct: true }),
      sig("comprehension", { label: "c", correct: true }),
      sig("comprehension", { label: "c", correct: true }),
      sig("comprehension", { label: "c", correct: false }),
    ],
    NOW,
  );
  assert.equal(m.find((x) => x.id === "comprehension")!.value, 80, "4/5 correct → 80");
}

// 7. Fluency — 6 unaided, 4 suggested → 60.
{
  const m = coachMetrics(
    [...Array.from({ length: 6 }, () => turn(5, 1)), ...Array.from({ length: 4 }, () => sig("suggestionUsed", { label: "s", words: 5, sentences: 1, chars: 25 }))],
    NOW,
  );
  assert.equal(m.find((x) => x.id === "fluency")!.value, 60, "6/10 unaided → 60");
}

// 8. invariant 12 — every metric has a unit and a definition; no two share one.
{
  const m = coachMetrics([], NOW);
  for (const x of m) {
    assert(x.unit.trim().length > 0, "invariant 12: every metric has a unit");
    assert(x.definition.length >= 20, "invariant 12: every metric has a definition of at least 20 chars");
  }
  const defs = m.map((x) => x.definition);
  assert.equal(new Set(defs).size, defs.length, "invariant 12: no two metrics share a definition");
}

// 9. invariant 8 (early half) — one week, nothing before it.
{
  // A full week of every kind, so all six metrics have a value to be "new" about.
  const oneWeek = [
    ...Array.from({ length: 7 }, (_, i) => turn(5, 1, NOW - i * 24 * 60 * 60 * 1000)),
    sig("comprehension", { label: "c", correct: true }, NOW),
    sig("lexicalItem", { label: "la cuenta" }, NOW),
    sig("suggestionUsed", { label: "s", words: 5, sentences: 1, chars: 25 }, NOW),
  ];
  const panel = coachPanel(oneWeek, NOW);
  assert.equal(panel.length, 6, "six pairs, always");
  for (const p of panel) {
    assert.notEqual(p.metric.value, null, "every metric has a value this week");
    assert.equal(p.delta, null, "no previous window → no delta");
    assert.equal(p.isNew, true, "a value with no prior sample is new");
    assert.notEqual(p.delta, p.metric.value, "invariant 8: a delta never equals its own metric's value");
  }
}

// 10. Two comparable weeks — a metric that fell from 90 to 80 has delta -10.
{
  const prevAt = NOW - WEEK_MS - 1; // inside the previous window, before this week
  const prev = Array.from({ length: 9 }, () => sig("comprehension", { label: "c", correct: true }, prevAt));
  prev.push(sig("comprehension", { label: "c", correct: false }, prevAt));
  const cur = Array.from({ length: 8 }, () => sig("comprehension", { label: "c", correct: true }));
  cur.push(sig("comprehension", { label: "c", correct: false }));
  cur.push(sig("comprehension", { label: "c", correct: false }));
  const panel = coachPanel([...prev, ...cur], NOW);
  const comp = panel.find((p) => p.metric.id === "comprehension")!;
  assert.equal(comp.metric.value, 80, "current week is 80");
  assert.equal(comp.delta, -10, "fell from 90 to 80 → delta -10");
  assert.equal(comp.isNew, false, "both weeks have samples → not new");
}

// 11. A malformed payload is skipped and lowers no metric.
{
  const good = turn(4, 1);
  const malformed = sig("unpromptedTurn", { label: "turn" }); // no numeric fields
  const alone = coachMetrics([good], NOW).find((x) => x.id === "complexity")!;
  const mixed = coachMetrics([good, malformed], NOW).find((x) => x.id === "complexity")!;
  assert.equal(mixed.value, alone.value, "a malformed row does not move complexity");
  assert.equal(mixed.sample, 1, "only the good turn stands on it");
}

console.log("coachmetrics.check OK");

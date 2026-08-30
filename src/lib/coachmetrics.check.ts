// Runnable self-check for §2.6 coach metrics: the six metrics, computed from
// signals and nothing else. Fixtures are built by hand — no DB, no clock beyond
// a fixed NOW constant.
// Run: node --experimental-strip-types src/lib/coachmetrics.check.ts
import assert from "node:assert";
import { coachMetrics, coachPanel, measured, headline, wins, daySeries, WEEK_MS } from "./coachmetrics.ts";
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

// 12. An empty panel's headline names nothing measured, and wins([]) is [].
{
  assert.equal(headline([]), "Nothing measured yet — this week is still blank.");
  assert.deepEqual(wins([]), []);
}

// invariant 10 — a 3-day week is not praised, and the headline names the number.
{
  // Three distinct days of comprehension + vocabulary only: exactly three metrics
  // are measured (comprehension, vocabulary, consistency), no turns, no deltas.
  const cur = [
    sig("comprehension", { label: "c", correct: true }, NOW),
    sig("comprehension", { label: "c", correct: true }, NOW - 24 * 60 * 60 * 1000),
    sig("comprehension", { label: "c", correct: true }, NOW - 2 * 24 * 60 * 60 * 1000),
    sig("lexicalItem", { label: "la cuenta" }, NOW),
    sig("lexicalItem", { label: "la cuenta" }, NOW - 24 * 60 * 60 * 1000),
    sig("lexicalItem", { label: "la cuenta" }, NOW - 2 * 24 * 60 * 60 * 1000),
  ];
  const panel = coachPanel(cur, NOW); // no previous window → every delta null
  const h = headline(panel);
  assert(!/consistent|great|strong|excellent/i.test(h), "invariant 10: a 3-day week is not praised");
  assert(h.includes("3"), "invariant 10: the headline names the number of days");
}

// invariant 11 — every win chip disappears when its driving metric drops below
// the threshold. Three of the six thresholds are asserted this way.
{
  const prevAt = NOW - WEEK_MS - 1;
  const prev = [
    ...Array.from({ length: 5 }, () => sig("comprehension", { label: "c", correct: true }, prevAt)),
    ...Array.from({ length: 5 }, () => sig("comprehension", { label: "c", correct: false }, prevAt)),
  ];
  const cur = [
    ...Array.from({ length: 7 }, (_, i) => turn(5, 1, NOW - i * 24 * 60 * 60 * 1000)),
    ...Array.from({ length: 3 }, () => sig("suggestionUsed", { label: "s", words: 5, sentences: 1, chars: 25 }, NOW)),
    ...Array.from({ length: 10 }, () => sig("comprehension", { label: "c", correct: true }, NOW)),
    ...Array.from({ length: 15 }, (_, i) => sig("lexicalItem", { label: `w${i}` }, NOW)),
  ];
  const full = coachPanel([...prev, ...cur], NOW);
  const all = wins(full);
  assert(all.includes("7 of 7 days practised"), "invariant 11: the consistency chip is present at 7 days");
  assert(all.includes("100% accuracy over 7 turns"), "invariant 11: the accuracy chip is present at 100%");
  assert(all.includes("15 distinct words met"), "invariant 11: the vocabulary chip is present at 15");

  // consistency below 5 → the consistency chip disappears
  const curLowConsistency = [
    ...Array.from({ length: 4 }, (_, i) => turn(5, 1, NOW - i * 24 * 60 * 60 * 1000)),
    ...Array.from({ length: 3 }, () => sig("suggestionUsed", { label: "s", words: 5, sentences: 1, chars: 25 }, NOW)),
    ...Array.from({ length: 10 }, () => sig("comprehension", { label: "c", correct: true }, NOW)),
    ...Array.from({ length: 15 }, (_, i) => sig("lexicalItem", { label: `w${i}` }, NOW)),
  ];
  assert(!wins(coachPanel([...prev, ...curLowConsistency], NOW)).includes("7 of 7 days practised"), "invariant 11: consistency below 5 drops the consistency chip");

  // accuracy below 90 (with sample still >= 5) → the accuracy chip disappears
  const curLowAccuracy = [
    ...Array.from({ length: 7 }, (_, i) => turn(5, 1, NOW - i * 24 * 60 * 60 * 1000)),
    ...Array.from({ length: 2 }, () => sig("correction", { label: "x" }, NOW)),
    ...Array.from({ length: 3 }, () => sig("suggestionUsed", { label: "s", words: 5, sentences: 1, chars: 25 }, NOW)),
    ...Array.from({ length: 10 }, () => sig("comprehension", { label: "c", correct: true }, NOW)),
    ...Array.from({ length: 15 }, (_, i) => sig("lexicalItem", { label: `w${i}` }, NOW)),
  ];
  assert(!wins(coachPanel([...prev, ...curLowAccuracy], NOW)).includes("100% accuracy over 7 turns"), "invariant 11: accuracy below 90 drops the accuracy chip");

  // vocabulary below 15 → the vocabulary chip disappears
  const curLowVocab = [
    ...Array.from({ length: 7 }, (_, i) => turn(5, 1, NOW - i * 24 * 60 * 60 * 1000)),
    ...Array.from({ length: 3 }, () => sig("suggestionUsed", { label: "s", words: 5, sentences: 1, chars: 25 }, NOW)),
    ...Array.from({ length: 10 }, () => sig("comprehension", { label: "c", correct: true }, NOW)),
    ...Array.from({ length: 10 }, (_, i) => sig("lexicalItem", { label: `w${i}` }, NOW)),
  ];
  assert(!wins(coachPanel([...prev, ...curLowVocab], NOW)).includes("15 distinct words met"), "invariant 11: vocabulary below 15 drops the vocabulary chip");
}

// invariant 8 — a panel from one window only has no delta to render, and no
// delta anywhere equals its own metric's value.
{
  const oneWeek = [
    ...Array.from({ length: 7 }, (_, i) => turn(5, 1, NOW - i * 24 * 60 * 60 * 1000)),
    sig("comprehension", { label: "c", correct: true }, NOW),
    sig("lexicalItem", { label: "la cuenta" }, NOW),
    sig("suggestionUsed", { label: "s", words: 5, sentences: 1, chars: 25 }, NOW),
  ];
  const panel = coachPanel(oneWeek, NOW);
  for (const p of panel) {
    assert.equal(p.delta, null, "invariant 8: one window → no delta");
    assert.notEqual(p.delta, p.metric.value, "invariant 8: a delta never equals its own metric's value");
  }
}

// invariant 9 — the seven boxes and the reported number are the same fact,
// computed once. This is the assertion that matters most in the file.
{
  const signals = [
    turn(5, 1, NOW),
    turn(5, 1, NOW - 24 * 60 * 60 * 1000),
    turn(5, 1, NOW - 2 * 24 * 60 * 60 * 1000),
  ];
  const series = daySeries(signals, NOW);
  assert.equal(series.length, 7, "invariant 9: the series is seven days");
  const active = series.filter((d) => d.active).length;
  const consistency = coachMetrics(signals, NOW).find((m) => m.id === "consistency")!.value;
  assert.equal(active, consistency, "invariant 9: active boxes === reported days");
}

// daySeries puts today last: NOW marks index 6, NOW - 6 days marks index 0.
{
  const today = daySeries([turn(5, 1, NOW)], NOW);
  assert.equal(today[6].active, true, "a signal stamped NOW marks index 6 (today)");
  const oldest = daySeries([turn(5, 1, NOW - 6 * 24 * 60 * 60 * 1000)], NOW);
  assert.equal(oldest[0].active, true, "a signal stamped NOW - 6 days marks index 0");
}

console.log("coachmetrics.check OK");

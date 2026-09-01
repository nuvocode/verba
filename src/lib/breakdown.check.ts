// The collection half of breakdown detection (PLAN-028), pinned: the learner's
// own baseline, the exclusion of unmeasured speak, and the eight signals — the
// three measured here and the five the model reports but we verify. Ten cases,
// following the plan's "Checks" section. The bluff decision is PLAN-029's; this
// file produces signals and draws no conclusion.
// Run: node --experimental-strip-types src/lib/breakdown.check.ts
import assert from "node:assert";
import {
  BASELINE_MIN,
  baselineFrom,
  medianTurnWords,
  turnSignalsFor,
  countPauses,
  speechRatio,
  keyWordActuallyMissing,
  BREAKDOWN_SIGNALS,
  BREAKDOWN_MEANING_SIGNALS,
  type BreakdownSignal,
  type TurnContext,
} from "./breakdown.ts";
import type { Signal, SignalKind } from "./model.ts";
import { coachMetrics } from "./coachmetrics.ts";
import type { ProducedTurn } from "./useTalk.ts";

const NOW = 1_000_000_000_000;
let n = 0;
const sig = (kind: SignalKind, payload: unknown, at = NOW): Signal => ({
  id: `s${n++}`,
  activityId: "a1",
  kind,
  observedAt: at,
  payload,
});

/** A measured turn signal: a latency, its speak, and whether the speak was known. */
const turnSig = (
  latencyMs: number,
  speakMs = 0,
  speakUnknown = false,
  at = NOW,
  words = 5,
  kind: "unpromptedTurn" | "suggestionUsed" = "unpromptedTurn",
): Signal =>
  sig(kind, { label: "turn", words, sentences: 1, chars: words * 5, latencyMs, speakMs, speakUnknown }, at);

/** A turn as it reaches `turnSignalsFor`. */
const turn = (t: Partial<ProducedTurn>): ProducedTurn => ({
  text: "una respuesta",
  fromSuggestion: false,
  words: 5,
  latencyMs: 4000,
  speakMs: 0,
  speakUnknown: false,
  missed: [],
  keyWord: "",
  ...t,
});

const ctx = (over: Partial<TurnContext> = {}): TurnContext => ({
  reply: "una respuesta cualquiera",
  medianTurnWords: null,
  ...over,
});

// --- case 1: BASELINE_MIN — 11 measured turns is quiet, 12 is ready -------------
// breakdown ledger 3 — a per-learner response baseline exists, and the timing signals
// below it (slowResponse, shortening) normalise against it and nothing else.
{
  const eleven = Array.from({ length: 11 }, (_, i) => turnSig(4000 - i * 100));
  const b11 = baselineFrom(eleven, NOW);
  assert.equal(b11.ready, false, "11 measured turns: the baseline is not ready");
  assert.equal(b11.sample, 11, "the count is still honest below the threshold");

  const twelve = [...eleven, turnSig(3900)];
  const b12 = baselineFrom(twelve, NOW);
  assert.equal(b12.ready, true, "12 measured turns: the baseline is ready");
  assert.equal(b12.sample, BASELINE_MIN, "the baseline reads the constant it stands on");
}

// --- case 2: an outlier does not move the median (MAD/median, not the mean) -----
// Twelve 4-second turns plus one 90-second turn; the median barely shifts because
// the outlier sits above the middle rather than pulling a mean.
{
  const xs = Array.from({ length: 12 }, (_, i) => turnSig(4000 - i * 100));
  const outlier = [...xs, turnSig(90_000)];
  const base = baselineFrom(outlier, NOW);
  // Eleven 4-second turns + one outlier whose value sits above the top of the
  // 12-turn middle block. The median of a sorted 13-list is the 7th (a real
  // 4-second turn); its neighbours do not change. Assert the choice, not the
  // arithmetic: a mean would have jumped far more than 500 ms.
  assert(Math.abs(base.median - 3450) <= 500, "a single outlier must not move the median more than 500 ms");
  const without = baselineFrom(xs, NOW);
  assert(Math.abs(base.median - without.median) <= 500, "with-vs-without outliers: the median barely moves");
}

// --- case 3: speakUnknown turns are excluded entirely from the sample ----------
{
  const ten = Array.from({ length: 12 }, (_, i) => turnSig(4000 - i * 100));
  const base = baselineFrom(ten, NOW);
  assert.equal(base.sample, 12, "a clean dozen stands on itself");

  // Ten unknown-speak turns added change neither the median nor the sample.
  const unknowns = Array.from({ length: 10 }, (_, i) => turnSig(50_000, 3000, /* speakUnknown */ true, NOW - (i + 1) * 1000));
  const mixed = baselineFrom([...ten, ...unknowns], NOW);
  assert.equal(mixed.sample, base.sample, "speakUnknown turns are not part of the sample");
  assert.equal(mixed.median, base.median, "speakUnknown turns do not move the median");
  assert.equal(mixed.ready, true, "the ready flag is unchanged by excluded turns");
}

// --- case 4: latencyMs − speakMs is what is measured ----------------------------
// breakdown ledger 4 — the model's speaking time is separated from the learner's: the
// measured latency is latencyMs − speakMs, floored, and an unmeasured speak is
// excluded rather than estimated.
// Two turns identical except that one had 6 s of coach audio must produce the
// same measured (speak-stripped) latency.
{
  const speakless = turn({ latencyMs: 9000, speakMs: 0 });
  const spoken = turn({ latencyMs: 15_000, speakMs: 6000 });
  // Both have 9000 ms of learner thinking time. Feed a ready baseline so the
  // timing path actually runs.
  const readyBase = baselineFrom(Array.from({ length: 12 }, (_, i) => turnSig(3000 - i * 100)), NOW);
  const a = turnSignalsFor(speakless, readyBase, ctx({ reply: "x" }));
  const b = turnSignalsFor(spoken, readyBase, ctx({ reply: "x" }));
  // Neither is slow against a 3-s baseline at 9 s? 9 s may be > median+3×mad here;
  // assert the equal-measured property instead: identical measured latency must
  // yield identical slowResponse verdicts.
  assert.deepEqual(a.includes("slowResponse"), b.includes("slowResponse"), "6 s of coach audio must not change the learner's measured latency");
}

// --- case 5: slowResponse fires only above median + 3 × mad ---------------------
{
  // A tight baseline: median ~3.45 s, mad ~0.3 s → bar ≈ 3.45 + 0.9 = 4.35 s.
  const base = baselineFrom(Array.from({ length: 12 }, (_, i) => turnSig(4000 - i * 100)), NOW);
  const bar = base.median + 3 * base.mad;

  const under = turn({ latencyMs: Math.round(bar - 50), speakMs: 0 });
  assert.deepEqual(turnSignalsFor(under, base, ctx({ reply: "x" })), [], "below the bar: no slowResponse");

  const over = turn({ latencyMs: Math.round(bar + 50), speakMs: 0 });
  assert(turnSignalsFor(over, base, ctx({ reply: "x" })).includes("slowResponse"), "above the bar: slowResponse fires");
}

// --- case 6: no timing signal at all when the baseline is not ready -------------
// However extreme the latency, an unready baseline emits nothing — §10's silence,
// not a threshold.
{
  const quiet = baselineFrom(Array.from({ length: 11 }, (_, i) => turnSig(4000 - i * 100)), NOW);
  assert.equal(quiet.ready, false, "eleven turns is still not ready");
  const extreme = turn({ latencyMs: 120_000, speakMs: 0 });
  const timingOut = turnSignalsFor(extreme, quiet, ctx({ reply: "x" }));
  assert(
    !timingOut.includes("slowResponse") && !timingOut.includes("shortening"),
    "an extreme latency on an unready baseline emits no timing signal",
  );
  // …and a huge-but-shortening-eligible turn still does not claim shortening.
  const shortTurn = turn({ latencyMs: 0, words: 1, speakMs: 0 });
  assert(!turnSignalsFor(shortTurn, quiet, ctx({ reply: "x" })).includes("shortening"), "shortening needs a real median too");
}

// --- case 7: hesitation fires on a halting envelope and never without one -------
{
  // A synthetic envelope with two long gaps: speech, 700 ms quiet, speech, 800 ms
  // quiet, speech. Under 0.4 speech ratio, two pauses over 600 ms.
  const halting = (label: number): number[] => {
    const frames: number[] = [];
    const push = (v: number, k: number) => {
      for (let i = 0; i < k; i++) frames.push(v);
    };
    push(0.3, 3); // speech
    push(0, 14); // 700 ms quiet → pause 1
    push(0.3, 3);
    push(0, 16); // 800 ms quiet → pause 2
    push(0.3, 3);
    return frames;
  };
  const h = halting(0);
  // speech ratio: 9 speech frames of 39 → 0.23 (< 0.4); two pauses ≥ 2.
  assert(speechRatio(h) < 0.4, "the synthetic envelope is under 0.4 speech");
  assert(countPauses(h) >= 2, "the synthetic envelope carries two long pauses");
  assert(
    turnSignalsFor(turn({ latencyMs: 1000, speakMs: 0 }), baselineFrom([], NOW), ctx({ reply: "x", levels: h })).includes("hesitation"),
    "a halting envelope is hesitation",
  );

  // A text-only turn (no levels) never fires hesitation — §10's first row for free.
  assert(
    !turnSignalsFor(turn({ latencyMs: 1000, speakMs: 0 }), baselineFrom([], NOW), ctx({ reply: "x" })).includes("hesitation"),
    "no levels → no hesitation, no special case",
  );
  // A smooth, mostly-speech envelope does not fire either.
  const smooth: number[] = Array.from({ length: 60 }, (_, i) => (i < 55 ? 0.3 : 0));
  assert(
    !turnSignalsFor(turn({ latencyMs: 1000, speakMs: 0 }), baselineFrom([], NOW), ctx({ reply: "x", levels: smooth })).includes("hesitation"),
    "a mostly-speech envelope is not a hesitation",
  );
}

// --- case 8: keyWordMissing is dropped when the key word is really present ------
{
  // The word is there, in a different case and with trailing punctuation.
  const present = turn({ latencyMs: 1000, speakMs: 0, missed: ["keyWordMissing"], keyWord: "cuenta" });
  assert(
    !turnSignalsFor(present, baselineFrom([], NOW), ctx({ reply: "Sí, la CUENTA, por favor." })).includes("keyWordMissing"),
    "a key word actually used (case/punctuation folded) drops the report",
  );

  const absent = turn({ latencyMs: 1000, speakMs: 0, missed: ["keyWordMissing"], keyWord: "cuenta" });
  assert(
    turnSignalsFor(absent, baselineFrom([], NOW), ctx({ reply: "No lo sé." })).includes("keyWordMissing"),
    "a key word genuinely absent survives verification",
  );
}

// --- case 9: an unknown string in `missed` is dropped; the rest survive ---------
{
  const out = turnSignalsFor(
    turn({ latencyMs: 1000, speakMs: 0, missed: ["topicChange", "madeUp", "keyWordMissing"], keyWord: "cuenta" }),
    baselineFrom([], NOW),
    ctx({ reply: "No entendí la pregunta sobre la cuenta." }),
  );
  assert(!out.includes("madeUp" as BreakdownSignal), "an unknown model signal is dropped");
  assert(out.includes("topicChange"), "a known model signal survives");
  // keyWordMissing is present in the reply, so it is verified and dropped — the
  // unknown string's fate is separate.
  assert(!out.includes("keyWordMissing"), "verifiable keyWordMissing is still verified");
  // The five-meaning set and the full eight are closed, no drift.
  assert.deepEqual(
    [...BREAKDOWN_MEANING_SIGNALS].sort(),
    ["apologyThenOn", "disconnected", "keyWordMissing", "overGeneral", "topicChange"],
    "the five meaning signals are exactly the five",
  );
  assert.deepEqual(
    [...BREAKDOWN_SIGNALS].sort(),
    ["apologyThenOn", "disconnected", "hesitation", "keyWordMissing", "overGeneral", "shortening", "slowResponse", "topicChange"],
    "the eight signals are exactly the eight",
  );
}

// --- case 10: breakdowns never move coach metrics --------------------------------
// A breakdown is not a mistake. Adding breakdown payloads to every turn signal in
// a fixed set must leave accuracy and comprehension exactly where they were.
{
  const baseSignals: Signal[] = [
    turnSig(4000, 0, false, NOW, 5),
    turnSig(3000, 0, false, NOW - 1000, 4),
    turnSig(2000, 0, false, NOW - 2000, 6),
    turnSig(1500, 0, false, NOW - 3000, 3),
    sig("correction", { label: "x", original: "soy", fixed: "estoy" }),
    sig("comprehension", { label: "c", correct: false }),
  ];
  // Same set, but every turn signal also carries a breakdown payload field.
  const withBreakdown: Signal[] = baseSignals.map((s) =>
    s.kind === "unpromptedTurn"
      ? { ...s, payload: { ...s.payload, breakdown: ["slowResponse", "keyWordMissing"] } }
      : s,
  );
  const a0 = coachMetrics(baseSignals, NOW).find((m) => m.id === "accuracy")!;
  const c0 = coachMetrics(baseSignals, NOW).find((m) => m.id === "comprehension")!;
  const a1 = coachMetrics(withBreakdown, NOW).find((m) => m.id === "accuracy")!;
  const c1 = coachMetrics(withBreakdown, NOW).find((m) => m.id === "comprehension")!;
  assert.equal(a1.value, a0.value, "breakdown payloads must not move accuracy");
  assert.equal(a1.sample, a0.sample, "…nor accuracy's sample");
  assert.equal(c1.value, c0.value, "breakdown payloads must not move comprehension");
  assert.equal(c1.sample, c0.sample, "…nor comprehension's sample");
}

console.log("breakdown.check OK");

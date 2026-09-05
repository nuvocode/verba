// Runnable self-check for the Monitor Load profile (PLAN-045). Run:
// node --experimental-strip-types src/lib/profile.check.ts
//
// What is pinned here is the layer's first *reading*: four differences between
// the learner's own two conditions, never one number. §3.1 forbids the composite
// score by name, §3.2 forbids commenting on half the data, and ledger row 9's
// second half — "we measured it, you're genuinely fine" — is only sayable when
// the measurement was actually made.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { monitorProfile, profileReading, readingSentence, rowComment, pauseSentence, earnedPraise, SMALL_ACCURACY_DIFF, SMALL_RATE_DIFF, LOW_ACCURACY, PAUSE_DROP, type ProfileRow } from "./profile.ts";
import { turnSpoken, turnStats, monitorContext, timingRate, timingPauseRatio, type Signal } from "./model.ts";
import { talkSignals } from "./signals.ts";
import type { MonitorContext } from "./fluency.ts";
import { FALSE_ALARM_ON_SCREEN } from "./fluency.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// --- helpers: build one session's signals --------------------------------------
const sig = (activityId: string, kind: Signal["kind"], payload: unknown, at: number): Signal => ({
  id: `${activityId}-${kind}-${at}`,
  activityId,
  kind,
  observedAt: at,
  payload,
});

const PLANNED_FIRST_CALM: MonitorContext = {
  mode: "free",
  planningTimeSec: 30,
  taskRepetition: 1,
  interlocutorPressure: "none",
  topicFamiliarity: "prepared",
};
const UNPLANNED_THIRD_INTERRUPTED: MonitorContext = {
  mode: "free",
  planningTimeSec: 0,
  taskRepetition: 3,
  interlocutorPressure: "interrupting",
  topicFamiliarity: "novel",
};

/** One session: a context, two turns (all spoken or all typed), corrections, and one timing signal. */
function session(
  activityId: string,
  ctx: MonitorContext,
  opts: { spoken: boolean; corrections: number; wordsPerTurn: number; speechRate: number; at: number },
): Signal[] {
  const out: Signal[] = [sig(activityId, "sessionContext", ctx, opts.at)];
  for (let i = 0; i < opts.corrections; i++) out.push(sig(activityId, "correction", { label: "x" }, opts.at));
  for (let i = 0; i < 2; i++)
    out.push(
      sig(
        activityId,
        "unpromptedTurn",
        { label: "unaided turn", words: opts.wordsPerTurn, sentences: 1, chars: opts.wordsPerTurn * 5, spoken: opts.spoken },
        opts.at,
      ),
    );
  out.push(
    sig(activityId, "timing", { label: "spoken timing", speechRate: opts.speechRate, unit: "words per minute", definition: "how fast you spoke" }, opts.at),
  );
  return out;
}

/** The real caller's order: `recentSignals` is `ORDER BY observed_at DESC`. */
const recentFirst = (s: Signal[]): Signal[] => [...s].sort((a, b) => b.observedAt - a.observedAt);

// --- 1. the four rows ----------------------------------------------------------
// Each row's two sides come from the conditions the table names, with the number
// the table names. A hand-built signal set produces exactly four rows; changing
// one condition moves exactly one row.
{
  const four = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 90, at: 2000 }),
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 90, at: 1000 }),
  ]);
  const rows = monitorProfile(four);
  assert.equal(rows.length, 4, "a hand-built signal set produces exactly four rows");
  assert.deepEqual(
    rows.map((r) => r.id),
    ["writtenVsSpoken", "plannedVsUnplanned", "firstVsThird", "calmVsInterrupted"],
    "the four rows are §3.1's four comparisons, in order",
  );

  // Row 1 — written vs spoken accuracy, corrections per 100 words.
  const wv = rows.find((r) => r.id === "writtenVsSpoken")!;
  assert.equal(wv.a.label, "Written", "row 1's A side is the written condition");
  assert.equal(wv.b.label, "Spoken", "row 1's B side is the spoken condition");
  assert.equal(wv.a.value, 1.0, "2 corrections over 200 written words is 1.0 per 100");
  assert.equal(wv.b.value, 1.0, "2 corrections over 200 spoken words is 1.0 per 100");
  assert.equal(wv.a.sessions, 2, "two written sessions stand behind the A side");
  assert.equal(wv.b.sessions, 2, "two spoken sessions stand behind the B side");
  assert.equal(wv.unit, "corrections per 100 words", "row 1 carries its own unit");

  // Rows 2–4 — words per minute under each condition.
  const pv = rows.find((r) => r.id === "plannedVsUnplanned")!;
  assert.equal(pv.a.value, 100, "planned sessions average 100 wpm");
  assert.equal(pv.b.value, 90, "unplanned sessions average 90 wpm");
  assert.equal(pv.unit, "words per minute", "rows 2–4 share the wpm unit");
  const ft = rows.find((r) => r.id === "firstVsThird")!;
  assert.equal(ft.a.value, 100, "first pass averages 100 wpm");
  assert.equal(ft.b.value, 90, "third pass averages 90 wpm");
  const ci = rows.find((r) => r.id === "calmVsInterrupted")!;
  assert.equal(ci.a.value, 100, "unpressured averages 100 wpm");
  assert.equal(ci.b.value, 90, "interrupted averages 90 wpm");
}

// --- 2. the gates — §3.2, and fluency ledger 9 ---------------------------------
// Two sessions total ⇒ empty. Three sessions but one side of a row with a single
// sample ⇒ that row is *absent from the array*, not present with a null. And
// nothing renders below the bar: the Coach source has no branch that draws a
// heading, a count or a placeholder for an unmet profile.
{
  // 1. Two sessions total ⇒ empty.
  const two = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 2000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 1000 }),
  ]);
  assert.deepEqual(monitorProfile(two), [], "two sessions total ⇒ empty — nothing below the bar");

  // 2. Three sessions but one side of a row with a single sample ⇒ that row is
  //    absent, not present with a null. Here spoken has one session (a3), so
  //    writtenVsSpoken is absent while plannedVsUnplanned (both sides ≥2) survives.
  const thin = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 90, at: 2000 }),
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 90, at: 1000 }),
  ]);
  const thinRows = monitorProfile(thin);
  assert(
    !thinRows.some((r) => r.id === "writtenVsSpoken"),
    "fluency ledger 9: a row with one side thin is absent from the array, not present with a null",
  );
  assert(
    thinRows.some((r) => r.id === "plannedVsUnplanned"),
    "a row with both sides ≥2 survives",
  );

  // 3. Nothing renders below the bar — the Coach source has no branch that draws
  //    a heading, a count or a placeholder for an unmet profile. The profile
  //    section is gated on `profile.length > 0` and there is no empty-state
  //    branch and no "sessions left" teaser. Scoped to the profile section
  //    itself (the JSX gated on `profile.length > 0`), so the repair section's
  //    own "Not enough sessions" copy cannot satisfy the assertion.
  const coachSrc = readFileSync(join(ROOT, "src/views/Coach.tsx"), "utf8");
  assert(
    /profile\.length > 0 && \(/.test(coachSrc),
    "fluency ledger 9: the profile section renders only when the profile is non-empty",
  );
  const profileBlock = coachSrc.slice(coachSrc.indexOf("profile.length > 0 && ("));
  assert(
    !/profile\.length === 0/.test(profileBlock),
    "fluency ledger 9: there is no empty-state branch for the profile — nothing renders below the bar",
  );
  assert(
    !/sessions left|come back after|Not enough sessions/.test(profileBlock),
    "fluency ledger 9: no teaser or count of sessions left to go",
  );
}

// --- 3. noProblem is sayable, and only when it is true (fluency ledger 9) ------
// Four rows, all four differences under their threshold ⇒ noProblem. The same
// data with one row missing ⇒ null. One difference over its threshold ⇒ not
// noProblem.
{
  // 1. Four rows, all four differences small ⇒ noProblem.
  const noProblemSet = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 95, at: 2000 }),
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 95, at: 1000 }),
  ]);
  const npRows = monitorProfile(noProblemSet);
  assert.equal(npRows.length, 4, "the noProblem set produces all four rows");
  assert.equal(profileReading(npRows), "noProblem", "four small differences ⇒ noProblem");

  // 2. The same data with one row missing ⇒ null, never noProblem. Here a4 is
  //    calm rather than interrupted, so calmVsInterrupted is absent.
  const threeSet = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 95, at: 2000 }),
    ...session("a4", { ...UNPLANNED_THIRD_INTERRUPTED, interlocutorPressure: "none" }, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 95, at: 1000 }),
  ]);
  const threeRows = monitorProfile(threeSet);
  assert.equal(threeRows.length, 3, "the three-row set produces exactly three rows");
  assert.equal(profileReading(threeRows), null, "fluency ledger 9: three rows and a missing fourth ⇒ null, never noProblem");

  // 3. One difference over its threshold ⇒ not noProblem.
  const overSet = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 60, at: 2000 }),
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 60, at: 1000 }),
  ]);
  const overRows = monitorProfile(overSet);
  assert.equal(overRows.length, 4, "the over-threshold set produces all four rows");
  assert.notEqual(profileReading(overRows), "noProblem", "one difference over its threshold ⇒ not noProblem");

  // 4. knowledgeGap is asked *first*. A learner whose written accuracy is poor
  //    but consistently poor has four small differences, and asking noProblem
  //    first hands them "we measured it, you're genuinely fine" — the worst
  //    sentence this layer can produce. The level is a fact about one number;
  //    small differences at a bad level are not good news.
  const lowButEven = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 5, wordsPerTurn: 50, speechRate: 100, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 5, wordsPerTurn: 50, speechRate: 100, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 5, wordsPerTurn: 50, speechRate: 95, at: 2000 }),
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 5, wordsPerTurn: 50, speechRate: 95, at: 1000 }),
  ]);
  const lowRows = monitorProfile(lowButEven);
  assert.equal(lowRows.length, 4, "the low-but-even set produces all four rows");
  assert.equal(lowRows.find((r) => r.id === "writtenVsSpoken")!.a.value, 5, "written accuracy is 5.0 per 100 words — above the low bar");
  assert.equal(
    profileReading(lowRows),
    "knowledgeGap",
    "fluency ledger 9: four small differences at a poor level read as knowledgeGap, never \"you're genuinely fine\"",
  );

  // 5. No fall-through. A record that matches none of the signatures reads as
  //    null, not as whatever branch happens to be last. Here accuracy is fine,
  //    the written/spoken gap is large, and every rate is identical: it is not
  //    noProblem, it is not knowledgeGap, and nothing measurable separates
  //    monitorDominant from slowAccess — so the four rows speak for themselves.
  const noSignature = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 3, wordsPerTurn: 50, speechRate: 100, at: 2000 }),
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 3, wordsPerTurn: 50, speechRate: 100, at: 1000 }),
  ]);
  const noSigRows = monitorProfile(noSignature);
  assert.equal(noSigRows.length, 4, "the no-signature set produces all four rows");
  assert.equal(profileReading(noSigRows), null, "a record matching no signature reads as null — no branch is reached by falling through");

  // 6. monitorDominant and slowAccess are gated on the same constant the 4/3/2
  //    card's third column is: `falseAlarmRepair` is what §3.3 uses to separate
  //    them, PLAN-041's hand sample is still blank, and a verdict standing on a
  //    metric the learner cannot see is worse than printing the metric. Neither
  //    reading is reachable while the constant is false — and the sentences for
  //    them exist, so flipping it is one edit and not a rewrite.
  assert.equal(FALSE_ALARM_ON_SCREEN, false, "the hand sample is still blank — the two readings it separates stay shut");
  const profileSrcGate = readFileSync(join(ROOT, "src/lib/profile.ts"), "utf8");
  assert(
    /if \(!FALSE_ALARM_ON_SCREEN\) return null;/.test(profileSrcGate),
    "monitorDominant and slowAccess are shut behind FALSE_ALARM_ON_SCREEN, not behind a comment",
  );
  assert(readingSentence("monitorDominant").length > 0, "the monitorDominant sentence exists behind the gate");
  assert(readingSentence("slowAccess").length > 0, "the slowAccess sentence exists behind the gate");

  // 7. The thresholds are the only three, named with their units, in one place.
  assert.equal(SMALL_ACCURACY_DIFF, 1.0, "the accuracy threshold is 1.0 corrections per 100 words");
  assert.equal(SMALL_RATE_DIFF, 10, "the rate threshold is 10 words per minute");
  assert.equal(LOW_ACCURACY, 4.0, "the low-accuracy bar is 4.0 corrections per 100 words");
}

// --- 4. the kill switch --------------------------------------------------------
// With monitorLoad off no sessionContext or timing signal exists, so the profile
// is empty — asserted through talkSignals with context: null, the same door
// ledger rows 8 and 12 use.
{
  const base = {
    turns: 1,
    corrections: [],
    words: [],
    produced: [
      { text: "Hola.", fromSuggestion: false, words: 1, latencyMs: 1000, speakMs: 0, speakUnknown: false, missed: [], keyWord: "", breakdown: [], verdict: "clear" as const, spoken: false },
    ],
    summary: "",
    strengths: [],
    focus: [],
    selfRepairs: [],
    completion: { repairs: [], abandoned: [], l1: [], avoidance: null },
  };
  // The fixture has to be one that *could* produce a row. Corrections and turns
  // are ordinary signals — the kill switch does not touch them — so a run of
  // all-typed sessions cannot tell a working gate from a broken one: row 1 needs
  // both a written and a spoken side. Two of each, so a profile that read the
  // turns without their context would hand back writtenVsSpoken here.
  const offSignals: Signal[] = [];
  for (const [a, spoken] of [["a1", false], ["a2", false], ["a3", true], ["a4", true]] as const) {
    const drafts = talkSignals(
      a,
      { ...base, context: null, produced: [{ ...base.produced[0], spoken }, { ...base.produced[0], spoken }] },
      "es",
      "es",
    );
    drafts.forEach((d, i) => offSignals.push({ id: `${a}-${i}`, activityId: d.activityId, kind: d.kind, observedAt: i, payload: d.payload }));
  }
  assert(
    !offSignals.some((s) => s.kind === "sessionContext" || s.kind === "timing"),
    "context null (measurement off) writes no sessionContext or timing signal",
  );
  assert(
    offSignals.some((s) => turnSpoken(s) === true) && offSignals.some((s) => turnSpoken(s) === false),
    "the fixture holds both spoken and typed sessions — a profile ignoring the context would find row 1 here",
  );
  assert.deepEqual(
    monitorProfile(offSignals),
    [],
    "fluency ledger 9: with the measurement off the profile is empty — every row, not only the ones built from monitor kinds",
  );
}

// --- 5. no composite -----------------------------------------------------------
// §3.1 forbids the reduction, and this is what forbidding it looks like in code:
// profile.ts holds no score/total/index/composite/overall, and ProfileRow has no
// numeric field beyond the two sides.
{
  const profileSrc = readFileSync(join(ROOT, "src/lib/profile.ts"), "utf8");
  for (const word of ["score", "total", "index", "composite", "overall"]) {
    assert(!new RegExp(`\\b${word}\\b`).test(profileSrc), `profile.ts must not hold "${word}" — §3.1 forbids the composite`);
  }
  const rowBlock = profileSrc.match(/interface ProfileRow \{([\s\S]*?)\}/)?.[1] ?? "";
  assert(!/:\s*number/.test(rowBlock), "ProfileRow has no numeric field beyond the two sides");
}

// --- 6. the row-1 honesty rule and the window's order --------------------------
// A mixed spoken/typed session counts for neither side. And every function here
// is fed signals in recentSignals' real order (recent-first) — the order the
// caller actually passes, never a hand-picked one.
{
  // 1. A mixed session — some turns spoken, some typed — counts for neither side.
  //    Here a3 is mixed, so spoken has only a4 behind it and writtenVsSpoken is
  //    absent, while the rate rows (which read the context, not the turns) survive.
  const mixedSession = [
    sig("a3", "sessionContext", UNPLANNED_THIRD_INTERRUPTED, 2000),
    sig("a3", "correction", { label: "x" }, 2000),
    sig("a3", "unpromptedTurn", { label: "unaided turn", words: 50, sentences: 1, chars: 250, spoken: false }, 2000),
    sig("a3", "unpromptedTurn", { label: "unaided turn", words: 50, sentences: 1, chars: 250, spoken: true }, 2000),
    sig("a3", "timing", { label: "spoken timing", speechRate: 90, unit: "words per minute", definition: "how fast you spoke" }, 2000),
  ];
  const mixedSet = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 3000 }),
    ...mixedSession,
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 90, at: 1000 }),
  ]);
  const mixedRows = monitorProfile(mixedSet);
  assert(
    !mixedRows.some((r) => r.id === "writtenVsSpoken"),
    "a mixed spoken/typed session counts for neither side — absent, never approximated",
  );

  // 2. The window's order is the caller's: recent-first. The check feeds the real
  //    order, and the profile is a group-by, so the same set in any order yields
  //    the same rows.
  const four = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 90, at: 2000 }),
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 90, at: 1000 }),
  ]);
  assert(
    four.every((s, i) => i === 0 || four[i - 1].observedAt >= s.observedAt),
    "the check feeds signals in recentSignals' real order (recent-first)",
  );
  assert.deepEqual(
    monitorProfile([...four].reverse()).map((r) => r.id),
    monitorProfile(four).map((r) => r.id),
    "the profile is a group-by — order does not change the rows",
  );

  // 3. The doors the profile reads through are the model's own: turnSpoken,
  //    turnStats, monitorContext and timingRate all read a payload and return
  //    null for a signal that is not the right kind.
  assert.equal(turnSpoken(sig("a", "correction", { label: "x" }, 0)), null, "turnSpoken is null for a non-turn");
  assert.equal(turnSpoken(sig("a", "unpromptedTurn", { label: "t", spoken: true }, 0)), true, "turnSpoken reads a spoken turn");
  assert.equal(turnSpoken(sig("a", "unpromptedTurn", { label: "t", spoken: false }, 0)), false, "turnSpoken reads a typed turn");
  assert.equal(turnStats(sig("a", "correction", { label: "x" }, 0)), null, "turnStats is null for a non-turn");
  assert.equal(monitorContext(sig("a", "timing", { label: "t" }, 0)), null, "monitorContext is null for a non-context");
  assert.equal(timingRate(sig("a", "sessionContext", { label: "c" }, 0)), null, "timingRate is null for a non-timing");
  assert.equal(timingRate(sig("a", "timing", { label: "t", speechRate: 80 }, 0)), 80, "timingRate reads a timing signal");
}

// --- 7. the word scan — §6.1's "sayı verilir, sıfat verilmez" (PLAN-046) ------
// Every sentence this layer can emit is generated from fixtures and scanned
// against a pinned list of judgement adjectives and §6.3's therapy vocabulary.
// The scan is over generated output, not source text, so a sentence assembled
// from parts is covered. Probe: the scanner must reject a planted string, or it
// is a scanner that scans nothing.
{
  const BANNED = [
    "relax", "breathe", "calm down", "anxious", "anxiety", "confidence", "perfectionist",
    "don't worry", "great", "excellent", "poor", "bad", "impressive", "only", "healthy",
    "quite", "genuinely fine", "well done", "nice job", "perfect",
  ];
  const scan = (s: string): string[] => BANNED.filter((w) => s.toLowerCase().includes(w));

  // The eight rowComment forms — four rows, both sides of the threshold.
  const row = (id: ProfileRow["id"], a: number, b: number): ProfileRow => ({
    id,
    question: "q",
    a: { label: "A", value: a, sessions: 2 },
    b: { label: "B", value: b, sessions: 2 },
    unit: id === "writtenVsSpoken" ? "corrections per 100 words" : "words per minute",
    definition: "d",
  });
  const rowComments = [
    rowComment(row("writtenVsSpoken", 1.0, 1.0)),
    rowComment(row("writtenVsSpoken", 1.0, 3.0)),
    rowComment(row("plannedVsUnplanned", 100, 100)),
    rowComment(row("plannedVsUnplanned", 100, 80)),
    rowComment(row("firstVsThird", 100, 100)),
    rowComment(row("firstVsThird", 100, 80)),
    rowComment(row("calmVsInterrupted", 100, 100)),
    rowComment(row("calmVsInterrupted", 100, 80)),
  ];
  for (const s of rowComments) {
    assert(scan(s).length === 0, `rowComment must not carry a judgement adjective or therapy word: "${s}"`);
  }

  // The four readingSentence forms, pauseSentence, earnedPraise. pauseSentence
  // and earnedPraise are generated from a fixture that makes them non-null, so
  // the scan covers the actual sentences the layer can emit.
  const pauseSession = (
    activityId: string,
    ctx: MonitorContext,
    opts: { corrections: number; wordsPerTurn: number; pauseRatio: number; at: number },
  ): Signal[] => {
    const out: Signal[] = [sig(activityId, "sessionContext", ctx, opts.at)];
    for (let i = 0; i < opts.corrections; i++) out.push(sig(activityId, "correction", { label: "x" }, opts.at));
    for (let i = 0; i < 2; i++)
      out.push(
        sig(activityId, "unpromptedTurn", { label: "unaided turn", words: opts.wordsPerTurn, sentences: 1, chars: opts.wordsPerTurn * 5, spoken: true }, opts.at),
      );
    out.push(
      sig(activityId, "timing", { label: "spoken timing", speechRate: 100, midClausePauseRatio: opts.pauseRatio, unit: "wpm", definition: "d" }, opts.at),
    );
    return out;
  };
  const pauseFixture = recentFirst([
    ...pauseSession("a1", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 4000 }),
    ...pauseSession("a2", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 3000 }),
  ]);
  const sentences = [
    ...(["monitorDominant", "slowAccess", "knowledgeGap", "noProblem"] as const).map(readingSentence),
    pauseSentence(pauseFixture)!,
    earnedPraise(recentFirst([
      ...pauseSession("a1", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.3, at: 4000 }),
      ...pauseSession("a2", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.3, at: 3000 }),
      ...pauseSession("a3", UNPLANNED_THIRD_INTERRUPTED, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 2000 }),
      ...pauseSession("a4", UNPLANNED_THIRD_INTERRUPTED, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 1000 }),
    ]))!,
  ];
  for (const s of sentences) {
    assert(scan(s).length === 0, `a layer sentence must not carry a judgement adjective or therapy word: "${s}"`);
  }

  // Probe: the scanner must reject a planted string, or it is a scanner that
  // scans nothing.
  assert(scan("you're genuinely fine, great job").length > 0, "the scanner must reject a planted judgement string");
  assert(scan("relax and breathe").length > 0, "the scanner must reject a planted therapy string");
}

// --- 8. rowComment states the difference with its unit (PLAN-046) --------------
// All four rows, on both sides of the threshold — eight assertions, and the
// number must appear in the sentence.
{
  const row = (id: ProfileRow["id"], a: number, b: number): ProfileRow => ({
    id,
    question: "q",
    a: { label: "A", value: a, sessions: 2 },
    b: { label: "B", value: b, sessions: 2 },
    unit: id === "writtenVsSpoken" ? "corrections per 100 words" : "words per minute",
    definition: "d",
  });
  const cases: { r: ProfileRow; unit: string }[] = [
    { r: row("writtenVsSpoken", 1.0, 1.0), unit: "corrections per 100 words" },
    { r: row("writtenVsSpoken", 1.0, 3.0), unit: "corrections per 100 words" },
    { r: row("plannedVsUnplanned", 100, 100), unit: "words per minute" },
    { r: row("plannedVsUnplanned", 100, 80), unit: "words per minute" },
    { r: row("firstVsThird", 100, 100), unit: "words per minute" },
    { r: row("firstVsThird", 100, 80), unit: "words per minute" },
    { r: row("calmVsInterrupted", 100, 100), unit: "words per minute" },
    { r: row("calmVsInterrupted", 100, 80), unit: "words per minute" },
  ];
  for (const { r, unit } of cases) {
    const s = rowComment(r);
    assert(s.includes(unit), `rowComment must state the difference with its unit: "${s}"`);
    assert(/\d/.test(s), `rowComment must carry the difference as a number: "${s}"`);
  }
}

// --- 9. earnedPraise and pauseSentence (PLAN-046 §4, §3) ----------------------
// earnedPraise returns a sentence when pauses fall and accuracy holds; null on a
// fixture where pauses fall by the same amount and accuracy worsens past
// SMALL_ACCURACY_DIFF. Plus null on three measured sessions (under the
// four-session bar), and null with monitorLoad off. pauseSentence is null when
// no session carries a midClausePauseRatio, and carries the percentage and its
// definition when they do.
{
  // A session with a context, two spoken turns, corrections, and a timing signal
  // carrying a midClausePauseRatio.
  const session = (
    activityId: string,
    ctx: MonitorContext,
    opts: { corrections: number; wordsPerTurn: number; pauseRatio: number; at: number },
  ): Signal[] => {
    const out: Signal[] = [sig(activityId, "sessionContext", ctx, opts.at)];
    for (let i = 0; i < opts.corrections; i++) out.push(sig(activityId, "correction", { label: "x" }, opts.at));
    for (let i = 0; i < 2; i++)
      out.push(
        sig(activityId, "unpromptedTurn", { label: "unaided turn", words: opts.wordsPerTurn, sentences: 1, chars: opts.wordsPerTurn * 5, spoken: true }, opts.at),
      );
    out.push(
      sig(activityId, "timing", { label: "spoken timing", speechRate: 100, midClausePauseRatio: opts.pauseRatio, unit: "words per minute, ms, ratio", definition: "how fast you spoke" }, opts.at),
    );
    return out;
  };

  // 1. Pauses fall by PAUSE_DROP and accuracy holds ⇒ a sentence. The older
  //    sessions (lower observedAt) carry the higher pause; the newer carry the
  //    lower one — pauses fall over time.
  const praise = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.3, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.3, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 2000 }),
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 1000 }),
  ]);
  const praiseSentence = earnedPraise(praise);
  assert(praiseSentence !== null, "earnedPraise returns a sentence when pauses fall and accuracy holds");
  assert(praiseSentence!.includes("20"), "the praise sentence states the pause drop as a number");

  // 2. The assertion that matters: pauses fall by the same amount but accuracy
  //    worsens past SMALL_ACCURACY_DIFF ⇒ null. Here the newer half (a1, a2)
  //    has 4 corrections over 100 words (4.0) vs the older half's 1.0 — a
  //    worsening of 3.0, past the 1.0 bar.
  const accWorsened = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { corrections: 4, wordsPerTurn: 50, pauseRatio: 0.3, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { corrections: 4, wordsPerTurn: 50, pauseRatio: 0.3, at: 3000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 2000 }),
    ...session("a4", UNPLANNED_THIRD_INTERRUPTED, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 1000 }),
  ]);
  assert.equal(earnedPraise(accWorsened), null, "fluency ledger 10: pauses down but accuracy down ⇒ null — praise is a conjunction");

  // 3. Three measured sessions (under the four-session bar) ⇒ null.
  const three = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.3, at: 3000 }),
    ...session("a2", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.3, at: 2000 }),
    ...session("a3", UNPLANNED_THIRD_INTERRUPTED, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 1000 }),
  ]);
  assert.equal(earnedPraise(three), null, "earnedPraise is null under the four-session bar");

  // 4. monitorLoad off ⇒ null — the same kill-switch fixture PLAN-045's review
  //    added. With no sessionContext signal, no session qualifies.
  const base = {
    turns: 1,
    corrections: [],
    words: [],
    produced: [
      { text: "Hola.", fromSuggestion: false, words: 1, latencyMs: 1000, speakMs: 0, speakUnknown: false, missed: [], keyWord: "", breakdown: [], verdict: "clear" as const, spoken: false },
    ],
    summary: "",
    strengths: [],
    focus: [],
    selfRepairs: [],
    completion: { repairs: [], abandoned: [], l1: [], avoidance: null },
  };
  const offSignals: Signal[] = [];
  for (const [a, spoken] of [["a1", false], ["a2", false], ["a3", true], ["a4", true]] as const) {
    const drafts = talkSignals(
      a,
      { ...base, context: null, produced: [{ ...base.produced[0], spoken }, { ...base.produced[0], spoken }] },
      "es",
      "es",
    );
    drafts.forEach((d, i) => offSignals.push({ id: `${a}-${i}`, activityId: d.activityId, kind: d.kind, observedAt: i, payload: d.payload }));
  }
  assert.equal(earnedPraise(offSignals), null, "fluency ledger 10: with the measurement off, earnedPraise is null");

  // 5. pauseSentence is null when no session carries a midClausePauseRatio.
  const noPause = recentFirst([
    ...session("a1", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 4000 }),
    ...session("a2", PLANNED_FIRST_CALM, { corrections: 1, wordsPerTurn: 50, pauseRatio: 0.5, at: 3000 }),
  ]);
  // Strip the midClausePauseRatio from the timing payloads.
  const stripped = noPause.map((s) =>
    s.kind === "timing" ? { ...s, payload: { ...(s.payload as object), midClausePauseRatio: undefined } } : s,
  );
  assert.equal(pauseSentence(stripped), null, "pauseSentence is null when no session carries a midClausePauseRatio");

  // 6. pauseSentence carries the percentage and its definition when they do.
  const withPause = pauseSentence(noPause);
  assert(withPause !== null, "pauseSentence returns a sentence when sessions carry a midClausePauseRatio");
  assert(withPause!.includes("50"), "pauseSentence carries the mean ratio as a percentage");
  assert(/mid-clause/.test(withPause!), "pauseSentence says what a mid-clause pause means");

  // 7. timingPauseRatio is the door: null for a non-timing signal, reads a timing.
  assert.equal(timingPauseRatio(sig("a", "sessionContext", { label: "c" }, 0)), null, "timingPauseRatio is null for a non-timing");
  assert.equal(timingPauseRatio(sig("a", "timing", { label: "t", midClausePauseRatio: 0.4 }, 0)), 0.4, "timingPauseRatio reads a timing signal");
}

// --- 10. the shape the app really writes (PLAN-046 review) --------------------
// Every fixture above invents an activityId per session — `a1`, `a2`, … — and the
// app never does. `db.ts` stores `activity_id` as "the ActivityId within that
// day's plan" and `learn.ts` draws it from a fixed set, so every conversation the
// learner ever has is filed under `"talk"`. Grouping by it made `monitorProfile`
// return `[]` for any real record, which is to say the Monitor Load section could
// never render at all. This section is the same fixture written the way the app
// writes it: one activityId, sessions a day apart.
{
  const DAY_MS = 24 * 60 * 60 * 1000;
  const day = (d: number) => 1_000_000 + d * DAY_MS;
  const real = recentFirst([
    ...session("talk", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: day(0) }),
    ...session("talk", PLANNED_FIRST_CALM, { spoken: false, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: day(1) }),
    ...session("talk", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 90, at: day(2) }),
    ...session("talk", UNPLANNED_THIRD_INTERRUPTED, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 90, at: day(3) }),
  ]);
  assert.equal(new Set(real.map((x) => x.activityId)).size, 1, "the premise: four sessions, one activityId — what the app really writes");
  assert.deepEqual(
    monitorProfile(real).map((r) => r.id),
    ["writtenVsSpoken", "plannedVsUnplanned", "firstVsThird", "calmVsInterrupted"],
    "fluency ledger 9: four sessions under one activityId produce all four rows — the profile must survive the ids the app actually writes",
  );
  const six = recentFirst([
    ...session("talk", PLANNED_FIRST_CALM, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: day(0) }),
    ...session("talk", PLANNED_FIRST_CALM, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: day(1) }),
    ...session("talk", PLANNED_FIRST_CALM, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: day(2) }),
    ...session("talk", PLANNED_FIRST_CALM, { spoken: true, corrections: 1, wordsPerTurn: 50, speechRate: 100, at: day(3) }),
  ]);
  assert.equal(earnedPraise(six), null, "four sessions with a flat pause ratio earn nothing — praise is measured, not handed out");
}

// --- 11. rowComment says the difference in the row's own terms (PLAN-046 review)
// Row 1 is counted in corrections per 100 words: the higher number is the
// condition that was corrected *more*. Calling it "faster" was both meaningless
// and backwards — it read as the good end of the difference on the one row the
// whole reading is built on.
{
  const row1: ProfileRow = {
    id: "writtenVsSpoken",
    question: "q",
    a: { label: "Written", value: 2.0, sessions: 2 },
    b: { label: "Spoken", value: 5.0, sessions: 2 },
    unit: "corrections per 100 words",
    definition: "d",
  };
  const s1 = rowComment(row1);
  assert(!/fast/.test(s1), `an accuracy row may not talk about speed: "${s1}"`);
  assert(/Spoken carried more corrections than Written/.test(s1), `an accuracy row names which condition was corrected more: "${s1}"`);
  // The direction is not decorative: swapping the sides swaps the sentence.
  const swapped = rowComment({ ...row1, a: { ...row1.a, value: 5.0 }, b: { ...row1.b, value: 2.0 } });
  assert(/Written carried more corrections than Spoken/.test(swapped), `…and it follows the numbers: "${swapped}"`);
  // A rate row still talks about speed, because there the higher number is faster.
  const row3: ProfileRow = {
    id: "firstVsThird",
    question: "q",
    a: { label: "First pass", value: 80, sessions: 2 },
    b: { label: "Third pass", value: 110, sessions: 2 },
    unit: "words per minute",
    definition: "d",
  };
  assert(/Third pass was faster than First pass/.test(rowComment(row3)), "a rate row names the faster condition");
}

console.log("profile.check OK");

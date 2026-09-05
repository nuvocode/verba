// §3.1's Monitor Load profile — the first *reading* in the layer, derived from
// signals and never stored.
//
// A reading is a comparison between the same learner's own two conditions, and
// storing it would let it drift from the signals under it, the same way a stored
// weakness drifted from the evidence behind it (see weakness.ts's header). It
// would also travel badly: backup.ts syncs localStorage wholesale but not SQLite,
// so a stored reading would reach the second machine with no evidence beneath it.
// Recompute it; it is a group-by over a few hundred rows.
//
// §3.1 forbids reducing the profile to one number — a single number carries no
// meaning on its own, and handing the learner a monitor-load rating makes them
// feel assessed, which grows the very problem being measured. So the type cannot
// hold one: ProfileRow carries exactly two sides and nothing else numeric, and
// profile.check.ts scans this file for the words that would smuggle one in.
//
// Every reading here reads its sessions through `fluency.ts`'s `measuredSessions`
// — one place that knows what a session is (an `activityId` is a slot in the
// day's plan, not a session) and one place the kill switch acts, since a session
// with no readable `sessionContext` does not qualify at all.
import type { Signal } from "./model.ts";
import { turnSpoken, turnStats, timingRate, timingPauseRatio } from "./model.ts";
import type { MonitorContext } from "./fluency.ts";
import { FALSE_ALARM_ON_SCREEN, measuredSessions } from "./fluency.ts";

/** One side of one comparison — a condition, its value, and what it stands on. */
export interface Side {
  label: string; // the condition, as the learner reads it
  value: number | null; // null = this side was never measured
  sessions: number; // measured sessions behind it (§3.2's "at least 2")
}

/** One of §3.1's four differences. Never summed with the others. */
export interface ProfileRow {
  id: "writtenVsSpoken" | "plannedVsUnplanned" | "firstVsThird" | "calmVsInterrupted";
  question: string; // what the difference shows, in §3.1's words
  a: Side;
  b: Side;
  unit: string; // invariant 12
  definition: string; // invariant 12
}

/**
 * §3.3's four typical outcomes. `null` is a legitimate answer and the common
 * one — §3.3 lists the *typical* outcomes, not a partition of every record.
 * `monitorDominant` and `slowAccess` are unreachable until PLAN-041's hand
 * sample lands: see `profileReading`.
 */
export type Reading = "monitorDominant" | "slowAccess" | "knowledgeGap" | "noProblem";

// ponytail: first guesses, tuned against nothing yet. They are named, in one
// place, with their units, so tuning them is one edit and the check that pins
// them fails loudly. PLAN-041's hand sample is the precedent for how they should
// eventually be set: against a real sample, by a human, once.
export const SMALL_ACCURACY_DIFF = 1.0; // corrections per 100 words
export const SMALL_RATE_DIFF = 10; // words per minute
export const LOW_ACCURACY = 4.0; // corrections per 100 words — §3.3's "written accuracy is low too"
// PLAN-046: how far the mid-clause pause ratio must fall (as a 0–1 fraction)
// before §6.2's praise is earned — ten percentage points. A smaller drop is
// noise, not a trend.
export const PAUSE_DROP = 0.1;

/**
 * One side of row 1 — written or spoken accuracy, as corrections per 100 words.
 *
 * §3.1's honesty rule: corrections are filed per session, not per turn, so a
 * session that mixes speech and typing cannot say which half its corrections
 * belong to. Only a session whose measured turns are *all* spoken is a spoken
 * sample, and only one whose turns are *all* typed is a written sample — a mixed
 * session counts for neither side. Absent, never approximated.
 *
 * The rate is pooled across the qualifying sessions: the sum of corrections over
 * the sum of words, times 100. A session with no measurable words contributes
 * no rate.
 */
function accuracySide(signals: Signal[], which: "written" | "spoken"): Side {
  let corrections = 0;
  let words = 0;
  let sessions = 0;
  for (const { sigs } of measuredSessions(signals)) {
    const turns = sigs.filter((s) => s.kind === "unpromptedTurn" || s.kind === "suggestionUsed");
    if (turns.length === 0) continue; // no measured turns → neither side
    const flags = turns.map((t) => turnSpoken(t));
    if (flags.some((f) => f === null)) continue; // an unreadable turn → neither side
    const allSpoken = flags.every((f) => f === true);
    const allTyped = flags.every((f) => f === false);
    if (which === "spoken" && !allSpoken) continue;
    if (which === "written" && !allTyped) continue;
    // A mixed session (some spoken, some typed) falls through both branches.
    let w = 0;
    for (const t of turns) {
      const stats = turnStats(t);
      if (stats) w += stats.words;
    }
    if (w === 0) continue; // no measurable words → no rate
    sessions += 1;
    corrections += sigs.filter((s) => s.kind === "correction").length;
    words += w;
  }
  return {
    label: which === "spoken" ? "Spoken" : "Written",
    value: words > 0 ? (corrections / words) * 100 : null,
    sessions,
  };
}

/**
 * One side of rows 2–4 — words per minute under a condition.
 *
 * A session contributes when its `sessionContext` matches the condition and it
 * carries at least one `timing` signal; the session's rate is the mean of its
 * timing signals' speechRate, and the side's value is the mean across sessions.
 * A session with the right context but no timing measurement has no wpm and
 * contributes nothing.
 */
function rateSide(signals: Signal[], match: (ctx: MonitorContext) => boolean, label: string): Side {
  const sessionRates: number[] = [];
  for (const { ctx, sigs } of measuredSessions(signals)) {
    if (!match(ctx)) continue;
    const rates = sigs
      .filter((s) => s.kind === "timing")
      .map((t) => timingRate(t))
      .filter((r): r is number => r !== null);
    if (rates.length === 0) continue;
    sessionRates.push(rates.reduce((a, b) => a + b, 0) / rates.length);
  }
  return {
    label,
    value: sessionRates.length > 0 ? sessionRates.reduce((a, b) => a + b, 0) / sessionRates.length : null,
    sessions: sessionRates.length,
  };
}

/**
 * §3.1's four differences, as data — or an empty array when the record is too
 * thin to read at all.
 *
 * Three hard gates (§3.2):
 *   1. At least three distinct sessions across the whole record.
 *   2. At least two sessions on each side of a row. A row with one side thin is
 *      **absent** — not zero, not a dash, not "—". It is not in the array.
 *   3. Nothing at all below the bar: if no row survives, the array is empty and
 *      the Coach screen renders nothing on the subject.
 *
 * `signals` is fed in `recentSignals`' real order (recent-first) — the order the
 * caller passes. The profile is a group-by, so the order does not change the
 * result, but the contract is part of every function here.
 */
export function monitorProfile(signals: Signal[]): ProfileRow[] {
  // §3.2's first bar counts *measured* sessions — the ones carrying a context.
  // With the measurement off there are none, and the profile is empty here
  // rather than one row further down.
  if (measuredSessions(signals).length < 3) return [];

  const rows: ProfileRow[] = [];

  const written = accuracySide(signals, "written");
  const spoken = accuracySide(signals, "spoken");
  if (written.sessions >= 2 && spoken.sessions >= 2) {
    rows.push({
      id: "writtenVsSpoken",
      question: "Written vs spoken accuracy — a small gap means the knowledge is there, the problem is production.",
      a: written,
      b: spoken,
      unit: "corrections per 100 words",
      definition: "how often you corrected yourself per 100 words",
    });
  }

  const planned = rateSide(signals, (c) => c.planningTimeSec > 0, "Planned");
  const unplanned = rateSide(signals, (c) => c.planningTimeSec === 0, "Unplanned");
  if (planned.sessions >= 2 && unplanned.sessions >= 2) {
    rows.push({
      id: "plannedVsUnplanned",
      question: "Planned vs unplanned — a large gap means a formulation bottleneck.",
      a: planned,
      b: unplanned,
      unit: "words per minute",
      definition: "how fast you got language out",
    });
  }

  const first = rateSide(signals, (c) => c.taskRepetition === 1, "First pass");
  const third = rateSide(signals, (c) => c.taskRepetition === 3, "Third pass");
  if (first.sessions >= 2 && third.sessions >= 2) {
    rows.push({
      id: "firstVsThird",
      question: "First vs third pass (4/3/2) — a large gap means the capacity is there, access is slow.",
      a: first,
      b: third,
      unit: "words per minute",
      definition: "how fast you got language out",
    });
  }

  const calm = rateSide(signals, (c) => c.interlocutorPressure === "none", "Unpressured");
  const interrupted = rateSide(signals, (c) => c.interlocutorPressure === "interrupting", "Interrupted");
  if (calm.sessions >= 2 && interrupted.sessions >= 2) {
    rows.push({
      id: "calmVsInterrupted",
      question: "Unpressured vs interrupted — a large gap means social pressure dominates.",
      a: calm,
      b: interrupted,
      unit: "words per minute",
      definition: "how fast you got language out",
    });
  }

  return rows;
}

/**
 * §3.3's reading of the profile, or null when the data does not support one.
 *
 * `null` is a legitimate answer and the common one: §3.3 lists four *typical*
 * outcomes, not a partition of every possible record. A reading reached by
 * falling through the other three is a reading forced onto data that does not
 * support it — the same failure as a reading on thin data, wearing a different
 * coat, and the more dangerous one because it is the branch most learners land
 * in. So every outcome here is reached by its own signature or not at all.
 *
 * The order matters, and it is not the spec's order. **`knowledgeGap` is asked
 * first**, because §3.3's "written accuracy is low too" is a fact about one
 * number, not about a difference — and a learner whose written accuracy is poor
 * but *consistently* poor has four small differences. Asking `noProblem` first
 * hands them "we measured it, you're genuinely fine", which is the worst sentence
 * this layer can produce.
 */
export function profileReading(rows: ProfileRow[]): Reading | null {
  const row1 = rows.find((r) => r.id === "writtenVsSpoken");
  if (!row1 || row1.a.value === null || row1.b.value === null) return null;
  const written = row1.a.value;
  const accuracyGap = Math.abs(written - row1.b.value);

  // knowledgeGap — §3.3's "written accuracy is low too". Asked first: it is a
  // statement about the level, not about a difference, and small differences at
  // a poor level are not good news. This layer then steps aside.
  if (written >= LOW_ACCURACY) return "knowledgeGap";

  const rateRows = rows.filter((r) => r.id !== "writtenVsSpoken");
  const measuredRates = rateRows.filter((r) => r.a.value !== null && r.b.value !== null);
  const rateGap = (r: ProfileRow) => Math.abs(r.a.value! - r.b.value!);

  // noProblem — every difference small, and the accuracy they are small *at* is
  // fine (the gate above). All four rows must exist: "all differences are small"
  // is a claim about four differences, and three of them is not it.
  if (rows.length === 4 && measuredRates.length === 3 && accuracyGap < SMALL_ACCURACY_DIFF && measuredRates.every((r) => rateGap(r) < SMALL_RATE_DIFF)) {
    return "noProblem";
  }

  // monitorDominant and slowAccess are not separable with what this plan can
  // weigh, and neither is returned until they are.
  //
  // §3.3 gives monitorDominant "written ≈ spoken accuracy, high falseAlarmRepair,
  // high midClausePauseRatio" and slowAccess "accuracy fine, high
  // initiationLatency and pauses, *low* falseAlarmRepair". Strip
  // `falseAlarmRepair` — PLAN-041's hand sample is still blank, and PLAN-044
  // already pinned that an unvalidated metric may not reach a screen — and the
  // two descriptions collapse onto the same evidence: accuracy is fine, and
  // production moves between conditions. The marker that separates them is the
  // one we are not allowed to weigh.
  //
  // Naming either of them here would be a verdict standing on a metric the
  // learner cannot see, which is worse than printing the metric. So the four
  // rows speak for themselves and the reading is null. `FALSE_ALARM_ON_SCREEN`
  // is the flip, and it is PLAN-041's to make: the same constant that gates the
  // 4/3/2 card's third column gates these two readings, because it is the same
  // missing evidence.
  if (!FALSE_ALARM_ON_SCREEN) return null;

  // Past the flip: written ≈ spoken is the monitor's signature, and a rate that
  // moves between conditions with accuracy intact is slow access.
  if (accuracyGap < SMALL_ACCURACY_DIFF && measuredRates.some((r) => rateGap(r) >= SMALL_RATE_DIFF)) return "monitorDominant";
  if (measuredRates.some((r) => rateGap(r) >= SMALL_RATE_DIFF)) return "slowAccess";
  return null;
}

/**
 * The one sentence the Coach renders for a reading. PLAN-046 owns how it is
 * worded; this plan renders it plainly. `monitorDominant`'s sentence names the
 * marker it could not weigh — not as a hedge about the conclusion, as a fact
 * about the evidence.
 */
export function readingSentence(reading: Reading): string {
  switch (reading) {
    case "monitorDominant":
      return "Your written and spoken accuracy are close, which points to the monitor rather than to the knowledge.";
    case "slowAccess":
      return "Your accuracy is fine, but the gap between conditions points to slow access — getting language out takes longer than it should.";
    case "knowledgeGap":
      return "Your written accuracy is low too, so this is a knowledge gap rather than a production one.";
    case "noProblem":
      // PLAN-046: the one sentence in the layer that could be read as a verdict.
      // It names what was measured rather than pronouncing on the learner — the
      // differences are small, and that is the fact, not a judgement about them.
      return "We measured your written and spoken accuracy and your speaking rate across conditions, and the differences are all small.";
  }
}

/**
 * §6.1's mirror, one row at a time (PLAN-046 §3): the one plain sentence about
 * *that* comparison that §7.3 asks each profile row to carry. Four rules, all
 * from §6.1:
 *   1. The sentence carries the difference as a number, with its unit.
 *   2. No adjective of judgement — the difference is stated and what it *means*
 *      is stated; how the learner should feel about it is not.
 *   3. The comparison is to themselves — no band norm, no "typical learner".
 *   4. A threshold crossing is named as a threshold, not as a verdict: the
 *      sentence says the difference is under or over the small-difference line.
 *
 * Two forms per row — under the line and over it — chosen against
 * `SMALL_ACCURACY_DIFF` (row 1) and `SMALL_RATE_DIFF` (rows 2–4). Both sides of
 * a surviving row are always measured, so both values are numbers here.
 */
export function rowComment(row: ProfileRow): string {
  const a = row.a.value!;
  const b = row.b.value!;
  const diff = Math.abs(a - b);
  const accuracy = row.id === "writtenVsSpoken";
  const line = accuracy ? SMALL_ACCURACY_DIFF : SMALL_RATE_DIFF;
  const small = diff < line;
  const head = `The difference is ${diff.toFixed(1)} ${row.unit} — ${small ? "under" : "over"} the small-difference line of ${line.toFixed(1)}`;
  if (small) return `${head}, so the two conditions are close.`;
  // Which way the difference runs, said in the row's own terms. Row 1 is counted
  // in corrections per 100 words, where the *higher* number is the condition
  // that was corrected more — calling it "faster" would be meaningless there and,
  // worse, would read as the good end of the difference. Rows 2-4 are words per
  // minute, where the higher number really is the faster condition.
  const high = a > b ? row.a.label : row.b.label;
  const low = a > b ? row.b.label : row.a.label;
  return accuracy
    ? `${head}, and ${high} carried more corrections than ${low}.`
    : `${head}, and ${high} was faster than ${low}.`;
}

/**
 * The pause sentence (PLAN-046 §3): the one piece of direct evidence about the
 * monitor that is not behind `FALSE_ALARM_ON_SCREEN`. The mean mid-clause pause
 * ratio across the measured sessions, as a percentage, with what a mid-clause
 * pause means. `null` when no measured session carried a `midClausePauseRatio` —
 * absent, never zero, and never a 0 % that means "we did not look".
 *
 * It reads `measuredSessions` like everything else in the file, so the kill
 * switch covers it for free: with `monitorLoad` off no `sessionContext` signal
 * is written, no session qualifies, and the sentence is null.
 */
export function pauseSentence(signals: Signal[]): string | null {
  const ratios: number[] = [];
  for (const { sigs } of measuredSessions(signals)) {
    for (const s of sigs) {
      const r = timingPauseRatio(s);
      if (r !== null) ratios.push(r);
    }
  }
  if (ratios.length === 0) return null;
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const pct = Math.round(mean * 100);
  return `${pct}% of your pauses were mid-clause — you were checking yourself as you built the sentence.`;
}

/**
 * §6.2's earned praise (PLAN-046 §4): the layer's own thesis turned into a
 * condition — `midClausePauseRatio` falling while accuracy holds. Nothing else
 * in this milestone congratulates anybody.
 *
 * Takes `measuredSessions` (oldest first) and splits it into an older and a
 * newer half. Requires **at least four** measured sessions — two a
 * side; fewer returns `null`, silently, like every other thin-data path in this
 * layer. Praise **only** when the pause ratio fell by at least `PAUSE_DROP`
 * **and** accuracy did not worsen by more than `SMALL_ACCURACY_DIFF`. Both
 * halves, or nothing.
 *
 * The sentence states both numbers and says what it means: they paused
 * mid-clause less and their accuracy did not pay for it. No exclamation mark, no
 * "great job", no adjective — the scan in profile.check.ts covers this sentence
 * too.
 *
 * `falseAlarmRepair`'s half of §6.2 stays behind `FALSE_ALARM_ON_SCREEN` with
 * the others — written, unreachable, and commented as such.
 *
 * ponytail: two halves of the record is not a trend line, and the comment says
 * so — two halves, not a trend; a real slope needs the sessions we do not have
 * yet. Four sessions split down the middle is the smallest thing that can tell
 * "falling" from "noisy", and it is the honest ceiling until the record is long
 * enough to fit anything better.
 */
export function earnedPraise(signals: Signal[]): string | null {
  // `measuredSessions` is oldest-first by contract, so the halves below are a
  // chronology and not whatever order the caller's query happened to return.
  const sessions = measuredSessions(signals);
  if (sessions.length < 4) return null;
  const half = Math.floor(sessions.length / 2);
  const older = sessions.slice(0, half);
  const newer = sessions.slice(half);

  const meanPause = (list: { sigs: Signal[] }[]): number | null => {
    const ratios: number[] = [];
    for (const { sigs } of list)
      for (const s of sigs) {
        const r = timingPauseRatio(s);
        if (r !== null) ratios.push(r);
      }
    return ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
  };
  const olderPause = meanPause(older);
  const newerPause = meanPause(newer);
  if (olderPause === null || newerPause === null) return null;

  // Accuracy, pooled the same way `accuracySide` pools it: corrections over
  // words, times 100, across the half's sessions.
  const accuracy = (list: { sigs: Signal[] }[]): number | null => {
    let corrections = 0;
    let words = 0;
    for (const { sigs } of list) {
      for (const s of sigs) {
        if (s.kind === "correction") corrections += 1;
        else if (s.kind === "unpromptedTurn" || s.kind === "suggestionUsed") {
          const stats = turnStats(s);
          if (stats) words += stats.words;
        }
      }
    }
    return words > 0 ? (corrections / words) * 100 : null;
  };
  const olderAcc = accuracy(older);
  const newerAcc = accuracy(newer);
  if (olderAcc === null || newerAcc === null) return null;

  const pauseDrop = olderPause - newerPause;
  const accWorsened = newerAcc - olderAcc;
  if (pauseDrop < PAUSE_DROP) return null;
  if (accWorsened > SMALL_ACCURACY_DIFF) return null;

  const dropPct = Math.round(pauseDrop * 100);
  return `Your mid-clause pauses fell by ${dropPct} percentage points, and your accuracy did not pay for it — you checked yourself less and it cost nothing.`;
}

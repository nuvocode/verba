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
import type { Signal } from "./model.ts";
import { turnSpoken, turnStats, monitorContext, timingRate } from "./model.ts";
import type { MonitorContext } from "./fluency.ts";
import { FALSE_ALARM_ON_SCREEN } from "./fluency.ts";

/** One side of one comparison — a condition, its value, and what it stands on. */
export interface Side {
  label: string; // the condition, as the learner reads it
  value: number | null; // null = this side was never measured
  sessions: number; // distinct activityIds behind it (§3.2's "at least 2")
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

/**
 * The sessions this profile may read: grouped by `activityId`, and **only those
 * carrying a readable `sessionContext`**.
 *
 * That condition is the kill switch, structurally. §3.2's third bullet is that
 * turning the profile off stops the *measurement*, not just the display — and
 * with `monitorLoad` off no `sessionContext` signal is written, so no session
 * qualifies and every row is empty by construction. Gating only rows 2–4 on the
 * context would leave row 1 standing: corrections and turns are ordinary
 * signals, written whatever the switch says, so a learner who had turned the
 * measurement off would still be handed a written-vs-spoken comparison.
 *
 * It is also the rule §2.4 already states: a measurement without its context
 * cannot be compared, and every row here is a comparison between conditions. A
 * session whose conditions are unknown does not belong on either side of one.
 */
function measuredSessions(signals: Signal[]): Map<string, { ctx: MonitorContext; sigs: Signal[] }> {
  const grouped = new Map<string, Signal[]>();
  for (const s of signals) {
    const list = grouped.get(s.activityId);
    if (list) list.push(s);
    else grouped.set(s.activityId, [s]);
  }
  const out = new Map<string, { ctx: MonitorContext; sigs: Signal[] }>();
  for (const [id, sigs] of grouped) {
    const ctxSig = sigs.find((s) => s.kind === "sessionContext");
    const ctx = ctxSig ? monitorContext(ctxSig) : null;
    if (ctx) out.set(id, { ctx, sigs });
  }
  return out;
}

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
  for (const [, { sigs }] of measuredSessions(signals)) {
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
  for (const [, { ctx, sigs }] of measuredSessions(signals)) {
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
  if (measuredSessions(signals).size < 3) return [];

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
      return "We measured it — you're genuinely fine.";
  }
}

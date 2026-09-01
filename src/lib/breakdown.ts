// The collection half of breakdown detection (PLAN-028): a baseline that belongs
// to the learner, and the eight signals that grade against it. PLAN-029 owns the
// decision — everything here produces signals and draws no conclusion from them.
//
// §10 is the spine. No threshold is hardcoded: every timing bar normalises against
// the learner's own history. A turn whose latency cannot be separated from the
// coach's is *excluded*, not estimated and not zeroed. A signal that is
// unmeasurable is absent, not zero.
import type { Signal, SignalKind } from "./model.ts";
import { turnStats, turnTiming } from "./model.ts";
import type { ProducedTurn } from "./useTalk.ts";

// --- the eight signals ---------------------------------------------------------

/** The eight breakdown signals. Three are measured here; five are the model's. */
export type BreakdownSignal =
  | "slowResponse" // measured latency > median + 3 × mad
  | "disconnected" // the reply does not answer what was asked
  | "overGeneral" // "yes", "maybe", "sure" and nothing else
  | "apologyThenOn" // "sorry"/"pardon" followed by carrying on
  | "keyWordMissing" // the coach's key word appears nowhere in the reply
  | "topicChange" // the reply starts a different subject
  | "hesitation" // audible: broken delivery in the RMS envelope
  | "shortening"; // this turn is far shorter than the learner's own norm

/** The closed set of all eight — pinned by breakdown.check so it cannot drift. */
export const BREAKDOWN_SIGNALS: readonly BreakdownSignal[] = [
  "slowResponse",
  "disconnected",
  "overGeneral",
  "apologyThenOn",
  "keyWordMissing",
  "topicChange",
  "hesitation",
  "shortening",
];

/**
 * The five signals that are judgements about meaning. Verba has exactly one
 * component that can make those — the model — so these ride the turn JSON and are
 * verified on our side before they count. `parseTurn` filters against this set so
 * nothing invented travels further; `turnSignalsFor` re-checks the observable ones.
 */
export const BREAKDOWN_MEANING_SIGNALS: readonly BreakdownSignal[] = [
  "disconnected",
  "overGeneral",
  "apologyThenOn",
  "keyWordMissing",
  "topicChange",
];

export const isBreakdownSignal = (s: string): s is BreakdownSignal =>
  (BREAKDOWN_SIGNALS as readonly string[]).includes(s);

// --- the RMS floor and the pause count ------------------------------------------

/**
 * The RMS ceiling that means "there is a voice right now". 0.02 is the silence
 * detector's floor in speech.ts and, before this plan, a private copy in
 * signals.ts. It is shared here so the two live in one place — speech.ts cannot
 * import this, so its copy is still the original; this is the second, not a third.
 */
export const SPEECH_FLOOR = 0.02;

/** Pauses over 600 ms in an envelope, using ~20 frames/s — the same count voiceSignals makes. */
export function countPauses(levels: number[]): number {
  let pauses = 0;
  let quiet = 0;
  for (const l of levels) {
    if (l > SPEECH_FLOOR) {
      if (quiet > 0.6) pauses++;
      quiet = 0;
    } else {
      quiet += 1 / 20;
    }
  }
  return pauses;
}

/** How much of an envelope carried speech, 0–1. 1 for an empty envelope. */
export function speechRatio(levels: number[]): number {
  if (!levels.length) return 1;
  return levels.filter((l) => l > SPEECH_FLOOR).length / levels.length;
}

// --- the measured latency -------------------------------------------------------

/**
 * The learner's thinking time for one turn: the measured latency with the coach's
 * speak time stripped out, floored at 0. Returns 0 for an unmeasured turn (its
 * latency row was not carried through the signal) — an absent measurement reads as
 * no measurement, not as an instant answer. When the turn's `speakUnknown` is true
 * the caller must exclude it; we still floor a measured number here, but the
 * baseline never sees those.
 */
export function measuredLatency(measured: number | null, speakMs: number): number {
  if (measured === null) return 0;
  return Math.max(0, measured - (speakMs || 0));
}

// --- the baseline ---------------------------------------------------------------

export interface Baseline {
  /** Median measured latency, ms. */
  median: number;
  /** Median absolute deviation, ms — the spread this learner normally has. */
  mad: number;
  /** Measured turns behind it. */
  sample: number;
  /** False until `sample >= BASELINE_MIN`. Everything timing-related stands down. */
  ready: boolean;
}

export const BASELINE_MIN = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Median of a list of numbers. 0 for an empty list. */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation: the median of `|x - median|`. 0 for an empty list. */
function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/**
 * A turn signal's measured learner latency, with the coach's speech stripped out.
 * `null` for a signal that is not a well-measured turn, and excluded for one whose
 * speakMs is unknown — §10's rule, implemented as an absence.
 */
function measuredFromSignal(s: Signal): number | null {
  if (s.kind !== "unpromptedTurn" && s.kind !== "suggestionUsed") return null;
  const t = turnTiming(s);
  if (!t || t.speakUnknown) return null;
  return Math.max(0, t.latencyMs - t.speakMs);
}

/** The turn kinds a measured latency rides on. */
const LATENCY_KINDS: readonly SignalKind[] = ["unpromptedTurn", "suggestionUsed"];

/**
 * The baseline over the last 30 days for the language those signals were recorded
 * under. Median and MAD rather than mean and standard deviation — one 90-second
 * turn where the learner answered the door should not move the bar for a month.
 *
 * Reads `unpromptedTurn` and `suggestionUsed` signals that carry a measured
 * latency and ignores the rest. Below `BASELINE_MIN` it returns `ready: false`
 * and no timing signal is ever emitted — the first sessions of a new learner are
 * quiet by construction rather than by a special case.
 */
export function baselineFrom(signals: Signal[], now: number): Baseline {
  const cutoff = now - 30 * DAY_MS;
  const measured: number[] = [];
  for (const s of signals) {
    if (!(LATENCY_KINDS as readonly string[]).includes(s.kind)) continue;
    if (s.observedAt < cutoff || s.observedAt > now) continue;
    const lat = measuredFromSignal(s);
    if (lat === null) continue;
    measured.push(lat);
  }
  const ready = measured.length >= BASELINE_MIN;
  return { median: median(measured), mad: mad(measured), sample: measured.length, ready };
}

// --- shortening: measured against the learner's own norm ------------------------

/**
 * This turn's word count below half the learner's median turn length, computed
 * from the same signal window as the baseline, and only when that median stands on
 * `BASELINE_MIN` turns. Same median — same immunity to an outlier.
 */
export function medianTurnWords(signals: Signal[], now: number): number | null {
  const cutoff = now - 30 * DAY_MS;
  const lengths: number[] = [];
  for (const s of signals) {
    if (s.kind !== "unpromptedTurn" && s.kind !== "suggestionUsed") continue;
    if (s.observedAt < cutoff || s.observedAt > now) continue;
    const stats = turnStats(s);
    if (!stats) continue;
    lengths.push(stats.words);
  }
  if (lengths.length < BASELINE_MIN) return null;
  return median(lengths);
}

// --- the verification gates -----------------------------------------------------

/** Fold case + punctuation + whitespace, the way questions.ts folds answers. */
const fold = (s: string): string => s.toLocaleLowerCase().replace(/\p{P}/gu, "").replace(/\s+/g, " ").trim();

/**
 * The key word a model said was missing, checked against the learner's reply.
 * A word that is plainly present — after case, punctuation and whitespace folding —
 * drops the `keyWordMissing` report: the model may point, we check (PLAN-027's
 * principle, applied to breakdowns).
 */
export function keyWordActuallyMissing(keyWord: string, reply: string): boolean {
  const k = fold(keyWord);
  if (!k) return true; // no key word named → nothing to verify → trust nothing
  return !fold(reply).includes(k);
}
// --- one turn, its signals ------------------------------------------------------

/**
 * The per-turn context `turnSignalsFor` needs beyond the turn itself. Timing
 * signals only fire when the baseline is ready; `medianTurnWords` gates
 * `shortening`; `reply` is what `keyWordMissing` is verified against; `levels`
 * is the voice envelope `hesitation` is measured from. The turn's own `missed`
 * and `keyWord` are read off the turn.
 */
export interface TurnContext {
  /** The learner's reply — what `keyWordMissing` is verified against. */
  reply: string;
  /** The learner's own median turn length, when it stands on enough turns. */
  medianTurnWords: number | null;
  /** The voice envelope, when the turn was spoken — what `hesitation` is measured from. */
  levels?: number[];
}

/** The meaning signals we believe: the model reported them and, where observable, we verified them. */
function verifiedMeaning(turn: ProducedTurn, ctx: TurnContext): BreakdownSignal[] {
  const out: BreakdownSignal[] = [];
  for (const label of turn.missed ?? []) {
    if (!isBreakdownSignal(label)) continue;
    if (label === "keyWordMissing") {
      // Verify the claim: a word plainly in the reply drops the report.
      if (keyWordActuallyMissing(turn.keyWord, ctx.reply)) out.push("keyWordMissing");
      continue;
    }
    // The other four are judgements about meaning only the model can make. We
    // verified the one that had a checkable object; the rest ride as reported.
    out.push(label);
  }
  return out;
}

/**
 * The measured timing signals for one turn: `slowResponse` and `shortening`.
 * Nothing fires when the baseline stands on too few turns — §10's "signals are
 * unreliable" row, and the reason a new learner is quiet by construction.
 */
function verifiedTiming(turn: ProducedTurn, baseline: Baseline, ctx: TurnContext): BreakdownSignal[] {
  const out: BreakdownSignal[] = [];
  if (!baseline.ready) return out;
  // slowResponse — measured latency above median + 3 × mad. A turn whose latency
  // could not be separated from the coach's (speakUnknown) is excluded, not zeroed.
  if (turn.latencyMs !== null && !turn.speakUnknown) {
    const lat = measuredLatency(turn.latencyMs, turn.speakMs);
    if (lat > baseline.median + 3 * baseline.mad) out.push("slowResponse");
  }
  // shortening — this turn's words below half the learner's own median, only when
  // that median is real. An unmeasurable baseline means no shortening is claimed.
  if (ctx.medianTurnWords !== null && turn.words < ctx.medianTurnWords / 2) out.push("shortening");
  return out;
}

/**
 * The voice-delivery signal: a turn whose envelope is halting. A text-only turn
 * (no levels) never carries it — §10's first row falls out for free, not by a
 * special case.
 */
function verifiedHesitation(ctx: TurnContext): BreakdownSignal[] {
  if (!ctx.levels || !ctx.levels.length) return [];
  if (speechRatio(ctx.levels) < 0.4 && countPauses(ctx.levels) >= 2) return ["hesitation"];
  return [];
}

/**
 * The `BreakdownSignal[]` for one turn: measured three (slow, shortening,
 * hesitation) plus the verified model-reported five. An empty array is the normal
 * answer — a well-measured, on-topic turn is not a breakdown. This is the 
 * collection half; the decision over what these mean is PLAN-029's.
 */
export function turnSignalsFor(turn: ProducedTurn, baseline: Baseline, ctx: TurnContext): BreakdownSignal[] {
  return [...verifiedTiming(turn, baseline, ctx), ...verifiedMeaning(turn, ctx), ...verifiedHesitation(ctx)];
}

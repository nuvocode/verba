// The context every M7 measurement rides with, and the closed set of monitor
// kinds the kill switch can delete. Pure by the same contract difficulty.ts and
// patience.ts hold: no provider, no ./db.ts, no React, no clock — it takes
// values and returns values, so fluency.check.ts can drive it in a bare Node
// process.
//
// Spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §2.4, §7.4, §9.
import type { ActivityId, SignalDraft, SignalKind } from "./model.ts";
import type { VoiceTurn } from "./useTalk.ts";
import type { SelfRepairReport } from "./prompts.ts";
import { words, clauseCount } from "./text.ts";
import { pauseLengths, leadingSilence, speechRuns, speechRatio, fromFirstSpeech } from "./breakdown.ts";

/**
 * The conditions one session ran under (§2.4). Written once per session, not
 * copied onto every turn: every field here is a property of the session, and a
 * per-turn copy is six fields that can disagree with each other.
 *
 * `modality` is deliberately absent — it is the one condition that varies inside
 * a session, so it rides the turn (`ProducedTurn.spoken`) instead.
 */
export interface MonitorContext {
  mode: "fluency" | "accuracy" | "free";
  planningTimeSec: number; // 0 = no planning
  taskRepetition: 1 | 2 | 3; // which pass over the same content
  interlocutorPressure: "none" | "paced" | "interrupting";
  topicFamiliarity: "prepared" | "novel";
}

/** What an ordinary conversation is: no mode, no planning, first pass, no pressure. */
export const FREE_CONTEXT: MonitorContext = {
  mode: "free",
  planningTimeSec: 0,
  taskRepetition: 1,
  interlocutorPressure: "none",
  topicFamiliarity: "novel",
};

/**
 * The six signal kinds this milestone writes. The kill switch deletes exactly
 * these.
 *
 * Declared here in full even though five of the six kinds have no writer until
 * PLAN-040–042. That is the point: the kill switch has to be able to delete a
 * kind the moment the kind exists, and a list that grows plan by plan is a list
 * that is one plan behind at every moment. `fluency.check.ts` pins it closed.
 */
export const MONITOR_KINDS: readonly SignalKind[] = [
  "sessionContext",
  "timing",
  "selfRepair",
  "abandonedUtterance",
  "l1Fallback",
  "avoidance",
];

/**
 * The session-context signal, the single builder. Written once per session,
 * beside the turn signals at the same stamp so `recapsFrom` groups it into the
 * session it describes.
 */
export function sessionContextSignal(activityId: ActivityId, ctx: MonitorContext): SignalDraft {
  return {
    activityId,
    kind: "sessionContext",
    payload: { ...ctx },
  };
}

// --- §2.1: the six timing numbers ----------------------------------------------

/**
 * Filled pauses, per pack. Matched as whole words against `words(text, locale)`.
 * Single words only: a multi-word filler ("o sea", "you know") cannot be matched
 * against a word list, and a missed filler under-reports — the safe direction —
 * while a phrase matcher would be a number nobody reads on its own.
 *
 * The rule for what belongs here: only tokens whose *lexical* use is rare enough
 * that counting them as fillers under-reports rather than over-reports. A token
 * that is also a common function word ("o", "sea", "é", "あの", "その", "so",
 * "also", "e", "ya", "well", "like") would be counted as a filler every time it
 * is used for its real meaning, inflating the number — so those are excluded.
 * What stays is the hesitation sound: the token a learner reaches for when the
 * word is not coming, and that is rarely a word they mean.
 */
export const FILLERS: Record<string, string[]> = {
  en: ["uh", "um", "er"],
  es: ["eh", "este", "pues"],
  fr: ["euh", "ben", "bah", "voilà", "genre"],
  de: ["äh", "ähm", "halt"],
  it: ["eh", "ehm", "cioè", "tipo", "allora"],
  pt: ["tipo", "né", "então", "assim"],
  ja: ["えー", "まあ", "うーん"],
  tr: ["şey", "yani", "işte", "hani"],
  id: ["anu", "hmm", "gitu"],
};

/** What one spoken recording measured (§2.1). Every field may be null: absent, never zero. */
export interface Timing {
  /** ms from the coach finishing to the learner's first sound. Null when unmeasurable. */
  initiationLatency: number | null;
  /** words per minute over the whole recording, pauses included. */
  speechRate: number;
  /** words per minute over the speaking time only. */
  articulationRate: number;
  /** mean words per run of speech, runs separated by pauses over 250 ms. */
  meanLengthOfRun: number;
  /** 0–1, a lower bound (D2). Null when the recording holds no pause at all. */
  midClausePauseRatio: number | null;
  /** filled pauses per 100 words. Null for a pack with no filler list. */
  filledPauseRate: number | null;
}

/**
 * The six timing numbers for one spoken recording, or null when the recording
 * has no words, no envelope, or is under 1.5 s — the same floor `pace` uses, and
 * for the same reason: a one-word answer has no tempo.
 */
export function timingOf(v: VoiceTurn, packId: string): Timing | null {
  if (v.ms < 1500 || !v.text.trim() || !v.levels.length) return null;
  const ws = words(v.text, v.locale);
  const wordCount = ws.length;
  if (!wordCount) return null;

  const initiationLatency =
    v.initiationMs === null || v.initiationMs === undefined
      ? null
      : (() => {
          const lead = leadingSilence(v.levels);
          return lead === null ? null : v.initiationMs + lead;
        })();

  // The utterance is the envelope from the first speech frame onward — the
  // leading silence belongs to `initiationLatency` and is counted exactly once.
  // Every timing measurement reads through this slice, so a learner who opened
  // the mic and thought for three seconds has not paused mid-utterance.
  const spoke = fromFirstSpeech(v.levels);
  // An envelope that holds no speech frame at all — the mic opened and nothing
  // was said — measures nothing. Without this, `utteranceMs` is 0 and both rates
  // divide by it to `Infinity`, which is a number nobody can read.
  if (!spoke.length) return null;
  const utteranceMs = v.ms * (spoke.length / v.levels.length);

  const speechRate = wordCount / (utteranceMs / 60000);
  const articulationRate = wordCount / ((utteranceMs * speechRatio(spoke)) / 60000);
  const meanLengthOfRun = wordCount / Math.max(1, speechRuns(spoke, 0.25));

  const P = pauseLengths(spoke, 0.25).length;
  const midClausePauseRatio = P === 0 ? null : Math.max(0, P - (clauseCount(v.text, v.locale) - 1)) / P;

  const fillers = FILLERS[packId];
  const fillerCount = fillers ? ws.filter((w) => fillers.includes(w)).length : 0;
  const filledPauseRate = fillers ? (100 * fillerCount) / wordCount : null;

  return {
    initiationLatency,
    speechRate,
    articulationRate,
    meanLengthOfRun,
    midClausePauseRatio,
    filledPauseRate,
  };
}

/** The `timing` signal for one spoken recording, carrying every field plus its unit and definition. */
export function timingSignal(activityId: ActivityId, t: Timing): SignalDraft {
  return {
    activityId,
    kind: "timing",
    payload: {
      label: "spoken timing",
      ...t,
      unit: "words per minute, ms, ratio",
      definition: "how fast you spoke, how long before you started, and where you paused",
    },
  };
}

// --- §2.2: self-repair ---------------------------------------------------------

/** * The folding every §2.2 verification compares through, and the one place it is
 * written: case and punctuation differences survive, a different word does not.
 * The same rule `verifyCorrections` uses.
 */
export function foldText(s: string, locale: string): string {
  return s.toLocaleLowerCase(locale).replace(/\p{P}/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * A span the learner actually said, and where. The one door every §2.2/§2.3
 * verification goes through — fold, find, and (for a pair) check the order
 * *inside* the line as well as across lines, because one recording is one line
 * and a self-repair lives entirely inside it.
 *
 * Returns the 0-based line index and the folded character offset where the span
 * starts, or `null` when the span is not in the transcript at all.
 */
export function saidAt(transcript: string[], span: string, locale: string): { line: number; at: number } | null {
  if (!span.trim()) return null;
  const needle = foldText(span, locale);
  for (let i = 0; i < transcript.length; i++) {
    const at = foldText(transcript[i], locale).indexOf(needle);
    if (at !== -1) return { line: i, at };
  }
  return null;
}

/**
 * True when `after` starts after `before` ends — same line, or any later line.
 * A pair that cannot both be found yields false.
 */
export function saidInOrder(transcript: string[], before: string, after: string, locale: string): boolean {
  const b = saidAt(transcript, before, locale);
  if (!b) return false;
  const a = saidAt(transcript, after, locale);
  if (!a) return false;
  if (a.line > b.line) return true;
  if (a.line < b.line) return false;
  // Same line: `after` must start strictly after `before` *ends* — `after`
  // overlapping `before` is not a rebuild.
  return a.at >= b.at + foldText(before, locale).length;
}

/** * The self-repairs we believe, out of what the model reported.
 *
 * Two gates, both local:
 *
 * 1. **It happened.** `before` and `after` must both appear in the transcript,
 *    `before` ahead of `after` — *inside a single recording* when the pair lives
 *    in one line, not just across lines — compared through `saidInOrder`, so the
 *    intra-line ordering PLAN-041's cross-line test missed is checked. A repair
 *    whose fragments are not in the text the learner produced, or whose reported
 *    order did not happen, was authored by the model, and it is dropped — not
 *    softened, dropped.
 *
 * 2. **It was a false alarm.** A `falseAlarm` claim is downgraded to `A` when the
 *    coach corrected that same fragment in the same session: the coach saying it
 *    was wrong and the reporter saying it was right cannot both stand, and the
 *    coach's correction is the one the learner already saw on screen. Matching is
 *    on the folded `original` of every `Correction`, exact — no substring, no
 *    paraphrase, the `praiseGate` rule.
 *
 * A downgrade rather than a drop, because the repair itself was observed; only
 * the claim about its needlessness failed. Dropping it would lose a real event.
 */
export function verifySelfRepairs(
  reported: SelfRepairReport[],
  transcript: string[],
  corrections: { original: string }[],
  locale: string,
): SelfRepairReport[] {
  const corrected = corrections.map((c) => foldText(c.original, locale));

  const kept: SelfRepairReport[] = [];
  for (const r of reported) {
    const before = r.before;
    const after = r.after;
    if (!before || !after) continue;
    // Gate 1: both fragments must be in the text the learner produced, `before`
    // ahead of `after` — the learner rebuilt forwards, or the model described
    // something that did not happen.
    if (!saidInOrder(transcript, before, after, locale)) continue;
    // Gate 2: a falseAlarm on a phrase the coach corrected in the same session
    // is downgraded to A — the coach's correction is the one the learner saw.
    if (r.type === "falseAlarm" && corrected.includes(foldText(before, locale))) {
      kept.push({ ...r, type: "A" });
      continue;
    }
    kept.push(r);
  }
  return kept;
}

/** One `selfRepair` signal. The single builder. */
export function selfRepairSignal(activityId: ActivityId, r: SelfRepairReport): SignalDraft {
  return {
    activityId,
    kind: "selfRepair",
    payload: {
      label: "structure you doubted",
      type: r.type,
      before: r.before,
      after: r.after,
      unit: "count",
      definition: "a phrase you interrupted and rebuilt",
    },
  };
}

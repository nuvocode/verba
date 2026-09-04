// The context every M7 measurement rides with, and the closed set of monitor
// kinds the kill switch can delete. Pure by the same contract difficulty.ts and
// patience.ts hold: no provider, no ./db.ts, no React, no clock — it takes
// values and returns values, so fluency.check.ts can drive it in a bare Node
// process.
//
// Spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §2.4, §7.4, §9.
import type { ActivityId, SignalDraft, SignalKind } from "./model.ts";
import type { VoiceTurn } from "./useTalk.ts";
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

// What each surface observed, as signals (§1.3). One function per surface, all
// pure: they take what the surface already has and return drafts. The ids and the
// clock are stamped later, at the single door (useDay.complete).
//
// `label` is the field Coach groups evidence on, so it carries the thing a
// weakness would end up being named after. Everything else in a payload rides
// along unread — signalLabel (lib/model) is the only structural reader there is.
import type { SignalDraft, ActivityId } from "./model.ts";
import type { Grade } from "./srs.ts";
import { words, sentenceCount } from "./text.ts";
import type { ProducedTurn, Reflection, VoiceTurn } from "./useTalk.ts";
import { repairSignal, type RepairObservation } from "./repair.ts";
import { countPauses, speechRatio } from "./breakdown.ts";

/**
 * A finished conversation. A correction with no note names nothing, so it is not
 * evidence of anything; every turn the learner produced is measured where it was
 * produced, because Coach reads signals and nothing else (§2.6).
 *
 * One signal per turn rather than one per session: an average computed here would
 * be a number Coach could not recount, and a session that mixed one long unaided
 * answer with four picked suggestions would arrive as a single middling figure.
 */
export function talkSignals(activityId: ActivityId, r: Reflection, locale: string): SignalDraft[] {
  return [
    ...r.corrections
      .filter((c) => c.note.trim() !== "")
      .map((c) => ({
        activityId,
        kind: "correction" as const,
        payload: { label: c.note, original: c.original, fixed: c.fixed, severity: c.severity },
      })),
    ...r.words.map((w) => ({
      activityId,
      kind: "lexicalItem" as const,
      payload: { label: w.term, translation: w.translation },
    })),
    ...r.produced.map((t) => turnSignal(activityId, t, locale)),
    // What the mic observed, per spoken turn — pace and delivery.
    ...(r.voice ?? []).flatMap((v) => voiceSignals(activityId, v)),
    // Times the learner asked to see the coach's text (PLAN-021). Recorded, never
    // scored — each ask is one assisted comprehension signal.
    ...(r.reveals ?? []).map((rv) => revealSignal(activityId, rv.what)),
    // Every repair move the learner used or the coach modelled (PLAN-027). One
    // signal per observation, written through repair.ts — nothing else constructs
    // the payload, and the inventory is derived from these alone.
    ...repairSignals(activityId, r.repairs ?? []),
    // The difficulty axis a session ran with, and whether the learner asked for
    // ease (PLAN-031). Both ride the record so Coach can see the pattern; neither
    // is ever scored. Written beside the turn signals so recapsFrom can group them
    // into the session they belong to.
    ...(r.axis ? [{ activityId, kind: "axisUsed" as const, payload: { label: r.axis } }] : []),
    ...(r.easeRequested ? [{ activityId, kind: "easeRequest" as const, payload: { label: "ease requested" } }] : []),
  ];
}

/**
 * A repair observation as a signal. One per observation, written through
 * `repair.ts`'s door so the payload shape has a single builder.
 */
export function repairSignals(activityId: ActivityId, observations: RepairObservation[]): SignalDraft[] {
  return observations.map((obs) => repairSignal(activityId, obs));
}

// The two labels a produced turn can carry. Fixed, not per-turn: a turn's own text
// is unique, so grouping on it would mean no weakness could ever collect its three
// pieces of evidence — the same reason READING and LISTENING are fixed below.
export const TURN = "unaided turn";
export const SUGGESTED = "suggested turn";

function turnSignal(activityId: ActivityId, t: ProducedTurn, locale: string): SignalDraft {
  const ws = words(t.text, locale);
  const payload = {
    label: t.fromSuggestion ? SUGGESTED : TURN,
    words: ws.length,
    sentences: Math.max(1, sentenceCount(t.text, locale)),
    chars: ws.reduce((n, w) => n + w.length, 0),
    // Timing (PLAN-028): how long this send took measured from the coach's line
    // landing, and how much of that was the coach's own voice holding the floor.
    // `speakUnknown` marks a turn whose speak duration could not be measured —
    // it is excluded from the baseline and timing signals entirely.
    latencyMs: t.latencyMs,
    speakMs: t.speakMs,
    speakUnknown: t.speakUnknown,
    // The decision (PLAN-029): the verdict this turn earned and the signals it
    // stood on. Ridden unread — `signalMiss` and `coachMetrics` never look here,
    // so a bluff stays arithmetically invisible. Nothing reads `verdict` to
    // compute a number the learner sees; PLAN-037 turns the distribution into a
    // direction in words, and that is the only reader there will be.
    breakdown: t.breakdown,
    verdict: t.verdict,
  };
  return t.fromSuggestion
    ? { activityId, kind: "suggestionUsed" as const, payload }
    : { activityId, kind: "unpromptedTurn" as const, payload };
}

/**
 * What a spoken turn observed, beside what it said. Two drafts, both with a unit
 * and a definition the Coach can print (invariant 12):
 *
 * - **pace** — words per minute, from the locale's own word count. Skipped when
 *   the turn is under 1.5 s or the text is empty: a one-word answer has no tempo.
 * - **pronunciation** — not phoneme scoring (no engine can do that honestly yet),
 *   but *delivery*: the fraction of the recording that carried speech, and how
 *   often the learner paused. Both are real observations with a real definition.
 */
export function voiceSignals(
  activityId: ActivityId,
  v: VoiceTurn,
): SignalDraft[] {
  const out: SignalDraft[] = [];

  // Pace: words per minute. A turn under 1.5 s or with no words has no tempo.
  if (v.ms >= 1500 && v.text.trim()) {
    const ws = words(v.text, v.locale).length;
    const wpm = ws / (v.ms / 60000);
    out.push({
      activityId,
      kind: "pace" as const,
      payload: {
        label: "speaking pace",
        wpm: Math.round(wpm * 10) / 10,
        unit: "words per minute",
        definition: "how many words you spoke per minute",
      },
    });
  }

  // Pronunciation → delivery: how much of the recording carried speech, and how
  // often the learner paused. The threshold is the silence detector's floor in
  // speech.ts and the hesitation checker's floor in breakdown.ts — one shared
  // constant, so "speech" means the same thing the recorder and the breakdown
  // half both heard (PLAN-028, the no-third-copy rule).
  if (v.levels.length) {
    const ratio = speechRatio(v.levels);
    const pauses = countPauses(v.levels);
    out.push({
      activityId,
      kind: "pronunciation" as const,
      payload: {
        label: "spoken delivery",
        speechRatio: Math.round(ratio * 100) / 100,
        pauses,
        unit: "fraction of speech, pauses",
        definition: "how much of your recording was speech, and how often you paused",
      },
    });
  }

  return out;
}

/**
 * A question the learner actually answered. Surfaces hand these over already
 * filtered — an unanswered question is not an observation, and the skip path
 * through a comprehension check leaves plenty of those behind.
 */
export interface GradedQuestion {
  prompt: string;
  given: string;
  answer: string;
  correct: boolean;
  /** The transcript was open for this question's chapter (PLAN-026). Optional — reading never sets it. */
  assisted?: boolean;
}

// The two comprehension labels are fixed rather than per-question: a question's
// own text is unique to its passage, so grouping on it would mean a weakness could
// never collect its three pieces of evidence. These are what a weakness gets named.
const READING = "reading comprehension";
const LISTENING = "listening comprehension";

/**
 * A finished passage: every graded question, right or wrong, plus the words that
 * were saved off it. A correct answer is an observation too — Coach decides later
 * which of them count as evidence of anything.
 */
export function readSignals(
  activityId: ActivityId,
  graded: (GradedQuestion & { qKind: string })[],
  savedWords: string[],
): SignalDraft[] {
  return [
    ...graded.map((q) => ({
      activityId,
      kind: "comprehension" as const,
      payload: { label: READING, correct: q.correct, prompt: q.prompt, given: q.given, answer: q.answer, qKind: q.qKind },
    })),
    ...savedWords.map((term) => ({
      activityId,
      kind: "lexicalItem" as const,
      payload: { label: term },
    })),
  ];
}

/** A finished listening piece: every graded question across its chapters. */
export function listenSignals(activityId: ActivityId, graded: GradedQuestion[]): SignalDraft[] {
  return graded.map((q) => ({
    activityId,
    kind: "comprehension" as const,
    payload: {
      label: LISTENING,
      correct: q.correct,
      prompt: q.prompt,
      given: q.given,
      answer: q.answer,
      // PLAN-026: the transcript was open for this chapter. Recorded, never
      // scored — the learner had the text available, and that is the fact being
      // recorded. Coach filters assisted signals out of its metrics, so this
      // moves no number.
      ...(q.assisted
        ? { assisted: true, source: "listen-transcript", definition: "you had the transcript open for this chapter" }
        : {}),
    },
  }));
}

/**
 * A finished review queue: one signal per card that was actually graded. The label
 * is the card itself — a word missed three times is a weakness about that word,
 * not about reviewing.
 */
export function memorySignals(activityId: ActivityId, reviews: { term: string; grade: Grade }[]): SignalDraft[] {
  return reviews.map((r) => ({
    activityId,
    kind: "lexicalItem" as const,
    payload: { label: r.term, grade: r.grade },
  }));
}

/**
 * A comprehension signal marked assisted. Recorded, never scored.
 *
 * The learner asked to see the coach's text (PLAN-021) — that is a comprehension
 * moment, and it is deliberately *not* a penalty: `assisted: true` and the
 * `source` let Coach and confidence tell a reveal from a wrong answer, and
 * nothing counts it against the learner. `confidence.ts` must not import this,
 * and `coachmetrics.ts` must filter assisted reveals out of its accuracy term.
 */
export function revealSignal(activityId: ActivityId, what: "line" | "all"): SignalDraft {
  return {
    activityId,
    kind: "comprehension" as const,
    payload: {
      label: "talk subtitles",
      assisted: true,
      source: "talk-subtitles",
      what,
      definition: "you asked to see the coach's text",
    },
  };
}

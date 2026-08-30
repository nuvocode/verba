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
import type { ProducedTurn, Reflection } from "./useTalk.ts";

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
  ];
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
  };
  return t.fromSuggestion
    ? { activityId, kind: "suggestionUsed" as const, payload }
    : { activityId, kind: "unpromptedTurn" as const, payload };
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
    payload: { label: LISTENING, correct: q.correct, prompt: q.prompt, given: q.given, answer: q.answer },
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

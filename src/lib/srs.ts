// SM-2 lite spaced repetition. Pure functions — no I/O — so they stay testable.

export const DAY_MS = 24 * 60 * 60 * 1000;

export type Grade = 0 | 1 | 2; // 0 = again, 1 = good, 2 = easy

export interface CardState {
  ease: number; // ~1.3 (hard) .. 2.5+ (easy)
  interval: number; // days until next review
  reps: number; // consecutive successful reviews
}

export const newCard: CardState = { ease: 2.5, interval: 0, reps: 0 };

/** Return the updated card state and the next due timestamp (epoch ms). */
export function schedule(card: CardState, grade: Grade, now: number): CardState & { due: number } {
  let { ease, interval, reps } = card;

  if (grade === 0) {
    // failed: reset streak, show again in 10 minutes
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    return { ease, interval, reps, due: now + 10 * 60 * 1000 };
  }

  reps += 1;
  if (reps === 1) interval = 1;
  else if (reps === 2) interval = 3;
  else interval = Math.max(1, Math.round(interval * ease));

  ease = grade === 2 ? ease + 0.15 : Math.max(1.3, ease - 0.02);
  return { ease, interval, reps, due: now + interval * DAY_MS };
}

const BLANK = "‗‗‗‗‗";

/**
 * Blank a term out of the sentence it was met in — recall in context beats recall
 * in isolation. Falls back to appending the blank when the term doesn't appear
 * verbatim (an inflected form, or no example at all).
 */
export function cloze(term: string, example: string): string {
  if (!example.trim()) return BLANK;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = example.replace(new RegExp(escaped, "i"), BLANK);
  return out === example ? `${example} — ${BLANK}` : out;
}

/** How settled a card is, 0..1: a fresh card reads weak, a three-week interval solid. */
export function strength(card: { interval: number }): number {
  return Math.max(0.08, Math.min(1, card.interval / 21));
}

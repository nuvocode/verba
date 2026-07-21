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

// A cloze front used to live here: the term blanked out of the sentence it was met
// in. It was dropped because it could not hold its own promise — a separable verb
// ("walk through" met as "Let me walk you through the menu") never matches
// literally, so the blank was tacked onto the end of an otherwise complete sentence
// and the card asked nothing. Memory now tests the term against its meaning, and
// shows the sentence as context; see Memory.tsx.

/** How settled a card is, 0..1: a fresh card reads weak, a three-week interval solid. */
export function strength(card: { interval: number }): number {
  return Math.max(0.08, Math.min(1, card.interval / 21));
}

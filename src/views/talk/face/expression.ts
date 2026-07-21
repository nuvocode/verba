// Which expression the coach is wearing, and for how long.
//
// The states the task asks for are not the same kind of thing, and treating them
// alike is what makes an expression system feel broken. Two are *situations* that
// last as long as the situation does — the learner is typing, the session is
// wrapping up. Two are *moments*: a correction arrived, a goal was met. A moment
// that stays on the face is a coach frozen mid-reaction; a situation that decays
// is a coach who stops listening while you are still typing.
//
// So moments arrive as a cue with a timestamp and fade on their own, situations
// arrive as a mode, and the rule between them lives here rather than in the
// component — this file runs under node, the component does not.
//
// Nothing here does sentiment analysis. Every one of these signals already exists
// in useTalk; Part C is a table lookup, not a model call.

import type { Expression } from "./paths";

/** A moment worth reacting to. `at` is `performance.now()` when it happened. */
export interface Cue {
  kind: "raised" | "smiling";
  at: number;
}

/**
 * A situation that lasts. `idle` is the ordinary case: talking, or waiting.
 *
 * The task also asks for a calm neutral during the reflection, and there is no
 * mode for it because there is nothing to be calm: Talk.tsx returns the wrap-up
 * from an early branch above the rail, so the face is unmounted for the whole of
 * it. Coming back remounts it, which re-reads the counters rather than replaying
 * them — no stale correction fires on the way in.
 */
export type Mode = "idle" | "listening";

/**
 * How long a moment stays on the face. Long enough to be seen at a glance, short
 * enough that two corrections in a row read as two reactions rather than one long
 * one. Below about 700ms the brow tween (220ms in and 220ms out) eats most of it
 * and the expression never fully arrives.
 *
 * A smile is held more than twice as long as a correction, and not for symmetry.
 * The two arrive at different moments in the learner's attention: a correction
 * lands while they are reading their own sentence come back marked, the smile
 * lands while they are reading a reply in a language they are still decoding. In
 * v1.5 the smile fired and decayed unseen — 1200ms is enough time to notice a
 * brow you were already looking at, and not enough to look up.
 */
export const CUE_MS: Record<Cue["kind"], number> = { raised: 1200, smiling: 2800 };

/**
 * The expression to draw. A live cue outranks the mode: the learner typing is the
 * background condition, the correction that just landed is the thing that
 * happened. Everything else falls back to neutral.
 */
export function expressionFor(cue: Cue | null, mode: Mode, now: number): Expression {
  if (cue && now - cue.at < CUE_MS[cue.kind]) return cue.kind;
  if (mode === "listening") return "listening";
  return "neutral";
}

/**
 * Confidence earned between smiles.
 *
 * v1.5 bound the smile to "all scenario goals met", which fires once and off a
 * signal that is really a turn count. This is the smallest honest replacement:
 * confidence already moves per turn by how much help the learner needed (4 for a
 * clean unaided sentence, 2 with a minor correction, 0 with a severe one), so
 * twelve points is roughly three good turns in a row — a stretch worth a smile,
 * and rare enough that a coach who smiles at it is not simpering. Over a 20-minute
 * session that lands two or three times, which is the whole point: the smile has
 * to stay scarce to keep meaning anything.
 */
export const SMILE_STEP = 12;

/** Whether confidence has climbed a full step since the last smile. */
export function earnedSmile(since: number, now: number): boolean {
  return now - since >= SMILE_STEP;
}

/**
 * The coach's own words saying it is pleased.
 *
 * Not sentiment analysis — a lookup for the marks a model reaches for when it is
 * being warm. v1.5's contradiction was the coach replying "😊" while the face sat
 * flat, and the learner reads both at once; matching the emoji costs nothing and
 * removes the one place the character visibly disagreed with itself. Kept narrow
 * on purpose: an ambiguous emoji (a wink, a thinking face) is not evidence.
 */
const PLEASED = /[\u{1F600}-\u{1F60A}\u{1F60D}\u{1F642}\u{263A}\u{1F44D}\u{1F44F}\u{1F389}\u{1F4AA}]/u;

export function looksPleased(text: string): boolean {
  return PLEASED.test(text);
}

/**
 * Whether a counter moving from `prev` to `next` is worth a reaction. Only
 * upwards: corrections and met goals accumulate, and the counts also reset to
 * zero when a session ends — reacting to that would have the coach beam at an
 * empty screen.
 */
export function rose(prev: number, next: number): boolean {
  return next > prev;
}

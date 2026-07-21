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
 */
export const CUE_MS = 1200;

/**
 * The expression to draw. A live cue outranks the mode: the learner typing is the
 * background condition, the correction that just landed is the thing that
 * happened. Everything else falls back to neutral.
 */
export function expressionFor(cue: Cue | null, mode: Mode, now: number): Expression {
  if (cue && now - cue.at < CUE_MS) return cue.kind;
  if (mode === "listening") return "listening";
  return "neutral";
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

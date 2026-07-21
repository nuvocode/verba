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
 * There is no mode for the reflection, and that is now a decision rather than an
 * accident. The wrap-up is a document — counts, the corrections to revisit, the
 * words kept, the summary — and it is read, not talked to. A character standing
 * beside it turns a report into a conversation, and it would be a silent
 * character at that: nothing is spoken there, so the face would have only its
 * idle loop to run. The coach speaks in the reflection through the summary it
 * wrote, which is the right register for the one screen that tells you what you
 * got wrong.
 *
 * Talk.tsx returns the wrap-up from an early branch above the rail, so the face
 * is unmounted for the whole of it — and coming back remounts it, which re-reads
 * the counters rather than replaying them. No stale correction fires on the way
 * in, which is a second reason to leave this alone.
 */
export type Mode = "idle" | "listening" | "attending" | "thinking";

/**
 * Which situation the face is in, from the three flags the session already keeps.
 *
 * The order is the whole content of this function. The learner acting outranks
 * the coach working: an open mic and a half-typed sentence are both someone
 * taking their turn, and a face that looks away to think while a learner is
 * mid-sentence has stopped listening to them. `thinking` gets what is left, which
 * is exactly the dead air it was added to fill — the model's latency, with nobody
 * typing into it.
 */
export function modeFor(s: { mic: boolean; typing: boolean; waiting: boolean }): Mode {
  if (s.mic) return "attending";
  if (s.typing) return "listening";
  if (s.waiting) return "thinking";
  return "idle";
}

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
  // Every mode but `idle` names the expression it wears. That is not a shortcut:
  // a mode with no face of its own is a mode with nothing to say, and the row it
  // would point at is the one it should have been named after.
  return mode === "idle" ? "neutral" : mode;
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

// ---- the idle schedules ----
//
// The blink and the gaze drift are the two things the face does when nothing is
// happening, which is most of the time. Both are timers in the component; the
// arithmetic lives here so the claim "this does not feel like a metronome" is
// something a check can hold rather than something a comment asserts.

/** How long an eye stays shut. Shorter than this and the lids never arrive. */
export const BLINK_MS = 120;
const BLINK_MIN = 2500;
const BLINK_MAX = 5200;

/** Gap between the two halves of a double blink, and how often one happens. */
export const DOUBLE_GAP_MS = 190;
const DOUBLE_CHANCE = 0.18;

/**
 * The next blink. Two random draws in, one plan out — so the component holds no
 * arithmetic and this stays testable.
 *
 * The double is the point of the rework. A single blink at a random interval is
 * still one shape repeating, and the eye reads the *shape*, not the spacing;
 * roughly one blink in five coming as a quick pair is what real eyes do and what
 * stops the character reading as a clock.
 */
export function blinkPlan(gapRand: number, doubleRand: number): { after: number; double: boolean } {
  return { after: BLINK_MIN + gapRand * (BLINK_MAX - BLINK_MIN), double: doubleRand < DOUBLE_CHANCE };
}

/** How long the eyes rest off-centre when they drift. */
export const DRIFT_MS = 1150;
const DRIFT_MIN = 11_000;
const DRIFT_MAX = 26_000;

/**
 * When the gaze next drifts. An order of magnitude rarer than a blink, and
 * deliberately so: a blink is punctuation and goes unnoticed, but eyes that
 * wander often stop reading as idleness and start reading as inattention.
 */
export function driftGap(r: number): number {
  return DRIFT_MIN + r * (DRIFT_MAX - DRIFT_MIN);
}

/**
 * The shape of a message this file needs — not `TalkMsg`, which would drag the
 * whole session type into a file that runs under node with no React.
 */
export interface Turn {
  role: "user" | "ai";
  text: string;
  corrections: unknown[];
  isAsk?: boolean;
}

/** Shortest sentence worth a nod. Below this the learner is answering, not
 *  producing — "yes, sometimes" is not the thing being encouraged. */
export const NOD_MIN_CHARS = 60;

/**
 * Turns worth nodding at: a long one the coach found nothing to fix in.
 *
 * Counted rather than flagged, so the component watches it the same way it
 * watches corrections — a rise is the event. The `isAsk` skip keeps ⌘K asides
 * out; they are questions about the language, in the learner's own tongue, and
 * nodding along to one would be praise for asking.
 *
 * Only counted once the coach has answered. Corrections arrive with the reply,
 * so a turn still in flight has an empty list for the same reason a perfect one
 * does — reacting then would nod at every sentence the moment it was sent, which
 * is precisely the fake signal Part A took out.
 */
export function noddable(msgs: Turn[]): number {
  let n = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== "user" || m.isAsk) continue;
    if (m.text.trim().length < NOD_MIN_CHARS || m.corrections.length > 0) continue;
    if (msgs.slice(i + 1).some((later) => later.role === "ai" && !later.isAsk)) n++;
  }
  return n;
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

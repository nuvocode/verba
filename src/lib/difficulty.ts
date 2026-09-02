// Controlled difficulty (PLAN-031): one dimension a session is made harder in,
// calibrated from what actually broke, and never announced on any surface.
//
// The whole module is pure by contract: it must not import a provider, ./db.ts,
// React, or a settings screen — it takes signals and values and returns the axis,
// the step, and the sentence that tells the model how to apply it. `pickAxis` is
// the rotation, `calibrate` is the two-consecutive-easy rise, and the in-session
// drop (a drowning learner) lives in useTalk through `dropOnDrown`.
import type { Signal } from "./model.ts";
import { turnBreakdown, signalLabel } from "./model.ts";

export const AXES = ["pace", "vocabulary", "length", "structure", "direction"] as const;
export type Axis = (typeof AXES)[number];

/** The step range. A fact about the learner, 0 = none, 4 = a lot. Clamped here. */
export const DIFFICULTY_MAX = 4;

/**
 * The context a session is picked in. `ease` is the learner's "do not push me
 * today" ask (from the turn, or ⌘K); `canSpeak` is whether a working TTS exists
 * right now — an axis that cannot be applied must never be chosen.
 */
export interface PickContext {
  ease: boolean;
  canSpeak: boolean;
}

/**
 * What one finished session tells the next pick. `drowned` is the definition of
 * "unable to speak" (§5.2): at least half the learner's turns over at least four
 * turns carried two or more breakdown signals. `zero` is a session with no
 * breakdowns at all — the input to the rise.
 */
export interface SessionRecap {
  /** The axis that session chose, or null. */
  axis: Axis | null;
  /** How many learner turns the session had. */
  turns: number;
  /** True when this session drowned (§5.2). */
  drowned: boolean;
  /** True when no learner turn carried a breakdown signal. */
  zero: boolean;
}

/**
 * The readiness a pick needs from the learner's baseline (PLAN-028). Below
 * `BASELINE_MIN` measured turns the app does not yet know the learner's pace or
 * their norm, so it must not manufacture difficulty on top of guessing.
 */
export interface DifficultyInventory {
  /** True once enough measured turns exist to know the learner (PLAN-028). */
  ready: boolean;
}

/** How a session is going right now, re-read each turn for the in-session drop. */
export interface DrownCheck {
  /** Number of the learner's turns so far this session. */
  turns: number;
  /** How many of those turns carried two or more breakdown signals. */
  heavy: number;
}

/** §5.2's "unable to speak", defined not judged. */
export function drowns(session: DrownCheck): boolean {
  if (session.turns < 4) return false;
  return session.heavy >= session.turns / 2;
}

/**
 * The in-session drop, the one the plan says must NOT wait for `calibrate`: on
 * the turn the drowning rule trips, the axis is pulled null for the remainder
 * and `difficultyStep` is dropped immediately. Returns the patch to apply, or
 * null when the rule has not tripped or the drop already happened (a second
 * trip must not drop below 0 or double-count).
 *
 * It does **not** ask whether an axis is active. A session with no axis is
 * exactly the session `pickAxis` hands a learner whose last one drowned — if the
 * drop waited for an axis, the learner who drowns twice running, the one who
 * most needs the step lowered, would never get it. §5.2 conditions the drop on
 * the learner drowning, not on anything having been manufactured.
 */
export function dropOnDrown(
  session: DrownCheck,
  step: number,
  alreadyDropped: boolean,
): { axis: null; step: number } | null {
  if (alreadyDropped || !drowns(session)) return null;
  return { axis: null, step: Math.max(0, step - 1) };
}

/**
 * "Do not push me today" — the effect, unconditionally, and it does not persist:
 * the axis becomes null for the rest of the session (the rewind budget's `off`
 * is set by the caller, PLAN-029) and `difficultyStep` is left byte-identical.
 */
export function easeEffect(step: number): { axis: null; step: number } {
  return { axis: null, step };
}

/**
 * The one place a session decides its axis, and the one place `null` is a real
 * answer. Three ways to reach it:
 *   - the learner asked for ease today (ctx.ease),
 *   - the learner is below `BASELINE_MIN` measured turns (inventory.ready),
 *   - the learner's last session drowned (history[0].drowned).
 * Selection rotates, not optimises: the last two sessions' axes are excluded so a
 * learner does not spend a fortnight being spoken to quickly. `pace` is skipped
 * when there is no working TTS — an axis that cannot be applied is not chosen.
 */
export function pickAxis(
  inventory: DifficultyInventory,
  history: SessionRecap[],
  _level: string,
  ctx: PickContext,
): Axis | null {
  if (ctx.ease) return null;
  if (!inventory.ready) return null;
  if (history[0]?.drowned) return null;

  const excluded = new Set<Axis>(
    history.slice(0, 2).flatMap((r) => (r.axis ? [r.axis] : [])),
  );
  let eligible = AXES.filter((a) => !excluded.has(a));
  if (!ctx.canSpeak) eligible = eligible.filter((a) => a !== "pace");
  if (eligible.length === 0) return null;

  // Rotate through AXES, not through `eligible`. The last axis used is almost
  // always one of the two this pick excludes, so looking for it inside the
  // eligible set finds nothing, and a rotation that starts from "not found"
  // collapses to "always the first eligible axis" — which left `structure` and
  // `direction` unreachable for the life of the app. Walking AXES from the last
  // one used and taking the first eligible axis after it keeps the wheel turning
  // through all five.
  const lastUsed = history.find((r) => r.axis !== null)?.axis;
  const from = lastUsed ? AXES.indexOf(lastUsed) + 1 : 0;
  for (let i = 0; i < AXES.length; i++) {
    const candidate = AXES[(from + i) % AXES.length];
    if (eligible.includes(candidate)) return candidate;
  }
  return null; // unreachable: eligible is non-empty and is a subset of AXES
}

/**
 * The sentence appended to `buildSystem` when an axis is active, written for the
 * model not the learner — it names the dimension the turn should be harder in.
 */
export function axisGuidance(axis: Axis, step: number): string {
  const dimension: Record<Axis, string> = {
    pace: "Speak at a normal conversational tempo — not slower teaching tempo. Keep your sentences as long as a native speaker's, and do not slow down after a short answer.",
    vocabulary: "Use one word in each of your replies that is a step above the learner's level, but make its meaning clear from context so they can infer it. Only one word — no more.",
    length: "Answer in two or three full sentences rather than one, each a connected clause a learner of this level can follow even if they cannot yet produce it.",
    structure: "Once per reply, use a construction the learner can understand but has not yet produced themselves — with enough surrounding plain language that the meaning stays reachable.",
    direction: "Let the conversation occasionally leave the answer the learner had ready — follow their idea where it naturally leads instead of always returning to the prepared topic.",
  };
  const amount =
    step <= 0
      ? ""
      : ` Do this ${step >= 4 ? "strongly" : step >= 2 ? "noticeably" : "gently"}.`;
  return `Harder this session: ${dimension[axis]}${amount} Never mention any of this to the learner.`;
}

/**
 * The one hard rule `buildSystem` gains beside an active axis: the coach never
 * comments on the conversation's difficulty. This is §5.2's last line, at the
 * prompt level, where it can actually hold — no surface-level text can stop a
 * model announcing a difficulty change if the system prompt does not forbid it.
 */
export const DIFFICULTY_NO_ANNOUNCE =
  "Never comment on the difficulty of the conversation, never announce that you are making it harder or easier for the learner, and never ask the learner whether it was too hard.";

/**
 * Calibration's input: over the recent signals, which sessions drowned and were
 * easy. Deliberately derived from the stored signals — the consecutive-zero
 * counter lives with the session record, never in settings (a stored counter
 * would be a second copy of the same fact).
 *
 * `signals` is ordered newest-first (as `recentSignals` returns). A session is a
 * batch of signals stamped with the same `observedAt` — `recordSignals` (useDay)
 * stamps a whole completed activity's signals with one `Date.now()`, so one
 * conversation is exactly one timestamp, and two conversations never share one.
 * The result is newest-first.
 */
export function recapsFrom(signals: Signal[]): SessionRecap[] {
  const byStamp = new Map<number, Signal[]>();
  const order: number[] = [];
  for (const s of signals) {
    if (!byStamp.has(s.observedAt)) order.push(s.observedAt);
    const list = byStamp.get(s.observedAt) ?? [];
    list.push(s);
    byStamp.set(s.observedAt, list);
  }

  const recap = (list: Signal[]): SessionRecap | null => {
    let axis: Axis | null = null;
    let turns = 0;
    let heavy = 0;
    let breakdowns = 0;
    for (const s of list) {
      if (s.kind === "axisUsed") {
        const label = signalLabel(s);
        axis = label && (AXES as readonly string[]).includes(label) ? (label as Axis) : null;
      }
      const bd = turnBreakdown(s);
      if (!bd) continue;
      turns++;
      if (bd.length >= 2) heavy++;
      if (bd.length > 0) breakdowns++;
    }
    // A batch with no learner turn in it is not a session this plan may read.
    // `recentSignals` returns every activity's signals, not the conversation's
    // alone — a Read or a Listen writes a batch of its own, and counting one as
    // a session with no breakdowns would hand `calibrate` a free "easy session"
    // for every activity the learner finished. It would also make `zero` true
    // for a conversation abandoned before its first turn. An empty batch is not
    // evidence of an easy session; it is the absence of a session.
    if (turns === 0) return null;
    return { axis, turns, drowned: drowns({ turns, heavy }), zero: breakdowns === 0 };
  };

  // `order` is the input's (newest-first) order of first appearances, so mapping
  // over it keeps the recaps newest-first.
  return order.flatMap((stamp) => {
    const r = recap(byStamp.get(stamp)!);
    return r ? [r] : [];
  });
}

/** The signal kinds this plan writes beside the turn signals. */
export const DIFFICULTY_SIGNAL_KINDS = ["axisUsed", "easeRequest"] as const;

/**
 * The rise (§5.2): two consecutive sessions with zero breakdowns → `step + 1`.
 * Two, not one — a single easy session is more likely a short one than a learner
 * who has outgrown the level. `recaps` is newest-first; this reads only the
 * zero-breakdown run at the head. It never drops (the drop is in-session).
 */
export function calibrate(step: number, recaps: SessionRecap[]): number {
  let run = 0;
  for (const r of recaps) {
    if (!r.zero) break;
    run++;
    if (run >= 2) return Math.min(DIFFICULTY_MAX, step + 1);
  }
  return step;
}

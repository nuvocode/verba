// Patience, and the praise economy (PLAN-032). Two behaviours, one purpose:
// removing the tells that give away that the learner is talking to a machine.
//
// Patience: the coach waits a multiple of the learner's own median latency
// before it offers anything, and while it waits the screen is exactly what it
// was when the coach finished speaking. Praise: the coach may only praise when
// it can point at a specific record the learner just got right, and at most
// twice a session.
//
// Everything here is pure by contract, the same contract difficulty.ts holds:
// no provider, no ./db.ts, no React, no settings screen. It takes a baseline
// and values and returns milliseconds, a line, and a verdict.

import type { Baseline } from "./breakdown.ts";

// --- how long to wait ---------------------------------------------------------

/**
 * The three patience settings, as multiples of the learner's own median
 * latency. `quick` is barely longer than their average, `patient` is a long
 * beat — the setting is how much *extra* room the coach gives, on top of what
 * the learner already needs.
 */
export const PATIENCE_STEPS = { quick: 1.5, normal: 2.5, patient: 4 } as const;
export type PatienceStep = keyof typeof PATIENCE_STEPS;

/**
 * The wait is clamped to this band. The floor is load-bearing: for a median
 * under about 5 s all three steps clamp to the same 8 s, and that is the
 * intended behaviour, not a bug to design around. **Never interrupt a learner
 * inside eight seconds** outranks the setting.
 */
export const WAIT_FLOOR = 8_000;
export const WAIT_CEILING = 90_000;

/**
 * How long the coach waits before offering, in ms — a multiple of the learner's
 * own median latency (`Baseline.median` from PLAN-028, already speech-corrected
 * by `measuredLatency`, so it is thinking time and not the coach's talking
 * time). Clamped to `[WAIT_FLOOR, WAIT_CEILING]`.
 *
 * Returns `null` when `baseline.ready` is false. **A null wait means the coach
 * does not interrupt at all** — not "use a default". Before Verba knows what
 * normal is for this learner, it has no business deciding they have stalled.
 * The caller must schedule nothing on `null`; it is not a number with a
 * fallback.
 */
export function waitMs(baseline: Baseline, step: PatienceStep): number | null {
  if (!baseline.ready) return null;
  const raw = baseline.median * PATIENCE_STEPS[step];
  return Math.min(WAIT_CEILING, Math.max(WAIT_FLOOR, raw));
}

// --- the offer, when the wait expires -----------------------------------------

/**
 * One line, offering and not imposing, and it is a coach line like any other.
 * Keyed by pack id with an `en` fallback, the same shape and the same nine
 * locales as `OWN_FALLBACK`, and every entry passes `bannedShape` — an offer
 * that says "you seem stuck" points at the learner and is the thing this plan
 * removes. It is a question, so a learner who ignores it is not helped anyway.
 */
export const OFFER_LINE: Record<string, string> = {
  en: "Want me to start you off?",
  es: "¿Quieres que te dé una pista?",
  fr: "Tu veux que je t'aide à commencer ?",
  de: "Soll ich dir einen Anfang geben?",
  it: "Vuoi che ti dia un inizio?",
  pt: "Queres que te ajude a começar?",
  ja: "始め方を教えましょうか？",
  tr: "Başlamana yardım edeyim mi?",
  id: "Mau kubantu mulai?",
};

/** At most this many offers per turn; past that the coach is silent. */
export const OFFER_CAP = 2;

// --- the wait/offer state machine --------------------------------------------
//
// The patience behaviour as a pure state machine, so the check can drive it on a
// virtual clock. `useTalk` holds a `WaitState` and calls these transitions; the
// only thing it adds is the real `setTimeout` scheduling. `ms` is
// `waitMs(baseline, step)` — `null` means "no wait" (no baseline yet), and every
// transition leaves the state unchanged on `null`, so a first session never
// offers.

export interface WaitState {
  /** Whether the coach is waiting — gates the suggestions render in Talk. */
  waiting: boolean;
  /** How many offers this turn has fired (capped at OFFER_CAP). */
  offerCount: number;
  /** Absolute time the wait expires, or null when no wait is armed. */
  deadline: number | null;
}

export const freshWait = (): WaitState => ({ waiting: false, offerCount: 0, deadline: null });

/**
 * Arm the wait at turn land. The flag and the deadline are two different things
 * and this only sets the flag: `waiting` goes up the moment the turn lands, so
 * the chips stay hidden for the whole of the coach's reply, but the clock does
 * not start until the coach stops speaking (`onSpeechEnd`). Arming the deadline
 * here instead would spend the wait on the coach's own audio — a six-second
 * reply against an eight-second wait leaves the learner two seconds of silence
 * before being offered help, which is the behaviour §6.1 exists to remove.
 *
 * On a `null` wait the state is unchanged — the coach does not interrupt at all.
 */
export function armWait(state: WaitState, ms: number | null): WaitState {
  if (ms === null) return state;
  return { ...state, waiting: true, deadline: null };
}

/**
 * The coach stopped speaking — the clock starts now. This is the only place a
 * deadline is set from, so every wait the learner actually experiences is a full
 * `ms` of silence, whatever the reply, the rewind or the offer before it took.
 *
 * Two ways it declines. At the cap the coach is silent for the rest of the turn,
 * so nothing re-arms. And a wait that is not open — no `waiting`, no offer fired
 * yet — belongs to no turn: that is the clip still draining after the learner
 * has already sent, and arming there would offer help into their next message.
 */
export function onSpeechEnd(state: WaitState, now: number, ms: number | null): WaitState {
  if (ms === null) return state;
  if (state.offerCount >= OFFER_CAP) return state;
  if (!state.waiting && state.offerCount === 0) return state;
  return { ...state, deadline: now + ms };
}

/**
 * The wait elapsed. If the coach is still speaking (a rewind's own → repeat, or
 * a reply still playing), do not cut in — re-arm a full wait and try again
 * later. Otherwise fire one offer: the count goes up, `waiting` drops (the
 * suggestions appear), and a full wait re-arms for the next offer. At the cap the
 * coach is silent — the deadline clears and nothing re-arms.
 */
/*
 * The `now + ms` these transitions set is the speech-off deadline: when nothing
 * is spoken there is no `onSpeechEnd` to start the clock, so the elapse and the
 * HOLD arm it themselves. With speech on, the clip that follows ends into
 * `onSpeechEnd`, which pushes the deadline out to a full wait of real silence.
 */
export function onWaitElapsed(state: WaitState, now: number, ms: number | null, speaking: boolean): WaitState {
  if (ms === null) return state;
  if (speaking) return { ...state, deadline: now + ms };
  if (state.offerCount >= OFFER_CAP) return { ...state, waiting: false, deadline: null };
  return { ...state, waiting: false, offerCount: state.offerCount + 1, deadline: now + ms };
}

/**
 * A verified HOLD: the learner asked for time, so the turn's offers are closed
 * (a learner who asked for time is not then offered help) and a full wait re-arms
 * from the moment the HOLD landed. `waiting` stays true — the learner is still
 * thinking.
 */
export function onHold(state: WaitState, now: number, ms: number | null): WaitState {
  if (ms === null) return state;
  return { ...state, offerCount: OFFER_CAP, deadline: now + ms };
}

/**
 * Learner input or the session ending: clear the wait. The suggestions appear
 * again.
 */
export function clearWait(state: WaitState): WaitState {
  return { ...state, waiting: false, deadline: null };
}

// --- praise needs a receipt ---------------------------------------------------

/**
 * At most this many pieces of praise per session. Held in `useTalk`, enforced
 * after the match.
 */
export const PRAISE_CAP = 2;

/**
 * The gate that decides whether a model's praise is shown. `for` must match a
 * supplied record exactly, comparing on trimmed, case-folded text and nothing
 * else. **No fuzzy matching, no substring, no paraphrase.** Praise without a
 * referenced record is not a style violation, it is a fabrication — the same
 * class of error as an invented metric, and treated the same way.
 *
 * The praise sentence lives in `text`, outside `reply` — so a dropped praise
 * really drops: the field is not shown, and `reply` stands on its own without
 * it.
 */
export function praiseGate(
  praise: { for: string; text: string } | undefined,
  records: string[],
  usedThisSession: number,
): { keep: boolean } {
  if (!praise) return { keep: false };
  if (usedThisSession >= PRAISE_CAP) return { keep: false };
  const target = praise.for.trim().toLocaleLowerCase();
  if (!target) return { keep: false };
  if (!praise.text.trim()) return { keep: false }; // a praise with no sentence is not shown
  const exact = records.some((r) => r.trim().toLocaleLowerCase() === target);
  return { keep: exact };
}

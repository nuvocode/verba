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
 * A dropped praise drops the field only. `turn.reply` is passed through
 * byte-identical, because the prompt asked for a reply that does not depend on
 * the praise.
 */
export function praiseGate(
  praise: { for: string } | undefined,
  records: string[],
  usedThisSession: number,
): { keep: boolean } {
  if (!praise) return { keep: false };
  if (usedThisSession >= PRAISE_CAP) return { keep: false };
  const target = praise.for.trim().toLocaleLowerCase();
  if (!target) return { keep: false };
  const exact = records.some((r) => r.trim().toLocaleLowerCase() === target);
  return { keep: exact };
}

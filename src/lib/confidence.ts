// Confidence, measured not seeded.
//
// §2.2 defines confidence exactly: the unprompted-production rate, from four
// components — unaided turn ratio, turn length, suggestion-use ratio, reply
// latency. The screen must state that it is a signal and not a score, and the
// claim has to stay true: no reward or punishment language anywhere near it.
//
// This file must not import ./db.ts or React. It takes turns and returns a value
// or `null` — and `null` is the value that means "not measured yet". The screen
// renders `—` plus a "measuring" caption for it, never 0, never 50 (invariant 26).

import type { CEFRLevel } from "./model.ts";

export interface Turn {
  words: number; // in the learner's own message
  fromSuggestion: boolean;
  /** Time from the coach's line landing to the send, in ms; null if unknown. */
  latencyMs: number | null;
}

/** Below this many turns there is nothing to report. §2.2: "ilk anlamlı turdan önce". */
export const MEASURES_AT = 3;

export interface Confidence {
  value: number; // 0–100
  turns: number; // what it was computed from — the screen prints it
  parts: { unaided: number; length: number; suggestion: number; latency: number | null };
}

/**
 * The expected turn length per CEFR level — the bar the length component measures
 * against. A B2 learner producing A1-length turns is not at 100%. The table is
 * deliberately small and fixed: there is nothing yet to tune it against.
 */
const EXPECTED_WORDS: Record<CEFRLevel, number> = {
  A1: 3,
  A2: 5,
  B1: 8,
  B2: 12,
  C1: 16,
  C2: 20,
};

/** Median of a list of numbers. */
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * `null` until MEASURES_AT turns have been produced. Never a placeholder number.
 *
 * The four components, each 0–1, then a plain mean — no tuned weights, because
 * there is nothing yet to tune them against. A component that cannot be computed
 * (every latency is null) drops out of the mean instead of scoring 0.
 */
export function confidence(turns: Turn[], level: CEFRLevel = "B1"): Confidence | null {
  if (turns.length < MEASURES_AT) return null;

  const total = turns.length;
  const suggested = turns.filter((t) => t.fromSuggestion).length;

  // unaided — 1 − suggested / total.
  const unaided = 1 - suggested / total;

  // length — median words per turn against the level's expectation, capped at 1.
  const medianWords = median(turns.map((t) => t.words));
  const length = Math.min(1, medianWords / EXPECTED_WORDS[level]);

  // suggestion — the recency-weighted version of unaided: the last five turns
  // count double, so a learner who needed help early and stopped needing it moves.
  let suggestedWeighted = 0;
  let totalWeighted = 0;
  turns.forEach((t, i) => {
    const weight = i >= total - 5 ? 2 : 1;
    totalWeighted += weight;
    if (t.fromSuggestion) suggestedWeighted += weight;
  });
  const suggestion = 1 - suggestedWeighted / totalWeighted;

  // latency — a decay over median latency; null latencies are excluded, and if
  // every latency is null this component drops out of the mean instead of 0.
  const latencies = turns.map((t) => t.latencyMs).filter((l): l is number => l !== null);
  const hasLatency = latencies.length > 0;
  // `null` when no latency was measured — the component drops out of the mean
  // rather than scoring 0, and the parts object says so (invariant 26).
  const latency = hasLatency ? 1 / (1 + median(latencies) / 20000) : null;

  const parts = { unaided, length, suggestion, latency };
  const present = hasLatency ? 4 : 3;
  const value = (unaided + length + suggestion + (latency ?? 0)) / present;

  return { value: Math.round(value * 100), turns: total, parts };
}

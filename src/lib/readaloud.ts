// The teleprompter's measurement (PLAN-024): expected words in, spoken words in,
// a report out. Pure by contract — no microphone, no React, no clock beyond the
// `ms` it is handed. The prompter does the listening; this module only compares.
//
// Matching is order-preserving and forgiving: a longest-common-subsequence walk
// over normalised tokens (`bareWord`), so one misheard word does not desynchronise
// the rest and mark forty words skipped. Words the transcript adds are ignored —
// a learner saying "um" is not an error.
import { bareWord } from "./reading.ts";

export interface AloudReport {
  /** Expected words that never appeared in the transcript, in order. */
  skipped: string[];
  /** Spoken words per minute, from the transcript and the elapsed time. */
  wpm: number;
  /** The prompter's own wpm — what they were asked to match. */
  targetWpm: number;
  /** |wpm − targetWpm| / targetWpm, 0–1. */
  paceMatch: number;
}

/**
 * The expected indices that appear in the transcript, in order — the LCS of the
 * two normalised word lists. A word matched out of order is still matched; a word
 * the transcript adds is simply never an expected index.
 */
function lcsExpectedIndices(exp: string[], hrd: string[]): Set<number> {
  const m = exp.length;
  const n = hrd.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = exp[i] === hrd[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (exp[i] === hrd[j]) {
      matched.add(i);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matched;
}

export function compare(expected: string[], heard: string[], ms: number, targetWpm: number, locale: string): AloudReport {
  // `locale` is part of the contract — the same tokenizer Read estimates with.
  // `bareWord` is locale-independent (it only strips punctuation and case-folds),
  // so the locale is carried for the caller's bookkeeping and future tokenizers.
  void locale;
  const exp = expected.map(bareWord).filter(Boolean);
  const hrd = heard.map(bareWord).filter(Boolean);
  const matched = lcsExpectedIndices(exp, hrd);
  // `skipped` is built over the same index space as the filtered `exp` — the
  // words that never appeared, in their original order.
  const skipped = exp.filter((_, i) => !matched.has(i));
  // Spoken words per minute, from the transcript and the elapsed time. A run with
  // no elapsed time has no tempo.
  const wpm = ms > 0 ? hrd.length / (ms / 60000) : 0;
  const paceMatch = targetWpm > 0 ? Math.abs(wpm - targetWpm) / targetWpm : 0;
  return {
    skipped,
    wpm,
    targetWpm,
    paceMatch,
  };
}

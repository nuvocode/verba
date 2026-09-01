// The passage quality gates (PLAN-022): deterministic arithmetic over sentences
// and words, and nothing else. A gate never asks the model whether its own output
// is good — that is not a gate. Each test is a thing a bad generation actually
// does, not a proxy for "good writing".
//
// This module is pure by contract: it must not import ./db.ts, React, or a
// provider. It takes text and returns verdicts; the hook (useRead) does the
// calling and the rendering.
//
// Bias every gate toward passing: a gate that rejects a good passage costs a
// regeneration the learner waits through, and a false reject is invisible — so
// where a test is unsure, it passes and says so in `why`.
import { bareWord, type ReadingText } from "./reading.ts";
import { words } from "./text.ts";

export interface GateResult {
  ok: boolean;
  /** 0-based indices of the sentences that failed. */
  failed: number[];
  /** One human-readable reason per failing sentence. */
  why: string[];
}

/** A passage that failed the gates, and what to do about it. */
export type PassageOutcome =
  | { ok: true; text: ReadingText; gates: { coherence: GateResult; reuse?: GateResult & { hit: string[]; missing: string[] }; level: { band: string; ok: boolean } } }
  | { ok: false; why: string; fallback: ReadingText | null };

// Copulas a tautology test can split on: "X is X" repeats itself.
const COPULAS = new Set([
  "is", "are", "was", "were", "be", "am", "seems", "seem", "looks", "look",
  "becomes", "become",
]);

/**
 * A content word: not a stopword and at least three characters. A pack without a
 * stopword list falls back to "every word is content" — the length floor is only
 * meaningful against a real stopword list, and a short-word language (Japanese,
 * Chinese) would otherwise have every sentence rejected as empty. The fallback is
 * weak but never wrong in a way that rejects good text.
 */
function contentWords(sentence: string, locale: string, stopwords: Set<string>): string[] {
  const ws = words(sentence, locale);
  if (stopwords.size === 0) return ws; // no list — every word is content
  return ws.filter((w) => w.length >= 3 && !stopwords.has(w));
}

/**
 * Per-sentence coherence, deterministically. Three tests, each a thing a bad
 * generation actually does:
 *  - emptiness: fewer than 2 content words, or every content word is a stopword.
 *  - tautology: the clause after the copula repeats the clause before it, or the
 *    sentence's content words are a subset of the previous sentence's. A negated
 *    repetition is a contradiction, not a tautology, so the test stands down
 *    when the sentence carries a negation word.
 *  - contradiction: a negation word at a word boundary, and the sentence's
 *    content words (negation words removed) are a subset of an earlier
 *    sentence's — it negates a predicate already asserted. Skipped when the
 *    pack supplies no negation list.
 *
 * There is deliberately no connection test: word overlap does not measure
 * coherence, and it rejects good text (a topic transition that shares no word
 * with the sentence before it is not a broken passage).
 */
export function coherence(
  t: ReadingText,
  locale: string,
  stopwords: Set<string>,
  negations?: Set<string>,
): GateResult {
  const failed: number[] = [];
  const why: string[] = [];
  const sentences = t.sentences.map((s) => s.target);
  const content = sentences.map((s) => contentWords(s, locale, stopwords));

  for (let i = 0; i < sentences.length; i++) {
    const reasons: string[] = [];
    const cur = content[i];
    const prior = content.slice(0, i);
    const prev = i > 0 ? content[i - 1] : null;

    // emptiness — fewer than 2 content words, or every one is a stopword. The
    // floor is deliberately low so a short but full A1–A2 sentence passes.
    if (cur.length < 2) {
      reasons.push("too few content words");
    } else if (cur.every((w) => stopwords.has(w))) {
      reasons.push("every content word is a stopword");
    }

    // tautology — the copula repeats itself, or this sentence restates the last.
    if (isTautology(sentences[i], cur, prev, locale, stopwords, negations)) {
      reasons.push("repeats itself or the previous sentence");
    }

    // contradiction — conservative, biased toward passing: only a clear negation
    // of an earlier sentence's own words is called out. A pack with no negation
    // list skips the test entirely.
    if (negations && isContradiction(sentences[i], cur, prior, negations)) {
      reasons.push("contradicts an earlier sentence");
    }

    if (reasons.length > 0) {
      failed.push(i);
      why.push(`sentence ${i + 1}: ${reasons.join("; ")}`);
    }
  }

  return { ok: failed.length === 0, failed, why };
}

function isTautology(
  sentence: string,
  cur: string[],
  prev: string[] | null,
  locale: string,
  stopwords: Set<string>,
  negations?: Set<string>,
): boolean {
  // A negated repetition is a contradiction, not a tautology — the tautology test
  // stands down when the sentence carries a negation word, so the two reasons are
  // never written for the same sentence.
  if (negations && hasNegation(sentence, negations)) return false;
  // Copula tautology: "The market is a market." — the words before and after the
  // copula are the same content words.
  const lower = sentence.toLowerCase();
  for (const cop of COPULAS) {
    const idx = lower.indexOf(` ${cop} `);
    if (idx !== -1) {
      const before = contentWords(lower.slice(0, idx), locale, stopwords);
      const after = contentWords(lower.slice(idx + cop.length), locale, stopwords);
      if (before.length > 0 && before.length === after.length && before.every((w) => after.includes(w))) {
        return true;
      }
    }
  }
  // Subset tautology: this sentence's content words are a subset of the previous
  // sentence's — it restates the last sentence rather than advancing it.
  if (prev && prev.length > 0 && cur.length > 0 && cur.every((w) => prev.includes(w))) {
    return true;
  }
  return false;
}

/** A negation word at a word boundary — "don't" inside "doesn't" must not count,
 *  and "not" inside "nothing" must not count either. */
function hasNegation(sentence: string, negations: Set<string>): boolean {
  const lower = sentence.toLowerCase();
  return [...negations].some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower));
}

function isContradiction(sentence: string, cur: string[], earlier: string[][], negations: Set<string>): boolean {
  // ponytail: this ceiling only catches a copula/modal negation — "the door is
  // not open" — that reuses the same content words. A negated *inflected* verb
  // ("she didn't leave" vs "she left") has a different stem that no stemmer here
  // folds, so it slips through; that is accepted. Stemming would over-fire on
  // agglutinative packs and gains little — conservative beats clever.
  if (!hasNegation(sentence, negations)) return false;
  // The sentence negates a predicate an earlier sentence asserted: its content
  // words, with the negation words removed, are a subset of an earlier sentence's.
  // The subset is what makes it a *repetition* of an assertion, not a new fact —
  // a negation of something never said is not a contradiction.
  const content = cur.filter((w) => !negations.has(w));
  if (content.length === 0) return false;
  for (const prev of earlier) {
    if (prev.length > 0 && content.every((w) => prev.includes(w))) return true;
  }
  return false;
}

/**
 * ≥ 50% of `want` present in the passage, by `bareWord`. Returns what is missing.
 * The `hit` list is what the reuse claim is allowed to print — the gate's output,
 * never the request.
 */
export function reuse(t: ReadingText, want: string[]): GateResult & { hit: string[]; missing: string[] } {
  const passage = new Set(
    t.sentences.flatMap((s) => s.target.split(/\s+/)).map(bareWord).filter(Boolean),
  );
  const seen = new Set<string>();
  const hit: string[] = [];
  const missing: string[] = [];
  for (const w of want) {
    const b = bareWord(w);
    if (!b || seen.has(b)) continue; // dedupe — a word asked twice is still one word
    seen.add(b);
    if (passage.has(b)) hit.push(w);
    else missing.push(w);
  }
  const threshold = Math.ceil(seen.size / 2);
  const ok = hit.length >= threshold;
  return {
    ok,
    failed: ok ? [] : [0],
    why: ok ? [] : [`only ${hit.length} of ${seen.size} requested words appear (need at least ${threshold})`],
    hit,
    missing,
  };
}

// CEFR order — the band ladder the level gate measures against.
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** The band a mean sentence length lands on. */
function bandFor(avgWords: number): string {
  if (avgWords < 8) return "A1";
  if (avgWords < 12) return "A2";
  if (avgWords < 16) return "B1";
  if (avgWords < 22) return "B2";
  if (avgWords <= 30) return "C1";
  return "C2";
}

function bump(band: string): string {
  const i = CEFR.indexOf(band);
  if (i === -1 || i >= CEFR.length - 1) return band;
  return CEFR[i + 1];
}

/**
 * Measured band from sentence length and word rarity, and whether it is within
 * one of `target`. A passage of very long words (rarity) bumps one band — a
 * signal that the vocabulary ran ahead of the level.
 */
export function level(t: ReadingText, target: string, locale: string): { band: string; ok: boolean } {
  const sentences = t.sentences.map((s) => s.target);
  const allWords = sentences.flatMap((s) => words(s, locale));
  const avgWords = sentences.length
    ? sentences.reduce((sum, s) => sum + Math.max(1, words(s, locale).length), 0) / sentences.length
    : 0;
  let band = bandFor(avgWords);
  // Rarity: an average word length of 8+ characters is a strong signal the
  // vocabulary outran the level. Conservative — only a clearly long average
  // bumps, and only when the length band is not already high. A C1-length
  // sentence is already advanced; long words do not need to push it further.
  if (allWords.length > 0) {
    const avgLen = allWords.reduce((n, w) => n + w.length, 0) / allWords.length;
    const bi = CEFR.indexOf(band);
    if (avgLen >= 8 && bi !== -1 && bi < CEFR.indexOf("C1")) band = bump(band);
  }
  const ti = CEFR.indexOf(target);
  const bi = CEFR.indexOf(band);
  // An unknown target is not a reason to reject — bias toward passing.
  const ok = ti === -1 || bi === -1 || Math.abs(bi - ti) <= 1;
  return { band, ok };
}

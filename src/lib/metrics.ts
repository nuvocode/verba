import type { Cefr } from "./level.ts";
import { sentenceCount, words } from "./text.ts";
import { levelLabel, MIN_ESTIMATE_SESSIONS, CONFIDENT_ESTIMATE_SESSIONS, type LevelEstimate } from "./model.ts";

// Level estimation v2 — a measured signal to sit alongside the v1 AI soft
// estimate. It reads the learner's own messages (never the tutor's) and derives
// three families of metric the scope calls for:
//   • vocabulary coverage — type/token ratio + how big their studied deck is
//   • error rate          — corrections the tutor made per learner message
//   • sentence complexity — words per sentence + average word length
// These fold into a 0–100 composite that maps onto the CEFR band. Pure and
// deterministic, so it is unit-checkable and reproducible.
//
// ponytail: word-count heuristics, not a parser or an embedding model. They
// correlate well enough with level to nudge the self-report; swap in a real
// linguistic complexity model only if this proves too coarse in practice.

export interface LevelMetrics {
  messages: number;
  words: number;
  uniqueWords: number;
  typeTokenRatio: number; // unique / total, richer vocabulary → higher
  avgSentenceLen: number; // words per sentence
  avgWordLen: number; // characters per word
  corrections: number;
  errorRate: number; // corrections per message
  deckSize: number; // vocabulary entries the learner has captured
}

export interface LevelEstimateV2 {
  estimate: Cefr;
  score: number; // 0–100 composite
  components: { complexity: number; coverage: number; accuracy: number };
}

export function computeMetrics(
  userTexts: string[],
  opts: { corrections?: number; deckSize?: number; locale?: string } = {},
): LevelMetrics {
  // Words and sentences are cut by the target language's own rules (lib/text) —
  // a whitespace split would read a whole Japanese message as one long word.
  const locale = opts.locale ?? "en";
  const texts = userTexts.filter((t) => t && t.trim());
  const allWords = texts.flatMap((t) => words(t, locale));
  const totalWords = allWords.length;
  const unique = new Set(allWords).size;
  const sentences = texts.reduce((n, t) => n + sentenceCount(t, locale), 0) || 1;
  const chars = allWords.reduce((n, w) => n + w.length, 0);
  const corrections = opts.corrections ?? 0;
  const messages = texts.length;
  return {
    messages,
    words: totalWords,
    uniqueWords: unique,
    typeTokenRatio: totalWords ? unique / totalWords : 0,
    avgSentenceLen: totalWords / sentences,
    avgWordLen: totalWords ? chars / totalWords : 0,
    corrections,
    errorRate: messages ? corrections / messages : 0,
    deckSize: opts.deckSize ?? 0,
  };
}

/** Rebuild the metric bundle from a stored session_metrics row (Coach reads these back). */
export function metricsFromRow(r: {
  messages: number;
  words: number;
  unique_words: number;
  avg_sentence_len: number;
  avg_word_len: number;
  corrections: number;
  deck_size: number;
}): LevelMetrics {
  return {
    messages: r.messages,
    words: r.words,
    uniqueWords: r.unique_words,
    typeTokenRatio: r.words ? r.unique_words / r.words : 0,
    avgSentenceLen: r.avg_sentence_len,
    avgWordLen: r.avg_word_len,
    corrections: r.corrections,
    errorRate: r.messages ? r.corrections / r.messages : 0,
    deckSize: r.deck_size,
  };
}

/** clamp x into 0..1 */
const unit = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Map metrics onto a CEFR band. Each component is normalised to 0..1 against a
 * rough A1→C2 span, then weighted into a composite. Thresholds are intentionally
 * gentle — this hints, it does not certify.
 */
export function estimateLevelV2(m: LevelMetrics): LevelEstimateV2 {
  // complexity: ~4 words/sentence (A1) → ~18 (C2); word length ~3.5 → ~6 chars.
  // ponytail: one span for every language. A Han/kana word is 1–3 characters no
  // matter how advanced the writer, so the word-length term reads low for
  // Japanese and Chinese and their complexity score sits under a European
  // learner's. It only nudges a self-reported level, so it is survivable —
  // move the span onto the pack (a `metrics` block) when a CJK learner is
  // visibly mis-levelled.
  const complexity = unit((m.avgSentenceLen - 4) / 14) * 0.6 + unit((m.avgWordLen - 3.5) / 2.5) * 0.4;
  // coverage: lexical variety + a bonus for a growing studied deck (caps at 100).
  const coverage = unit(m.typeTokenRatio / 0.6) * 0.6 + unit(m.deckSize / 100) * 0.4;
  // accuracy: fewer corrections per message is better; 0 errors → 1, ~0.6/msg → 0.
  const accuracy = unit(1 - m.errorRate / 0.6);

  const score = Math.round((complexity * 0.4 + coverage * 0.35 + accuracy * 0.25) * 100);

  return {
    estimate: levelLabel(score),
    score,
    components: {
      complexity: Math.round(complexity * 100),
      coverage: Math.round(coverage * 100),
      accuracy: Math.round(accuracy * 100),
    },
  };
}

/** The learner's measured level, derived from their session scores. The only producer.
 * Scores may arrive in any order; the mean is order-independent. If someone later
 * wants "the latest", note db.recentMetricScores returns oldest-first, so use at(-1),
 * not [0]. */
export function levelEstimateFrom(scores: number[]): LevelEstimate {
  if (scores.length === 0) {
    return { value: 0, label: "A1", confidence: "low", sampleSize: 0 };
  }
  const value = Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
  const sampleSize = scores.length;
  const confidence =
    sampleSize >= CONFIDENT_ESTIMATE_SESSIONS ? "high" : sampleSize >= MIN_ESTIMATE_SESSIONS ? "medium" : "low";
  return { value, label: levelLabel(value), confidence, sampleSize };
}

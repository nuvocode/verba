import { CEFR_LEVELS, type Cefr } from "./level.ts";

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

const words = (text: string): string[] => (text.toLowerCase().match(/\p{L}+(?:['’]\p{L}+)?/gu) ?? []);
const sentences = (text: string): number => Math.max(1, (text.match(/[.!?]+/g) ?? []).length);

export function computeMetrics(
  userTexts: string[],
  opts: { corrections?: number; deckSize?: number } = {},
): LevelMetrics {
  const texts = userTexts.filter((t) => t && t.trim());
  const allWords = texts.flatMap(words);
  const totalWords = allWords.length;
  const unique = new Set(allWords).size;
  const sentenceCount = texts.reduce((n, t) => n + sentences(t), 0) || 1;
  const chars = allWords.reduce((n, w) => n + w.length, 0);
  const corrections = opts.corrections ?? 0;
  const messages = texts.length;
  return {
    messages,
    words: totalWords,
    uniqueWords: unique,
    typeTokenRatio: totalWords ? unique / totalWords : 0,
    avgSentenceLen: totalWords / sentenceCount,
    avgWordLen: totalWords ? chars / totalWords : 0,
    corrections,
    errorRate: messages ? corrections / messages : 0,
    deckSize: opts.deckSize ?? 0,
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
  const complexity = unit((m.avgSentenceLen - 4) / 14) * 0.6 + unit((m.avgWordLen - 3.5) / 2.5) * 0.4;
  // coverage: lexical variety + a bonus for a growing studied deck (caps at 100).
  const coverage = unit(m.typeTokenRatio / 0.6) * 0.6 + unit(m.deckSize / 100) * 0.4;
  // accuracy: fewer corrections per message is better; 0 errors → 1, ~0.6/msg → 0.
  const accuracy = unit(1 - m.errorRate / 0.6);

  const score = Math.round((complexity * 0.4 + coverage * 0.35 + accuracy * 0.25) * 100);

  // 6 bands across 0..100.
  const idx = Math.min(CEFR_LEVELS.length - 1, Math.floor(score / (100 / CEFR_LEVELS.length)));
  return {
    estimate: CEFR_LEVELS[idx],
    score,
    components: {
      complexity: Math.round(complexity * 100),
      coverage: Math.round(coverage * 100),
      accuracy: Math.round(accuracy * 100),
    },
  };
}

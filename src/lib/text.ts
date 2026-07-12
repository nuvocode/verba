// Language-aware text segmentation.
//
// Verba used to split target text on " " and count sentences with /[.!?]/. That
// is a Latin-alphabet assumption wearing a tokenizer's clothes: Japanese,
// Chinese, Thai and Khmer write without spaces, and their sentences end in 。!?
// So a Japanese passage was one enormous "word" and one enormous "sentence" —
// tapping a word sent the whole line to the dictionary, and the level metrics
// read every learner as a beginner.
//
// Intl.Segmenter is the platform's own ICU word/sentence breaker. It knows all
// of the above already, so no language needs a tokenizer of its own — this is
// the one place a new pack's locale has to be honoured, and it is honoured for
// free.

/** Segmenters are not cheap to build and we rebuild the same handful forever. */
const cache = new Map<string, Intl.Segmenter>();

const supported = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function";

function segmenter(locale: string, granularity: "word" | "sentence"): Intl.Segmenter | null {
  if (!supported) return null;
  const key = `${locale}|${granularity}`;
  let seg = cache.get(key);
  if (!seg) {
    try {
      seg = new Intl.Segmenter(locale, { granularity });
    } catch {
      // An unknown/typo'd locale must not take the reader down — ICU's root
      // locale segments fine for everything except the tricky Asian scripts.
      seg = new Intl.Segmenter(undefined, { granularity });
    }
    cache.set(key, seg);
  }
  return seg;
}

export interface Token {
  text: string;
  /** True for a word the learner can tap; false for spaces and punctuation. */
  word: boolean;
}

/**
 * Every piece of `text` in order — words *and* the whitespace/punctuation
 * between them — so a renderer can rebuild the original string exactly while
 * making only the words interactive. This is what makes spaceless scripts work:
 * there is nothing to join back together.
 */
export function tokens(text: string, locale: string): Token[] {
  const seg = segmenter(locale, "word");
  if (!seg)
    // ponytail: pre-Segmenter webview — the old whitespace split, kept only as a
    // floor. Every browser Tauri ships on has had Segmenter for years.
    return text.split(/(\s+)/).filter(Boolean).map((t) => ({ text: t, word: !/^\s+$/.test(t) }));
  return [...seg.segment(text)].map((s) => ({ text: s.segment, word: !!s.isWordLike }));
}

/** Just the word-like segments, lowercased — the unit the metrics count. */
export function words(text: string, locale: string): string[] {
  return tokens(text, locale)
    .filter((t) => t.word)
    .map((t) => t.text.toLowerCase());
}

/** How many sentences `text` holds. Never returns 0, so it is safe as a divisor. */
export function sentenceCount(text: string, locale: string): number {
  const seg = segmenter(locale, "sentence");
  if (!seg) return Math.max(1, (text.match(/[.!?。！？]+/g) ?? []).length);
  let n = 0;
  for (const s of seg.segment(text)) if (s.segment.trim()) n++;
  return Math.max(1, n);
}

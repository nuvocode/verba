// The Read note contract (PLAN-023): a note names something in the passage and
// explains it — it never proposes a replacement. This module is pure by contract:
// it must not import the talk prompt module (invariant 19 — Read's schema and
// Talk's correction schema never meet), ./db.ts, React, or a provider. It takes
// raw model output and a passage, and returns the notes worth keeping.
import { bareWord, type ReadingText } from "./reading.ts";

/** The five things a note can be about. Read's own closed set — it never reuses
 * Talk's correction categories (invariant 19). */
export type NoteType = "lexis" | "structure" | "register" | "culture" | "contrast";

const NOTE_TYPES: NoteType[] = ["lexis", "structure", "register", "culture", "contrast"];

export interface ReadNote {
  type: NoteType;
  /** The expression as it appears in the passage — verbatim, including inflection. */
  anchor: string;
  /** Index of the sentence the anchor was found in. Filled by validation, not the model. */
  sentence: number;
  /** One or two lines, in the learner's language. */
  body: string;
}

/**
 * Normalise an expression for anchoring: per-token `bareWord` (punctuation
 * stripped, case-folded), whitespace collapsed. No stemming, no fuzzy match — a
 * real anchor must survive punctuation and casing, but "run out" must not match
 * "ran out".
 */
function normalise(expr: string): string {
  return expr
    .split(/\s+/)
    .map(bareWord)
    .filter(Boolean)
    .join(" ");
}

/**
 * Drops every note that cannot be anchored, caps what survives, and orders by
 * priority. Silent by design: a rejected note is not an error, it is a note that
 * was not worth keeping.
 *
 * Rules, in order:
 *  1. Shape: `type` in the five, `anchor` a non-empty string, `body` ≥ 10 chars.
 *  2. Anchor: `anchor` must occur in some sentence's `target`, matched on the
 *     normalised form. `sentence` is set from where it was found.
 *  3. One note per anchor; one note per sentence maximum. Duplicates dropped.
 *  4. Priority: lexis/structure before register/culture/contrast; within a type,
 *     longer anchors first; ties by sentence order.
 *  5. Cap: take the first `cap`. Zero notes is a valid outcome.
 */
export function validateNotes(raw: unknown, text: ReadingText, _locale: string, cap: number): ReadNote[] {
  if (!Array.isArray(raw)) return [];
  const sentences = text.sentences.map((s) => s.target);
  // Pre-normalise each sentence once, so anchoring is a single pass.
  const normalisedSentences = sentences.map((s) => normalise(s));

  const seenAnchor = new Set<string>();
  const valid: ReadNote[] = [];

  for (const item of raw) {
    const o = item as any;
    // 1. shape
    if (!o || typeof o !== "object") continue;
    const type = o.type;
    if (!NOTE_TYPES.includes(type)) continue;
    const anchor = typeof o.anchor === "string" ? o.anchor.trim() : "";
    if (!anchor) continue;
    const body = typeof o.body === "string" ? o.body.trim() : "";
    if (body.length < 10) continue;

    // 2. anchor — must occur in some sentence's target, on the normalised form.
    const norm = normalise(anchor);
    if (!norm) continue;
    let sentence = -1;
    for (let i = 0; i < normalisedSentences.length; i++) {
      if (normalisedSentences[i].includes(norm)) {
        sentence = i;
        break;
      }
    }
    if (sentence === -1) continue;

    // 3. one note per anchor — the first occurrence of an anchor wins.
    if (seenAnchor.has(norm)) continue;
    seenAnchor.add(norm);

    valid.push({ type, anchor, sentence, body });
  }

  // 4. priority: lexis/structure first, then longer anchors within a type, then
  // sentence order. Sorting before the per-sentence dedupe means the highest-
  // priority note on a sentence is the one that survives.
  const rank = (t: NoteType) => (t === "lexis" || t === "structure" ? 0 : 1);
  valid.sort((a, b) => {
    const r = rank(a.type) - rank(b.type);
    if (r !== 0) return r;
    const len = b.anchor.length - a.anchor.length;
    if (len !== 0) return len;
    return a.sentence - b.sentence;
  });

  // 3b. one note per sentence — after priority sorting, the first note on each
  // sentence is the one worth keeping.
  const seenSentence = new Set<number>();
  const kept: ReadNote[] = [];
  for (const n of valid) {
    if (seenSentence.has(n.sentence)) continue;
    seenSentence.add(n.sentence);
    kept.push(n);
  }

  // 5. cap.
  return kept.slice(0, cap);
}

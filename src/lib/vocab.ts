/**
 * The gate every card passes before it reaches the deck.
 *
 * Memory used to take whatever any surface handed it, and the deck filled with
 * things that are not vocabulary: a time from a comprehension question ("8:15"),
 * a name, a card with no meaning at all. A deck like that is not a deck, it is a
 * transcript of the story — and reviewing it teaches nothing about the language.
 *
 * So: a card is a **term and its meaning**. Everything here is a pure function of
 * the candidate, so the same rules can be run before a write (`worthLearning`) and
 * over rows already on file (`suspect`), and both can be tested without a database.
 */

export interface VocabCandidate {
  term: string;
  translation: string;
  /** The sentence it was met in. Optional context — its absence is not disqualifying. */
  example?: string;
}

/** Rejected candidates carry the reason, because the reason is what the UI shows. */
export type Verdict = { ok: true } | { ok: false; why: string };

const OK: Verdict = { ok: true };

/** Case-folded, punctuation-trimmed, whitespace-collapsed — for the "is this the same string" checks. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:!?¿¡"“”'’()[\]—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Any numeral in any script: 8, ٨, ８. A term that counts something is a story detail. */
const NUMERAL = /\p{N}/u;
/** At least one letter in any script — rules out "—", "…", "%". */
const LETTER = /\p{L}/u;
/** Latin single characters are letters of the alphabet; a lone kanji or hanzi is a word. */
const LONE_LATIN = /^\p{Script=Latin}$/u;

/** A term of more than this many whitespace-separated words is a sentence, not vocabulary. */
export const MAX_TERM_WORDS = 4;

/**
 * Should this become a card?
 *
 * Deliberately conservative: every rule here rejects something that has actually
 * turned up in a real deck, and none of them can reject an ordinary word or phrase
 * that came with its meaning.
 */
export function worthLearning(c: VocabCandidate): Verdict {
  const term = c.term.trim();
  const translation = (c.translation ?? "").trim();
  const example = (c.example ?? "").trim();

  if (!term) return { ok: false, why: "no term" };
  // Times, dates, quantities, addresses. These are what the passage said, not what
  // the language does — and they are the single largest source of junk cards. Checked
  // before "not a word" so that "8:15" is turned away for the reason it is really wrong.
  if (NUMERAL.test(term)) return { ok: false, why: "a number, time or date" };
  if (!LETTER.test(term)) return { ok: false, why: "not a word" };
  if (LONE_LATIN.test(term)) return { ok: false, why: "a single letter" };
  if (term.split(/\s+/).length > MAX_TERM_WORDS) return { ok: false, why: "a whole phrase, too long to study" };

  // A card with nothing on the back cannot be reviewed: the learner is asked to
  // recall a meaning the app never recorded.
  if (!translation) return { ok: false, why: "no meaning recorded" };
  // A model that echoes the term as its own translation has told us nothing.
  if (normalize(term) === normalize(translation)) return { ok: false, why: "the meaning just repeats the term" };
  // "term = the sentence" is the other way a whole line ends up on a card.
  if (example && normalize(term) === normalize(example)) return { ok: false, why: "the whole sentence" };

  return OK;
}

/**
 * Why a card already on file looks like junk — `null` when it looks fine.
 *
 * The same rules, pointed backwards, so the deck can show the learner exactly which
 * of their cards were let in by the old, looser capture and offer to clear them.
 */
export function suspect(row: VocabCandidate): string | null {
  const v = worthLearning(row);
  return v.ok ? null : v.why;
}

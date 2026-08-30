// What the deck looks like to the learner (§2.5): three groups, one capped ask,
// one calm sentence about the backlog, and four filters. Pure — Memory renders
// what this file decides, and deck.check.ts holds it to the spec without a
// database in the room.
import { strength, DAILY_REVIEW_CAP } from "./srs.ts";

/** The row shape this file needs. `db.VocabRow` satisfies it structurally. */
export interface DeckCard {
  id: number;
  term: string;
  translation: string;
  example: string;
  ease: number;
  interval: number;
  due: number;
  reps: number;
  lapses: number;
  type: string;
  captured_by: string;
  source_surface: string;
  level_band: string | null;
}

/** A card parked this long is not being learned any more; it is known. */
export const LEARNED_INTERVAL_DAYS = 21;

export type DeckGroup = "due" | "soon" | "learned";

/**
 * Which of the three groups a card is in. "Soon" is everything scheduled that has
 * not settled yet — the group a learner checks to see what is coming, which is why
 * it is not merged into "learned".
 */
export function groupOf(card: DeckCard, now: number): DeckGroup {
  if (card.due <= now) return "due";
  return card.interval >= LEARNED_INTERVAL_DAYS ? "learned" : "soon";
}

export function groupDeck(cards: DeckCard[], now: number): Record<DeckGroup, DeckCard[]> {
  const out: Record<DeckGroup, DeckCard[]> = { due: [], soon: [], learned: [] };
  for (const c of cards) out[groupOf(c, now)].push(c);
  out.due.sort((a, b) => a.due - b.due);
  return out;
}

/**
 * What the learner is asked for today, and what is merely true.
 *
 * The ask is capped; the backlog is not the ask. "112 due" is the number that
 * makes a learner close the app, so it never appears on a button — it appears in
 * a sentence that says the queue will come to them a day at a time.
 */
export function reviewAsk(dueCount: number, cap = DAILY_REVIEW_CAP): number {
  return Math.min(dueCount, cap);
}

/** The button. Always the capped number, always with its unit. */
export function reviewCall(dueCount: number, cap = DAILY_REVIEW_CAP): string {
  const ask = reviewAsk(dueCount, cap);
  return `${ask} ${ask === 1 ? "review" : "reviews"} today`;
}

/**
 * The backlog, said once and calmly. `null` when there is no backlog beyond
 * today's ask — a reassurance nobody needed is just another number on the screen.
 */
export function backlogNote(dueCount: number, cap = DAILY_REVIEW_CAP): string | null {
  const over = dueCount - reviewAsk(dueCount, cap);
  if (over <= 0) return null;
  return `${over} more are waiting behind today's ${cap}. They come back to you a day at a time — there is nothing to catch up on.`;
}

export interface DeckFilter {
  type?: string; // §1.4 VocabItem.type
  surface?: string; // where it was met: talk | read | listen
  band?: string; // CEFR band of the item
  fragile?: boolean; // strength < FRAGILE
}

/** Under this, the bar draws in the warning colour and "fragile" selects it. */
export const FRAGILE = 0.4;

export function filterDeck(cards: DeckCard[], f: DeckFilter): DeckCard[] {
  return cards.filter(
    (c) =>
      (!f.type || c.type === f.type) &&
      (!f.surface || c.source_surface === f.surface) &&
      (!f.band || c.level_band === f.band) &&
      (!f.fragile || strength(c) < FRAGILE),
  );
}

/** The values actually present in this deck — a filter chip for a value nobody has is furniture. */
export function facets(cards: DeckCard[]): { types: string[]; surfaces: string[]; bands: string[] } {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return {
    types: uniq(cards.map((c) => c.type)),
    surfaces: uniq(cards.map((c) => c.source_surface)),
    bands: uniq(cards.map((c) => c.level_band)),
  };
}

/** How a card's type reads on screen. camelCase is a schema, not a label. */
export function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    word: "word",
    phrase: "phrase",
    phrasalVerb: "phrasal verb",
    idiom: "idiom",
    collocation: "collocation",
    pronunciation: "pronunciation",
  };
  return labels[type] ?? "word";
}

/** Where a card came from, and who kept it — one line, or null when nothing is known. */
export function originLine(card: DeckCard): string | null {
  const who = card.captured_by === "coach" ? "kept for you" : "you kept this";
  return card.source_surface ? `${who} in ${card.source_surface}` : who;
}

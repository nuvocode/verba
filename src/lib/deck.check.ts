// Runnable check: `node --experimental-strip-types src/lib/deck.check.ts`
import assert from "node:assert";
import {
  groupOf,
  groupDeck,
  reviewAsk,
  reviewCall,
  backlogNote,
  filterDeck,
  facets,
  typeLabel,
  originLine,
  FRAGILE,
  type DeckCard,
} from "./deck.ts";
import { strength } from "./srs.ts";

const now = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const card = (over: Partial<DeckCard>): DeckCard => ({
  id: 1,
  term: "t",
  translation: "x",
  example: "",
  ease: 2.5,
  interval: 0,
  due: now,
  reps: 0,
  lapses: 0,
  type: "word",
  captured_by: "learner",
  source_surface: "read",
  level_band: null,
  ...over,
});

// 1. groupOf: overdue → due, 3-day → soon, 30-day → learned, due exactly now → due.
assert.equal(groupOf(card({ due: now - 1 }), now), "due", "overdue is due");
assert.equal(groupOf(card({ due: now + 3 * DAY, interval: 3 }), now), "soon", "3-day card is soon");
assert.equal(groupOf(card({ due: now + 30 * DAY, interval: 30 }), now), "learned", "30-day card is learned");
assert.equal(groupOf(card({ due: now }), now), "due", "due exactly now is due");

// 2. invariant 15: bars that are all the same length mean the value is not wired
//    to the schedule. A deck at intervals 0,1,5,21 and eases 1.3/2.5 must draw at
//    least four distinct strengths.
const varied = [0, 1, 5, 21].flatMap((interval) =>
  [1.3, 2.5].map((ease) => card({ interval, ease, due: now + interval * DAY })),
);
assert(new Set(varied.map(strength)).size >= 4, "invariant 15: strength bars must differ across the deck");

// 3. reviewCall: capped, singular, zero.
assert.equal(reviewCall(112), "20 reviews today");
assert.equal(reviewCall(1), "1 review today");
assert.equal(reviewCall(0), "0 reviews today");

// 4. backlogNote: says the overflow, and stays quiet when there is none.
assert.ok(backlogNote(112)?.includes("92"), "backlogNote(112) mentions the 92 waiting");
assert.equal(backlogNote(20), null);
assert.equal(backlogNote(3), null);

// 5. filterDeck narrows on each key independently and on two at once; empty filter returns all.
const deck = [
  card({ id: 1, type: "word", source_surface: "read", level_band: "B1", ease: 1.3, interval: 0 }),
  card({ id: 2, type: "phrase", source_surface: "talk", level_band: "B2", ease: 2.5, interval: 21 }),
  card({ id: 3, type: "idiom", source_surface: "listen", level_band: null, ease: 1.3, interval: 0 }),
];
assert.equal(filterDeck(deck, {}).length, 3, "empty filter returns everything");
assert.deepEqual(filterDeck(deck, { type: "phrase" }).map((c) => c.id), [2], "type filter");
assert.deepEqual(filterDeck(deck, { surface: "read" }).map((c) => c.id), [1], "surface filter");
assert.deepEqual(filterDeck(deck, { band: "B2" }).map((c) => c.id), [2], "band filter");
assert.deepEqual(filterDeck(deck, { fragile: true }).map((c) => c.id), [1, 3], "fragile filter");
assert.deepEqual(filterDeck(deck, { type: "word", surface: "read" }).map((c) => c.id), [1], "two keys at once");

// 6. facets lists only values present, sorted, with no null band leaking in.
const f = facets(deck);
assert.deepEqual(f.types, ["idiom", "phrase", "word"], "types sorted");
assert.deepEqual(f.surfaces, ["listen", "read", "talk"], "surfaces sorted");
assert.deepEqual(f.bands, ["B1", "B2"], "null band does not leak in");

// 7. typeLabel: camelCase becomes a label; unknown falls back to "word".
assert.equal(typeLabel("phrasalVerb"), "phrasal verb");
assert.equal(typeLabel("not-a-real-type"), "word");

// originLine: who kept it, and where.
assert.equal(originLine(card({ captured_by: "coach", source_surface: "talk" })), "kept for you in talk");
assert.equal(originLine(card({ captured_by: "learner", source_surface: "read" })), "you kept this in read");
assert.equal(originLine(card({ captured_by: "learner", source_surface: "" })), "you kept this");

// groupDeck sorts the due group oldest-first.
const g = groupDeck(
  [card({ id: 1, due: now + 5 * DAY, interval: 5 }), card({ id: 2, due: now - 1 }), card({ id: 3, due: now - 5 })],
  now,
);
assert.deepEqual(g.due.map((c) => c.id), [3, 2], "due group is oldest-first");
assert.equal(g.soon.length, 1, "one soon");
assert.equal(g.learned.length, 0, "no learned");

// reviewAsk is the capped number.
assert.equal(reviewAsk(112), 20);
assert.equal(reviewAsk(5), 5);

// FRAGILE is the documented threshold.
assert.equal(FRAGILE, 0.4);

console.log("deck.check OK");

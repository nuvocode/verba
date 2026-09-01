// Runnable self-check for §PLAN-022 passage gates: coherence, reuse, level.
// Fixtures are hand-written, in `en` and one non-Latin locale. The gates are
// deterministic arithmetic — no model, no DB, no clock.
// Run: node --experimental-strip-types src/lib/passage.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { coherence, reuse, level } from "./passage.ts";
import type { ReadingText } from "./reading.ts";

// A minimal stopword set for the fixtures. Real packs may carry their own; the
// fallback (length ≥ 3) is exercised where a set is empty.
const STOP = new Set(["the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "it", "is", "was", "are", "were", "be", "i", "you", "he", "she", "we", "they", "this", "that", "there", "with", "for", "as", "by", "from", "so", "then", "now", "not", "no", "yes", "very", "just", "also", "too"]);

// The en pack's negation words, mirrored for the fixtures — the contradiction
// test only runs when a pack supplies them.
const EN_NEGATIONS = new Set([
  "not", "no", "never", "don't", "doesn't", "didn't", "isn't", "aren't",
  "wasn't", "weren't", "won't", "can't", "cannot", "couldn't", "wouldn't", "shouldn't",
]);

const t = (sentences: string[], title = "A passage"): ReadingText => ({
  title,
  sentences: sentences.map((target) => ({ target, native: "" })),
});

// invariant 20 — a coherent 6-sentence passage passes all three gates.
{
  const text = t([
    "Maria went to the market on Saturday morning.",
    "She bought fresh vegetables and some ripe fruit at the market.",
    "The fruit was sweet and the vegetables were fresh.",
    "She also found a small stall selling warm bread.",
    "The bread was warm and the baker was friendly.",
    "Then she walked home carrying her heavy bag.",
  ]);
  const c = coherence(text, "en", STOP, EN_NEGATIONS);
  assert.equal(c.ok, true, "a coherent passage passes coherence");
  assert.deepEqual(c.failed, [], "…with no failing sentence");
  const r = reuse(text, ["market", "bread", "baker", "vegetables"]);
  assert.equal(r.ok, true, "a passage containing the words passes reuse");
  const l = level(text, "A2", "en");
  assert.equal(l.ok, true, "a mid-length passage is within one of an A2 target");
}

// invariant 20 — a passage whose sentence 4 repeats sentence 3 fails coherence
// at index 3.
{
  const text = t([
    "Maria went to the market on Saturday morning.",
    "She bought fresh vegetables and some ripe fruit.",
    "The market was crowded with many friendly people.",
    "The market was crowded with many friendly people.",
    "She bought a loaf and talked with the baker.",
    "Then she walked home carrying her heavy bag.",
  ]);
  const c = coherence(text, "en", STOP, EN_NEGATIONS);
  assert.equal(c.ok, false, "a repeated sentence fails coherence");
  assert(c.failed.includes(3), "the repeat fails at index 3");
}

// invariant 20 — "The market is a market." fails as a tautology.
{
  const c = coherence(t(["The market is a market."]), "en", STOP, EN_NEGATIONS);
  assert.equal(c.ok, false, "a copula tautology fails");
  assert(c.why.some((w) => w.includes("repeats")), "the reason names the tautology");
}

// invariant 20 — "It was nice. Yes." fails as empty.
{
  const c = coherence(t(["It was nice.", "Yes."]), "en", STOP, EN_NEGATIONS);
  assert.equal(c.ok, false, "an empty sentence fails");
  assert(c.why.some((w) => w.includes("content words")), "the reason names the emptiness");
}

// invariant 20 — a contradiction fires on a word-boundary negation of a shared
// predicate: the sentence's content words (negation removed) are a subset of an
// earlier sentence's, and it is not a tautology.
{
  const text = t([
    "The market is open on Saturday.",
    "The market is not open on Saturday.",
  ]);
  const c = coherence(text, "en", STOP, EN_NEGATIONS);
  assert.equal(c.ok, false, "a word-boundary negation of a shared predicate is a contradiction");
  assert(c.why.some((w) => w.includes("contradicts")), "the reason names the contradiction");
  assert(!c.why.some((w) => w.includes("repeats")), "a negated repetition is a contradiction, not a tautology");
}

// invariant 20 — a negation inside another word is not a contradiction: "nothing"
// contains "not" but negates a noun, not a predicate.
{
  const text = t([
    "Maria bought nothing at the market.",
    "She walked home with an empty bag.",
  ]);
  const c = coherence(text, "en", STOP, EN_NEGATIONS);
  assert.equal(c.ok, true, "a negation inside another word is not a contradiction");
}

// invariant 20 — a negation of something never said is not a contradiction: the
// sentence's content words are not a subset of any earlier sentence's.
{
  const text = t([
    "Maria went to the market.",
    "She did not buy any bread.",
  ]);
  const c = coherence(text, "en", STOP, EN_NEGATIONS);
  assert.equal(c.ok, true, "a negation of something never asserted is not a contradiction");
}

// invariant 20 — positive fixtures: ordinary passages must pass. A gate that
// rejects a good passage is invisible, so these pin the door open. Three
// hand-written passages, each with a different shape — one carries a negative
// sentence, one is built from short A1–A2 sentences, one is a plain narrative.
{
  const market = t([
    "The market was busy on Saturday morning.",
    "Ana wanted fresh bread for her family.",
    "She did not find any bread at the market.",
    "So she walked to the bakery on the corner.",
  ]);
  assert.equal(coherence(market, "en", STOP, EN_NEGATIONS).ok, true, "a passage with a negative sentence passes coherence");

  const job = t([
    "Lucas started a new job last week.",
    "The office is near the river.",
    "His colleagues are friendly and patient.",
    "He takes the bus every morning.",
  ]);
  assert.equal(coherence(job, "en", STOP, EN_NEGATIONS).ok, true, "a passage of short A1–A2 sentences passes coherence");

  const rain = t([
    "Rain fell all afternoon.",
    "The streets were empty.",
    "A small cafe stayed open on the corner.",
    "Two students shared an umbrella outside.",
  ]);
  assert.equal(coherence(rain, "en", STOP, EN_NEGATIONS).ok, true, "a plain narrative passage passes coherence");
}

// invariant 21 — reuse with 4 of 8 words present passes at exactly 50%; 3 of 8
// fails and names the five missing.
{
  const text = t([
    "Maria went to the market on Saturday morning.",
    "She bought fresh vegetables and some ripe fruit.",
    "The market was crowded with many friendly people.",
    "Maria found a small stall selling warm bread.",
    "She bought a loaf and talked with the baker.",
    "Then she walked home carrying her heavy bag.",
  ]);
  const want = ["market", "bread", "baker", "vegetables", "fruit", "stall", "loaf", "bag"];
  const r4 = reuse(text, want.slice(0, 4));
  assert.equal(r4.ok, true, "4 of 8 present passes at exactly 50%");
  assert.equal(r4.hit.length, 4, "the hit list names the four present");
  const r3 = reuse(text, want.slice(0, 3).concat(["zebra", "moon", "river", "cloud", "stone"]));
  assert.equal(r3.ok, false, "3 of 8 present fails");
  assert.equal(r3.missing.length, 5, "the five missing are named");
  assert(r3.missing.includes("zebra"), "a missing word is named");
}

// invariant 21 — the hit list is the gate's output, not the request: a word
// asked twice is counted once, and only present words are hits.
{
  const text = t(["Maria bought fresh bread at the market."]);
  const r = reuse(text, ["bread", "bread", "market", "zebra"]);
  assert.equal(r.hit.length, 2, "a word asked twice is counted once");
  assert.equal(r.missing.length, 1, "only the truly missing word is named");
}

// level — a 30-word-sentence C1 passage is outside an A2 target and inside a B2 one.
{
  const long = t([
    "The extraordinarily complicated negotiations between the multinational corporations and the governmental regulatory authorities continued throughout the entire prolonged and contentious fiscal quarter.",
  ]);
  const lA2 = level(long, "A2", "en");
  assert.equal(lA2.ok, false, "a C1-length sentence is outside an A2 target");
  const lB2 = level(long, "B2", "en");
  assert.equal(lB2.ok, true, "…and inside a B2 one");
}

// A non-Latin locale still measures — Japanese words are cut by their own rules.
{
  const ja = t(["私は市場でパンを買いました。", "彼女は新鮮な野菜を買いました。"]);
  const c = coherence(ja, "ja", new Set());
  // With no stopword list, content = length ≥ 3; these sentences have enough.
  assert.equal(c.ok, true, "a Japanese passage with enough words passes coherence");
  const l = level(ja, "A2", "ja");
  assert.equal(typeof l.band, "string", "a Japanese passage still gets a band");
}

// invariant 20 — the bypass scan: useRead.ts has exactly one setText( on a
// success path, and no path assigns a passage whose outcome was ok: false.
{
  const src = readFileSync(new URL("./useRead.ts", import.meta.url), "utf8");
  // The success path is the one place a *generated* passage is assigned. The
  // other setText calls are null (close) or a saved passage (open/openFallback),
  // which are not generation. Count the generate success-path assignment — the
  // one that follows the gates and precedes the save.
  const successAssignments = (src.match(/setText\(t\);\s*\n\s*await saveReading/g) ?? []).length;
  assert.equal(successAssignments, 1, "useRead.ts has exactly one setText( on a success path");
  // The only place an ok:false outcome is built is `reject`, which sets the
  // outcome and never the text. Assert that the reject function body — from its
  // declaration to its closing brace — contains no setText call.
  const rejectBody = src.match(/async function reject\([\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert(rejectBody.length > 0, "the reject function exists");
  assert(!/setText\(/.test(rejectBody), "no path assigns a passage whose outcome was ok: false");
}

console.log("passage.check OK");

// Runnable self-check for the capture gate: what is allowed to become a card, what
// is turned away, and that the two real cards that prompted the rule set — a time
// pulled out of a comprehension question, and a phrase with no meaning on the back —
// are both rejected.
// Run: node --experimental-strip-types src/lib/vocab.check.ts
import assert from "node:assert";
import { suspect, worthLearning, MAX_TERM_WORDS } from "./vocab.ts";

const ok = (c: { term: string; translation: string; example?: string }) => worthLearning(c).ok;
const why = (c: { term: string; translation: string; example?: string }) => {
  const v = worthLearning(c);
  return v.ok ? "" : v.why;
};

// --- what a card is: a term and its meaning ---
assert(
  ok({ term: "walk through", translation: "to explain or guide someone step by step", example: "Let me walk you through the menu." }),
  "an ordinary phrase with a meaning is a card, even when the example inflects it",
);
assert(ok({ term: "acogedor", translation: "cosy" }), "a word needs no example sentence to be worth learning");
assert(ok({ term: "猫", translation: "cat" }), "a lone CJK character is a word, not a stray letter");
assert(ok({ term: "por si acaso", translation: "just in case" }), "a short set phrase is fine");

// --- the card from the screenshot: a time, captured from a missed comprehension cloze ---
assert(!ok({ term: "8:15", translation: "", example: "…the clock on the kitchen wall showed 8:15." }), "a time is not vocabulary");
assert(why({ term: "8:15", translation: "" }) === "a number, time or date", "…and it is turned away for being a number");
assert(!ok({ term: "1997", translation: "the year he left" }), "a year is a story detail even with a gloss");
assert(!ok({ term: "٨", translation: "eight" }), "numerals in other scripts count as numerals too");

// --- a card with nothing on the back cannot be reviewed ---
assert(why({ term: "desayunar", translation: "" }) === "no meaning recorded", "an empty gloss is disqualifying");
assert(why({ term: "desayunar", translation: "   " }) === "no meaning recorded", "…and whitespace is empty");
assert(
  why({ term: "Vertrag", translation: "vertrag." }) === "the meaning just repeats the term",
  "a model echoing the term back has recorded no meaning",
);

// --- whole lines are not terms ---
const line = "Let me walk you through the menu.";
assert(why({ term: line, translation: "izin ver menüyü anlatayım", example: line }) === "a whole phrase, too long to study", "a sentence is not a term");
assert(
  why({ term: "por si", translation: "por si!", example: "Por si." }) === "the meaning just repeats the term",
  "term-equals-translation is caught before term-equals-example",
);
assert(!ok({ term: "un café", translation: "un café", example: "Un café, por favor." }), "term equal to its own example is not a card");
assert(MAX_TERM_WORDS === 4, "the length cut is four words — a collocation, not a clause");
assert(ok({ term: "a b c d", translation: "four words is still allowed" }), "the cut is exclusive: four words pass");
assert(!ok({ term: "a b c d e", translation: "five is a clause" }), "…five do not");

// --- not-a-word ---
assert(why({ term: "—", translation: "dash" }) === "not a word", "punctuation is not a word");
assert(why({ term: "", translation: "x" }) === "no term", "an empty term says so plainly");
assert(why({ term: "e", translation: "and" }) === "a single letter", "a lone latin letter is a letter, not a word");

// --- suspect() is the same ruling, pointed at rows already on file ---
assert(suspect({ term: "acogedor", translation: "cosy" }) === null, "a good row is not suspect");
assert(suspect({ term: "8:15", translation: "" }) === "a number, time or date", "…and a bad one names its reason for the deck to show");

console.log("vocab.check.ts — all assertions passed");

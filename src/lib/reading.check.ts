// Runnable self-check for the reading ask: what the reader wants a passage to be —
// how long, and what about — and how that reaches the prompt.
// Run: node --experimental-strip-types src/lib/reading.check.ts
import assert from "node:assert";
import { defaultSettings, type Settings } from "./settings.ts";
import { storyPrompt, LENGTHS, DEFAULT_LENGTH } from "./reading.ts";

const s: Settings = { ...defaultSettings, targetLang: "Spanish", nativeLang: "English" };

// --- length: three words the reader can say, three counts the model is given ---
assert(LENGTHS.short < LENGTHS.medium && LENGTHS.medium < LENGTHS.long, "the three lengths are actually ordered");
assert(LENGTHS[DEFAULT_LENGTH] === 10, "the default is a sitting's worth, not the old hardcoded 8");

assert(storyPrompt(s, { sentences: LENGTHS.short }).includes("about 5 sentences"), "short asks for ~5");
assert(storyPrompt(s, { sentences: LENGTHS.long }).includes("about 20 sentences"), "long asks for ~20");

// A long passage is not a short one with a bigger number: a 3B model left alone at 20
// sentences pads and drifts, so the prompt has to ask for the shape of a story.
const long = storyPrompt(s, { sentences: LENGTHS.long });
assert(long.includes("a situation, a complication, a resolution"), "long asks for an arc");
assert(long.includes("Do not pad it out"), "…and forbids the padding it would otherwise do");
assert(!storyPrompt(s, { sentences: LENGTHS.short }).includes("Do not pad it out"), "short needs none of that");

// --- topic: what the reader typed outranks the day's plan and the coach's file ---
const known = [
  { id: 1, fact: "Lives in Ankara", created_at: 0 },
  { id: 2, fact: "Loves Superman comics", created_at: 0 },
];
const asked = storyPrompt(s, { topic: "a trip to Japan", interests: "cooking", memories: known });
assert(asked.includes("The learner asked for a passage about: a trip to Japan"), "the topic they named is the topic");
assert(!asked.includes("Tailor the topic to the learner's interests"), "…and the day's theme stands down for it");

// A named topic must not be furnished out of the learner's file: a story about Japan
// has no business reaching for their comic books just because we know about them.
assert(asked.includes("not the subject of this passage"), "with a topic, the memories are demoted to background");
assert(asked.includes("A story that never touches any of it is a good story"), "…and ignoring them entirely is allowed");
assert(!asked.includes("set the story in the learner's own world"), "…so the instruction to use them is gone");

// Recency is the other half of it: a small model leans on what it read last, so the
// subject has to come after the facts, not before them.
assert(
  asked.indexOf("Loves Superman comics") < asked.indexOf("The learner asked for a passage about"),
  "the facts are stated before the subject, so the subject gets the last word",
);

// With no topic named, the learner's world is exactly what makes the passage theirs.
const unasked = storyPrompt(s, { interests: "the market", memories: known });
assert(unasked.includes("set the story in the learner's own world"), "an unasked-for passage is still set in their world");
assert(unasked.includes("Loves Superman comics"), "…and still knows them");

// Empty is not a topic — it is "keep today's plan", which is what keeps the daily flow one keystroke.
const planned = storyPrompt(s, { topic: "   ", interests: "the market" });
assert(planned.includes("Tailor the topic to the learner's interests: the market"), "blank topic falls back to the theme");
assert(!planned.includes("asked for a passage about"), "…and does not tell the model the learner asked for whitespace");

// Nothing at all still generates something worth reading.
assert(storyPrompt(s, {}).includes("Pick an engaging everyday topic"), "no theme, no topic: the coach picks");

// The day's weak area rides along either way — asking for a topic does not drop the goal.
assert(
  storyPrompt(s, { topic: "restaurant vocabulary", goal: "past tense" }).includes("give practice with: past tense"),
  "a named topic still practises what the day is for",
);

console.log("reading.check.ts — all assertions passed");

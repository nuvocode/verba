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
const asked = storyPrompt(s, { topic: "a trip to Japan", interests: "cooking", memories: [{ id: 1, fact: "Lives in Ankara", created_at: 0 }] });
assert(asked.includes("The learner asked for a passage about: a trip to Japan"), "the topic they named is the topic");
assert(!asked.includes("Tailor the topic to the learner's interests"), "…and the day's theme stands down for it");
assert(asked.includes("Lives in Ankara"), "…while their world is still the furniture, not the subject");

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

// Runnable self-check for long-term memory (Settings → User Memory): what a model's
// answer is allowed to write, what gets deduped, what supersedes what, and that the
// facts actually reach the prompts that were supposed to receive them.
// Run: node --experimental-strip-types src/lib/memory.check.ts
import assert from "node:assert";
import { defaultSettings, type Settings } from "./settings.ts";
import {
  buildSystem,
  memoryBrief,
  memoryDate,
  memoryPrompt,
  parseMemory,
  planMemory,
  type Memory,
} from "./prompts.ts";
import { storyPrompt } from "./reading.ts";
import { weeklyReportPrompt } from "./coach.ts";

const s: Settings = { ...defaultSettings, targetLang: "Spanish", nativeLang: "English" };
const scenario = { id: "free", title: "Free talk", emoji: "💬", setup: "Talk about anything." };

const JULY = new Date("2026-07-14T09:00:00Z").getTime();
const known: Memory[] = [
  { id: 3, fact: "Works as a backend developer", created_at: JULY },
  { id: 5, fact: "Lives in Ankara", created_at: JULY },
];

// --- the record carries its date, and shows it the way Settings does ---
assert(memoryDate(JULY) === "14 Jul 2026", "a fact is dated the way the ticket writes it");
assert(memoryBrief([]).length === 0, "a first-time learner's prompt carries no memory preamble at all");
assert(memoryBrief(known).includes("Works as a backend developer · 14 Jul 2026"), "each bullet is the fact and its date");

// --- parse: models return what they like, and none of it may reach the table raw ---
const parsed = parseMemory(
  '```json\n{ "facts": [ { "fact": "Moved to Berlin  for   work", "replaces": "5" }, { "fact": "Cooks most evenings", "replaces": null } ] }\n```',
);
assert(parsed.length === 2, "fenced JSON is unwrapped");
assert(parsed[0].fact === "Moved to Berlin for work", "whitespace in a fact is collapsed");
assert(parsed[0].replaces === 5, '"5" is the number 5 — models quote ids as often as not');
assert(parsed[1].replaces === null, "null means new");
assert(parseMemory("I didn't find anything durable.").length === 0, "prose is not a fact");
assert(parseMemory('{ "facts": [ { "fact": "   " } ] }').length === 0, "an empty fact is not a fact");
assert(
  parseMemory('{ "facts": [ { "fact": "Likes hiking", "replaces": 0 } ] }')[0].replaces === null,
  "0 is not a row id — it reads as new, not as a delete",
);

// --- plan: the half that does not depend on the model having behaved ---

// Told twice is not two bullets, whatever the punctuation and case say.
assert(
  planMemory(known, [{ fact: "works as a Backend Developer!", replaces: null }]).length === 0,
  "a fact already on file is dropped",
);
// …and not twice within one answer either.
assert(
  planMemory(known, [
    { fact: "Has a sister in Izmir", replaces: null },
    { fact: "has a sister in Izmir.", replaces: null },
  ]).length === 1,
  "one answer cannot record the same fact twice",
);

// A changed fact supersedes the row it names.
const moved = planMemory(known, [{ fact: "Lives in Berlin", replaces: 5 }]);
assert(moved.length === 1 && moved[0].replaces === 5, "a fact that changed replaces the one it changed");

// A hallucinated id must not delete a row the learner never contradicted.
const ghost = planMemory(known, [{ fact: "Plays the guitar", replaces: 99 }]);
assert(ghost.length === 1 && ghost[0].replaces === null, "an id that names no row is written as new, deleting nothing");

// The cap: a session that "learns" ten durable facts has stopped telling them from small talk.
const flood = planMemory(
  [],
  Array.from({ length: 10 }, (_, i) => ({ fact: `Fact number ${i}`, replaces: null })),
);
assert(flood.length === 6, "at most six facts come out of one conversation");

// --- the facts reach the three prompts that asked for them ---
const system = buildSystem(s, scenario, undefined, known);
assert(system.includes("Lives in Ankara"), "the coach's system prompt carries the memory");
assert(system.includes("Never read the list back"), "…and is told not to recite it");
assert(!buildSystem(s, scenario).includes("What you know about the learner"), "no memory, no block");

const story = storyPrompt(s, { memories: known });
assert(story.includes("Works as a backend developer"), "the reading generator can lean on the memory for topics");
assert(!storyPrompt(s, {}).includes("What you know about the learner"), "…and says nothing when there is none");

const stats = { sessions: 3, messages: 40, wordsPracticed: 300, vocabLearned: 8, vocabReviewed: 20, avgLevelScore: 60, focusAreas: [] };
assert(weeklyReportPrompt(s, stats, undefined, known).includes("Lives in Ankara"), "the weekly report knows them too");

// --- extraction: the model is shown what is already recorded, by id, so it can supersede ---
const extract = memoryPrompt(s, known);
assert(extract.includes("5. Lives in Ankara"), "the known facts are numbered with the ids planMemory will check");
assert(extract.includes("Spanish"), "…and it knows which language it is recording for");
assert(memoryPrompt(s, []).includes("Nothing is recorded yet"), "an empty record says so, rather than showing a blank list");

console.log("memory.check.ts — all assertions passed");

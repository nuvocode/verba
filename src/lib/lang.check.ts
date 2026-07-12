// Runnable self-check for the language seam: segmentation (lib/text), the
// punctuation strip, the metrics that hang off them, and the rule that every
// prompt naming the target language also carries the pack's guidance.
// Run: node --experimental-strip-types src/lib/lang.check.ts
import assert from "node:assert";
import { tokens, words, sentenceCount } from "./text.ts";
import { bareWord } from "./reading.ts";
import { computeMetrics } from "./metrics.ts";
import { getPack } from "./packs/index.ts";
import { vocabPrompt, summaryPrompt, buildSystem } from "./prompts.ts";
import { levelPrompt } from "./level.ts";
import { placementPrompt } from "./placement.ts";
import { weeklyReportPrompt, drillPrompt } from "./coach.ts";
import { recapPrompt, buildDailyPlan } from "./learn.ts";
import { defaultSettings, type Settings } from "./settings.ts";
import { BUNDLED_SCENARIOS } from "./scenarios.ts";

// --- segmentation: the spaceless scripts are the whole point ---
const JA = "私は学生です。";
assert(
  tokens(JA, "ja-JP").filter((t) => t.word).length > 1,
  "Japanese must cut into several words — a whitespace split saw one",
);
assert.deepEqual(
  words("Quisiera un café, por favor.", "es-ES"),
  ["quisiera", "un", "café", "por", "favor"],
  "Spanish still cuts the way it always did",
);

// The renderer rebuilds the passage out of these, so nothing may be lost.
for (const [text, loc] of [
  [JA, "ja-JP"],
  ["Quisiera un café, por favor.", "es-ES"],
  ["¿Dónde está el mercado?", "es-ES"],
] as const)
  assert.equal(tokens(text, loc).map((t) => t.text).join(""), text, `tokens must round-trip exactly (${loc})`);

// --- sentences: 。 ends one, and the old /[.!?]/ never knew ---
assert.equal(sentenceCount("私は学生です。今日は暑いです。", "ja-JP"), 2, "Japanese sentences end in 。");
assert.equal(sentenceCount("Hola. ¿Qué tal?", "es-ES"), 2, "Spanish sentences still count");
assert.equal(sentenceCount("", "es-ES"), 1, "never zero — it is a divisor");

// --- punctuation strip covers every script, not just Latin ---
assert.equal(bareWord("学生。"), "学生", "CJK full stop is punctuation too");
assert.equal(bareWord("mercado,"), "mercado", "and the Latin set still works");

// --- metrics no longer read a Japanese learner as a one-word beginner ---
const ja = computeMetrics(["私は毎日、日本語を勉強しています。友達と話すのが好きです。"], { locale: "ja-JP" });
assert(ja.words > 5, `Japanese message must yield real words, got ${ja.words}`);
assert.equal(ja.messages, 1);
assert(ja.avgSentenceLen > 1, "…spread across its two sentences");

// --- every prompt that names the target language carries the pack ---
const s: Settings = { ...defaultSettings, packId: "ja", targetLang: "Japanese", cefr: "A1" };
const pack = getPack("ja");
assert(pack, "the bundled Japanese pack must resolve");
const plan = buildDailyPlan(s, { date: "2026-07-12", dueVocab: 0 });
const carriers: [string, string][] = [
  ["buildSystem", buildSystem(s, BUNDLED_SCENARIOS[0], pack)],
  ["vocabPrompt", vocabPrompt(s, pack)],
  ["summaryPrompt", summaryPrompt(s, pack)],
  ["levelPrompt", levelPrompt(s, pack)],
  ["placementPrompt", placementPrompt(s, pack)],
  ["weeklyReportPrompt", weeklyReportPrompt(s, { sessions: 1, messages: 1, wordsPracticed: 1, vocabLearned: 1, vocabReviewed: 1, avgLevelScore: 50, focusAreas: [] }, pack)],
  ["drillPrompt", drillPrompt(s, ["particles"], 4, pack)],
  ["recapPrompt", recapPrompt(s, plan, ["conversation"], pack)],
];
for (const [name, prompt] of carriers)
  assert.match(prompt, /Language notes for Japanese:/, `${name} must fold in the pack's guidance`);

// A missing pack degrades to no guidance rather than throwing.
for (const [name, prompt] of [
  ["vocabPrompt", vocabPrompt(s)],
  ["placementPrompt", placementPrompt(s)],
] as const)
  assert(!prompt.includes("Language notes"), `${name} without a pack must not invent guidance`);

// The vocab card is studied as a cloze, so the model is told to keep them alignable.
assert.match(vocabPrompt(s, pack), /MUST contain "term" written exactly/, "cloze alignment is asked for");

console.log("lang.check ✓");

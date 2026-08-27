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
const s: Settings = { ...defaultSettings, packId: "ja", profile: { ...defaultSettings.profile, targetLanguage: "Japanese", level: "A1" } };
const pack = getPack("ja");
assert(pack, "the bundled Japanese pack must resolve");
const plan = buildDailyPlan(s, { date: "2026-07-12", dayIndex: 1, dueVocab: 0 });
const carriers: [string, string][] = [
  ["buildSystem", buildSystem(s, BUNDLED_SCENARIOS[0], pack)],
  ["vocabPrompt", vocabPrompt(s, pack)],
  ["summaryPrompt", summaryPrompt(s, pack)],
  ["placementPrompt", placementPrompt(s, pack)],
  ["weeklyReportPrompt", weeklyReportPrompt(s, { sessions: 1, messages: 1, wordsPracticed: 1, vocabLearned: 1, vocabReviewed: 1, avgLevelScore: 50, focusAreas: [] }, pack)],
  ["drillPrompt", drillPrompt(s, ["particles"], 4, pack)],
  ["recapPrompt", recapPrompt(s, plan, [], ["talk"], pack)],
];
for (const [name, prompt] of carriers)
  assert.match(prompt, /Language notes for Japanese:/, `${name} must fold in the pack's guidance`);

// A missing pack degrades to no guidance rather than throwing.
for (const [name, prompt] of [
  ["vocabPrompt", vocabPrompt(s)],
  ["placementPrompt", placementPrompt(s)],
] as const)
  assert(!prompt.includes("Language notes"), `${name} without a pack must not invent guidance`);

// The card is a term and its meaning, so the meaning is not optional — and the
// details of the conversation (a name, a time, a price) are not terms. The cloze
// alignment this used to demand is gone with the cloze itself.
assert.match(vocabPrompt(s, pack), /Never leave it empty/, "a card with no meaning may not be proposed");
assert.match(vocabPrompt(s, pack), /Never pick a proper name, a number, a time/, "story details are not vocabulary");

// --- no language-name literals outside their three homes (#14) ---
// invariant 1
// When the gate is green, every language name a learner sees comes from exactly
// one of three places: the active pack's `name`, `profile.targetLanguage`, or
// `langName` (lib/langs.ts). That is the single source this gate guards. It does
// not claim more — "the target language changes everywhere at once" is not
// something a static scan can prove.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname } from "node:path";
import { BUNDLED_PACKS } from "./packs/bundled.ts";
import { COMMUNITY_PACKS } from "./packs/community.ts";

const PACK_NAMES = [...BUNDLED_PACKS, ...COMMUNITY_PACKS].map((p) => p.name);

function isExcluded(p: string): boolean {
  // *.check.ts — the gate's own file and every sibling check may name languages
  // in assertions; they are tests, not UI.
  if (p.endsWith(".check.ts")) return true;
  // src/lib/packs/ — a pack is where its language's canonical name lives by design.
  if (p.startsWith("src/lib/packs/")) return true;
  // src/lib/langs.ts — the code→name mapping; the definition the gate checks against.
  if (p === "src/lib/langs.ts") return true;
  // src/lib/settings.ts — DEFAULT_TARGET_LANGUAGE is a product default (what a
  // fresh install starts on), not display text; it may hold "Spanish" once.
  if (p === "src/lib/settings.ts") return true;
  return false;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // Not join(): on Windows it separates with a backslash, and every path in
    // isExcluded is written with forward slashes — so the exclusions all miss
    // and the gate reports every pack file as an offender. Node reads a
    // forward-slash path on Windows perfectly well.
    const p = `${dir}/${entry}`;
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && (extname(p) === ".ts" || extname(p) === ".tsx")) out.push(p);
  }
  return out;
}

/** Crude comment stripper: keeps newlines so line numbers survive the strip. A
 *  `//` inside a string can slip through (false negative), never a false hit. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/\/\/[^\n]*/g, "");
}

/** Language-name hits in comment-stripped text, as (name, line). */
function scanText(text: string, names: string[]): { name: string; line: number }[] {
  const stripped = stripComments(text);
  const hits: { name: string; line: number }[] = [];
  for (const name of names) {
    const re = new RegExp("\\b" + name + "\\b", "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null)
      hits.push({ name, line: stripped.slice(0, m.index).split("\n").length });
  }
  return hits;
}

// The gate must not be able to fool itself: a known name in a probe string has
// to be caught, or a broken regex would silently stay green forever.
assert(scanText('const x = "Spanish";', PACK_NAMES).length === 1, "the gate must catch a known name in a probe string");

const files = walk("src");
assert(files.length > 0, "the gate walked no files — a silent green is a lie");
// The walker and isExcluded have to agree about what a path looks like. When
// they stopped agreeing, nothing was excluded and the gate failed on files it
// was written to permit — so prove at least one exclusion still fires.
assert(files.some(isExcluded), "no file was excluded — walk and isExcluded disagree about path separators");
const offenders: string[] = [];
for (const f of files) {
  if (isExcluded(f)) continue;
  for (const hit of scanText(readFileSync(f, "utf8"), PACK_NAMES))
    offenders.push(`${f}:${hit.line} — language-name literal "${hit.name}"`);
}
if (offenders.length > 0)
  assert.fail("language-name literals outside their three homes (#14):\n" + offenders.join("\n"));

console.log("lang.check ✓");

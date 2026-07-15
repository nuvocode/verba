import { level, type Settings } from "./settings.ts";
import type { LanguagePack } from "./packs/schema";
import { memoryBrief, memoryStance, packGuidance, type Memory } from "./prompts.ts";
import { questionInstructions, questionsShape, parseQuestions, type Question } from "./questions.ts";

// Reading immersion: story mode + flow reading share one shape — a title plus
// sentence-aligned target/native pairs, which the reader renders dual-page and
// highlights in sync. "Guided reading" is that render; "flow" is calling
// continueReadingPrompt() to append more; "story mode" seeds it with adaptive
// options.

export interface Sentence {
  target: string; // sentence in the language being learned
  native: string; // its translation in the learner's language
  note?: string; // optional coach note — shown in the reader's margin
}

export interface ReadingText {
  title: string;
  sentences: Sentence[];
}

/**
 * Strip punctuation off a tapped word so "mercado," and "mercado" look up the
 * same. \p{P} is every punctuation mark Unicode knows about — the hand-written
 * Latin set this replaced had no idea 。、！？「」، or । existed.
 */
export function bareWord(w: string): string {
  return w.toLowerCase().replace(/\p{P}/gu, "");
}

/**
 * What the reader can ask for before a passage is written. Length is a choice of
 * three, not a number: the point is "a longer read", and the sentence count is an
 * implementation detail the reader has no reason to hold an opinion about.
 */
export type PassageLength = "short" | "medium" | "long";

/**
 * Sentence counts behind the three lengths. `long` is where a 3B model starts to
 * lose the thread, so the prompt asks for structure at that size rather than only
 * a bigger number — see storyPrompt().
 */
export const LENGTHS: Record<PassageLength, number> = { short: 5, medium: 10, long: 20 };

export const DEFAULT_LENGTH: PassageLength = "medium";

export interface StoryOptions {
  interests?: string; // free text, e.g. "space travel, cooking"
  topic?: string; // what the reader asked this passage to be about — outranks interests
  goal?: string; // e.g. "practise past tense"
  sentences?: number; // rough target length (default 8)
  memories?: Memory[]; // what the coach knows about the learner — the story can be set in their own world
}

const jsonShape =
  `Answer with ONLY a JSON object in this exact shape: ` +
  `{ "title": "a short title in TARGET", "sentences": [ { "target": "one sentence in TARGET", "native": "its translation in NATIVE", "note": "optional one-line coach note in NATIVE about a grammar point or word choice in this sentence, or null" } ] }. ` +
  `Split the text into individual sentences — one object per sentence — so the two languages line up. ` +
  `Add a "note" to only 2-3 of the sentences — the ones that teach something worth pausing on. Use null elsewhere.`;

function base(s: Settings, pack?: LanguagePack): string {
  return [
    `You generate graded reading material for a ${s.targetLang} learner whose native language is ${s.nativeLang}.`,
    `Target CEFR level: ${level(s)}. Keep vocabulary and grammar appropriate for that level.`,
    packGuidance(pack),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Story mode: a fresh, self-contained adaptive story. */
export function storyPrompt(s: Settings, opts: StoryOptions = {}, pack?: LanguagePack): string {
  const n = opts.sentences ?? 8;
  const memories = opts.memories ?? [];
  const topic = opts.topic?.trim();
  return [
    base(s, pack),
    // What the coach knows comes *before* the subject, so the subject gets the last
    // word. A local model leans on whatever it read most recently, and a passage the
    // reader asked for by name should not be steered by a fact from the file on them.
    memories.length ? memoryLine(memories, !!topic) : "",
    // The reader asking for something outranks both the day's theme and that file:
    // they said what they want the passage to be about.
    topic
      ? `The learner asked for a passage about: ${topic}. That is the subject. The setting, the characters and the details all come out of it, and nothing else they happen to like needs to appear in the story.`
      : opts.interests
        ? `Tailor the topic to the learner's interests: ${opts.interests}.`
        : `Pick an engaging everyday topic.`,
    opts.goal ? `Where natural, give practice with: ${opts.goal}.` : "",
    lengthLine(n),
    jsonShape.replace(/TARGET/g, s.targetLang).replace(/NATIVE/g, s.nativeLang),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * What the passage is about is decided below this block — by the topic the reader
 * named, or failing that by their interests and the day's plan. The facts are only
 * ever furniture, and never every passage's furniture: a story about a rainy weekend
 * in Edinburgh has no business reaching for their comic books, and neither does the
 * next one about the market.
 */
function memoryLine(memories: Memory[], asked: boolean): string {
  return [
    memoryBrief(memories),
    memoryStance,
    asked
      ? `What they asked for is the subject of this passage; where a fact above does not fit it, leave it out entirely. A story that never touches any of it is a good story.`
      : `The subject below is the subject. A fact above may furnish a detail where it genuinely fits — their city, their work, the people they have mentioned — but a story that never touches any of it is a good story.`,
  ].join("\n");
}

/**
 * Asking a small local model for 20 sentences instead of 5 is not the same request
 * with a bigger number in it: left alone it pads, repeats the same beat, or drifts
 * off the thread. Past ~12 sentences the prompt has to ask for the shape of a story,
 * not just its size.
 */
function lengthLine(n: number): string {
  if (n <= LENGTHS.short) return `Write a coherent, complete short story of about ${n} sentences.`;
  if (n < LENGTHS.long) return `Write a coherent, complete short story of about ${n} sentences with a beginning, a middle and an ending.`;
  return (
    `Write a coherent, complete story of about ${n} sentences. Give it a clear arc — a situation, a complication, a resolution — ` +
    `and keep one thread and the same characters running through all of it. ` +
    `Do not pad it out: no repeated beats, no restating what a sentence already said, no unrelated sentences to reach the count.`
  );
}

/** Flow reading: continue an existing text with more level-appropriate sentences. */
export function continueReadingPrompt(s: Settings, text: ReadingText, pack?: LanguagePack): string {
  const soFar = text.sentences.map((x) => x.target).join(" ");
  return [
    base(s, pack),
    `Continue this text naturally with about 6 more sentences. Do not repeat what came before.`,
    `Text so far: ${soFar}`,
    `Keep the same title: "${text.title}".`,
    jsonShape.replace(/TARGET/g, s.targetLang).replace(/NATIVE/g, s.nativeLang),
  ].join("\n\n");
}

/** On-demand explanation of a single word the learner tapped while reading. */
export function explainWordPrompt(s: Settings, word: string, sentence: string): string {
  return [
    `The learner is reading ${s.targetLang} and tapped the word "${word}".`,
    `In this sentence: "${sentence}".`,
    `Answer with ONLY a JSON object: { "word": "${word}", "meaning": "its meaning in ${s.nativeLang}", "lemma": "dictionary form in ${s.targetLang}", "note": "one short usage note in ${s.nativeLang}" }.`,
  ].join("\n");
}

export interface WordExplanation {
  word: string;
  meaning: string;
  lemma: string;
  note: string;
}

/**
 * The comprehension check for a finished passage. Reading owns no question logic of
 * its own — it hands the passage text to the shared question layer (lib/questions)
 * and gets back the same multiple-choice / cloze model listening uses.
 */
export function comprehensionPrompt(s: Settings, text: ReadingText, pack?: LanguagePack): string {
  const passage = text.sentences.map((x) => x.target).join(" ");
  return [
    base(s, pack),
    `The learner has just finished reading this passage:`,
    passage,
    questionInstructions(s.targetLang, s.nativeLang, 3),
    `Answer with ONLY a JSON object: { ${questionsShape(s.targetLang, s.nativeLang)} }.`,
  ].join("\n\n");
}

export function parseComprehension(raw: string): Question[] {
  return parseQuestions((extractJson(raw) ?? {}).questions);
}

export function parseReading(raw: string): ReadingText {
  const obj = extractJson(raw) ?? {};
  const sentences = Array.isArray(obj.sentences)
    ? obj.sentences
        .filter((x: any) => x && (x.target || x.native))
        .map((x: any) => ({
          target: String(x.target ?? ""),
          native: String(x.native ?? ""),
          note: x.note ? String(x.note) : undefined,
        }))
    : [];
  return { title: typeof obj.title === "string" ? obj.title : "", sentences };
}

export function parseWordExplanation(raw: string): WordExplanation {
  const o = extractJson(raw) ?? {};
  return {
    word: String(o.word ?? ""),
    meaning: String(o.meaning ?? raw.trim()),
    lemma: String(o.lemma ?? ""),
    note: String(o.note ?? ""),
  };
}

// same defensive extractor as prompts.ts — kept local so this module stays pure
// (no import cycle through prompts' Settings-heavy exports).
function extractJson(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

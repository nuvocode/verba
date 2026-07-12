import type { Settings } from "./settings";
import type { LanguagePack } from "./packs/schema";
import { packGuidance } from "./prompts.ts";

// Reading immersion: story mode + flow reading share one shape — a title plus
// sentence-aligned target/native pairs, which the reader renders dual-page and
// highlights in sync. "Guided reading" is that render; "flow" is calling
// continueReadingPrompt() to append more; "story mode" seeds it with adaptive
// options.

export interface Sentence {
  target: string; // sentence in the language being learned
  native: string; // its translation in the learner's language
}

export interface ReadingText {
  title: string;
  sentences: Sentence[];
}

export interface StoryOptions {
  interests?: string; // free text, e.g. "space travel, cooking"
  goal?: string; // e.g. "practise past tense"
  sentences?: number; // rough target length (default 8)
}

const jsonShape =
  `Answer with ONLY a JSON object in this exact shape: ` +
  `{ "title": "a short title in TARGET", "sentences": [ { "target": "one sentence in TARGET", "native": "its translation in NATIVE" } ] }. ` +
  `Split the text into individual sentences — one object per sentence — so the two languages line up.`;

function base(s: Settings, pack?: LanguagePack): string {
  return [
    `You generate graded reading material for a ${s.targetLang} learner whose native language is ${s.nativeLang}.`,
    `Target CEFR level: ${s.cefr}. Keep vocabulary and grammar appropriate for that level.`,
    packGuidance(pack),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Story mode: a fresh, self-contained adaptive story. */
export function storyPrompt(s: Settings, opts: StoryOptions = {}, pack?: LanguagePack): string {
  const n = opts.sentences ?? 8;
  return [
    base(s, pack),
    opts.interests ? `Tailor the topic to the learner's interests: ${opts.interests}.` : `Pick an engaging everyday topic.`,
    opts.goal ? `Where natural, give practice with: ${opts.goal}.` : "",
    `Write a coherent, complete short story of about ${n} sentences.`,
    jsonShape.replace(/TARGET/g, s.targetLang).replace(/NATIVE/g, s.nativeLang),
  ]
    .filter(Boolean)
    .join("\n\n");
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

export function parseReading(raw: string): ReadingText {
  const obj = extractJson(raw) ?? {};
  const sentences = Array.isArray(obj.sentences)
    ? obj.sentences
        .filter((x: any) => x && (x.target || x.native))
        .map((x: any) => ({ target: String(x.target ?? ""), native: String(x.native ?? "") }))
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

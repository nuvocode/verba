import { level, type Settings } from "./settings.ts";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";
import { questionInstructions, questionsShape, parseQuestions, type Question } from "./questions.ts";

// Listening: a chaptered piece the learner hears — not reads — with a
// comprehension check at the end of each chapter. Generated in two passes because
// a small local model cannot hold a multi-chapter arc *and* its questions in one
// call: first an outline (the arc, the recurring people, one beat per chapter),
// then each chapter on its own against that outline — text plus questions from the
// shared question layer (lib/questions). The transcript rides along with each
// chapter but is only shown after the learner has answered.

export interface Beat {
  title: string; // the chapter's title, in TARGET
  beat: string; // one line of what happens, in NATIVE — the writer's brief for that chapter
}

export interface Outline {
  title: string; // the piece's title, in TARGET
  premise: string; // the arc and who is in it, in NATIVE
  beats: Beat[];
}

export interface Line {
  target: string; // the sentence, heard first and shown only after answering
  native: string; // its translation — the transcript the learner unlocks
}

export interface Chapter {
  title: string;
  lines: Line[];
  questions: Question[];
}

export interface ListeningPiece {
  title: string;
  premise: string;
  chapters: Chapter[];
}

/** Chapters in a piece. Small on purpose — an arc a learner can hold, and N+1 model calls. */
export const CHAPTERS = 3;
/** Questions per chapter (the scope's "2-3"). */
export const QUESTIONS_PER_CHAPTER = 3;

export interface ListeningOptions {
  interests?: string; // free text / the day's theme
  goal?: string; // the day's weak area, folded in where natural
}

function base(s: Settings, pack?: LanguagePack): string {
  return [
    `You write graded listening material for a ${s.targetLang} learner whose native language is ${s.nativeLang}.`,
    `Target CEFR level: ${level(s)}. Keep vocabulary and grammar appropriate for that level.`,
    packGuidance(pack),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Pass 1: the arc. Short and cheap — just enough to keep the chapters on one thread. */
export function outlinePrompt(s: Settings, opts: ListeningOptions = {}, pack?: LanguagePack): string {
  return [
    base(s, pack),
    opts.interests ? `Tailor it to the learner's interests: ${opts.interests}.` : `Pick an engaging everyday situation.`,
    `Plan a short ${CHAPTERS}-chapter story with a real arc — a situation, a complication, a resolution — and recurring people, so that paying attention across chapters is rewarded.`,
    `Answer with ONLY a JSON object: { "title": "a short title in ${s.targetLang}", "premise": "1-2 sentences in ${s.nativeLang} on the arc and who is in it", "beats": [ { "title": "chapter title in ${s.targetLang}", "beat": "one line in ${s.nativeLang} on what happens" } ] }. Give exactly ${CHAPTERS} beats.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Pass 2, once per chapter: the chapter's text and its comprehension questions. */
export function chapterPrompt(
  s: Settings,
  outline: Outline,
  index: number,
  opts: ListeningOptions = {},
  pack?: LanguagePack,
): string {
  const beat = outline.beats[index];
  // The whole arc rides in every chapter call so the writer keeps the thread and the
  // same people without being fed the prior chapters' full text (which a 3B model has
  // no room for anyway) — the outline is the memory.
  const arc = outline.beats.map((b, i) => `${i + 1}. ${b.title} — ${b.beat}`).join("\n");
  return [
    base(s, pack),
    `You are writing chapter ${index + 1} of ${outline.beats.length} of "${outline.title}".`,
    `Premise: ${outline.premise}`,
    `The whole arc, so this chapter keeps the thread and the same people:\n${arc}`,
    `Write chapter ${index + 1} — "${beat?.title}": ${beat?.beat}. About 5-8 sentences. It is heard, not read, so keep the sentences speakable and clear, and carry the people and what they are doing over from the earlier chapters.`,
    opts.goal ? `Where natural, give practice with: ${opts.goal}.` : "",
    questionInstructions(s.targetLang, s.nativeLang, QUESTIONS_PER_CHAPTER),
    `Answer with ONLY a JSON object: { "sentences": [ { "target": "one sentence in ${s.targetLang}", "native": "its translation in ${s.nativeLang}" } ], ${questionsShape(s.targetLang, s.nativeLang)} }. One object per sentence, so the transcript lines up.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseOutline(raw: string): Outline {
  const o = extractJson(raw) ?? {};
  const beats: Beat[] = Array.isArray(o.beats)
    ? o.beats
        .map((b: any) => ({ title: String(b?.title ?? "").trim(), beat: String(b?.beat ?? "").trim() }))
        .filter((b: Beat) => b.title || b.beat)
    : [];
  return { title: typeof o.title === "string" ? o.title : "", premise: String(o.premise ?? ""), beats };
}

export function parseChapter(raw: string, title: string): Chapter {
  const o = extractJson(raw) ?? {};
  const lines: Line[] = Array.isArray(o.sentences)
    ? o.sentences
        .filter((x: any) => x && (x.target || x.native))
        .map((x: any) => ({ target: String(x.target ?? ""), native: String(x.native ?? "") }))
    : [];
  return { title, lines, questions: parseQuestions(o.questions) };
}

// same defensive extractor as reading.ts / learn.ts — kept local so this module
// stays pure and has no import cycle back through the heavier modules.
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

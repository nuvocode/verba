import type { Settings } from "./settings.ts";
import { levelOf } from "./model.ts";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";

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

/** What a multiple-choice option tests — the three failure modes §2.4 names, plus the right answer. */
export type ListenWhy = "correct" | "wrongSubject" | "wrongTense" | "irrelevantDetail";

export interface ListenOption {
  text: string;
  why: ListenWhy;
}

/**
 * A comprehension question bound to the audio it came from. `lineIdx` is resolved
 * from the model's `line` at parse time — the model keeps returning the sentence
 * text, never a timestamp it cannot know. `audioRange` itself is `spans[lineIdx]`,
 * computed at playback time and never stored: durations belong to the synthesis.
 *
 * Structurally a `Question` (same kind/prompt/answer/line) but with `options` as
 * `ListenOption[]` — the shared layer's `string[]` cannot hold the `why` labels.
 */
export interface ListenQuestion {
  kind: "mcq" | "cloze";
  prompt: string; // mcq: the question (in NATIVE). cloze: the line with ___ (in TARGET).
  options?: ListenOption[]; // mcq only — exactly four, one per `why` kind
  answer: string; // mcq: the exact correct option. cloze: the removed word.
  line: string; // the source sentence the answer sits in (TARGET) — shown on a miss
  /** Index of the line the answer sits in — resolved from `line` at parse time. */
  lineIdx: number;
}

export interface Chapter {
  title: string;
  lines: Line[];
  questions: ListenQuestion[];
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
    `You write graded listening material for a ${s.profile.targetLanguage} learner whose native language is ${s.profile.nativeLanguage}.`,
    `Target CEFR level: ${levelOf(s.profile)}. Keep vocabulary and grammar appropriate for that level.`,
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
    `Answer with ONLY a JSON object: { "title": "a short title in ${s.profile.targetLanguage}", "premise": "1-2 sentences in ${s.profile.nativeLanguage} on the arc and who is in it", "beats": [ { "title": "chapter title in ${s.profile.targetLanguage}", "beat": "one line in ${s.profile.nativeLanguage} on what happens" } ] }. Give exactly ${CHAPTERS} beats.`,
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
    listeningQuestionInstructions(s.profile.targetLanguage, s.profile.nativeLanguage, QUESTIONS_PER_CHAPTER),
    `Answer with ONLY a JSON object: { "sentences": [ { "target": "one sentence in ${s.profile.targetLanguage}", "native": "its translation in ${s.profile.nativeLanguage}" } ], ${listeningQuestionsShape(s.profile.targetLanguage, s.profile.nativeLanguage)} }. One object per sentence, so the transcript lines up.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The question instructions for a listening chapter. Same quality bar as the shared
 * layer, plus the three failure modes §2.4 names: every multiple choice carries
 * exactly four options — the right answer and one wrong option per
 * misunderstanding — so a miss can be explained specifically ("that happened, but
 * to her sister, not to her"). `why` is never shown as a label; it is what makes
 * the explanation on a miss specific.
 */
export function listeningQuestionInstructions(targetLang: string, nativeLang: string, n = 3): string {
  return [
    `After the passage, write ${n} comprehension questions a listener could only answer if they understood what happened.`,
    `Each question must hang on a load-bearing detail — who did or agreed to what, why something changed, a name or number that decides the outcome. Never on trivia, phrasing, or a detail that does not matter. If a question could be answered without having followed the passage, it is wasted — replace it.`,
    `Mix the types. At least one "multiple_choice": the question and every option in ${nativeLang}. At least one "fill_blank": take one real sentence from the passage and remove a single meaningful word (never "the", "a", or filler) — the listener types it back.`,
    `For every multiple_choice, give EXACTLY four options, each labelled by what it tests: one with "why": "correct", and three wrong ones — one "wrongSubject" (a true detail about the wrong person or thing), one "wrongTense" (the right thing at the wrong time), one "irrelevantDetail" (a true detail that does not answer the question). Use each of the four "why" kinds exactly once.`,
    `For every question include "line": the exact sentence from the passage in ${targetLang} the answer sits in, so a listener who missed it can be shown where it was.`,
  ].join("\n");
}

/** The JSON shape for a listening chapter's questions — the shared shape plus the `why` labels. */
export function listeningQuestionsShape(targetLang: string, nativeLang: string): string {
  return (
    `"questions": [ ` +
    `{ "type": "multiple_choice", "prompt": "the question in ${nativeLang}", "options": [ { "text": "option in ${nativeLang}", "why": "correct" }, { "text": "option in ${nativeLang}", "why": "wrongSubject" }, { "text": "option in ${nativeLang}", "why": "wrongTense" }, { "text": "option in ${nativeLang}", "why": "irrelevantDetail" } ], "answer": "the exact text of the correct option", "line": "the source sentence in ${targetLang}" }, ` +
    `{ "type": "fill_blank", "prompt": "the source sentence in ${targetLang} with the removed word written as ___", "answer": "the removed word in ${targetLang}", "line": "the same source sentence, complete, in ${targetLang}" } ` +
    `]`
  );
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

/** Trim + lowercase + drop punctuation — the same normalisation questions.ts uses for answers. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\p{P}/gu, "").replace(/\s+/g, " ").trim();
}

const WHY: Record<string, ListenWhy> = {
  correct: "correct",
  wrongsubject: "wrongSubject",
  wrongtense: "wrongTense",
  irrelevantdetail: "irrelevantDetail",
};

// The model labels kinds the human way ("multiple_choice"); the app names them the
// short way. Same map as questions.ts, kept local so this module stays pure and
// questions.ts's scoring is untouched.
const KIND: Record<string, "mcq" | "cloze"> = {
  multiple_choice: "mcq",
  multiple: "mcq",
  mcq: "mcq",
  fill_blank: "cloze",
  fill: "cloze",
  cloze: "cloze",
};

/**
 * Resolve a question's `line` to the index of the chapter line it sits in, by
 * matching against the chapter's lines (normalised, as questions.ts normalises
 * answers). A question whose line cannot be matched is dropped — a question that
 * cannot be replayed is half a question, and §2.4 is explicit that every question
 * is bound to a range.
 */
function resolveLineIdx(line: string, lines: Line[]): number {
  const want = norm(line);
  if (!want) return -1;
  return lines.findIndex((l) => norm(l.target) === want);
}

/**
 * Parse a chapter's questions into the listening model. Beyond the shared layer's
 * rules, a listening question must bind to a line (or it is dropped) and a
 * multiple choice must carry exactly the four `why` kinds once each (or it is
 * dropped) — a question that cannot be replayed or explained is not worth asking.
 */
function parseListenQuestions(raw: unknown, lines: Line[]): ListenQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ListenQuestion[] = [];
  for (const q of raw) {
    if (!q) continue;
    const kind = KIND[String(q.type ?? q.kind ?? "").toLowerCase()];
    const prompt = String(q.prompt ?? "").trim();
    const answer = String(q.answer ?? "").trim();
    if (!kind || !prompt || !answer) continue;
    const line = String(q.line ?? "").trim();
    const lineIdx = resolveLineIdx(line, lines);
    if (lineIdx < 0) continue; // a question that cannot be replayed is dropped
    if (kind === "mcq") {
      const options = parseOptions(q.options);
      if (!options) continue; // must carry exactly the four why kinds once each
      const correct = options.find((o) => o.why === "correct");
      if (!correct || norm(correct.text) !== norm(answer)) continue; // unanswerable
      out.push({ kind, prompt, options, answer, line, lineIdx });
    } else {
      out.push({ kind, prompt, answer, line, lineIdx });
    }
  }
  return out;
}

/** Exactly four options, one per `why` kind, each present once. `null` when not. */
function parseOptions(raw: unknown): ListenOption[] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const options: ListenOption[] = [];
  const seen = new Set<ListenWhy>();
  for (const o of raw) {
    if (!o) return null;
    const text = String(o.text ?? "").trim();
    const why = WHY[String(o.why ?? "").toLowerCase()];
    if (!text || !why || seen.has(why)) return null;
    seen.add(why);
    options.push({ text, why });
  }
  return seen.size === 4 ? options : null;
}

/**
 * A deterministic per-question shuffle of a multiple choice's options, so the
 * correct one is not always first. Deterministic means the same question always
 * renders the same order — a stable hash of the prompt seeds the rotation, so a
 * re-render does not reshuffle under the learner's cursor.
 */
export function shuffledOptions(q: ListenQuestion): ListenOption[] {
  const opts = q.options ?? [];
  if (opts.length < 2) return opts;
  // A tiny string hash of the prompt — stable across renders, varied per question.
  let h = 0;
  for (let i = 0; i < q.prompt.length; i++) h = (h * 31 + q.prompt.charCodeAt(i)) >>> 0;
  const rot = h % opts.length;
  return opts.map((_, i) => opts[(i + rot) % opts.length]);
}

export function parseChapter(raw: string, title: string): Chapter {
  const o = extractJson(raw) ?? {};
  const lines: Line[] = Array.isArray(o.sentences)
    ? o.sentences
        .filter((x: any) => x && (x.target || x.native))
        .map((x: any) => ({ target: String(x.target ?? ""), native: String(x.native ?? "") }))
    : [];
  return { title, lines, questions: parseListenQuestions(o.questions, lines) };
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

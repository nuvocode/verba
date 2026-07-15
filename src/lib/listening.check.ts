// Runnable self-check for listening generation — the two-pass prompt shape and the
// parses that turn a model's JSON into a playable, checkable chapter.
// Run: node --experimental-strip-types src/lib/listening.check.ts
import assert from "node:assert";
import { defaultSettings, type Settings } from "./settings.ts";
import {
  outlinePrompt,
  chapterPrompt,
  parseOutline,
  parseChapter,
  CHAPTERS,
  QUESTIONS_PER_CHAPTER,
} from "./listening.ts";

const s: Settings = { ...defaultSettings, targetLang: "Spanish", nativeLang: "English", cefr: "B1" };

// --- pass 1: the outline asks for an arc and recurring people, not one flat block ---
const outline = outlinePrompt(s, { interests: "cooking" });
assert(outline.includes(`${CHAPTERS}-chapter`), "the outline asks for the fixed chapter count");
assert(/arc/.test(outline) && /recurring people/.test(outline), "…with an arc and people worth following across chapters");
assert(outline.includes("Tailor it to the learner's interests: cooking"), "interests reach the outline");

// --- pass 2: a chapter is written against the whole arc, so it keeps the thread ---
const beats = [
  { title: "El mercado", beat: "Ana meets Luis at the market" },
  { title: "El plan", beat: "they agree to cook together" },
  { title: "La cena", beat: "the dinner goes wrong, then right" },
];
const ch2 = chapterPrompt(s, { title: "Un día", premise: "Ana and Luis cook", beats }, 1, { goal: "past tense" });
assert(ch2.includes("chapter 2 of 3"), "the chapter knows where it sits in the arc");
assert(ch2.includes("El mercado") && ch2.includes("La cena"), "the whole arc rides along so the thread holds");
assert(ch2.includes("give practice with: past tense"), "the day's weak area folds in");
assert(/load-bearing/.test(ch2), "the shared question quality bar is carried into the chapter prompt");
assert(ch2.includes(`${QUESTIONS_PER_CHAPTER} comprehension questions`), "the per-chapter question count reaches the prompt");

// --- parseOutline: tolerant of noise, keeps only real beats ---
const o = parseOutline('prose... {"title":"Un día","premise":"Ana y Luis","beats":[{"title":"A","beat":"x"},{"beat":""}]}');
assert(o.title === "Un día" && o.beats.length === 1, "outline parse drops the empty beat, keeps the real one");
assert(parseOutline("garbage").beats.length === 0, "unparseable outline yields no beats, never throws");

// --- parseChapter: transcript lines up, questions come through the shared layer ---
const raw = JSON.stringify({
  sentences: [
    { target: "Luis pagó la cuenta.", native: "Luis paid the bill." },
    { target: "Ana sonrió.", native: "Ana smiled." },
  ],
  questions: [
    { type: "multiple_choice", prompt: "Who paid?", options: ["Ana", "Luis"], answer: "Luis", line: "Luis pagó la cuenta." },
    { type: "fill_blank", prompt: "Luis pagó la ___.", answer: "cuenta", line: "Luis pagó la cuenta." },
  ],
});
const chapter = parseChapter(raw, "El mercado");
assert(chapter.title === "El mercado", "the beat's title is carried onto the chapter");
assert(chapter.lines.length === 2 && chapter.lines[0].native === "Luis paid the bill.", "the transcript lines up target/native");
assert(chapter.questions.length === 2, "the questions parse through the shared layer");
assert(parseChapter("nonsense", "T").lines.length === 0, "an unparseable chapter is empty, never throws");

console.log("listening.check.ts — all assertions passed");

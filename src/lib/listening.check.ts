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
  shuffledOptions,
  CHAPTERS,
  QUESTIONS_PER_CHAPTER,
} from "./listening.ts";

const s: Settings = { ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "Spanish", nativeLanguage: "English", level: "B1" } };

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
// PLAN-026: the chapter prompt asks for the four `why` kinds, each exactly once.
assert(ch2.includes('"why": "correct"') && ch2.includes('"why": "wrongSubject"'), "the prompt names the correct and wrongSubject kinds");
assert(ch2.includes('"why": "wrongTense"') && ch2.includes('"why": "irrelevantDetail"'), "…and the wrongTense and irrelevantDetail kinds");

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
    {
      type: "multiple_choice",
      prompt: "Who paid?",
      options: [
        { text: "Luis", why: "correct" },
        { text: "Ana", why: "wrongSubject" },
        { text: "Luis pagará", why: "wrongTense" },
        { text: "La cuenta era cara", why: "irrelevantDetail" },
      ],
      answer: "Luis",
      line: "Luis pagó la cuenta.",
    },
    { type: "fill_blank", prompt: "Luis pagó la ___.", answer: "cuenta", line: "Luis pagó la cuenta." },
  ],
});
const chapter = parseChapter(raw, "El mercado");
assert(chapter.title === "El mercado", "the beat's title is carried onto the chapter");
assert(chapter.lines.length === 2 && chapter.lines[0].native === "Luis paid the bill.", "the transcript lines up target/native");
assert(chapter.questions.length === 2, "the questions parse through the shared layer");
assert(parseChapter("nonsense", "T").lines.length === 0, "an unparseable chapter is empty, never throws");

// PLAN-026: lineIdx resolves against the chapter's lines, tolerating punctuation
// and casing differences.
assert.equal(chapter.questions[0].lineIdx, 0, "the mcq's line resolves to line 0");
assert.equal(chapter.questions[1].lineIdx, 0, "the cloze's line resolves to line 0");
const caseRaw = JSON.stringify({
  sentences: [{ target: "Ana sonrió.", native: "Ana smiled." }],
  questions: [{ type: "fill_blank", prompt: "Ana ___.", answer: "sonrió", line: "ana sonrió" }],
});
const caseChapter = parseChapter(caseRaw, "T");
assert.equal(caseChapter.questions.length, 1, "a line with differing casing still resolves");
assert.equal(caseChapter.questions[0].lineIdx, 0, "…to the right line");

// PLAN-026: a question whose line matches nothing is dropped — it cannot be replayed.
const unmatched = parseChapter(
  JSON.stringify({
    sentences: [{ target: "Ana sonrió.", native: "Ana smiled." }],
    questions: [{ type: "fill_blank", prompt: "Ana ___.", answer: "sonrió", line: "Luis pagó la cuenta." }],
  }),
  "T",
);
assert.equal(unmatched.questions.length, 0, "a question whose line matches nothing is dropped");

// PLAN-026: a multiple choice missing one of the four why kinds is dropped; one
// with all four is kept.
const missingWhy = parseChapter(
  JSON.stringify({
    sentences: [{ target: "Ana sonrió.", native: "Ana smiled." }],
    questions: [
      {
        type: "multiple_choice",
        prompt: "Who smiled?",
        options: [
          { text: "Ana", why: "correct" },
          { text: "Luis", why: "wrongSubject" },
          { text: "Ana sonreirá", why: "wrongTense" },
          // no irrelevantDetail — dropped
        ],
        answer: "Ana",
        line: "Ana sonrió.",
      },
    ],
  }),
  "T",
);
assert.equal(missingWhy.questions.length, 0, "a question missing one of the four why kinds is dropped");
const dupWhy = parseChapter(
  JSON.stringify({
    sentences: [{ target: "Ana sonrió.", native: "Ana smiled." }],
    questions: [
      {
        type: "multiple_choice",
        prompt: "Who smiled?",
        options: [
          { text: "Ana", why: "correct" },
          { text: "Luis", why: "wrongSubject" },
          { text: "Marta", why: "wrongSubject" }, // duplicate kind
          { text: "Ana sonreirá", why: "wrongTense" },
        ],
        answer: "Ana",
        line: "Ana sonrió.",
      },
    ],
  }),
  "T",
);
assert.equal(dupWhy.questions.length, 0, "a question with a duplicated why kind is dropped");

// PLAN-026: the shuffle is deterministic for the same question and does not always
// place the answer at index 0 across a set of ten.
{
  const q = chapter.questions[0];
  const a = shuffledOptions(q);
  const b = shuffledOptions(q);
  assert.deepEqual(a.map((o) => o.text), b.map((o) => o.text), "the shuffle is deterministic for the same question");
  const correctIdx = a.findIndex((o) => o.why === "correct");
  assert(correctIdx >= 0, "the correct option is present after the shuffle");
  // Ten distinct prompts → the correct option is not always first.
  const firsts = new Set<number>();
  for (let i = 0; i < 10; i++) {
    const qq = { ...q, prompt: `question ${i}` };
    firsts.add(shuffledOptions(qq).findIndex((o) => o.why === "correct"));
  }
  assert(firsts.size > 1, "the correct option is not always at index 0 across a set of ten");
}

console.log("listening.check.ts — all assertions passed");

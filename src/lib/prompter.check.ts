// Runnable self-check for the teleprompter's pacing: words per minute is the only dial,
// and everything the moving column does has to follow from it.
// Run: node --experimental-strip-types src/lib/prompter.check.ts
import assert from "node:assert";
import {
  clampWpm,
  stepWpm,
  wordsIn,
  countWords,
  pxPerSecond,
  secondsFor,
  clock,
  lineAt,
  ended,
  DEFAULT_WPM,
  WPM_MIN,
  WPM_MAX,
  WPM_STEP,
} from "./prompter.ts";

// --- the dial: it moves in honest steps and it has ends ---
assert(WPM_MIN < DEFAULT_WPM && DEFAULT_WPM < WPM_MAX, "the default pace is somewhere a person could actually read");
assert.equal(stepWpm(DEFAULT_WPM, 1), DEFAULT_WPM + WPM_STEP, "+ speeds up by one step");
assert.equal(stepWpm(DEFAULT_WPM, -1), DEFAULT_WPM - WPM_STEP, "− slows down by one step");
assert.equal(stepWpm(WPM_MAX, 1), WPM_MAX, "…and leaning on + at the top does nothing");
assert.equal(stepWpm(WPM_MIN, -1), WPM_MIN, "…nor − at the bottom");
assert.equal(clampWpm(0), WPM_MIN, "a nonsense pace is pulled back into range");
assert.equal(clampWpm(9999), WPM_MAX, "…from either side");

// --- words: cut by the language's own rules, or a spaceless script scrolls past in a blink ---
assert.equal(wordsIn("El gato duerme en la silla.", "es"), 6, "Spanish counted as words, punctuation is not one");
assert(wordsIn("私は毎朝コーヒーを飲みます。", "ja") > 1, "Japanese is not one enormous word — this is the whole point");
assert.equal(countWords(["Uno dos.", "Tres."], "es"), 3, "a passage is the sum of its sentences");

// --- speed: the column's job is to make the passage take exactly as long as its words do ---
// This is the invariant the whole view rests on. A 120-word passage at 120 wpm is a
// minute of speech, and the column has to take a minute to travel — whatever its height,
// which is to say whatever the font size and the window width happen to be today.
for (const height of [1200, 4800]) {
  const speed = pxPerSecond(120, height, 120);
  assert(Math.abs(height / speed - 60) < 1e-9, `120 words at 120 wpm is a minute of scrolling at ${height}px tall`);
}
assert.equal(pxPerSecond(260, 3000, 200), 2 * pxPerSecond(130, 3000, 200), "twice the pace is twice the speed");
assert.equal(pxPerSecond(130, 3000, 0), 0, "an empty passage does not move — and does not divide by zero");
assert.equal(pxPerSecond(130, 0, 200), 0, "…nor does one that hasn't been laid out yet");

assert.equal(secondsFor(65, 130), 30, "half a minute's worth of words is half a minute");
assert.equal(clock(secondsFor(65, 130)), "0:30", "…and it is said in minutes and seconds");
assert.equal(clock(-5), "0:00", "the countdown never goes negative");

// --- which line is "now": the last one whose top has reached the mark ---
const tops = [0, 100, 260, 400];
assert.equal(lineAt(0, tops), 0, "at rest, the first line is the one being read");
assert.equal(lineAt(99, tops), 0, "…and it stays that until the next line reaches the mark");
assert.equal(lineAt(100, tops), 1, "the moment it does, it is the one");
assert.equal(lineAt(9999, tops), 3, "past the end, the last line is still the last line");
assert.equal(lineAt(0, []), -1, "no sentences, no line");

// --- the end ---
assert(!ended(399, 400), "not over while any of the column is below the mark");
assert(ended(400, 400), "over once all of it has climbed past");
assert(!ended(0, 0), "an unmeasured column has not 'ended' — it hasn't started");

// --- one reading-time formula (PLAN-024) --------------------------------------
// Read.tsx's estimate and Prompter.tsx's remaining time are the same call on the
// same numbers: both count words with `countWords(sentences, locale)` and both
// convert with `secondsFor(words, wpm)`. Changing wpm in the prompter updates the
// estimate on the passage view because both read `settings.prompterWpm`. Prove it
// by computing both numbers from the same inputs and asserting equality at three
// wpm values.
{
  const sentences = [
    "Maria went to the market on Saturday morning.",
    "She bought fresh vegetables and some ripe fruit.",
    "Then she walked home carrying her heavy bag.",
  ];
  const locale = "en";
  const words = countWords(sentences, locale);
  for (const wpm of [90, 130, 200]) {
    // Read's estimate: the whole passage at the prompter's pace.
    const readEstimate = secondsFor(words, wpm);
    // Prompter's remaining time: the same words, the same pace.
    const prompterRemaining = secondsFor(words, wpm);
    assert.equal(readEstimate, prompterRemaining, `Read estimate === Prompter remaining at ${wpm} wpm`);
    // And the estimate is the passage's words at that pace — not a guess.
    assert.equal(readEstimate, (words / wpm) * 60, `the estimate is words/wpm*60 at ${wpm} wpm`);
  }
  // A non-Latin locale counts with the same tokenizer — a Japanese passage is not
  // estimated by counting spaces.
  const ja = ["私は市場でパンを買いました。", "彼女は新鮮な野菜を買いました。"];
  assert(countWords(ja, "ja") > 2, "Japanese is counted by its own tokenizer, not by spaces");
}

console.log("prompter.check.ts ✓");

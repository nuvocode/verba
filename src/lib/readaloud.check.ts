// Runnable self-check for the teleprompter's measurement (PLAN-024): expected
// words in, spoken words in, a report out. The matching is order-preserving and
// forgiving — one misheard word must not desynchronise the rest.
// Run: node --experimental-strip-types src/lib/readaloud.check.ts
import assert from "node:assert";
import { compare } from "./readaloud.ts";

const EXPECTED = [
  "Maria went to the market on Saturday morning.",
  "She bought fresh vegetables and some ripe fruit.",
  "Then she walked home carrying her heavy bag.",
];
const expectedWords = EXPECTED.join(" ").split(/\s+/);

// 1. A perfect read: nothing skipped, pace matches. The passage is 18 words, so
//    reading it at 130 wpm takes 18/130 of a minute.
{
  const ms = (expectedWords.length / 130) * 60_000;
  const r = compare(expectedWords, expectedWords, ms, 130, "en");
  assert.deepEqual(r.skipped, [], "a perfect read skips nothing");
  assert(Math.abs(r.paceMatch) < 0.01, `a perfect read matches the pace, got ${r.paceMatch}`);
}

// 2. Three words dropped from the middle: exactly those three in `skipped`, in order.
{
  const heard = expectedWords.filter((w) => !["fresh", "vegetables", "some"].includes(w));
  const r = compare(expectedWords, heard, 60_000, 130, "en");
  assert.deepEqual(r.skipped, ["fresh", "vegetables", "some"], "the three dropped words are named, in order");
}

// 3. One word misheard ("marcado" for "mercado"): at most one entry in `skipped` —
//    the LCS does not cascade.
{
  const heard = expectedWords.map((w) => (w === "market" ? "marcado" : w));
  const r = compare(expectedWords, heard, 60_000, 130, "en");
  assert(r.skipped.length <= 1, "a single misheard word does not cascade");
  assert.deepEqual(r.skipped, ["market"], "the misheard word is the one skipped");
}

// 4. Extra filler words in the transcript: `skipped` still empty.
{
  const heard = ["um", ...expectedWords, "uh", "well"];
  const r = compare(expectedWords, heard, 60_000, 130, "en");
  assert.deepEqual(r.skipped, [], "filler words are not errors");
}

// 5. Reading at half the target wpm gives paceMatch ≈ 0.5, and the sign is not
//    lost — a `wpm` field the caller can compare. Half of 130 is 65 wpm, so the
//    18-word passage takes 18/65 of a minute.
{
  const ms = (expectedWords.length / 65) * 60_000;
  const r = compare(expectedWords, expectedWords, ms, 130, "en");
  assert(Math.abs(r.paceMatch - 0.5) < 0.01, `half the pace is paceMatch ≈ 0.5, got ${r.paceMatch}`);
  assert(r.wpm < r.targetWpm, "the wpm field keeps the sign — slower than target");
}

// 6. A non-Latin locale counts words with the same tokenizer Read estimates with.
{
  const ja = ["私は市場でパンを買いました。", "彼女は新鮮な野菜を買いました。"];
  const jaWords = ja.join(" ").split(/\s+/);
  const r = compare(jaWords, jaWords, 60_000, 130, "ja");
  assert.deepEqual(r.skipped, [], "a Japanese read skips nothing");
}

// 7. An adverb the transcript adds is not an error — "quickly" between two
//    expected words leaves `skipped` empty.
{
  const heard = expectedWords.flatMap((w) => (w === "walked" ? ["walked", "quickly"] : [w]));
  const r = compare(expectedWords, heard, 60_000, 130, "en");
  assert.deepEqual(r.skipped, [], "an added adverb is not a skipped word");
}

console.log("readaloud.check OK");

// The teleprompter's pacing — the arithmetic behind the moving column, kept away from
// the DOM so it can be checked without one.
//
// The exercise is reading a passage out loud against a deadline you don't set, so the
// only honest dial is words per minute: the number a speaker can hold an opinion about.
// Everything else here is derived from it.

import { tokens } from "./text.ts";

/** Slower than this is not an exercise; faster is not speech. */
export const WPM_MIN = 70;
export const WPM_MAX = 320;
export const WPM_STEP = 10;
/** An unhurried reading-aloud pace — a narrator, not a newsreader. */
export const DEFAULT_WPM = 130;

export const clampWpm = (wpm: number) => Math.min(Math.max(Math.round(wpm), WPM_MIN), WPM_MAX);
/** One press of `+` / `−`. */
export const stepWpm = (wpm: number, dir: 1 | -1) => clampWpm(wpm + dir * WPM_STEP);

/**
 * How many words a sentence is, cut by the target language's own rules — the same
 * segmenter the reader taps words with. A script that writes without spaces would
 * otherwise count as one word and scroll past in a blink.
 */
export const wordsIn = (sentence: string, locale: string) => tokens(sentence, locale).filter((t) => t.word).length;

export const countWords = (sentences: string[], locale: string) =>
  sentences.reduce((n, s) => n + wordsIn(s, locale), 0);

/**
 * The speed the column has to travel at for the reader to be meeting `wpm`.
 *
 * Words are not laid out evenly — a line of long words is no taller than a line of
 * short ones — but across a whole passage the height of the column *is* its word count,
 * drawn. So one conversion for the whole column is enough, and it stays true when the
 * window is resized or the font changes, because both of those move `heightPx` too.
 */
export function pxPerSecond(wpm: number, heightPx: number, words: number): number {
  if (words <= 0 || heightPx <= 0) return 0;
  return (heightPx / words) * (wpm / 60);
}

/** Seconds to speak `words` at `wpm` — what the time remaining is made of. */
export const secondsFor = (words: number, wpm: number) => (wpm > 0 ? (words / wpm) * 60 : 0);

/** m:ss, for a countdown nobody should have to interpret. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The line that is "now": the last one whose top has reached the focus line. `tops` are
 * the sentence offsets within the column, `offset` how far the column has travelled —
 * the two meet exactly when a sentence's first line sits on the mark.
 */
export function lineAt(offsetPx: number, tops: number[]): number {
  if (!tops.length) return -1;
  let i = 0;
  while (i + 1 < tops.length && tops[i + 1] <= offsetPx + 0.5) i++;
  return i;
}

/** The run is over once the last sentence has climbed past the mark — i.e. the whole column has. */
export const ended = (offsetPx: number, heightPx: number) => heightPx > 0 && offsetPx >= heightPx;

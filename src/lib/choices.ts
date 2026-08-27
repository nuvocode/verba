// The menus a learner is offered, written once.
//
// Setup asks about level and daily time; Settings → Learning asks about the same
// two later. §5.3 is explicit that these must be the same concepts under the same
// names — "short / medium / long" in one place and raw minutes in the other is
// two products. Both screens read this file, so they cannot drift apart.
import type { CEFRLevel } from "./model.ts";

/** Every level, with the sentence that says what it means. A bare CEFR code is a
 *  code, not an answer to "where am I starting from" (§5.3). */
export const LEVELS: [CEFRLevel, string, string][] = [
  ["A1", "Brand new", "I know a few words at most. Start me from zero, gently."],
  ["A2", "I can get by", "Ordering food, asking directions — but real conversations lose me fast."],
  ["B1", "Conversational", "I can hold a conversation but plateau on nuance, speed, and idiom."],
  ["B2", "Comfortable", "I'm fluent in most situations; I want nuance, idiom, and native speed."],
  ["C1", "Advanced", "I work or study in it. I'm after precision, register, and the last 5%."],
  ["C2", "Near-native", "I want to sound like someone who grew up with it."],
];

/**
 * The three session lengths, as minutes and as the name each one goes by. The
 * minute count is the value the plan is built to; the name is what the learner
 * chose. Neither is shown without the other.
 */
export const TIMES: [number, string, string][] = [
  [20, "a focused burst", "Three short pieces — conversation, a passage, the words that are due."],
  [45, "the sweet spot", "The full day: conversation, reading, role-play, listening and review."],
  [75, "deep immersion", "Everything, with room to go long on the parts you're enjoying."],
];

/** The name a stored minute count goes by, for a value that is one of the three. */
export const timeName = (minutes: number): string =>
  TIMES.find(([n]) => n === minutes)?.[1] ?? TIMES[1][1];

/**
 * The nearest of the three to an arbitrary minute count.
 *
 * Only old records need this: setup has always written one of the three, and the
 * free-form minutes box in Settings is gone. Snapping on load means the picker
 * can never render with nothing selected, and never has to show a raw number to
 * explain why.
 */
export const snapTime = (minutes: number): number =>
  TIMES.reduce((best, [n]) => (Math.abs(n - minutes) < Math.abs(best - minutes) ? n : best), TIMES[0][0]);

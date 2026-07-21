// The coach's face, as data. No React here, and no DOM — rig.tsx arranges these
// into groups and Face.tsx decides which frame is showing.
//
// Everything is drawn inside one 120×120 box against a fixed set of anchors. The
// anchors are the contract: the rig, the blink and every expression are written
// against them, so a part can be redrawn without anything else moving.
//
//   eye line      y = 64          eye centres   x = 47 / 73
//   mouth         x 46 → 74, baseline y = 88
//   head tilt     origin 60, 96   (base of the neck — turning about the crown
//                                  reads as a bobbing ball, not a head)
//
// The linework is filled contour, not stroke: a stroke cannot vary in width, and
// variable width is the whole difference between an ink line and a technical one.
// The exception is the mouth and the glasses, each for its own reason — see below.

import type { Mouth } from "../../../lib/voice";

/**
 * Mouth frames. The five `voice.Mouth` names plus `smile`, which is an expression
 * and not a level — `mouthPath` below is what composes the two, so lib/voice.ts
 * never learns that expressions exist.
 *
 * Every frame is `M q q Z` and nothing else. That is not a style preference: the
 * browser will only interpolate `d` between paths that share a command structure,
 * and `.face .m { transition: d }` in theme.css is what softens frame changes at
 * 60fps. Break the skeleton and the transition silently stops applying — it does
 * not error, the mouth just starts snapping.
 *
 * The opening amounts are deliberately smaller than v1's. In v1 the mouth was
 * filled with the terracotta accent; the accent now lives on the glasses, so the
 * mouth is ink, and v1's amplitudes at this width punch a black hole through the
 * lower third of the face. Measured, not copied.
 *
 * `rest` carries a 1px upward curve rather than sitting flat. A mouth drawn as a
 * straight line is not neutral — it reads as withheld, and v1.5 shipped a coach
 * people described as bored. The curve is the cheapest fix there is: same
 * skeleton, one control point, and the face is benevolent at rest instead of
 * blank. `smile` was deepened in the same pass, because a warm rest and the old
 * smile were within half a pixel of each other and the cue would have vanished.
 */
export const MOUTHS: Record<Mouth | "smile", string> = {
  closed: "M46 88 q14 0 28 0 q-14 0.9 -28 0 Z",
  rest: "M46 85.6 q14 7.2 28 0 q-14 2 -28 0 Z",
  half: "M46 87.4 q14 5 28 0 q-14 -2.4 -28 0 Z",
  open: "M46 86.6 q14 9.5 28 0 q-14 -4.8 -28 0 Z",
  wide: "M46 86 q14 13.5 28 0 q-14 -6.8 -28 0 Z",
  smile: "M46 83.6 q14 10.6 28 0 q-14 7 -28 0 Z",
};

/**
 * Where the corners of a mouth frame sit, which is what the eye reads as warmth:
 * corners above the middle is a smile, level is a line. Parsed from the path
 * rather than kept beside it, so the two cannot drift apart — `expression.check`
 * uses it to hold the ordering closed → rest → smile.
 */
export function cornerY(d: string): number {
  return Number(d.split(" ")[1]);
}

/**
 * How open the mouth is, that is the interior of it, relative to the linework.
 * An alpha rather than a fixed grey on purpose: it is taken against `currentColor`,
 * so in both themes the cavity lands halfway between the line and the ground. A
 * literal mid-grey would read as a hole on the dark theme's charcoal.
 */
export const MOUTH_FILL = 0.5;

/** The brow frames the rig can draw. */
export type Brow = "neutral" | "raised" | "soft";

/** What the face is doing that is not speech, named for the situation rather than
 *  the muscle — Part C maps app events onto these and nothing else. */
export type Expression = "neutral" | "listening" | "raised" | "smiling";

/**
 * One expression decomposed into the parts that move. Keeping the mapping here,
 * as data, is what makes Part C a table lookup instead of a pile of conditionals
 * spread across the component: an event picks an `Expression`, and the rig reads
 * the row.
 */
export const EXPRESSIONS: Record<Expression, { brow: Brow; smiling: boolean; tilt: number }> = {
  neutral: { brow: "neutral", smiling: false, tilt: 0 },
  // The tilt is what says "listening"; a raised brow while the learner is still
  // typing reads as surprise at a sentence nobody has finished yet.
  //
  // −4° and not less: at the 92px this ships at, −2.5° was measured and does not
  // register at all. The ceiling is roughly −6°, past which a tilted head stops
  // reading as attention and starts reading as a question.
  listening: { brow: "neutral", smiling: false, tilt: -4 },
  raised: { brow: "raised", smiling: false, tilt: 0 },
  smiling: { brow: "soft", smiling: true, tilt: 0 },
};

/**
 * Which mouth to draw. Speech outranks expression: a coach that freezes into a
 * smile mid-sentence is worse than one that never smiles. `smile` therefore only
 * survives while nothing is being said.
 */
export function mouthPath(mouth: Mouth, smiling: boolean): string {
  if (mouth !== "rest") return MOUTHS[mouth];
  return smiling ? MOUTHS.smile : MOUTHS.rest;
}

/**
 * Brows, one pair per state, all on the same `Q Q Z` skeleton so they tween like
 * the mouth does. Left and right are not mirrors — a face drawn with perfect
 * symmetry reads as machine-made, and the brow is where that shows first.
 */
export const BROWS: Record<Brow, string> = {
  neutral:
    "M38.2 53.8 Q46.8 47.9 56 50.8 Q46.8 51.9 38.2 55.2 Z" +
    "M81.8 53.2 Q73.2 47.2 64 50.4 Q73.2 51.4 81.8 54.8 Z",
  raised:
    "M38.2 53.8 Q46.8 44.4 56 50.8 Q46.8 51.9 38.2 55.2 Z" +
    "M81.8 53.2 Q73.2 43.7 64 50.4 Q73.2 51.4 81.8 54.8 Z",
  soft:
    "M38.2 53.8 Q46.8 49.5 56 50.8 Q46.8 51.9 38.2 55.2 Z" +
    "M81.8 53.2 Q73.2 48.8 64 50.4 Q73.2 51.4 81.8 54.8 Z",
};

/** Eyes open: upper lid, lower lid, pupil — per side. */
export const EYES_OPEN =
  "M40.5 64.6 Q47 57.7 53.6 63.6 Q47 60.7 40.5 64.6 Z" +
  "M41 65.3 Q47 68.6 53.3 65 Q47 67.2 41 65.3 Z" +
  "M66.5 63.5 Q73 57.9 79.5 64.7 Q73 60.9 66.5 63.5 Z" +
  "M66.9 65.1 Q73 68.5 78.9 65.2 Q73 67.3 66.9 65.1 Z";

/** Eyes shut: one lid line each, curving down. The pupils are dropped, not hidden. */
export const EYES_SHUT =
  "M40.5 63.4 Q47 66.6 53.6 63.2 Q47 64.8 40.5 63.4 Z" +
  "M66.5 63.2 Q73 66.6 79.5 63.4 Q73 64.8 66.5 63.2 Z";

export const PUPILS: { cx: number; cy: number; r: number }[] = [
  { cx: 47.3, cy: 63.2, r: 2.1 },
  { cx: 72.7, cy: 63.3, r: 2.15 },
];

/**
 * The face contour. One closed shape with the outer and inner edge in the same
 * path — the gap between them is the line, and because the two edges are not
 * parallel the line thickens on the way down: 1.3 at the temple, 3.5 at the jaw
 * corner, 4.0 under the chin. That gradient is the pen pressure.
 *
 * It is broken into more segments than the shape strictly needs. The extra
 * control points carry small deviations meant to read as a hand rather than a
 * spline; at the size this ships (92px) they sit under the perception threshold
 * and the width gradient is doing all the visible work. Kept because the cost is
 * a few hundred bytes and the avatar may yet be shown larger.
 */
export const FACE =
  "M28.8 44 C28.3 48.6 28 52.4 27.9 56 C27.8 59.8 28 63.2 28.3 66.2 " +
  "C28.6 69.4 29.2 72.6 30.2 75.6 C31 78.4 32.1 81 33.4 83.4 C34.9 86.7 37.2 89.8 40.3 92.7 " +
  "C45.9 98 53.4 104.9 60 104.9 C66.9 104.9 74.6 97.8 80.2 92.3 C83.5 89.2 85.9 86 87.3 82.6 " +
  "C88.5 79.9 89.5 77 90.2 74 C90.9 71.2 91.4 68.4 91.6 65.6 C91.9 59.6 91.8 51.8 91.1 44 " +
  "L89.8 44 C90.4 51.8 90.5 59.6 90.2 65.6 C90 68.2 89.6 70.9 88.9 73.6 C88.2 76.4 87.3 79.1 86.2 81.5 " +
  "C84.9 84.7 82.6 87.6 79.4 90.4 C74 95.4 67 100.9 60 100.9 C53.1 100.9 45.9 95.6 40.4 90.6 " +
  "C37.4 87.8 35.2 84.8 33.8 81.6 C32.6 79.2 31.6 76.7 30.9 74.1 C30 71.2 29.5 68.2 29.2 65.9 " +
  "C28.9 62.9 28.7 59.6 28.8 56 C28.9 52.4 29.2 48.6 29.7 44 Z";

/**
 * Hair as a solid mass rather than a bundle of strokes. This is the single change
 * that stopped the character reading as a mascot: an empty crown above a pair of
 * eyes is a balloon, and no amount of line refinement fixed that. The mass also
 * covers where the face contour ends at y=44, so those ends are never seen.
 */
export const HAIR =
  "M28.4 54 C27 41 28.2 27 36 19.4 C43.2 12.4 52.6 10.2 60 10.2 " +
  "C68.8 10.2 78.2 13 84.2 19.8 C88.6 24.6 90.9 31.6 91.6 39 C91.9 44 91.8 49.4 91.2 54 " +
  "C90.6 45 89 38.4 86.4 33.8 C81.8 37.8 73.8 39.8 65.8 38.8 C55.8 37.6 45.8 40 39.8 44.2 " +
  "C36 46.9 32 49.8 28.4 54 Z" +
  "M45.4 39.4 Q52 36.6 58.6 37.3 Q52 38.9 46.2 41.2 Z" +
  "M32.6 48.6 Q35.8 43.2 40.8 39.8 Q36.4 44.5 34.2 50.6 Z" +
  "M63.4 39.2 Q70.4 39.6 76.6 37.6 Q70.6 40.6 63.8 40.7 Z";

/** Nose: the ridge, and the base tucked close under it. A heavier nose reads as a
 *  beak at this scale — that was tried and thrown away. */
export const NOSE =
  "M60.6 63 C60.2 68 59.4 73 57.8 76.6 C58.5 77.2 59.3 77.3 59.9 76.9 " +
  "C60.7 73 61.1 68 61.3 63.2 Z" +
  "M56.9 78.3 Q59.4 80.2 62.3 79.2 Q59.5 80.8 56.3 79.4 Z";

/**
 * The glasses, and the one place the terracotta accent is spent. Drawn with a
 * stroke while everything else is filled contour: round frames are a manufactured
 * object with one consistent gauge, so uniform width is what they should have.
 * The inconsistency is the point — it separates the object from the hand.
 */
export const GLASS_R = 8.6;
export const GLASSES =
  `M${47 + GLASS_R} 62 C${49 + GLASS_R} 59.4 ${71 - GLASS_R} 59.4 ${73 - GLASS_R} 62` +
  `M${47 - GLASS_R} 61.4 Q34 59.2 30 58.4` +
  `M${73 + GLASS_R} 61.4 Q86 59.2 90 58.4`;

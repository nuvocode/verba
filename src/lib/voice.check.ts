// Runnable self-check for the coach's mouth. Runs headless — no window, so no
// AudioContext and no animation frames; what is tested is the two pure functions
// the character actually watches, which is where every visible bug would live.
//
// The bug this file exists to prevent is flicker. A mouth that chatters between
// two frames on a steady vowel is worse than no mouth at all, and it is exactly
// what a naive `if (level > x)` produces on real speech.
// Run: node --experimental-strip-types src/lib/voice.check.ts
import assert from "node:assert";
import { mouthFor, MOUTH_START, syntheticLevel, type Mouth, type MouthState } from "./voice.ts";

const at = (mouth: Mouth, since = -Infinity): MouthState => ({ mouth, since });

/**
 * Feed a series of levels, one per `step` ms, and report the frames it produced.
 * `step` defaults to well past the dwell, so what these assertions measure is the
 * hysteresis and not the dwell quietly covering for it.
 */
function drive(levels: number[], from: Mouth = "closed", step = 100): Mouth[] {
  let s = at(from);
  const seen: Mouth[] = [];
  levels.forEach((l, i) => {
    s = mouthFor(l, s, i * step);
    seen.push(s.mouth);
  });
  return seen;
}

/** How many times the frame changed across a run. Settling once is not flicker. */
const changes = (frames: Mouth[]) => frames.filter((f, i) => i > 0 && f !== frames[i - 1]).length;

// --- the mapping itself ---
assert.equal(mouthFor(0, at("closed"), 1000).mouth, "closed", "silence keeps the mouth shut");
assert.equal(mouthFor(0.9, at("closed"), 1000).mouth, "wide", "a shout opens it all the way");
assert.equal(mouthFor(0.09, at("closed"), 1000).mouth, "half", "a murmur is half-open");
assert.equal(mouthFor(0.2, at("closed"), 1000).mouth, "open");

// Loud → silent must come all the way back down, or the coach ends every reply
// caught mid-vowel.
assert.equal(mouthFor(0, at("wide"), 1000).mouth, "closed", "silence closes a wide mouth");

// --- no flicker: a level wobbling across one threshold must not chatter ---
// 0.06 is the closed→half edge; this crosses it sixty times over six seconds,
// which without hysteresis is sixty frame changes. Settling into `half` once is
// allowed and correct; anything after that is the chatter.
const frames = drive(Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.055 : 0.065)));
assert(changes(frames) <= 1, `a level wobbling on a threshold must settle once — got ${frames.join(" ")}`);
assert.equal(frames.at(-1), "half");

// The same wobble one notch up (the 0.15 open edge) must be just as steady.
const upper = drive(
  Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.145 : 0.155)),
  "half",
);
assert(changes(upper) <= 1, `…and so must the next threshold up — got ${upper.join(" ")}`);
assert.equal(upper.at(-1), "open");

// --- but a real crossing must still get through ---
assert.equal(drive([0, 0, 0.5, 0.5, 0.5]).at(-1), "wide", "hysteresis must not deafen the mouth");

// A fresh mouth owes no dwell — the first syllable must open it, whatever the
// clock happens to read.
assert.equal(mouthFor(0.9, MOUTH_START, 0).mouth, "wide", "the opening syllable must not be swallowed");

// --- dwell: two frame changes cannot land on consecutive ticks ---
// A transient that shoots through every threshold and back inside two frames is
// the other flicker, and thresholds alone do not catch it.
let s = mouthFor(0.9, MOUTH_START, 0);
assert.equal(s.mouth, "wide");
s = mouthFor(0, s, 16); // 16ms later — under the dwell
assert.equal(s.mouth, "wide", "a frame must be held for its dwell, however the level moves");
s = mouthFor(0, s, 200);
assert.equal(s.mouth, "closed", "…and must give way once the dwell has passed");

// --- the OS voice's stand-in ---
const curve = Array.from({ length: 2000 }, (_, i) => syntheticLevel(i * 5));
assert(
  curve.every((v) => v >= 0 && v <= 1),
  "the synthetic level must stay in the 0–1 the mapping is written in",
);
assert(Math.max(...curve) > 0.3, "it must open the mouth wide sometimes, or the coach mumbles");
assert(Math.min(...curve) < 0.04, "…and close it sometimes, or the coach gapes");

// It must not visibly loop. The two rates share no period inside ten seconds, so
// a sample and its ten-second echo must differ.
for (const t of [0, 1234, 4321, 7777]) {
  assert(
    Math.abs(syntheticLevel(t) - syntheticLevel(t + 10_000)) > 1e-6,
    `the synthetic curve repeats at ${t}ms + 10s — the eye will catch that`,
  );
}

// A word boundary re-phases the curve, which is the only reason it is a parameter.
assert.notEqual(syntheticLevel(5000, 0), syntheticLevel(5000, 137));
assert.equal(syntheticLevel(5137, 137), syntheticLevel(5000, 0), "phase is a shift of the same curve");

console.log("voice.check.ts — ok");

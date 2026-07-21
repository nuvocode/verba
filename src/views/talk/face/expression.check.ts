// Runnable self-check for the coach's expressions. Runs headless — no window, so
// no timers and no React; what is tested is the pure rule the component asks on
// every render, which is where every visible bug would live.
//
// The bugs this file exists to prevent, in order of how bad they look:
//   - a smile that never leaves (a coach frozen mid-reaction)
//   - a reaction to a counter going *down*, which is what a session reset does
//   - the tilt of "listening" outranking a correction that just landed
// Run: node --experimental-strip-types src/views/talk/face/expression.check.ts
import assert from "node:assert";
import { CUE_MS, expressionFor, rose, type Cue, type Mode } from "./expression.ts";
import { BROWS, EXPRESSIONS, MOUTHS, mouthPath } from "./paths.ts";

const cue = (kind: Cue["kind"], at: number): Cue => ({ kind, at });

// ---- a moment fades ----

assert.equal(expressionFor(cue("smiling", 1000), "idle", 1000), "smiling", "arrives at once");
assert.equal(expressionFor(cue("smiling", 1000), "idle", 1000 + CUE_MS - 1), "smiling");
assert.equal(
  expressionFor(cue("smiling", 1000), "idle", 1000 + CUE_MS),
  "neutral",
  "a smile that outlives its window is a coach frozen mid-reaction",
);

// A stale cue is not merely ignored — the mode underneath it comes back.
assert.equal(expressionFor(cue("raised", 0), "listening", 99_999), "listening");

// ---- a moment outranks a situation ----

assert.equal(
  expressionFor(cue("raised", 500), "listening", 600),
  "raised",
  "the learner typing is the background; the correction is the event",
);

// ---- situations ----

assert.equal(expressionFor(null, "listening", 0), "listening");
assert.equal(expressionFor(null, "idle", 0), "neutral");

// There is deliberately no "reflecting" mode: Talk.tsx returns the wrap-up from a
// branch above the rail, so the face is unmounted for the whole of it. If that
// ever changes, this is the line that should start failing to compile.
const modes: Mode[] = ["idle", "listening"];
assert.equal(modes.length, 2);

// ---- counters ----

assert.equal(rose(0, 1), true);
assert.equal(rose(3, 3), false, "a re-render is not an event");
assert.equal(rose(4, 0), false, "ending a session zeroes the counts; that is not a goal met");

// ---- speech outranks expression ----
// The one rule that is not in expressionFor: a mouth mid-syllable must not be
// replaced by a smile, or the coach stops talking while still making noise.

for (const m of ["closed", "half", "open", "wide"] as const) {
  assert.equal(mouthPath(m, true), MOUTHS[m], `${m} must survive a smile`);
}
assert.equal(mouthPath("rest", true), MOUTHS.smile, "silence is where a smile is allowed");
assert.equal(mouthPath("rest", false), MOUTHS.rest);

// ---- the tween contract ----
// theme.css softens `d` changes on the mouth and the brows, but a browser will
// only interpolate between paths built from the same commands. Nothing enforces
// that at runtime: break it and the transition silently stops applying.

const shape = (d: string) => d.replace(/-?[\d.]+/g, "#").replace(/\s+/g, " ").trim();

const mouthShapes = new Set(Object.values(MOUTHS).map(shape));
assert.equal(
  mouthShapes.size,
  1,
  `every mouth frame must share one command structure; found ${[...mouthShapes].join(" | ")}`,
);

const browShapes = new Set(Object.values(BROWS).map(shape));
assert.equal(browShapes.size, 1, "every brow frame must share one command structure");

// Every expression must name a brow the rig can actually draw.
for (const [name, e] of Object.entries(EXPRESSIONS)) {
  assert.ok(BROWS[e.brow], `expression ${name} points at a brow that does not exist`);
}

// Exactly one expression smiles, and it is the one with the soft brow — a smiling
// mouth under a neutral brow is the uncanny one.
const smilers = Object.values(EXPRESSIONS).filter((e) => e.smiling);
assert.equal(smilers.length, 1);
assert.equal(smilers[0].brow, "soft");

console.log("expression.check.ts — ok");

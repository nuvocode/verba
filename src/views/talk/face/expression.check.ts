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
import {
  BLINK_MS,
  blinkPlan,
  CUE_MS,
  DRIFT_MS,
  driftGap,
  earnedSmile,
  expressionFor,
  looksPleased,
  modeFor,
  noddable,
  NOD_MIN_CHARS,
  rose,
  SMILE_STEP,
  type Cue,
  type Mode,
  type Turn,
} from "./expression.ts";
import { BROWS, cornerY, EXPRESSIONS, GAZE_OFFSET, GLASS_R, MOUTHS, mouthPath, PUPILS } from "./paths.ts";

const cue = (kind: Cue["kind"], at: number): Cue => ({ kind, at });

// ---- a moment fades ----

assert.equal(expressionFor(cue("smiling", 1000), "idle", 1000), "smiling", "arrives at once");
assert.equal(expressionFor(cue("smiling", 1000), "idle", 1000 + CUE_MS.smiling - 1), "smiling");
assert.equal(
  expressionFor(cue("smiling", 1000), "idle", 1000 + CUE_MS.smiling),
  "neutral",
  "a smile that outlives its window is a coach frozen mid-reaction",
);

// A smile is read at a glance away from the face; a brow is read on the face that
// was already being watched. v1.5 gave them the same window and the smile went
// unseen for a whole release.
assert.ok(CUE_MS.smiling > CUE_MS.raised * 2, "a smile needs longer than a correction to land");

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
assert.equal(expressionFor(null, "attending", 0), "attending");
assert.equal(expressionFor(null, "thinking", 0), "thinking");
assert.equal(expressionFor(null, "idle", 0), "neutral");

// There is deliberately no "reflecting" mode: Talk.tsx returns the wrap-up from a
// branch above the rail, so the face is unmounted for the whole of it. If that
// ever changes, this is the line that should start failing to compile.
const modes: Mode[] = ["idle", "listening", "attending", "thinking"];
assert.equal(modes.length, 4);

// ---- which situation wins ----
// The learner acting outranks the coach working. A face that looks away to think
// while someone is still typing has stopped listening to them.

assert.equal(modeFor({ mic: true, typing: true, waiting: true }), "attending", "an open mic wins");
assert.equal(modeFor({ mic: false, typing: true, waiting: true }), "listening", "typing beats waiting");
assert.equal(modeFor({ mic: false, typing: false, waiting: true }), "thinking", "dead air is what it fills");
assert.equal(modeFor({ mic: false, typing: false, waiting: false }), "idle");

// Typing and speaking must not draw the same face — the task asks for a mic state
// *distinct* from the typing tilt, and identical rows would satisfy every other
// assertion here while shipping nothing.
const t = EXPRESSIONS.listening;
const a = EXPRESSIONS.attending;
assert.ok(t.brow !== a.brow || t.tilt !== a.tilt || t.gaze !== a.gaze, "attending must differ from listening");

// Thinking is the only expression that looks away. Anything else that did would
// be the coach avoiding eye contact with a learner who is waiting on it.
const aside = Object.entries(EXPRESSIONS).filter(([, e]) => e.gaze === "aside");
assert.deepEqual(
  aside.map(([k]) => k),
  ["thinking"],
);

// ---- counters ----

assert.equal(rose(0, 1), true);
assert.equal(rose(3, 3), false, "a re-render is not an event");
assert.equal(rose(4, 0), false, "ending a session zeroes the counts; that is not a goal met");

// ---- smile economy ----
// The failure this replaces: one smile per session, bound to a turn-count proxy,
// fired and decayed before anyone looked. What matters now is scarcity — a coach
// that smiles at every turn is not warm, it is nervous.

assert.equal(earnedSmile(50, 50 + SMILE_STEP), true, "a full step is earned");
assert.equal(earnedSmile(50, 50 + SMILE_STEP - 1), false, "most of a step is not a step");
assert.equal(earnedSmile(50, 54), false, "one good turn is not a smile");
// Two clean unaided turns (+4 each) and a corrected one (+2) still fall short —
// the step is deliberately more than a lucky pair.
assert.equal(earnedSmile(50, 50 + 4 + 4 + 2), false);
assert.equal(earnedSmile(50, 42), false, "confidence cannot fall into a smile");

// The emoji rule is a lookup, not sentiment: the coach saying it is pleased, in
// the one form a model reliably reaches for. v1.5 replied 😊 while the face sat
// flat, and the learner reads both at once.
assert.equal(looksPleased("Genau! 😊 Das war sehr gut."), true);
assert.equal(looksPleased("Perfekt 👏"), true);
assert.equal(looksPleased("🙂"), true);
assert.equal(looksPleased("Und was hast du dann gemacht?"), false, "plain prose is not a smile");
assert.equal(looksPleased("Hmm 🤔 nicht ganz."), false, "an ambiguous mark is not evidence");
assert.equal(looksPleased("Leider falsch 😕"), false);

// ---- the idle schedules ----
// What the face does when nothing is happening, which is most of the time. Both
// timers live in the component; the arithmetic is here so "this does not feel
// like a metronome" is a property something can hold rather than a comment.

assert.equal(blinkPlan(0, 1).after, 2500, "the shortest gap");
assert.equal(blinkPlan(1, 1).after, 5200, "the longest");
assert.ok(blinkPlan(0.5, 1).after > 3000, "the middle of the range is a comfortable gap");

// A double is the minority case. If it ever became the common one the pair would
// be the shape that repeats, which is the thing this exists to break.
assert.equal(blinkPlan(0.5, 0).double, true);
assert.equal(blinkPlan(0.5, 0.5).double, false);
assert.equal(blinkPlan(0.5, 1).double, false);

// Drift is an order of magnitude rarer than blinking. Eyes that wander often stop
// reading as idleness and start reading as inattention.
assert.ok(
  driftGap(0) > blinkPlan(1, 1).after * 2,
  `even the soonest drift must be rarer than the longest blink gap (${driftGap(0)} vs ${blinkPlan(1, 1).after})`,
);
assert.ok(driftGap(1) > driftGap(0));
assert.ok(DRIFT_MS > BLINK_MS * 5, "a drift rests; a blink passes");

// ---- gaze geometry ----
// The pupil has to stay inside its lens. Off the glass it stops being a glance
// and becomes an eye-roll — and the frame is drawn in the one accent colour, so
// a pupil crossing it is the most conspicuous mistake this rig can make.

for (const [name, [dx, dy]] of Object.entries(GAZE_OFFSET)) {
  for (const p of PUPILS) {
    const lens = { cx: p.cx < 60 ? 47 : 73, cy: 64 };
    const reach = Math.hypot(p.cx + dx - lens.cx, p.cy + dy - lens.cy) + p.r;
    assert.ok(reach < GLASS_R - 1, `gaze ${name} puts a pupil ${reach.toFixed(1)} out, past the frame at ${GLASS_R}`);
  }
}

// The two ways of leaving must not look like the same habit.
assert.ok(GAZE_OFFSET.aside[0] * GAZE_OFFSET.drift[0] < 0, "thought and idleness look opposite ways");
assert.ok(
  Math.abs(GAZE_OFFSET.drift[0]) < Math.abs(GAZE_OFFSET.aside[0]),
  "a drift is smaller than a look-away",
);
assert.deepEqual(GAZE_OFFSET.at, [0, 0]);

// ---- the nod ----
// A nod is for a long sentence the coach found nothing to fix in. The trap it has
// to avoid is the one Part A removed from the smile: reacting to a turn before the
// reply that judges it has arrived, which would nod at every sentence on send.

const user = (text: string, corrections: unknown[] = [], isAsk = false): Turn => ({
  role: "user",
  text,
  corrections,
  isAsk,
});
const coach = (text = "…"): Turn => ({ role: "ai", text, corrections: [] });
const LONG = "I spent the whole morning reading about how cities plan their transport.";
assert.ok(LONG.length >= NOD_MIN_CHARS);

assert.equal(noddable([user(LONG), coach()]), 1, "long, clean, and answered");
assert.equal(noddable([user(LONG)]), 0, "a turn still in flight has no corrections *yet*");
assert.equal(noddable([user(LONG, [{}]), coach()]), 0, "a corrected turn is not a nod");
assert.equal(noddable([user("Yes, sometimes."), coach()]), 0, "short is answering, not producing");
assert.equal(noddable([user(LONG, [], true), coach()]), 0, "a ⌘K aside is a question, not a sentence");
assert.equal(noddable([user(LONG), coach(), user(LONG), coach()]), 2, "counted, so a rise is the event");

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

// ---- warmth, as geometry ----
// The corners are what the eye reads: above the middle is a smile, level is a
// line. `rest` carries a curve so the coach is benevolent when nothing is
// happening, which is most of the time — but it has to stay clearly short of
// `smile`, or the cue it is supposed to make room for stops being visible at all.

const lift = (frame: keyof typeof MOUTHS) => 88 - cornerY(MOUTHS[frame]);

assert.ok(lift("rest") >= 1 && lift("rest") <= 3, `rest must be warm, not grinning (got ${lift("rest")})`);
assert.ok(
  lift("smile") - lift("rest") >= 1.5,
  `a smile a warm rest has swallowed is not a cue (rest ${lift("rest")}, smile ${lift("smile")})`,
);
assert.equal(lift("closed"), 0, "a shut mouth is a line; the warmth lives in rest");

console.log("expression.check.ts — ok");

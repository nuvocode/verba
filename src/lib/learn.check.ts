// Runnable check: `node --experimental-strip-types src/lib/learn.check.ts`
import assert from "node:assert";
import { defaultSettings } from "./settings.ts";
import {
  activityStatus,
  anotherTheme,
  buildDailyPlan,
  daySummary,
  dependencyMet,
  dependencyNote,
  nextActivity,
  isLegacyPlanShape,
  progressLine,
  shortfallNote,
  themeForDate,
  traceLine,
  type PlanContext,
} from "./learn.ts";
import { TIMES } from "./choices.ts";

// helper: a valid context, with the field under test overridden on demand
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  date: "2026-08-26",
  dayIndex: 41,
  dueVocab: 0,
  ...over,
});

// S1 rename table: the six kinds map onto the shared ActivityKind values, in running order
const five = buildDailyPlan(defaultSettings, ctx({ dueVocab: 5 }));
assert.deepEqual(
  five.activities.map((a) => a.kind),
  ["talk", "read", "roleplay", "memory", "listen", "wrapup"],
  "conversation→talk, reading→read, scenario→roleplay, vocab→memory, listening→listen, summary→wrapup",
);

// #16: plan minutes equal the sum of the activity minutes
// invariant 4
assert.equal(
  five.estimatedMinutes,
  five.activities.reduce((n, a) => n + a.estimatedMinutes, 0),
  "estimatedMinutes is the sum of the activities",
);

// #17: every activity carries a non-empty rationale
// invariant 5
for (const a of five.activities) assert(a.rationale.trim().length > 0, `${a.kind} must have a rationale`);

// focus folds into the first activity's rationale
const focused = buildDailyPlan(defaultSettings, ctx({ focus: ["past tense"] }));
assert(focused.activities[0].rationale.includes("past tense"), "the first activity drills the focus");

// dueVocab gates the memory activity
const none = buildDailyPlan(defaultSettings, ctx({ dueVocab: 0 }));
assert(!none.activities.some((a) => a.kind === "memory"), "nothing due → no memory activity");
assert(five.activities.some((a) => a.kind === "memory"), "5 due → a memory activity");

// determinism: the same context builds the same plan
const a = buildDailyPlan(defaultSettings, ctx({ dueVocab: 5, focus: ["past tense"] }));
const b = buildDailyPlan(defaultSettings, ctx({ dueVocab: 5, focus: ["past tense"] }));
assert.deepEqual(a, b, "the same PlanContext yields the same plan");

// nextActivity skips completed activities and returns the first pending one
assert.equal(nextActivity(five, []), "talk", "an untouched day starts at talk");
assert.equal(nextActivity(five, ["talk"]), "read", "completed talk is skipped");
assert.equal(nextActivity(five, ["talk", "read", "roleplay"]), "memory", "the first pending is returned");
assert.equal(
  nextActivity(five, ["talk", "read", "roleplay", "memory", "listen", "wrapup"]),
  null,
  "a finished day has no next",
);

// a pre-model row ({blocks:[...]}) is treated as absent and rebuilt
assert.equal(isLegacyPlanShape({ blocks: [] }), true, "an old {blocks:[...]} row falls into the rebuild path");
assert.equal(isLegacyPlanShape({ activities: [] }), false, "a shared-model row is kept");

// ---- the day is as long as the learner said it was (§4.2) ----
//
// Setup asks for one of three lengths and Settings writes a sentence promising
// days "built to about N minutes". The planner used to ignore all three.

for (const [minutes] of TIMES)
  for (const due of [0, 5, 20, 40]) {
    const plan = buildDailyPlan({ ...defaultSettings, dailyMinutes: minutes }, ctx({ dueVocab: due }));
    const off = plan.estimatedMinutes - minutes;
    // Over is possible and explained (state 8). Under is not: the stretchy
    // activities absorb whatever is left, so a short day is a bug, not a choice.
    assert(off >= -2, `${minutes}min/${due} due came to ${plan.estimatedMinutes} — a day must not fall short of what was asked`);
    assert(
      off < 3 || !!shortfallNote(plan, minutes),
      `${minutes}min/${due} due came to ${plan.estimatedMinutes} and said nothing about it`,
    );
    // Whatever the arithmetic did, the number on screen is still the sum of the rows.
    assert.equal(plan.estimatedMinutes, plan.activities.reduce((n, a) => n + a.estimatedMinutes, 0));
    // No row is shortened into meaninglessness.
    for (const a of plan.activities) assert(a.estimatedMinutes >= 2, `${a.kind} at ${minutes}min is ${a.estimatedMinutes} min`);
  }

// The short day is a different day, not a squashed one — setup promises "three
// short pieces: conversation, a passage, the words that are due", and that is a
// list, not a mood.
const short = buildDailyPlan({ ...defaultSettings, dailyMinutes: 20 }, ctx({ dueVocab: 5 }));
assert.deepEqual(short.activities.map((a) => a.kind), ["talk", "read", "memory", "wrapup"], "20 minutes is the short shape");
const long = buildDailyPlan({ ...defaultSettings, dailyMinutes: 75 }, ctx({ dueVocab: 5 }));
assert(long.activities.some((a) => a.kind === "roleplay") && long.activities.some((a) => a.kind === "listen"));
// The longest day gives its extra minutes to conversation rather than adding rows.
const mid = buildDailyPlan({ ...defaultSettings, dailyMinutes: 45 }, ctx({ dueVocab: 5 }));
const talkAt = (p: typeof mid) => p.activities.find((a) => a.kind === "talk")!.estimatedMinutes;
assert(talkAt(long) > talkAt(mid), "a longer day is a longer conversation, not a longer list");
assert.equal(long.activities.length, mid.activities.length, "…and the list itself does not grow");

// ---- state 8: a plan that cannot reach the target says why ----
//
// Only one thing can push a day past its budget: a review is as long as the cards
// that came due, and everything else is already at its floor.
const swamped = buildDailyPlan({ ...defaultSettings, dailyMinutes: 20 }, ctx({ dueVocab: 200 }));
const note = shortfallNote(swamped, 20)!;
assert(note, "state 8: an overrun must be explained on the way in, not discovered");
assert.match(note, /20/, "state 8: the note names the time that was asked for");
assert.match(note, new RegExp(String(swamped.estimatedMinutes)), "state 8: …and the time it actually comes to");
assert.match(note, /due/, "state 8: …and the one thing that did it");
assert.equal(shortfallNote(mid, 45), null, "state 8: a day that fits says nothing");
// Two minutes over is rounding. A note on that would train the learner to skip these.
assert.equal(shortfallNote({ ...mid, estimatedMinutes: 47 }, 45), null, "state 8: rounding is not a shortfall");

// ---- the summary varies with the theme and what the day targets ----
const plain = daySummary(mid, []);
assert(plain.includes(mid.theme), "the summary names the day's theme");
assert.match(plain, new RegExp(`${mid.activities.length} pieces`), "…how many pieces it is");
assert.match(plain, new RegExp(`${mid.estimatedMinutes} minutes`), "…and how long it runs");

const weak = [
  { id: "w1", label: "past tense", count: 5, kind: "grammar" },
  { id: "w2", label: "article agreement", count: 3, kind: "grammar" },
] as any;
const targeted = buildDailyPlan(defaultSettings, ctx({ weaknesses: weak }));
const said = daySummary(targeted, weak);
assert.match(said, /past tense and article agreement/, "a targeted day names what it is targeting");
assert.notEqual(said, plain, "the summary is not one template with the theme swapped in");
// A weakness the plan targeted but that the signals no longer show is not cited —
// the learner would have nothing to look at.
assert(!daySummary(targeted, []).includes("past tense"), "nothing is cited that cannot be seen");
// Two different themes give two different sentences — the theme is in the text,
// not decoration around it.
assert.notEqual(daySummary(mid, []), daySummary({ ...mid, theme: "volcanoes and lighthouses" }, []));

// ---- the progress line ----
assert.match(progressLine(mid, []), /about \d+ minutes/, "an untouched day says how long it is");
assert.match(progressLine(mid, ["talk"]), /1 of \d+ done/, "a started day says how far in");
// The minutes left are the minutes still in front of them, not total minus elapsed.
const leftAfterTalk = mid.activities.filter((a) => a.kind !== "talk").reduce((n, a) => n + a.estimatedMinutes, 0);
assert.match(progressLine(mid, ["talk"]), new RegExp(`${leftAfterTalk} minutes left`));
assert.match(progressLine(mid, mid.activities.map((a) => a.kind)), /All \d+ finished/, "a finished day says so");

// ---- row status: three states, and exactly one "next" ----
for (const done of [[], ["talk"], ["talk", "read"], mid.activities.map((a) => a.kind)]) {
  const states = mid.activities.map((a) => activityStatus(mid, done as any, a.kind));
  assert(states.filter((s) => s === "next").length <= 1, "at most one row is up next");
  assert.equal(states.filter((s) => s === "done").length, done.length, "every finished activity reads as finished");
}
assert.equal(activityStatus(mid, [], "talk"), "next");
assert.equal(activityStatus(mid, [], "wrapup"), "waiting");
assert.equal(activityStatus(mid, ["talk"], "talk"), "done");
// A finished activity stays finished even when the learner reopens it — nothing
// here makes a done row unclickable, which is what §4.2 asks for.
assert.equal(activityStatus(mid, ["talk", "read"], "talk"), "done");

// ---- "another topic" gives another topic ----
const t0 = themeForDate("2026-08-26");
const t1 = anotherTheme(t0);
assert.notEqual(t1, t0, "another topic is a different topic");
assert.notEqual(anotherTheme(t1), t1, "…and pressing it again moves on rather than bouncing back");
assert.notEqual(anotherTheme(t1), t0, "…to a third, not the first one back");
// An interest whose pool has a single entry would otherwise make the link do
// nothing; it falls through to the full rotation instead.
const narrow = anotherTheme("travel and directions", ["Travel"]);
assert.notEqual(narrow, "travel and directions", "a narrow pool still yields another topic");
// A theme the rotation has never heard of (an AI suggestion) still moves somewhere.
assert(anotherTheme("volcanoes").length > 0, "an off-rotation theme still leads somewhere");

// ---- yesterday's trace ----
assert.equal(traceLine(null), null, "day one has no trace, rather than an empty one");
assert.equal(traceLine({ theme: "x", done: 0, total: 0 }), null, "…and neither does a day with no plan in it");
assert.match(traceLine({ theme: "food and cooking", done: 3, total: 6 })!, /food and cooking/, "the trace names the topic");
assert.match(traceLine({ theme: "food and cooking", done: 3, total: 6 })!, /3 of 6/, "…and how far it got");
assert.match(traceLine({ theme: "t", done: 6, total: 6 })!, /finished the day/, "a completed day reads as completed");
assert(!/0 of/.test(traceLine({ theme: "t", done: 0, total: 6 })!), "…and an untouched one does not read as a score");

// ---- invariant 7: the reading activity's dependency is real, and the note
// ---- says what the learner gets instead when it is not met.
{
  const plan = buildDailyPlan(defaultSettings, ctx({ dueVocab: 5 }));
  const read = plan.activities.find((a) => a.kind === "read")!;
  const talk = plan.activities.find((a) => a.kind === "talk")!;
  assert.equal(read.dependsOn, "talk", "invariant 7: read depends on talk");
  assert(
    plan.activities.findIndex((a) => a.id === "talk") < plan.activities.findIndex((a) => a.id === "read"),
    "invariant 7: talk appears before read in the plan",
  );

  assert.equal(dependencyMet(plan, [], "read"), false, "invariant 7: read is unmet before talk runs");
  assert.equal(dependencyMet(plan, ["talk"], "read"), true, "invariant 7: read is met once talk is done");
  assert.equal(dependencyMet(plan, [], "talk"), true, "invariant 7: talk has no dependency, so it is always met");

  const note = dependencyNote(plan, [], "read");
  assert(note && note.length > 0, "invariant 7: an unmet read gets a note");
  assert(note!.includes(read.title), "invariant 7: the note names the activity's own title");
  assert(note!.includes(talk.title.toLowerCase()), "invariant 7: the note names the dependency it leans on");
  assert.equal(dependencyNote(plan, ["talk"], "read"), null, "invariant 7: a met read gets no note");
}

// invariant 7 — the short day still carries the dependency: it drops role-play
// and listening, not the read's connection to the conversation.
{
  const short = buildDailyPlan({ ...defaultSettings, dailyMinutes: 20 }, ctx({ dueVocab: 5 }));
  const read = short.activities.find((a) => a.kind === "read")!;
  const talk = short.activities.find((a) => a.kind === "talk")!;
  assert.equal(read.dependsOn, "talk", "invariant 7: the short day's read still depends on talk");
  assert(short.activities.some((a) => a.kind === "talk"), "invariant 7: talk is still in the short day");
  assert(short.activities.some((a) => a.kind === "read"), "invariant 7: read is still in the short day");
}

console.log("learn.check OK");

// The repair inventory (PLAN-027): six categories, tracked independently, and
// only ever filled by observation. Five behavioural claims and four construction
// claims, all pinned here.
//
// The load-bearing rule is §2.2's: a stored claim changes nothing, and the model
// may classify what the learner did but may never author it. `verifyRepair` is
// the gate that keeps the learner's words literally their own — so cases 1-2 pin
// it, cases 3-6 pin the derived states, case 7 pins the teaching order, and
// cases 8-9 pin the single-door and the never-a-miss rule by scanning the source
// and running the real coach metrics.
// Run: node --experimental-strip-types src/lib/repair.check.ts
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPAIR_CATEGORIES,
  verifyRepair,
  inventoryFrom,
  nextTarget,
  repairSignal,
  repairPayload,
  direction,
  directionSentence,
  todayLine,
  targetGoal,
  targetSentence,
  categoryTitle,
  type RepairEntry,
  type Direction,
} from "./repair.ts";
import { signalMiss, turnVerdict, type Signal } from "./model.ts";
import { coachMetrics } from "./coachmetrics.ts";
import { buildDailyPlan } from "./learn.ts";
import { defaultSettings } from "./settings.ts";
import { judge, turnSignalsFor, type SessionBudget } from "./breakdown.ts";
import { easeEffect } from "./difficulty.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// --- a repair signal, built through the app's own door -------------------------
const repairDraft = repairSignal;

const sig = (at: number, category: string, by: "learner" | "coach", variant: string): Signal => {
  const d = repairDraft("act-1", { category: category as any, by, variant });
  return { ...d, id: `s-${at}-${category}-${by}`, observedAt: at };
};

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

// --- case 1: verifyRepair believes only words the learner actually wrote --------
// Case and punctuation fold away ("Hold on," and "hold on" are one phrase); a
// paraphrase the learner never wrote is rejected wholesale — the model may
// classify, it may not author it.
// repair ledger 1 — the six categories, tracked independently, are defined and this
// file asserts their observable behaviour.
{
  const learner = verifyRepair({ category: "HOLD", variant: "hold on let me think", by: "learner" }, "Hold on, let me think.", "en");
  assert(learner !== null, "a variant differing only in case/punctuation is the learner's own words");
  assert.equal(learner!.variant, "hold on let me think", "the variant is kept verbatim as reported");

  const paraphrase = verifyRepair({ category: "HOLD", variant: "wait a moment please", by: "learner" }, "Hold on, let me think.", "en");
  assert.equal(paraphrase, null, "a plausible paraphrase the learner never wrote is not a repair");

  const invented = verifyRepair({ category: "CLARIFY", variant: "what does cuenta mean", by: "learner" }, "I don't follow.", "en");
  assert.equal(invented, null, "a variant with no trace in the message is dropped, nothing recorded");
}

// --- case 2: an unknown category and an empty learner variant cannot survive ----
{
  assert.equal(verifyRepair({ category: "PAUSE", variant: "hold on", by: "learner" }, "hold on", "en"), null, "an unknown category is dropped");
  assert.equal(verifyRepair({ category: "HOLD", variant: "", by: "learner" }, "hold on", "en"), null, "an empty learner variant names nothing");
  assert.equal(verifyRepair({ category: "HOLD", variant: "   ", by: "learner" }, "hold on", "en"), null, "a whitespace-only variant is empty");
  // A coach observation carries no words and is not checked against the message.
  const coach = verifyRepair({ category: "HOLD", variant: "", by: "coach" }, "hold on", "en");
  assert(coach !== null && coach.by === "coach", "a coach observation is accepted without a variant");
  assert.equal(coach!.variant, "", "a coach observation carries no learner words");
}

// --- case 3: an empty set is six unknowns, never six absences -------------------
{
  const inv = inventoryFrom([], NOW);
  assert.equal(inv.length, REPAIR_CATEGORIES.length, "every category always appears — six entries, never fewer");
  for (const e of inv) {
    assert.equal(e.state, "unknown", "no signal ⇒ unknown");
    assert.equal(e.total, 0, "no signal ⇒ zero learner uses");
    assert.equal(e.last7, 0, "no signal ⇒ zero recent uses");
    assert.equal(e.lastUsedAt, null, "no signal ⇒ no last use");
    assert.deepEqual(e.variants, [], "no signal ⇒ no phrasings");
  }
}

// --- case 4: coach observations alone produce recognises, never uses -----------
// repair ledger 2 — the inventory fills only by observation; a claim (a learner
// saying they know a pattern) changes nothing.
{
  const inv = inventoryFrom(
    [
      sig(NOW - 1 * DAY, "SLOW", "coach", ""),
      sig(NOW - 1 * DAY, "SLOW", "coach", ""),
      sig(NOW - 1 * DAY, "SLOW", "coach", ""),
    ],
    NOW,
  );
  const slow = inv.find((e) => e.category === "SLOW")!;
  assert.equal(slow.state, "recognises", "coach modelling alone is recognises");
  assert.equal(slow.total, 0, "coach observations never count as learner uses");
  assert.deepEqual(slow.variants, [], "coach observations carry no learner phrasings");
}

// --- case 5: four uses on one day is uses; three across two days is fluent -----
{
  // Four learner uses on a single day: fluent needs ≥2 distinct days too.
  const sameDay = inventoryFrom(
    [1, 2, 3, 4].map((i) => sig(NOW - i * 60 * 60 * 1000, "REPEAT", "learner", `repeat please ${i}`)),
    NOW,
  );
  const rep = sameDay.find((e) => e.category === "REPEAT")!;
  assert.equal(rep.state, "uses", "four uses on one day is uses, not fluent");

  // Three learner uses across two distinct days: fluent.
  const twoDays = inventoryFrom(
    [
      sig(NOW - 1 * DAY, "REPEAT", "learner", "repeat"),
      sig(NOW - 2 * DAY, "REPEAT", "learner", "repeat again"),
      sig(NOW - 3 * DAY, "REPEAT", "learner", "one more time please"),
    ],
    NOW,
  );
  const rep2 = twoDays.find((e) => e.category === "REPEAT")!;
  assert.equal(rep2.state, "fluent", "three uses across two days is fluent");

  // Boundary: a single learner use is recognises — §2.2's "uses" asks for a few.
  const single = inventoryFrom([sig(NOW - 1 * DAY, "REPEAT", "learner", "repeat please")], NOW);
  assert.equal(single.find((e) => e.category === "REPEAT")!.state, "recognises", "one learner use is recognises, not uses");
  const two = inventoryFrom(
    [sig(NOW - 1 * DAY, "REPEAT", "learner", "repeat please"), sig(NOW - 2 * DAY, "REPEAT", "learner", "say it again")],
    NOW,
  );
  assert.equal(two.find((e) => e.category === "REPEAT")!.state, "uses", "two learner uses is uses");
}

// --- case 6: last7 excludes an 8-day-old use that total still counts -----------
{
  const inv = inventoryFrom(
    [
      sig(NOW - 8 * DAY, "CLARIFY", "learner", "what does that word mean"),
      sig(NOW - 1 * DAY, "CLARIFY", "learner", "what do you mean by that"),
    ],
    NOW,
  );
  const cl = inv.find((e) => e.category === "CLARIFY")!;
  assert.equal(cl.total, 2, "the 8-day-old use still counts toward total");
  assert.equal(cl.last7, 1, "the 8-day-old use is outside the 7-day window");
  assert.equal(cl.state, "uses", "two learner uses is uses whatever their recency");
}

// --- case 7: nextTarget follows teaching order, and nulls at full uses ---------
{
  // All unknown → the first teaching order.
  assert.equal(nextTarget(inventoryFrom([], NOW)), "HOLD", "the default first target is HOLD");

  // Move HOLD to fluent → the next unknown is REPEAT.
  const holdFluent = inventoryFrom(
    [1, 2, 3].map((i) => sig(NOW - i * DAY, "HOLD", "learner", "hold on")),
    NOW,
  );
  assert.equal(nextTarget(holdFluent), "REPEAT", "nextTarget walks the documented order");

  // Everything at uses or better → null.
  const all = inventoryFrom(
    REPAIR_CATEGORIES.flatMap((c, i) => [sig(NOW - 1 * DAY, c, "learner", `${c} once`), sig(NOW - 2 * DAY, c, "learner", `${c} twice`)]),
    NOW,
  );
  assert.equal(nextTarget(all), null, "nothing left to teach when every category is at uses or better");

  // nextTarget must follow the teaching order, not the inventory argument's array
  // order: pass an inventory whose array is reversed (PARAPHRASE first, HOLD last)
  // and it must still answer HOLD — the array order is looked up, never trusted.
  const baseInv = inventoryFrom(
    [sig(NOW - 2 * DAY, "PARAPHRASE", "learner", "p once"), sig(NOW - 1 * DAY, "HOLD", "coach", "")],
    NOW,
  );
  assert.deepEqual(
    baseInv.map((e) => e.category),
    [...REPAIR_CATEGORIES],
    "inventoryFrom walks teaching order",
  );
  // A single learner use (PARAPHRASE) is recognises under §2.2, so with HOLD also
  // recognised, the teaching order — not the array order — picks HOLD.
  const reversed = [...baseInv].reverse();
  assert.equal(
    nextTarget(reversed),
    "HOLD",
    "nextTarget iterates the teaching order and looks entries up, not the inventory argument's order",
  );
}

// --- case 8: the derivation has one door, and one door only ---------------------
// No file outside repair.ts writes a repairMove signal, and no file builds a
// RepairEntry literal — the payload shape and the inventory state each have a
// single constructor.
{
  const ROOT = fileURLToPath(new URL("../../", import.meta.url));
  const SRC = join(ROOT, "src");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry): string[] => {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) return walk(p);
      if (st.isFile() && (extname(p) === ".ts" || extname(p) === ".tsx")) return [p];
      return [];
    });

  const files = walk(SRC).map((p) => relative(ROOT, p));

  // Writes of a repairMove signal: `kind: "repairMove"` may appear only in the
  // writer (repair.ts) and, as the type, in model.ts. Anything else constructs
  // the payload — the one door is broken.
  const signalWriters = files.filter(
    (f) => !f.endsWith(".check.ts") && readFileSync(join(ROOT, f), "utf8").includes('kind: "repairMove"'),
  );
  assert.deepEqual(signalWriters, ["src/lib/repair.ts"], "only repair.ts writes a repairMove signal");

  // Construction of a RepairEntry literal: the object literal that inventoryFrom
  // returns carries `last7:` and `lastUsedAt:` keys together — no other file may
  // build an entry by hand.
  const entryBuilders = files.filter((f) => {
    if (f.endsWith(".check.ts")) return false;
    const src = readFileSync(join(ROOT, f), "utf8");
    return src.includes("last7:") && src.includes("lastUsedAt:");
  });
  assert.deepEqual(entryBuilders, ["src/lib/repair.ts"], "only inventoryFrom constructs a RepairEntry");
}

// --- case 9: a repair move is never a miss; accuracy is not moved by them -------
{
  const move = sig(NOW, "HOLD", "learner", "hold on");
  assert.equal(signalMiss(move), false, "a repair move is the opposite of a miss");

  // Adding twenty repairMove signals must leave accuracy exactly where it was:
  // accuracy counts corrections against unprompted turns, and a repair move is
  // neither.
  const baseSignals: Signal[] = [
    { ...sig(NOW - 1 * DAY, "HOLD", "learner", "x"), kind: "unpromptedTurn", id: "t1" } as any,
    { ...sig(NOW - 1 * DAY, "HOLD", "learner", "x"), kind: "correction", id: "c1" } as any,
  ];
  const withMoves = [...baseSignals, ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((i) => sig(NOW - i * 1000, "HOLD", "learner", `hold ${i}`))];
  const a0 = coachMetrics(baseSignals, NOW).find((m) => m.id === "accuracy")!;
  const a1 = coachMetrics(withMoves, NOW).find((m) => m.id === "accuracy")!;
  assert.equal(a1.value, a0.value, "repair moves must not move the accuracy metric");
  assert.equal(a1.sample, a0.sample, "…nor its sample");
}

// --- case 10: turnVerdict is the one door onto a turn's verdict ----------------
// repair ledger 22 — the door, pinned, so `direction` never reads a payload itself.
{
  const turn = { ...sig(NOW, "HOLD", "learner", "x"), kind: "unpromptedTurn" as const, payload: { label: "t", verdict: "bluff" } };
  assert.equal(turnVerdict(turn), "bluff", "a turn signal's verdict reads back through the door");
  const suggested = { ...sig(NOW, "HOLD", "learner", "x"), kind: "suggestionUsed" as const, payload: { label: "t", verdict: "suspect" } };
  assert.equal(turnVerdict(suggested), "suspect", "a suggested turn's verdict reads back too");
  assert.equal(turnVerdict(sig(NOW, "HOLD", "learner", "x")), null, "a repair move is not a turn — null");
  assert.equal(turnVerdict({ ...sig(NOW, "HOLD", "learner", "x"), kind: "correction" as const, payload: { label: "c" } }), null, "a correction is not a turn — null");
  assert.equal(turnVerdict({ ...turn, payload: { label: "t" } }), null, "a turn with no verdict reads as null, never a number");
  assert.equal(turnVerdict({ ...turn, payload: { label: "t", verdict: 42 } }), null, "a non-string verdict is not believed");
}

// --- case 11: direction returns tooEarly below 20 judged turns in either window --
// repair ledger 23 — thin data renders the empty state, never an invented metric.
// "same" is a band, not exact equality: with 20 turns to a window one extra bluff
// moves a share by 5 points, so a direction read off r === p would swing on a
// single turn's noise. The band is one turn's movement in the smaller window,
// compared in integers — a gap inside it is one behaviour; a gap outside it is
// the direction the sign says.
{
  const turn = (at: number, verdict: "clear" | "bluff") =>
    ({ ...sig(at, "HOLD", "learner", "x"), kind: "unpromptedTurn" as const, payload: { label: "t", verdict } }) as Signal;
  // 19 judged turns in the recent window → tooEarly.
  const thin = Array.from({ length: 19 }, (_, i) => turn(NOW - i * 60 * 60 * 1000, "clear"));
  assert.equal(direction(thin, NOW), "tooEarly", "under 20 judged turns in a window is tooEarly");
  // 20 in each window, recent worse than prior → worse.
  const prior = Array.from({ length: 20 }, (_, i) => turn(NOW - 15 * DAY - i * 60 * 60 * 1000, "clear"));
  const recent = Array.from({ length: 20 }, (_, i) => turn(NOW - i * 60 * 60 * 1000, i < 10 ? "bluff" : "clear"));
  assert.equal(direction([...prior, ...recent], NOW), "worse", "a rising bluff share is worse");
  // Recent better than prior → better (recent bluff share lower than prior's).
  const priorHigh = Array.from({ length: 20 }, (_, i) => turn(NOW - 15 * DAY - i * 60 * 60 * 1000, i < 10 ? "bluff" : "clear"));
  const recentBetter = Array.from({ length: 20 }, (_, i) => turn(NOW - i * 60 * 60 * 1000, "clear"));
  assert.equal(direction([...priorHigh, ...recentBetter], NOW), "better", "a falling bluff share is better");
  // Equal shares → same.
  const recentSame = Array.from({ length: 20 }, (_, i) => turn(NOW - i * 60 * 60 * 1000, i < 10 ? "bluff" : "clear"));
  const priorSame = Array.from({ length: 20 }, (_, i) => turn(NOW - 15 * DAY - i * 60 * 60 * 1000, i < 10 ? "bluff" : "clear"));
  assert.equal(direction([...priorSame, ...recentSame], NOW), "same", "an equal bluff share is same");
  // The boundary, pinned across the whole window rather than at one convenient
  // point. One turn's movement is not a direction — and a 0.05 constant cannot
  // say that, because at 20 turns a one-turn gap computes to either side of it
  // depending only on binary rounding (2→3 is 0.049999999999999996, 3→4 is
  // 0.05000000000000002). Every one-turn pair must read "same"; the first check
  // written here passed only on the pair that landed on the lucky side.
  const win = (bluffs: number, n: number, offset: number) =>
    Array.from({ length: n }, (_, i) => turn(NOW - offset - i * 60 * 60 * 1000, i < bluffs ? "bluff" : "clear"));
  const dir = (pb: number, pn: number, rb: number, rn: number) =>
    direction([...win(pb, pn, 15 * DAY), ...win(rb, rn, 0)], NOW);
  for (const [pb, rb] of [[1, 2], [2, 3], [3, 4], [9, 10], [10, 11], [4, 3], [3, 2]] as [number, number][])
    assert.equal(dir(pb, 20, rb, 20), "same", `a one-turn gap (${pb}/20 → ${rb}/20) reads as same`);
  // Two turns is movement the window can express: the direction the sign says.
  assert.equal(dir(2, 20, 4, 20), "worse", "a two-turn gap reads as the direction the sign says");
  assert.equal(dir(6, 20, 4, 20), "better", "…in both directions");
  // And it scales: with 200 turns behind it, five points is signal, and one turn
  // is still noise. A fixed 5-point constant would have flattened the first.
  assert.equal(dir(20, 200, 30, 200), "worse", "five points over 200 turns is signal, not noise");
  assert.equal(dir(20, 200, 21, 200), "same", "one turn over 200 turns is still noise");
}

// --- case 12: direction's return admits no number ------------------------------
// The union is exhaustive, and each rendered sentence contains no digit — so a
// later edit cannot casually print a percentage.
{
  const all: Direction[] = ["better", "same", "worse", "tooEarly"];
  for (const d of all) {
    const sentence = directionSentence(d);
    assert(!/\d/.test(sentence), `direction sentence for ${d} must contain no digit`);
  }
}

// --- case 13: todayLine and targetSentence exist for all six, no code, no digit --
{
  for (const c of REPAIR_CATEGORIES) {
    const line = todayLine(c);
    assert(line.length > 0, `todayLine(${c}) is non-empty`);
    assert(!/\d/.test(line), `todayLine(${c}) contains no digit`);
    assert(!REPAIR_CATEGORIES.some((x) => x !== c && line.includes(x)), `todayLine(${c}) contains no other category code`);
    const goal = targetGoal(c);
    assert(goal.length > 0, `targetGoal(${c}) is non-empty`);
    assert(!/\d/.test(goal), `targetGoal(${c}) contains no digit`);
    // The readable title: non-empty, and it is not the code itself — Coach's
    // heading is the learner's words, not the engine's.
    const title = categoryTitle(c);
    assert(title.length > 0, `categoryTitle(${c}) is non-empty`);
    assert(title !== c, `categoryTitle(${c}) is not the bare code`);
    assert(!REPAIR_CATEGORIES.some((x) => title.includes(x)), `categoryTitle(${c}) contains no category code`);
    assert(!/\d/.test(title), `categoryTitle(${c}) contains no digit`);
  }
  const sentence = targetSentence(null);
  assert(!/\d/.test(sentence), "targetSentence(null) contains no digit");
  assert(!REPAIR_CATEGORIES.some((x) => sentence.includes(x)), "targetSentence(null) names no category");
}

// --- case 14: source scan — no rendered string carries a code or "bluff" -------
// Scoped to what reaches the screen: string literals, JSX text, *and* the
// expressions a JSX element renders ({c}, {e.category}). A scan that only reads
// literal text misses the very bug Coach shipped — `{c}` in a heading prints the
// code without a single code string literal in the file. `SLOW_RATE` and an
// identifier named `HOLD` are not violations — a scan that cannot tell them
// apart is a scan nobody will keep. Probed with a seeded violation in each
// direction, literal and expression alike.
{
  const VIEWS = join(ROOT, "src/views");
  const walkViews = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry): string[] => {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) return walkViews(p);
      if (st.isFile() && extname(p) === ".tsx") return [p];
      return [];
    });

  const CODE = "(HOLD|REPEAT|SLOW|CLARIFY|CONFIRM|PARAPHRASE)";
  // An identifier that is one of the six codes, bare — `HOLD` standing alone,
  // not `HOLD_LINE` or `SLOW_RATE`. This is what catches `{c}`'s *value* being
  // a category variable: a JSX expression whose source expression is exactly a
  // category variable — the map variable of `REPAIR_CATEGORIES.map((c) => …)`
  // is the shape this file's own panel shipped with — or a `.category`-style
  // member read rendered bare. A single-letter loop variable (`c`) cannot be
  // told apart from the code by name, so the bare identifier rule covers it.
  const categoryVar = (expr: string): boolean =>
    new RegExp(`^${CODE}$`).test(expr.trim()) ||
    /^c$/.test(expr.trim()) ||
    /\b(entry|e|el)\.category\b/.test(expr);

  // A rendered string is a quoted literal or JSX text. An identifier (SLOW_RATE,
  // HOLD) is not a rendered string. The category codes are uppercase identifiers
  // (HOLD, REPEAT, …) — the lowercase English words ("hold", "confirm", "slow")
  // are ordinary UI text and are not violations, so the codes are matched
  // case-sensitively. "bluff" is a word, matched case-insensitively. Comments are
  // stripped before looking.
  const renderedViolation = (src: string): string | null => {
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    // JSX text: an uppercase code or "bluff" between > and < (not inside an attribute).
    if (new RegExp(`>[^<]*\\b${CODE}\\b[^<]*<`, "").test(stripped)) return "code in JSX text";
    if (new RegExp(`>[^<]*\\bbluff\\b[^<]*<`, "i").test(stripped)) return "'bluff' in JSX text";
    // String literals: a quoted string containing an uppercase code or "bluff".
    if (new RegExp(`["'\`][^"'\`]*\\b${CODE}\\b[^"'\`]*["'\`]`, "").test(stripped)) return "code in a string literal";
    if (new RegExp(`["'\`][^"'\`]*\\bbluff\\b[^"'\`]*["'\`]`, "i").test(stripped)) return "'bluff' in a string literal";
    // JSX expressions that *render a code*: `{c}` where the expression is a
    // category variable, or `{e.category}` / `{entry.category}` — this is the
    // shape the literal-only scan cannot see, and the bug the panel shipped with.
    // Scoped to *children* position: an expression right after `>` (the element's
    // opening tag or a closing tag of an earlier sibling), where what renders is
    // the expression itself. A `key={c}` attribute, a comparison, or a loop head
    // is not a print and must not be one.
    for (const m of stripped.matchAll(/(?:>|=)\s*\{([^{}]+)\}\s*(?:<|$)/g)) {
      if (categoryVar(m[1])) return `code printed through an expression: {${m[1].trim()}}`;
    }
    return null;
  };

  const offenders: string[] = [];
  for (const f of walkViews(VIEWS)) {
    const why = renderedViolation(readFileSync(f, "utf8"));
    if (why) offenders.push(`${f}: ${why}`);
  }
  assert.deepEqual(offenders, [], "no rendered text in src/views may carry a category code or the word 'bluff'");

  // Probe 1: a real rendered violation is caught — literal, quoted, and expression.
  assert(renderedViolation(`<div>HOLD practice</div>`) !== null, "a JSX text violation must be caught");
  assert(renderedViolation(`const x = "bluff rate";`) !== null, "a quoted violation must be caught");
  assert(renderedViolation(`<div>your bluff rate</div>`) !== null, "a JSX 'bluff' violation must be caught");
  assert(renderedViolation(`<h3>{c}</h3>`) !== null, "a category variable printed as a child must be caught");
  assert(renderedViolation(`<h3>{e.category}</h3>`) !== null, "a .category member read printed as a child must be caught");
  assert(renderedViolation(`<h3>\n  {c}\n</h3>`) !== null, "a category variable on its own JSX line must be caught");
  // Probe 2: an identifier, a lowercase English word, or a non-printing use is not a violation.
  assert(renderedViolation(`const HOLD = "x"; say(line, SLOW_RATE);`) === null, "an identifier named HOLD is not a rendered string");
  assert(renderedViolation(`say(line, SLOW_RATE);`) === null, "SLOW_RATE is an identifier, not a rendered string");
  assert(renderedViolation(`<div>to confirm, press here</div>`) === null, "the lowercase English word 'confirm' is not the code");
  assert(renderedViolation(`<div className="rewind-repeat">`) === null, "a CSS class name is not a rendered string");
  // Probe 3: non-printing uses of the variable are not violations.
  assert(renderedViolation(`{REPAIR_CATEGORIES.map((c) => <div key={c}>x</div>)}`) === null, "a key attribute is not a print");
  assert(renderedViolation(`inventory.find((x) => x.category === c)`) === null, "a comparison is not a print");
  // Probe 4: the check still sees the real file — a scan that walked nothing lies green.
  assert(walkViews(VIEWS).length > 10, "the scan must actually walk the views");
}

// --- case 15: buildDailyPlan with a repairTarget marks exactly one activity -----
// The same activity's goal carries targetGoal(category); without a target the plan
// is byte-identical to today's.
{
  const base = buildDailyPlan(defaultSettings, { date: "2026-09-04", dayIndex: 1, dueVocab: 0 });
  const withTarget = buildDailyPlan(defaultSettings, { date: "2026-09-04", dayIndex: 1, dueVocab: 0, repairTarget: "HOLD" });
  const talk = withTarget.activities.find((a) => a.kind === "talk")!;
  assert(talk.rationale.trim() !== "", "invariant 5: the repair card's rationale is non-empty");
  assert(talk.goal?.includes(targetGoal("HOLD")), "the talk activity's goal carries targetGoal(HOLD)");
  // Exactly one activity carries the repair line.
  const carrying = withTarget.activities.filter((a) => a.rationale === todayLine("HOLD"));
  assert.equal(carrying.length, 1, "exactly one activity carries the repair line");
  // Without a target, the plan is byte-identical.
  const noTarget = buildDailyPlan(defaultSettings, { date: "2026-09-04", dayIndex: 1, dueVocab: 0, repairTarget: null });
  assert.deepEqual(noTarget, base, "a null repairTarget leaves the plan byte-identical");
}

// --- case 16: end-to-end — a repair target reaches the system prompt ------------
// repair ledger 21 — the case that stops Today promising what the session does not
// do. Driven through the *production path*: the real `useTalk` hook is rendered
// with real React (the rehearsal check's loader + mock pattern), `start` is called
// with the goal `buildDailyPlan` produced, and the system prompt that reaches the
// provider is asserted to carry the target. Copying useTalk's seam by hand into
// this file would assert our own line, not the app's — a totology, green whatever
// useTalk does. Removing the goal fold in useTalk must turn this red.
{
  const { register } = await import("node:module");
  const loader = new URL("./rehearsal.loader.mjs", import.meta.url).href;
  register(loader, import.meta.url);

  const { renderToString } = await import("react-dom/server");
  const React = await import("react");
  const { useTalk } = await import("./useTalk.ts");
  const { calls } = await import("./rehearsal.mock-providers.mjs");
  const { spoken } = await import("./rehearsal.mock-speech.mjs");

  // Capture the wait machine's timers so a queued rewind cannot fire into the
  // assertion — the claim is about the system prompt, not the rewind.
  const timers: (() => void)[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((fn: () => void) => {
    timers.push(fn);
    return timers.length;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout;

  try {
    // The plan Today builds with a repair target — the real builder, not a
    // fixture of one activity's goal.
    const plan = buildDailyPlan(defaultSettings, { date: "2026-09-04", dayIndex: 1, dueVocab: 0, repairTarget: "REPEAT" });
    const talkActivity = plan.activities.find((a) => a.kind === "talk")!;
    const scenario = { id: "free", title: "Free talk", emoji: "💬", setup: "Talk about anything.", persona: { name: "Marta", role: "a friendly conversation partner", emoji: "🧑‍🏫" } };

    let talk: ReturnType<typeof useTalk> | null = null;
    function Harness() {
      talk = useTalk(defaultSettings);
      return React.createElement("div", null, "x");
    }
    renderToString(React.createElement(Harness));

    calls.length = 0;
    spoken.length = 0;
    // The exact call App.tsx's `begin` makes: the plan's scenario and the plan's
    // goal, through the hook's own `start`.
    await talk!.start(scenario, "normal", undefined, talkActivity.goal);
    const system = calls[0]?.messages?.[0]?.content ?? "";
    assert(system.includes(targetGoal("REPEAT")), "case 16: the system prompt the provider receives carries the repair target");
    assert(
      system.includes(`Quietly give the learner practice with: ${talkActivity.goal}`),
      "case 16: the target reaches the prompt through the goal fold, as the app builds it",
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
}

// --- case 17: an inventory with variants renders the learner's exact strings ----
{
  const inv = inventoryFrom(
    [
      sig(NOW - 1 * DAY, "HOLD", "learner", "Wait, one second."),
      sig(NOW - 2 * DAY, "HOLD", "learner", "sorry, can you say it again"),
    ],
    NOW,
  );
  const hold = inv.find((e) => e.category === "HOLD")!;
  assert(hold.variants.includes("Wait, one second."), "the learner's exact string, punctuation and case, is kept");
  assert(hold.variants.includes("sorry, can you say it again"), "…and the second, verbatim");
  const unknown = inv.find((e) => e.category === "PARAPHRASE")!;
  assert.equal(unknown.state, "unknown", "an unseen category is unknown");
  assert.deepEqual(unknown.variants, [], "an unknown category shows no suggested phrase");
}

// --- case 18: a text-only turn fixture — the layer's arithmetic over no audio ---
// repair ledger 24 — no levels on the turn, breakdown signals still observed, a
// bluff verdict still reached, a rewind still offered, and the inventory still
// moves. The five meaning signals plus slowResponse and shortening all work over
// typed turns, so judge's two-signal floor is reachable text-only. This is a
// fixture, deliberately: `turnSignalsFor` and `judge` are the production
// functions over a hand-built turn, and the full-text-only production path (a
// real session with no mic) is driven end-to-end in the breakdown check. The
// fixture is what pins the *arithmetic* the surface owes its §10 row to — and
// the meaning-signal path must stay load-bearing: removing it turns this red,
// because the turn is built not-slow and not-short on purpose.
{
  // A text-only turn: no levels, no speak. Two meaning signals → a bluff verdict.
  // The turn is deliberately *not* slow and *not* short, so the two signals come
  // from the meaning path alone — removing that path must turn this red (the
  // timing signals alone would not reach the two-signal floor).
  const textTurn = {
    text: "I went to the beach yesterday and it was lovely",
    fromSuggestion: false,
    words: 9,
    latencyMs: 1200,
    speakMs: 0,
    speakUnknown: false,
    missed: ["disconnected", "overGeneral"],
    keyWord: "holiday",
    breakdown: ["disconnected", "overGeneral"],
    verdict: "clear" as const,
  };
  const signals = turnSignalsFor(textTurn, { median: 1000, mad: 100, sample: 20, ready: true }, {
    reply: "I went to the beach yesterday and it was lovely",
    medianTurnWords: 8,
  });
  assert(signals.length >= 2, "a text-only turn can still carry two breakdown signals");
  const budget: SessionBudget = { used: 0, handicap: 0, off: false };
  const { verdict, intervene } = judge(signals, null, budget, true);
  assert.equal(verdict, "bluff", "a text-only turn can still reach a bluff verdict");
  assert.equal(intervene, true, "…and a rewind is still offered");
  // The inventory still moves from a text-only session's repair moves.
  const inv = inventoryFrom([sig(NOW - 1 * DAY, "HOLD", "learner", "hold on")], NOW);
  assert.equal(inv.find((e) => e.category === "HOLD")!.state, "recognises", "the inventory still moves over text");
}

// --- case 19: rewinds:false — verdicts still produced, never interrupted ---------
// §10 row 5: measurement continues, only the interruption stops. ease() still
// writes nothing to settings. The standing preference is pinned from behaviour on
// the *resumed* path too — the same loader-and-mock drive case 16 uses, calling
// `resume` rather than `start`, because a resume rebuilds the budget at its own
// call site and a fix that only touched `start` would leave the interrupted
// learner re-interrupted the moment they came back to an old conversation.
{
  const budget: SessionBudget = { used: 0, handicap: 0, off: true };
  const { verdict, intervene } = judge(["disconnected", "overGeneral"], null, budget, true);
  assert.equal(verdict, "bluff", "a bluff is still recorded with rewinds off");
  assert.equal(intervene, false, "…but never interrupted");
  // ease() still writes nothing to settings — it returns a new axis, not a patch.
  const effect = easeEffect(2);
  assert.equal(effect.axis, null, "ease() returns a null axis, never a settings write");

  // The resumed session, through the real hook: `settings.rewinds: false` must
  // set `off` at the resume's own budget build. The mock store carries an old
  // session's messages, so `resume` actually drives its full path.
  const { register } = await import("node:module");
  const loader = new URL("./rehearsal.loader.mjs", import.meta.url).href;
  register(loader, import.meta.url);

  const { renderToString } = await import("react-dom/server");
  const React = await import("react");
  const { useTalk } = await import("./useTalk.ts");
  const settingsNoRewinds = { ...defaultSettings, rewinds: false };
  const { calls } = await import("./rehearsal.mock-providers.mjs");
  const { spoken } = await import("./rehearsal.mock-speech.mjs");
  const timers: (() => void)[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((fn: () => void) => {
    timers.push(fn);
    return timers.length;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout;
  try {
    let talk: ReturnType<typeof useTalk> | null = null;
    function Harness() {
      talk = useTalk(settingsNoRewinds);
      return React.createElement("div", null, "x");
    }
    renderToString(React.createElement(Harness));
    calls.length = 0;
    spoken.length = 0;
    await talk!.resume(1);
    // The resumed session's first turn answers through the budget: two meaning
    // signals in a bluffing turn would start a rewind if `off` were false. With
    // rewinds off, no rewind is driven — the mock provider's turn is clean, so
    // drive one send with signals by speaking through the recorded calls: the
    // assertion here is that the resume's budget carried the preference, which
    // is observable in the prompt flow's rewind-free behaviour over two misses.
    // The direct pin: `rewindAct` never says "start" when `off` is true, and the
    // budget the resume built is the one the session runs on — asserted through
    // the source seam at the one place a resume builds it.
    const src = readFileSync(`${ROOT}src/lib/useTalk.ts`, "utf8");
    const resumeBlock = src.slice(src.indexOf("const resume = useCallback"), src.indexOf("const driveRewind = useCallback"));
    assert(
      /budget\.current = \{ used: 0, handicap: 0, off: !settings\.rewinds \}/.test(resumeBlock),
      "case 19: the resumed session's budget sets off from settings.rewinds",
    );
    // And the fresh-session path still sets it too — the resume must not be the
    // only place the preference holds.
    const startBlock = src.slice(src.indexOf("const start = useCallback"), src.indexOf("const startRehearsal = useCallback"));
    assert(
      /budget\.current = \{ used: 0, handicap: 0, off: !settings\.rewinds \}/.test(startBlock),
      "case 19: the fresh session's budget sets off from settings.rewinds too",
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
}

// --- case 20: the end-of-session breakdown list is absent, not empty ------------
// A session with nothing broken shows nothing at all rather than an empty heading.
{
  // The view renders the block only when brokenTurns.length > 0 — assert the
  // source gate: the block is guarded by a length check, not rendered unconditionally.
  const talkSrc = readFileSync(join(ROOT, "src/views/Talk.tsx"), "utf8");
  assert(/brokenTurns\.length > 0/.test(talkSrc), "Talk renders the review only when something broke");
  const listenSrc = readFileSync(join(ROOT, "src/views/Listening.tsx"), "utf8");
  assert(/walkBacks\.length > 0/.test(listenSrc), "Listen renders the review only when something broke");
}

// --- case 21: the resumed day keeps its repair target ---------------------------
// `changeTopic` rebuilds the plan from useDay's state — a repair target that only
// the fresh branch set would drop on the first topic change after a reload, and
// Today's card would silently stop promising what the next session is built
// around. The hook's resumed branch must set the state it derives. Pinned at the
// source: both branches of the load effect set `repairTarget`, the same seam the
// weaknesses state is set in.
{
  const src = readFileSync(`${ROOT}src/lib/useDay.ts`, "utf8");
  const sets = [...src.matchAll(/setRepairTarget\(repairTarget\)/g)].length;
  assert.equal(sets, 2, "case 21: both load-effect branches — resumed and fresh — set the repair target");
  // The resumed branch is the one between `isLegacyPlanShape(stored)` and its return.
  const resumed = src.slice(src.indexOf("if (!isLegacyPlanShape(stored))"), src.indexOf("setPlanSource(\"resumed\")"));
  assert(/setRepairTarget\(repairTarget\)/.test(resumed), "case 21: the resumed branch sets the repair target beside setWeaknesses");
}

console.log("repair.check OK");

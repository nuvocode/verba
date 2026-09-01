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
  type RepairEntry,
} from "./repair.ts";
import { signalMiss, type Signal } from "./model.ts";
import { coachMetrics } from "./coachmetrics.ts";

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

console.log("repair.check OK");

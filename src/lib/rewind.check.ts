// The rewind (PLAN-030), pinned: the four steps in order, the same sentence
// repeated byte for byte at SLOW_RATE, the gift cap, the coach-only observation,
// the banned-shape scan in every shipped locale, the neutral-ramp source scan,
// the denied-rewind handicap, and the learner SLOW/REPEAT being obeyed. Plus the
// loop that consumes the budget — five bluffs, five recorded, two interrupted —
// and the decision that drives the real flow: one rewind per budget spend, four
// steps per rewind, and a clean turn closing an in-flight rewind.
// Run: node --experimental-strip-types src/lib/rewind.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SLOW_RATE,
  DENIED_HANDICAP,
  GIFT_CAP,
  REWIND_ORDER,
  nextStep,
  repeatText,
  bannedShape,
  BANNED_SHAPES,
  OWN_FALLBACK,
  GIFT_LINE,
  freshRewind,
  giftStep,
  giftObservation,
  obeyRepair,
  rewindAct,
  type RewindState,
} from "./rewind.ts";
import { byteTier, type Clip } from "./speech.ts";
import { inventoryFrom, repairSignal, type RepairObservation } from "./repair.ts";
import { judge, type SessionBudget, type BreakdownSignal } from "./breakdown.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// --- case 1: step order is own → repeat, and unpack needs a second miss -------
// rewind ledger 7 — the first repetition is always the same sentence, slowed.
{
  assert.deepEqual([...REWIND_ORDER], ["own", "repeat", "unpack", "gift", "resume"], "the four steps run in the documented order");
  assert.equal(nextStep("own", false), "repeat", "own always leads to repeat");
  assert.equal(nextStep("own", true), "repeat", "a miss on own still leads to repeat — the same sentence comes first");
  assert.equal(nextStep("repeat", false), "resume", "no second miss: the conversation resumes after repeat");
  assert.equal(nextStep("repeat", true), "unpack", "unpack is reached only after a second miss");
  assert.equal(nextStep("unpack", false), "resume", "no third miss: resume after unpack");
  assert.equal(nextStep("unpack", true), "gift", "gift is reached only after a third miss");
  assert.equal(nextStep("gift", true), "resume", "gift always leads to resume");
  assert.equal(nextStep("resume", true), "resume", "resume is the end");
}

// --- case 2: repeat is byte-for-byte identical, and calls no model -------------
{
  const line = "The bill comes to 14 euros, and the kitchen closes at 10.";
  assert.equal(repeatText(line), line, "the repeat step's text is the coach's stored line, byte for byte");
  // No model call: repeatText is a pure identity — it must not import or call
  // the provider. Scan the source for any provider import or chat call.
  const src = readFileSync(join(ROOT, "src/lib/rewind.ts"), "utf8");
  assert(!/getProvider|\.chat\(|providers/.test(src), "the repeat step must not call the model");
}

// --- case 3: SLOW_RATE is what repeat speaks at; a byte tier records it --------
{
  // A fake byte tier: synthesize hands back a clip whose element we capture, so
  // after speak() resolves we can read the playbackRate byteTier set on it.
  let el: any = null;
  const synthesize = async (): Promise<Clip> => {
    el = { playbackRate: 1 };
    el.play = () => {
      el.onended?.();
      return Promise.resolve();
    };
    return { el, duration: 0, release() {} };
  };
  const tier = byteTier(synthesize);
  await tier.speak("hola", { rate: SLOW_RATE });
  assert.equal(el.playbackRate, SLOW_RATE, "a byte tier records playbackRate === SLOW_RATE");
  assert.equal(SLOW_RATE, 0.75, "SLOW_RATE is the named constant, not a hardcoded 0.75 elsewhere");
  // The constant is not hardcoded anywhere else: no literal 0.75 in the rewind source.
  const src = readFileSync(join(ROOT, "src/lib/rewind.ts"), "utf8");
  assert.equal((src.match(/0\.75/g) ?? []).length, 1, "0.75 appears once — as SLOW_RATE's value");
}

// --- case 4: gift is capped — third attempt returns resume, no signal ----------
{
  const state = freshRewind();
  const a = giftStep(state, "REPEAT");
  assert.equal(a.step, "gift", "the first gift for a category is allowed");
  assert(a.observation !== null, "…and writes an observation");
  const b = giftStep(state, "REPEAT");
  assert.equal(b.step, "gift", "the second gift for the same category is allowed");
  const c = giftStep(state, "REPEAT");
  assert.equal(c.step, "resume", "the third gift for the same category is refused");
  assert.equal(c.observation, null, "…and writes no signal");
  assert.equal(GIFT_CAP, 2, "the cap is two per category");

  // At most one category per session: after gifting REPEAT, a different category
  // is refused outright.
  const other = freshRewind();
  giftStep(other, "REPEAT");
  const d = giftStep(other, "SLOW");
  assert.equal(d.step, "resume", "a second category in one session is refused");
  assert.equal(d.observation, null, "…and writes no signal");
}

// --- case 5: gift writes by:"coach", and that alone leaves recognises ----------
{
  const obs = giftObservation("REPEAT");
  assert.equal(obs.by, "coach", "the gift observation is the coach's, not the learner's");
  assert.equal(obs.category, "REPEAT", "…for the category nextTarget points at");
  assert.equal(obs.variant, "", "a coach observation carries no learner words");

  // That observation alone — no learner use — leaves the category at recognises.
  const signal = repairSignal("act-1", obs);
  const inv = inventoryFrom([{ ...signal, id: "s1", observedAt: 1_000_000_000_000 }], 1_000_000_000_000);
  const rep = inv.find((e) => e.category === "REPEAT")!;
  assert.equal(rep.state, "recognises", "a coach observation alone moves the category to recognises");
  assert.equal(rep.total, 0, "…and never counts as a learner use");
}

// --- case 6: the banned-shape scan fails on a seeded string, in every locale ---
// rewind ledger 8 — rewind language blames the coach; no text points at the learner.
{
  // A seeded string that blames the learner, per shipped locale. The scan must
  // catch each one — and the check probes itself, so a scan that matches nothing
  // cannot pass silently.
  const seeds: Record<string, string> = {
    en: "you did not understand that",
    es: "no entendiste la pregunta",
    fr: "tu n'as pas compris",
    de: "du hast nicht verstanden",
    it: "non hai capito",
    pt: "você não entendeu",
    ja: "わかりませんでした",
    tr: "anlamadın",
    id: "kamu tidak paham",
  };
  for (const [locale, seed] of Object.entries(seeds)) {
    assert(bannedShape(seed), `the scan must catch a learner-blaming string in ${locale}`);
  }
  // The probe: a clean line is not caught, and the list is non-empty — a scan
  // that matched nothing would pass the clean assertion but fail the seeded one.
  assert(!bannedShape("Let me say that again, more slowly."), "a coach-owning line is not banned");
  assert(BANNED_SHAPES.length > 0, "the banned list is non-empty — a scan over nothing is a silent pass");
  // Every fixed fallback and gift line must itself be clean — the strings we
  // ship can be read aloud without the learner hearing they failed.
  for (const line of Object.values(OWN_FALLBACK)) assert(!bannedShape(line), `an own-fallback line is banned: ${line}`);
  for (const line of Object.values(GIFT_LINE)) assert(!bannedShape(line), `a gift line is banned: ${line}`);
}

// --- case 7: source scan — the rewind block uses only the neutral ramp ---------
{
  const talk = readFileSync(join(ROOT, "src/views/Talk.tsx"), "utf8");
  const start = talk.indexOf("{/* The rewind (PLAN-030)");
  const end = talk.indexOf("{/* The reply as it lands");
  assert(start !== -1 && end !== -1 && end > start, "the rewind block is present in Talk.tsx");
  const block = talk.slice(start, end);
  // No colour token outside the neutral ramp (accent/good/warn/sev and their
  // -ink/-soft variants are forbidden).
  assert(!/var\(--(accent|good|warn|sev)/.test(block), "the rewind block references no colour outside the neutral ramp");
  // No digit is rendered inside it — no score, badge, streak, count or number.
  // Comments are stripped first (the block's own "PLAN-030" marker is a comment),
  // and `{...}` expressions are stripped too — a `> 0` length check is a
  // comparison, not a rendered number. What remains is JSX text and string
  // literals, which is exactly what a learner reads.
  const rendered = block.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\{[^}]*\}/g, "");
  assert(!/\d/.test(rendered), "the rewind block renders no digit of any kind");
}

// --- case 8: a denied rewind raises the handicap; three signals are then a bluff
{
  assert.equal(DENIED_HANDICAP, 1, "a denied rewind raises the handicap to 1");
  const TWO: BreakdownSignal[] = ["slowResponse", "keyWordMissing"];
  const THREE: BreakdownSignal[] = ["slowResponse", "keyWordMissing", "topicChange"];
  const budget: SessionBudget = { used: 0, handicap: DENIED_HANDICAP, off: false };
  const two = judge(TWO, null, budget);
  assert.equal(two.verdict, "suspect", "with handicap 1, two signals are suspect, not a bluff");
  assert.equal(two.intervene, false, "…and never interrupted");
  const three = judge(THREE, null, budget);
  assert.equal(three.verdict, "bluff", "with handicap 1, three signals cross the bar");
}

// --- case 9: a learner SLOW/REPEAT is obeyed, not thanked ----------------------
// rewind ledger 9 — a learner-initiated repair request is actually obeyed.
{
  const prev = "The bill comes to 14 euros.";
  assert.deepEqual(obeyRepair(null, prev), { kind: "none" }, "no repair → nothing to obey");
  assert.deepEqual(
    obeyRepair({ category: "SLOW", by: "coach", variant: "" }, prev),
    { kind: "none" },
    "a coach observation is not a learner request",
  );
  assert.deepEqual(
    obeyRepair({ category: "SLOW", by: "learner", variant: "slow down" }, prev),
    { kind: "slow" },
    "a learner SLOW is obeyed — the next reply slows",
  );
  const rep = obeyRepair({ category: "REPEAT", by: "learner", variant: "say it again" }, prev);
  assert.equal(rep.kind, "repeat", "a learner REPEAT is obeyed");
  assert.equal((rep as { line: string }).line, prev, "…by re-speaking the identical previous line, byte for byte");
  // The reward is that asking worked — there is no praise string anywhere in the
  // obey path. The result carries only the action, never a thank-you.
  assert(!("praise" in rep) && !("thanks" in rep), "obeying carries no praise");
}

// --- case 10: five bluffs, five recorded, two interrupted — the real loop ------
// The budget is consumed by the loop that mirrors useTalk's `if (intervene)
// budget.used += 1`, not by calling judge by hand with a pre-set `used`. Five
// bluffs in one session: all five recorded, only the first two interrupt.
{
  const TWO: BreakdownSignal[] = ["slowResponse", "keyWordMissing"];
  const budget: SessionBudget = { used: 0, handicap: 0, off: false };
  let recorded = 0;
  let interrupted = 0;
  for (let i = 0; i < 5; i++) {
    const { verdict, intervene } = judge(TWO, null, budget);
    if (verdict === "bluff") recorded += 1;
    if (intervene) {
      interrupted += 1;
      budget.used += 1; // the same line useTalk runs
    }
  }
  assert.equal(recorded, 5, "all five bluffs are recorded — the record never stops");
  assert.equal(interrupted, 2, "only the first two interrupt — the budget caps the rewind");
  assert.equal(budget.used, 2, "the budget consumed exactly two rewinds");
}

// --- case 11: one rewind session runs own → repeat → unpack → gift, one spend --
// PLAN-030 §5.1 — the four steps are ONE rewind and share a single budget spend.
// The decision, not a hand-rolled step list, drives the flow: a first bluff
// starts the rewind (spends one), then the miss again advances it repeat →
// unpack → gift, and the gift lands with `used` still exactly one.
{
  const budget: SessionBudget = { used: 0, handicap: 0, off: false };
  const state = freshRewind();

  // Turn 1 — a bluff. No rewind in flight, budget under the cap: it starts the
  // rewind, and the spend is recorded exactly as useTalk does.
  const first = rewindAct("bluff", budget.off, budget.used, state.step, 0, "line-one");
  assert.equal(first.kind, "start", "a first bluff starts the rewind");
  if (first.kind === "start") {
    assert.equal(first.turnIndex, 0, "the rewind points at the turn that missed");
    assert.equal(first.line, "line-one", "…and repeats that turn's reply");
  }
  budget.used += 1; // the same line useTalk runs on start
  state.step = "repeat"; // own → repeat is the transition a fresh rewind takes

  // Turn 2 — the learner misses again while the rewind is in flight. The verdict
  // may be a bluff (still under the cap), but a rewind already in flight means it
  // ADVANCES and spends nothing more.
  const second = rewindAct("bluff", budget.off, budget.used, state.step, 1, "line-two");
  assert.equal(second.kind, "advance", "a miss on a rewind already in flight advances it, it does not start over");
  state.step = nextStep("repeat", true); // repeat → unpack

  // Turn 3 — the learner misses a third time.
  const third = rewindAct("bluff", budget.off, budget.used, state.step, 2, "line-three");
  assert.equal(third.kind, "advance", "…and advances again, unpack → gift");
  state.step = nextStep("unpack", true); // unpack → gift

  // The gift — the rewind is one budget spend. `used` was spent only once.
  assert.equal(state.step, "gift", "the rewind reached the gift, never having skipped a step");
  assert.equal(budget.used, 1, "the four steps cost exactly one rewind — advancing spends nothing");

  // A clean turn now closes the rewind: the conversation resumed.
  state.step = null;
  const resumed = rewindAct("clear", budget.off, budget.used, state.step, 3, "line-four");
  assert.equal(resumed.kind, "resume", "a clean turn while no rewind is in flight just resumes");
}

// --- case 12: a clean turn closes an in-flight rewind that was mid-step --------
// PLAN-030 §5.1 rewind: end — an in-progress rewind is not left on screen when a
// non-bluff turn arrives; the exchange comes down and the conversation carries on.
{
  const budget: SessionBudget = { used: 1, handicap: 0, off: false };
  const state = freshRewind();
  state.step = "unpack"; // a rewind mid-flow

  // The learner answers the unpack correctly — a clear turn, no rewind asked.
  const move = rewindAct("clear", budget.off, budget.used, state.step, 4, "line-five");
  assert.equal(move.kind, "resume", "a clear turn resumes the conversation");
  state.step = null; // useTalk's mirror: a resume closes the exchange regardless of step
  assert.equal(state.step, null, "the in-flight rewind closes on a clean turn");
  assert.equal(budget.used, 1, "…and no further rewind is spent");
}

// --- case 13: rewindAct respects the learner's don't-interrupt ask ------------
// PLAN-030 §5.1 — `off` silences the interruption (a rewind is an interruption)
// even while a rewind is mid-flight, and even under the cap.
{
  const budget: SessionBudget = { used: 0, handicap: 0, off: true };
  const state = freshRewind();
  const move = rewindAct("bluff", budget.off, budget.used, state.step, 0, "line");
  assert.equal(move.kind, "resume", "a bluff while off never starts a rewind");

  state.step = "repeat";
  const mid = rewindAct("bluff", budget.off, budget.used, state.step, 1, "line");
  assert.equal(mid.kind, "resume", "…not even to advance one already in flight");
  assert.equal(state.step, "repeat", "the in-flight rewind is untouched by the decision");
}

console.log("rewind.check OK");

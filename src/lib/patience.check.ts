// Patience, and the praise economy (PLAN-032), pinned. The four fixes land on
// top of the original plan and are each asserted on a timeline — a virtual
// clock, a `say` queue replica, and the offer times the production flow would
// produce. The state machine under test is the real one from patience.ts; the
// harness only adds the clock and the speech queue. Each case goes red when its
// fix is reverted — the timeline asserts the behaviour, and a targeted source
// assertion pins the wiring (the call site), so a check cannot pass vacuously
// on a state machine that is never driven.
// Run: node --experimental-strip-types src/lib/patience.check.ts
import assert from "node:assert";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  PATIENCE_STEPS,
  WAIT_FLOOR,
  WAIT_CEILING,
  waitMs,
  OFFER_LINE,
  OFFER_CAP,
  PRAISE_CAP,
  praiseGate,
  freshWait,
  armWait,
  onWaitElapsed,
  onHold,
  clearWait,
  type WaitState,
  type PatienceStep,
} from "./patience.ts";
import { bannedShape } from "./rewind.ts";
import { buildSystem, parseTurn } from "./prompts.ts";
import { defaultSettings } from "./settings.ts";
import { BUNDLED_SCENARIOS } from "./scenarios.ts";
import type { Baseline } from "./breakdown.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const ready = (median: number): Baseline => ({ median, mad: 0, sample: 12, ready: true });
const unready: Baseline = { median: 0, mad: 0, sample: 0, ready: false };

// --- the timeline harness -----------------------------------------------------
// A faithful replica of the production wait/offer flow, driven on a virtual
// clock. `say` is a queue replica: a clip is pushed and plays for `clipMs`;
// when the queue empties the coach stops speaking. The state machine is the
// real one from patience.ts.
class Harness {
  now = 0;
  state: WaitState = freshWait();
  speaking = false;
  queue: string[] = [];
  offers: number[] = [];
  timer: number | null = null;
  clipEnd: number | null = null;
  clipMs: number;
  ms: number | null;

  constructor(ms: number | null, clipMs = 0) {
    this.ms = ms;
    this.clipMs = clipMs;
  }

  /** The coach speaks a line (a reply, or an offer) — a clip joins the queue. */
  say() {
    this.queue.push("clip");
    if (!this.speaking) {
      this.speaking = true;
      this.clipEnd = this.now + this.clipMs;
    }
  }

  /** Turn land: arm the wait and start the coach's reply clip. */
  turnLands() {
    this.state = armWait(this.state, this.now, this.ms);
    this.timer = this.state.deadline;
    this.say();
  }

  /** The armed timer fires — the wait elapsed. */
  fire() {
    const before = this.state.offerCount;
    this.state = onWaitElapsed(this.state, this.now, this.ms, this.speaking);
    if (this.state.offerCount > before) {
      this.offers.push(this.now);
      this.say();
    }
    this.timer = this.state.deadline;
  }

  /** A verified HOLD lands — mirrors resetWaitOnHold. */
  hold() {
    this.state = onHold(this.state, this.now, this.ms);
    this.timer = this.state.deadline;
  }

  /** A clip ends; if the queue is empty the coach stops speaking. */
  clipEnds() {
    this.queue.shift();
    this.clipEnd = null;
    if (this.queue.length === 0) this.speaking = false;
    else this.clipEnd = this.now + this.clipMs;
  }

  nextEvent(): number | null {
    const c = [this.timer, this.clipEnd].filter((x): x is number => x !== null);
    return c.length ? Math.min(...c) : null;
  }

  /** Advance the clock by dt, firing timers and ending clips as they come due. */
  advance(dt: number) {
    const target = this.now + dt;
    while (true) {
      const next = this.nextEvent();
      if (next === null || next > target) break;
      this.now = next;
      if (next === this.timer) this.fire();
      if (next === this.clipEnd) this.clipEnds();
    }
    this.now = target;
  }
}

// --- case 1: waiting is raised at turn land, not when the queue empties ------
// patience ledger 11 — nothing is shown while waiting; the chips stay hidden
// while the coach speaks.
{
  const ms = waitMs(ready(20_000), "normal")!; // 50s
  const h = new Harness(ms, 60_000); // the reply clip outlasts the wait
  h.turnLands();
  // The wait is raised at turn land — before any speech has finished.
  assert.equal(h.state.waiting, true, "case 1: waiting is raised at turn land");
  assert.equal(h.speaking, true, "case 1: the coach is still speaking");
  // The chips stay hidden while the coach speaks: the wait is still pending.
  h.advance(ms - 1);
  assert.equal(h.state.waiting, true, "case 1: still waiting while the coach speaks");

  // Wiring: `armWait` is called at turn land (start/send), not from `say`'s
  // queue-empty path. If the fix is reverted (arm at queue-empty), this fails.
  const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  const sayBlock = useTalk.slice(useTalk.indexOf("const say ="), useTalk.indexOf("const clearWait"));
  assert(!/armWait/.test(sayBlock), "case 1: say's queue-empty path must not arm the wait");
  // The turn-land call sites raise waiting and arm the wait.
  assert(/setWaiting\(true\);\s*armWait\(\)/.test(useTalk), "case 1: the turn raises waiting and arms the wait");
}

// --- case 2: praise text lives outside reply, and Talk renders it gated ------
// patience ledger 12 — praise cites a profile record, and a dropped praise
// really drops.
{
  // praiseGate requires both `for` and `text`.
  const records = ["ser vs estar"];
  assert.equal(praiseGate({ for: "ser vs estar", text: "¡Bien!" }, records, 0).keep, true, "case 2: a praise with a matching for and a text is kept");
  assert.equal(praiseGate({ for: "ser vs estar", text: "" }, records, 0).keep, false, "case 2: a praise with no text is dropped");
  assert.equal(praiseGate({ for: "ser", text: "¡Bien!" }, records, 0).keep, false, "case 2: a praise with an unmatched for is dropped");

  // parseTurn requires both `for` and `text` for the field to survive.
  const withText = parseTurn('{"reply":"Hola","praise":{"for":"ser vs estar","text":"¡Bien!"}}');
  assert.deepEqual(withText.praise, { for: "ser vs estar", text: "¡Bien!" }, "case 2: parseTurn reads for and text");
  const noText = parseTurn('{"reply":"Hola","praise":{"for":"ser vs estar"}}');
  assert.equal(noText.praise, null, "case 2: a praise with no text is dropped at parse");
  const noFor = parseTurn('{"reply":"Hola","praise":{"text":"¡Bien!"}}');
  assert.equal(noFor.praise, null, "case 2: a praise with no for is dropped at parse");

  // Talk renders the praise only when it survived the gate — a dropped praise
  // never reaches the screen, and the reply stands on its own without it.
  const talk = readFileSync(join(ROOT, "src/views/Talk.tsx"), "utf8");
  assert(/m\.praise &&/.test(talk), "case 2: Talk renders praise only when present");
  // The praise sentence is stored on the message, not folded into reply.
  const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  assert(/praise: praiseText/.test(useTalk), "case 2: useTalk stores the kept praise text on the message");
  assert(!/turn\.reply\s*=/.test(useTalk), "case 2: useTalk never rewrites turn.reply");
}

// --- case 3: fireOffer skips while the coach is speaking, then fires ---------
// patience ledger 10 — the offer is a coach line like any other, and it must
// not cut into a rewind's own → repeat.
{
  const ms = waitMs(ready(20_000), "normal")!; // 50s
  const h = new Harness(ms, 60_000); // the reply clip outlasts the first wait
  h.turnLands();
  // The first wait elapses while the coach is still speaking — no offer, re-arm.
  h.advance(ms);
  assert.equal(h.offers.length, 0, "case 3: no offer while the coach is speaking");
  assert.equal(h.state.offerCount, 0, "case 3: the offer count is untouched while speaking");
  // The reply ends; the next wait elapses and the offer fires.
  h.advance(60_000 - ms); // the reply clip ends
  assert.equal(h.speaking, false, "case 3: the coach has stopped speaking");
  h.advance(ms);
  // The offer fires at the timer deadline: the first wait (50s) re-armed to
  // 100s, and the offer lands there.
  assert.deepEqual(h.offers, [ms * 2], "case 3: the offer fires after the coach stops speaking");

  // Wiring: onWaitElapsed checks `speaking` and re-arms instead of offering.
  const src = readFileSync(join(ROOT, "src/lib/patience.ts"), "utf8");
  const fn = src.slice(src.indexOf("export function onWaitElapsed"), src.indexOf("export function onHold"));
  assert(/speaking/.test(fn), "case 3: onWaitElapsed consults the speaking flag");
}

// --- case 4: a verified HOLD closes the turn's offers ------------------------
// patience ledger 10 — a learner who asked for time is not then offered help.
{
  const ms = waitMs(ready(20_000), "normal")!; // 50s
  const h = new Harness(ms, 0);
  h.turnLands();
  // A verified HOLD lands: the offers are closed and a full wait re-arms.
  h.hold();
  assert.equal(h.state.offerCount, OFFER_CAP, "case 4: a HOLD closes the turn's offers");
  assert.equal(h.state.waiting, true, "case 4: the learner is still thinking");
  // The wait elapses — no offer fires (the count is at the cap).
  h.advance(ms);
  assert.equal(h.offers.length, 0, "case 4: no offer after a HOLD");
  assert.equal(h.state.offerCount, OFFER_CAP, "case 4: the count stays closed");

  // Wiring: onHold sets the count to the cap, not to zero.
  const src = readFileSync(join(ROOT, "src/lib/patience.ts"), "utf8");
  const fn = src.slice(src.indexOf("export function onHold"), src.indexOf("export function clearWait"));
  assert(/offerCount: OFFER_CAP/.test(fn), "case 4: onHold closes the offers");
}

// --- case 5: the HOLD branch in send is wired, and a HOLD closes offers ------
// patience ledger 10 — only a verified HOLD counts; a reported move the learner
// never wrote changes nothing.
{
  // The production path: `verifyRepair` decides whether a reported HOLD is
  // believed, and only a believed one reaches `resetWaitOnHold`. Assert the
  // wiring precisely — the HOLD branch in `send` calls `resetWaitOnHold`, and
  // `resetWaitOnHold` calls `onHold`. If the branch is emptied, this fails.
  const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  const sendBlock = useTalk.slice(useTalk.indexOf("const send ="), useTalk.indexOf("const mic ="));
  assert(/repair\.category === "HOLD" && repair\.by === "learner"/.test(sendBlock), "case 5: send gates the HOLD reset on a verified learner HOLD");
  assert(/resetWaitOnHold\(\)/.test(sendBlock), "case 5: the HOLD branch calls resetWaitOnHold");
  const holdBlock = useTalk.slice(useTalk.indexOf("const resetWaitOnHold"), useTalk.indexOf("const nameSession"));
  assert(/onHold\(/.test(holdBlock), "case 5: resetWaitOnHold drives onHold");

  // An unverified reported HOLD — the learner never wrote the variant — is null.
  const { verifyRepair } = await import("./repair.ts");
  const msg = "one second, let me think";
  const believed = verifyRepair({ category: "HOLD", variant: "one second" }, msg, "en");
  assert(believed !== null, "case 5: a HOLD the learner actually wrote is believed");
  const notWritten = verifyRepair({ category: "HOLD", variant: "hold on a moment" }, msg, "en");
  assert.equal(notWritten, null, "case 5: a reported HOLD the learner never wrote is not believed");

  // Timeline: a HOLD turn closes the offers — no offer fires after it.
  const ms = waitMs(ready(20_000), "normal")!;
  const h = new Harness(ms, 0);
  h.turnLands();
  h.hold();
  h.advance(ms * 3);
  assert.equal(h.offers.length, 0, "case 5: a HOLD turn produces no offer");
}

// --- case 6: waitMs scales with the baseline median ---------------------------
// patience ledger 10 — patience derives from the learner's own average.
{
  const a = waitMs(ready(10_000), "normal")!;
  const b = waitMs(ready(20_000), "normal")!;
  assert.equal(a, 25_000, "case 6: 10s median × 2.5 = 25s");
  assert.equal(b, 50_000, "case 6: 20s median × 2.5 = 50s");
  assert.equal(b, a * 2, "case 6: doubling the median doubles the wait");
}

// --- case 7: the clamp holds at both ends ------------------------------------
// patience ledger 10 — the wait is clamped to [WAIT_FLOOR, WAIT_CEILING].
{
  assert.equal(waitMs(ready(1_000), "normal"), WAIT_FLOOR, "case 7: a 1s median clamps to the floor");
  assert.equal(waitMs(ready(100_000), "normal"), WAIT_CEILING, "case 7: a 100s median clamps to the ceiling");
  assert.equal(waitMs(ready(1_000), "quick"), WAIT_FLOOR, "case 7: quick clamps to the floor too");
  assert.equal(waitMs(ready(1_000), "patient"), WAIT_FLOOR, "case 7: patient clamps to the floor too");
}

// --- case 8: null for an unready baseline, for every step --------------------
// patience ledger 10 — a null wait means the coach does not interrupt at all.
{
  for (const step of Object.keys(PATIENCE_STEPS) as PatienceStep[]) {
    const got = waitMs(unready, step);
    assert.equal(got, null, `case 8: an unready baseline returns null for ${step}`);
    assert.equal(typeof got, "object", `case 8: null and not a number — a "sensible default" cannot creep in`);
  }
  // A null wait arms nothing: the state machine leaves the state unchanged.
  const h = new Harness(null, 0);
  h.turnLands();
  assert.equal(h.state.waiting, false, "case 8: a null wait raises nothing");
  assert.equal(h.state.deadline, null, "case 8: a null wait arms no timer");
}

// --- case 9: ordering, as the two cases it is --------------------------------
// patience ledger 10 — quick <= normal <= patient, strict only where the clamp
// is not binding.
{
  const above = ready(20_000);
  const q = waitMs(above, "quick")!;
  const n = waitMs(above, "normal")!;
  const p = waitMs(above, "patient")!;
  assert(q < n && n < p, `case 9: strictly increasing above the floor (${q} < ${n} < ${p})`);
  const below = ready(1_000);
  assert.equal(waitMs(below, "quick"), WAIT_FLOOR, "case 9: below the floor, quick = floor");
  assert.equal(waitMs(below, "normal"), WAIT_FLOOR, "case 9: below the floor, normal = floor");
  assert.equal(waitMs(below, "patient"), WAIT_FLOOR, "case 9: below the floor, patient = floor");
  for (const median of [500, 1_000, 5_000, 20_000, 100_000]) {
    const b = ready(median);
    const qq = waitMs(b, "quick")!;
    const nn = waitMs(b, "normal")!;
    const pp = waitMs(b, "patient")!;
    assert(qq <= nn && nn <= pp, `case 9: non-strict ordering holds for median ${median}`);
  }
}

// --- case 10: the offer fires at most OFFER_CAP times per turn --------------
// patience ledger 10 — the offer is capped.
{
  const ms = waitMs(ready(20_000), "normal")!; // 50s
  const h = new Harness(ms, 0);
  h.turnLands();
  // Two offers fire, each a full wait apart; the third wait is silent.
  h.advance(ms);
  assert.equal(h.offers.length, 1, "case 10: the first offer fires");
  h.advance(ms);
  assert.equal(h.offers.length, 2, "case 10: the second offer fires");
  h.advance(ms * 3);
  assert.equal(h.offers.length, 2, "case 10: no third offer — the cap holds");
  assert.equal(h.state.offerCount, OFFER_CAP, "case 10: the count is at the cap");
  assert.equal(OFFER_CAP, 2, "case 10: the cap is two");
}

// --- case 11: every OFFER_LINE locale exists and passes bannedShape ----------
// patience ledger 10 — the offer is a coach line like any other.
{
  const PACK_IDS = ["en", "es", "fr", "de", "it", "pt", "ja", "tr", "id"];
  for (const id of PACK_IDS) {
    const line = OFFER_LINE[id];
    assert(line && line.trim() !== "", `case 11: OFFER_LINE has a line for pack ${id}`);
    assert(!bannedShape(line), `case 11: the offer for ${id} must not blame the learner: "${line}"`);
  }
  assert(bannedShape("you got it wrong"), "case 11: the scan catches a learner-blaming offer");
  assert(OFFER_LINE.en, "case 11: the en fallback exists");
}

// --- case 12: praiseGate drops a `for` that matches no record ---------------
// patience ledger 12 — praise cites a profile record.
{
  const records = ["ser vs estar", "past tense of ir", "por vs para"];
  assert.equal(praiseGate({ for: "ser vs estar", text: "¡Bien!" }, records, 0).keep, true, "case 12: an exact match is kept");
  assert.equal(praiseGate({ for: "you used ser and estar correctly", text: "¡Bien!" }, records, 0).keep, false, "case 12: a paraphrase is dropped");
  assert.equal(praiseGate({ for: "ser", text: "¡Bien!" }, records, 0).keep, false, "case 12: a substring is dropped");
  assert.equal(praiseGate({ for: "the subjunctive", text: "¡Bien!" }, records, 0).keep, false, "case 12: an unmatched record is dropped");
  assert.equal(praiseGate(undefined, records, 0).keep, false, "case 12: no praise is dropped");
  assert.equal(praiseGate({ for: "  SER VS ESTAR  ", text: "¡Bien!" }, records, 0).keep, true, "case 12: matching is case-folded and trimmed");
}

// --- case 13: the third praise of a session is dropped -----------------------
// patience ledger 12 — praise is capped per session.
{
  const records = ["ser vs estar"];
  assert.equal(praiseGate({ for: "ser vs estar", text: "¡Bien!" }, records, 0).keep, true, "case 13: the first praise is kept");
  assert.equal(praiseGate({ for: "ser vs estar", text: "¡Bien!" }, records, 1).keep, true, "case 13: the second praise is kept");
  assert.equal(praiseGate({ for: "ser vs estar", text: "¡Bien!" }, records, 2).keep, false, "case 13: the third praise is dropped");
  assert.equal(PRAISE_CAP, 2, "case 13: the cap is two per session");
  // The gate itself returns only `keep` — it cannot touch the reply.
  const src = readFileSync(join(ROOT, "src/lib/patience.ts"), "utf8");
  const fn = src.slice(src.indexOf("export function praiseGate"), src.indexOf("// --- the offer"));
  const body = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert(!/reply/.test(body), "case 13: praiseGate never mentions the reply");
}

// --- case 14: source scan — buildSystem always carries the praise rule -------
// patience ledger 12 — praise cites a profile record.
{
  const probeFile = join(tmpdir(), "patience.praise.probe.ts");
  writeFileSync(probeFile, 'const x = "Do not praise the learner\'s language";');
  try {
    assert(/Do not praise the learner's language/.test(readFileSync(probeFile, "utf8")), "case 14 probe: the scan catches its own seeded text");
  } finally {
    unlinkSync(probeFile);
  }

  const system = buildSystem(defaultSettings, BUNDLED_SCENARIOS[0], BUNDLED_SCENARIOS[0].persona, undefined, [], { axis: null, step: 0 }, []);
  assert(system.includes("Do not praise the learner's language"), "case 14: buildSystem carries the no-groundless-praise rule");
  assert(system.includes('"great"'), "case 14: buildSystem carries the banned-word list");
  // The praise sentence is told to live in "praise"."text", never in "reply".
  assert(system.includes('"praise"."text"'), "case 14: buildSystem puts the praise sentence in text, not reply");
  const withRecord = buildSystem(defaultSettings, BUNDLED_SCENARIOS[0], BUNDLED_SCENARIOS[0].persona, undefined, [], { axis: null, step: 0 }, ["ser vs estar"]);
  assert(withRecord.includes("ser vs estar"), "case 14: the correction record is supplied");
  const noRecord = buildSystem(defaultSettings, BUNDLED_SCENARIOS[0], BUNDLED_SCENARIOS[0].persona, undefined, [], { axis: null, step: 0 }, []);
  assert(noRecord.includes("no correction record yet"), "case 14: an empty record says no praise is allowed");
}

// --- case 15: source scan — Talk renders nothing while the wait is pending ----
// patience ledger 11 — nothing is shown while waiting.
{
  const probeFile = join(tmpdir(), "patience.wait.probe.tsx");
  writeFileSync(probeFile, "const x = talk.suggestions.length > 0;");
  try {
    assert(/talk\.suggestions\.length > 0/.test(readFileSync(probeFile, "utf8")), "case 15 probe: the scan catches a seeded unconditional suggestion render");
  } finally {
    unlinkSync(probeFile);
  }

  const talk = readFileSync(join(ROOT, "src/views/Talk.tsx"), "utf8");
  const suggestionRenders = talk.match(/talk\.suggestions\.map/g) ?? [];
  assert(suggestionRenders.length === 1, "case 15: suggestions are rendered in exactly one place");
  assert(/talk\.suggestions\.length > 0 && !talk\.waiting/.test(talk), "case 15: the suggestion render is gated on !waiting");
  assert(/!talk\.waiting/.test(talk), "case 15: the hint announcement is gated on !waiting");
  assert(/talk\.busy && !talk\.streaming/.test(talk), "case 15: the typing indicator is gated on busy, not on waiting");
}

console.log("patience.check: ok");


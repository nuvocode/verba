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
  onSpeechEnd,
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
// clock. `say(dur)` is the speech queue: clips play in order, and when the queue
// empties the coach falls silent — which is the only place a deadline is set,
// exactly as `say`'s queue-empty path is in useTalk. The state machine is the
// real one from patience.ts.
//
// The harness records, for every offer, how long the learner had actually been
// in silence when it fired. That number is the thing §6.1 is about: a wait the
// coach's own audio has already spent is not a wait.
class Harness {
  now = 0;
  state: WaitState = freshWait();
  speaking = false;
  queue: number[] = [];
  clipEnd: number | null = null;
  /** When the coach last fell silent; null while it is speaking. */
  quietSince: number | null = 0;
  offers: number[] = [];
  /** Silence before each offer — offers[i] fired after silences[i] ms of quiet. */
  silences: number[] = [];
  timer: number | null = null;
  ms: number | null;
  offerClipMs: number;

  constructor(ms: number | null, offerClipMs = 0) {
    this.ms = ms;
    this.offerClipMs = offerClipMs;
  }

  /** The coach speaks a line — a clip joins the queue. */
  say(dur: number) {
    this.queue.push(dur);
    if (!this.speaking) {
      this.speaking = true;
      this.quietSince = null;
      this.playNext();
    }
  }

  /** The queue advances; when it empties the coach stops speaking. */
  private playNext() {
    const d = this.queue.shift();
    if (d === undefined) {
      this.speaking = false;
      this.clipEnd = null;
      this.quietSince = this.now;
      // The only place a deadline is set — `say`'s queue-empty path.
      this.state = onSpeechEnd(this.state, this.now, this.ms);
      this.timer = this.state.deadline;
      return;
    }
    this.clipEnd = this.now + d;
  }

  /** Turn land: raise the flag (no clock yet) and start the reply clip. */
  turnLands(replyMs: number) {
    this.state = armWait(this.state, this.ms);
    // Whatever deadline the state says, the harness schedules — so an `armWait`
    // that arms the clock at turn land is observed here, not silently ignored.
    this.timer = this.state.deadline;
    this.say(replyMs);
  }

  /** Turn land with speech off: nothing is ever queued, so the silence is now. */
  turnLandsSilent() {
    this.state = armWait(this.state, this.ms);
    this.state = onSpeechEnd(this.state, this.now, this.ms);
    this.timer = this.state.deadline;
  }

  /** The armed timer fires — the wait elapsed. */
  fire() {
    const before = this.state.offerCount;
    this.state = onWaitElapsed(this.state, this.now, this.ms, this.speaking);
    if (this.state.offerCount > before) {
      this.offers.push(this.now);
      this.silences.push(this.quietSince === null ? 0 : this.now - this.quietSince);
      this.say(this.offerClipMs);
    }
    this.timer = this.state.deadline;
  }

  /** A verified HOLD lands — mirrors resetWaitOnHold. */
  hold() {
    this.state = onHold(this.state, this.now, this.ms);
    this.timer = this.state.deadline;
  }

  /**
   * Advance the clock by dt, firing timers and ending clips as they come due.
   * One event at a time: a timer and a clip ending in the same millisecond are
   * resolved timer-first, so the elapse still sees the coach speaking and
   * re-arms rather than cutting in on the last word.
   */
  advance(dt: number) {
    const target = this.now + dt;
    for (;;) {
      const due = [this.timer, this.clipEnd].filter((x): x is number => x !== null && x <= target);
      if (due.length === 0) break;
      const at = Math.min(...due);
      this.now = at;
      if (this.timer === at) {
        this.timer = null;
        this.fire();
      } else {
        this.playNext();
      }
    }
    this.now = target;
  }
}

// --- case 1: the flag rises at turn land, the clock starts at silence --------
// patience ledger 11 — nothing is shown while waiting; and ledger 10 — the wait
// is a full wait of *silence*, not one the coach's own audio has spent.
{
  const ms = waitMs(ready(20_000), "normal")!; // 50s
  const h = new Harness(ms);
  h.turnLands(6_000); // an ordinary reply: shorter than the wait
  // The flag is up at turn land, before any speech has finished — the chips are
  // hidden for the whole of the coach's reply.
  assert.equal(h.state.waiting, true, "case 1: waiting is raised at turn land");
  assert.equal(h.speaking, true, "case 1: the coach is still speaking");
  // …and no clock is running yet. Arming the deadline here would spend the wait
  // on the coach's own audio.
  assert.equal(h.state.deadline, null, "case 1: no deadline until the coach falls silent");

  // The reply ends; now the clock starts, and the offer is a full wait away.
  h.advance(6_000);
  assert.equal(h.speaking, false, "case 1: the coach has stopped speaking");
  assert.equal(h.state.deadline, 6_000 + ms, "case 1: the deadline is a full wait from the silence");
  h.advance(ms);
  assert.deepEqual(h.offers, [6_000 + ms], "case 1: the offer fires a full wait after the coach stopped");
  assert.deepEqual(h.silences, [ms], "case 1: the learner had a full wait of silence");

  // Wiring: `armWait` raises the flag at turn land; the deadline is set only by
  // `say`'s queue-empty path (and, with speech off, at the turn). If the fix is
  // reverted — the deadline armed at turn land — this fails.
  const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  const sayBlock = useTalk.slice(useTalk.indexOf("const say ="), useTalk.indexOf("const clearWait"));
  assert(/armDeadlineRef\.current\(\)/.test(sayBlock), "case 1: say's queue-empty path starts the clock");
  const armBlock = useTalk.slice(useTalk.indexOf("const armWait ="), useTalk.indexOf("const armDeadline ="));
  assert(!/setTimeout/.test(armBlock), "case 1: armWait sets the flag, never the timer");
  assert(/setWaiting\(true\);\s*armWait\(\)/.test(useTalk), "case 1: the turn raises waiting and arms the wait");
  const src = readFileSync(join(ROOT, "src/lib/patience.ts"), "utf8");
  const fn = src.slice(src.indexOf("export function armWait"), src.indexOf("export function onSpeechEnd"));
  assert(!/deadline: now/.test(fn), "case 1: armWait must not set a deadline");
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
  // never reaches the screen, and the reply stands on its own without it. It is
  // the coach's own target-language text, so it sits inside PLAN-021's curtain:
  // with subtitles off it stays hidden until the line is revealed.
  const talk = readFileSync(join(ROOT, "src/views/Talk.tsx"), "utf8");
  assert(/m\.praise && \(settings\.subtitles \|\| revealed\.has\(i\)\)/.test(talk), "case 2: the praise render is gated on the gate and on the curtain");
  // The praise sentence is stored on the message, not folded into reply, and it
  // is spoken like any other coach line — Talk is voice-primary (PLAN-018).
  const useTalk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  assert(/praise: praiseText/.test(useTalk), "case 2: useTalk stores the kept praise text on the message");
  assert(/if \(praiseText\) say\(praiseText\)/.test(useTalk), "case 2: a kept praise is spoken");
  assert(!/turn\.reply\s*=/.test(useTalk), "case 2: useTalk never rewrites turn.reply");
}

// --- case 3: no offer cuts into a rewind, and the wait after it is full ------
// patience ledger 10 — the offer is a coach line like any other, and it must
// not cut into a rewind's own → repeat.
{
  const ms = waitMs(ready(1_000), "normal")!; // the floor, 8s
  const h = new Harness(ms);
  h.turnLands(3_000); // the reply ends at 3s and starts the clock: deadline 11s
  h.advance(3_000);
  assert.equal(h.state.deadline, 3_000 + ms, "case 3: the clock started when the reply ended");
  // A rewind's own → repeat joins the floor at 4s and holds it for 8s, straddling
  // the deadline at 11s.
  h.advance(1_000);
  h.say(8_000);
  h.advance(20_000);
  // The offer did not cut in mid-rewind…
  assert(h.offers.every((t) => t >= 12_000), "case 3: no offer while the rewind held the floor");
  // …and when it came, it came after a full wait of silence, not a remainder.
  assert.equal(h.offers.length, 1, "case 3: one offer fired");
  assert.deepEqual(h.silences, [ms], "case 3: a full wait of silence after the rewind");
  assert.equal(h.offers[0], 12_000 + ms, "case 3: the offer is a full wait after the rewind ended");

  // Wiring: onWaitElapsed consults `speaking` and re-arms instead of offering.
  const src = readFileSync(join(ROOT, "src/lib/patience.ts"), "utf8");
  const fn = src.slice(src.indexOf("export function onWaitElapsed"), src.indexOf("export function onHold"));
  assert(/speaking/.test(fn), "case 3: onWaitElapsed consults the speaking flag");
}

// --- case 4: a verified HOLD closes the turn's offers ------------------------
// patience ledger 10 — a learner who asked for time is not then offered help.
{
  const ms = waitMs(ready(20_000), "normal")!; // 50s
  const h = new Harness(ms);
  h.turnLandsSilent();
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
  const h = new Harness(ms);
  h.turnLandsSilent();
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
  const h = new Harness(null);
  h.turnLands(3_000);
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
  const h = new Harness(ms);
  h.turnLandsSilent();
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

// --- case 16: every offer follows a full wait of real silence ----------------
// patience ledger 10 — the wait is the learner's silence, not the clock the
// coach's own audio ran down.
//
// This is the boundary the whole plan turns on, and it is invisible to a
// timeline whose clip either outlasts the wait or lasts nothing at all: the
// ordinary turn is a reply *shorter* than the wait. With the deadline armed at
// turn land, a six-second reply against the eight-second floor leaves the
// learner two seconds before being offered help — §6.1's opening complaint,
// reproduced by the app that exists to remove it.
{
  for (const median of [1_000, 3_000, 20_000]) {
    for (const step of ["quick", "normal", "patient"] as PatienceStep[]) {
      const ms = waitMs(ready(median), step)!;
      // Replies on both sides of the wait, including the ones that make the
      // remainder small: an ordinary reply, a long one, one just under the wait.
      for (const replyMs of [0, 3_000, 6_000, ms - 1, ms, ms + 5_000]) {
        const h = new Harness(ms, 2_000); // the offer holds the floor too
        h.turnLands(replyMs);
        h.advance(replyMs + ms * 4);
        assert.equal(h.offers.length, OFFER_CAP, `case 16: both offers fire (median ${median}, ${step}, reply ${replyMs})`);
        for (const [i, silence] of h.silences.entries()) {
          assert.equal(
            silence,
            ms,
            `case 16: offer ${i + 1} must follow a full wait of silence — median ${median}, ${step}, reply ${replyMs}: got ${silence}ms, wanted ${ms}ms`,
          );
          assert(
            silence >= WAIT_FLOOR,
            `case 16: no offer inside the floor — median ${median}, ${step}, reply ${replyMs}: got ${silence}ms`,
          );
        }
      }
    }
  }
}

console.log("patience.check: ok");


// Rehearsal (PLAN-034), pinned: the in-role turn keeps what Verba observes and
// drops what the coach would teach with; the five things switched off in role
// are each off at their own call site, with the mode in the condition; the
// rewind stops after `repeat`; the debrief drops a `stuck` entry that cannot
// point at the transcript; calibration never counts a rehearsal; the two new
// builders sit in exactly one prompt list each; the announced and working key
// sets agree.
//
// Cases 3, 4, 5 and 9 are the ones that pass vacuously if written against
// fixtures: each is driven through the production path (parseRole, useTalk's
// own source, driveRewind's real flow, real signals through recapsFrom and
// calibrate), and each must fail when its own rule is removed — verified by
// removing the rule and running, not by reading.
// Run: node --experimental-strip-types src/lib/rehearsal.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  rehearsalScenario,
  rehearsalSystem,
  parseRole,
  debriefPrompt,
  parseDebrief,
  type RehearsalBrief,
} from "./rehearsal.ts";
import { buildSystem, styleGuidance, SPOKEN_PROMPTS, STRUCTURED_PROMPTS, type Settings } from "./prompts.ts";
import { nextStep } from "./rewind.ts";
import { recapsFrom, calibrate } from "./difficulty.ts";
import { talkSignals } from "./signals.ts";
import { keysFor } from "./keys.ts";
import { defaultSettings } from "./settings.ts";
import { axisGuidance, DIFFICULTY_NO_ANNOUNCE } from "./difficulty.ts";
import type { Signal } from "./model.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const brief: RehearsalBrief = { who: "my landlord", about: "the boiler that has not been fixed", formality: "formal" };
const s: Settings = { ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "Spanish", nativeLanguage: "English" } };
const sc = rehearsalScenario(brief);

// --- case 1: the in-role prompt carries none of the tutor's kit ---------------
// rehearsal ledger 18 — role-play and feedback are separated: the in-role prompt
// carries none of the tutor's kit, and each absence is probed below so it
// cannot pass on a typo.
// Each absence is asserted by a specific marker string, and each is probed
// against a seeded violation below, so an absence assertion cannot pass on a
// typo in its own marker.
{
  const prompt = rehearsalSystem(s, brief, sc);

  // No correction instruction — the shape's `corrections` key and the rule
  // buildSystem writes for it are both absent.
  assert(!prompt.includes('"corrections"'), "case 1: no corrections key in the in-role turn shape");
  assert(!prompt.includes("Do NOT correct the learner"), "case 1: no correction rule in role");
  // No suggestion instruction.
  assert(!prompt.includes('"suggestions"'), "case 1: no suggestions key in role");
  assert(!prompt.includes("Give 2-3"), "case 1: no suggestion-counting rule in role");
  // No difficulty guidance — absent from the prompt entirely, not set low.
  assert(!prompt.includes("Harder this session"), "case 1: no axis guidance in role");
  assert(!prompt.includes("Never comment on the difficulty"), "case 1: no difficulty talk in role at all");
  // No styleGuidance — the register is the brief's, not the coach's.
  assert(!prompt.includes(styleGuidance("warm")), "case 1: no warm guidance in role");
  assert(!prompt.includes(styleGuidance("direct")), "case 1: no direct guidance in role");
  assert(!prompt.includes("Speak directly"), "case 1: no style paragraph at all in role");
  // No praise instruction — the other party has never seen a record to cite.
  assert(!prompt.includes('"praise"'), "case 1: no praise key in role");
  assert(!prompt.includes("praise the learner"), "case 1: no praise rule in role");
  // No goals — the other party has no goals sheet.
  assert(!prompt.includes('"goalsMet"'), "case 1: no goalsMet key in role");
  assert(!prompt.includes("Help the learner practise these goals"), "case 1: no goal list in role");
  // No opening detail — a supplier does not know the learner moved house.
  assert(!prompt.includes("You may open by asking after"), "case 1: no opening-detail permission in role");

  // The probes: a seeded violation of each rule makes the same scan catch it,
  // so the absences above are doing the work, not matching nothing.
  const seeded = (extra: string) => prompt + "\n" + extra;
  assert(seeded(`\n${axisGuidance("pace", 1)}`).includes("Harder this session"), "case 1 probe: the difficulty scan fires when the guidance is present");
  assert(seeded(`\n${styleGuidance("direct")}`).includes("Speak directly"), "case 1 probe: the style scan fires when styleGuidance is present");
  assert(seeded('\n"corrections": [ { "original": "x" } ]').includes('"corrections"'), "case 1 probe: the corrections scan fires when the key is present");
  assert(seeded('\n"suggestions": [ "one" ]').includes('"suggestions"'), "case 1 probe: the suggestions scan fires when the key is present");
  assert(seeded('\n"praise": { "for": "x", "text": "y" }').includes('"praise"'), "case 1 probe: the praise scan fires when the key is present");
  assert(seeded('\n"goalsMet": [0]').includes('"goalsMet"'), "case 1 probe: the goals scan fires when the key is present");
}

// --- case 2: the prompt carries the brief, and formality changes it ------------
{
  const prompt = rehearsalSystem(s, brief, sc);
  assert(prompt.includes("my landlord"), "case 2: the prompt names who the rehearsal is with");
  assert(prompt.includes("the boiler that has not been fixed"), "case 2: the prompt names what it is about");
  assert(prompt.includes("formally"), "case 2: the prompt pins the formality");

  // All three formality values produce different prompts.
  const casual = rehearsalSystem(s, { ...brief, formality: "casual" }, rehearsalScenario({ ...brief, formality: "casual" }));
  const neutral = rehearsalSystem(s, { ...brief, formality: "neutral" }, rehearsalScenario({ ...brief, formality: "neutral" }));
  const formal = rehearsalSystem(s, { ...brief, formality: "formal" }, rehearsalScenario({ ...brief, formality: "formal" }));
  assert(casual !== neutral && neutral !== formal && casual !== formal, "case 2: all three formalities differ");
  assert(casual.includes("casually") && formal.includes("formally"), "case 2: each formality is pinned by its own word");
}

// --- case 3: parseRole keeps observation, drops teaching -----------------------
// Driven through the production parser — the same call `useTalk.send` makes —
// not through a fixture of our own shape.
{
  const raw = JSON.stringify({
    reply: "Déjame verlo, es un problema serio.",
    // A model that sends the teaching fields anyway: ignored, not shown.
    corrections: [{ original: "yo voy", fixed: "voy", note: "omit the pronoun", severity: "severe", category: "grammar" }],
    suggestions: ["¿Puedo hacer yo la reparación?"],
    goalsMet: [0, 1],
    praise: { for: "ser vs estar", text: "¡Bien hecho!" },
    ease: true,
    // The observation fields the repair layer lives on.
    repair: { category: "HOLD", variant: "espera, un momento" },
    missed: ["keyWordMissing", "topicChange"],
    keyWord: "plomero",
  });
  const turn = parseRole(raw);
  // The keeping half — this is what makes the rehearsal's signals real.
  assert.equal(turn.reply, "Déjame verlo, es un problema serio.", "case 3: the reply is kept");
  assert(turn.repair && turn.repair.category === "HOLD" && turn.repair.variant === "espera, un momento", "case 3: the repair is kept");
  assert.deepEqual(turn.missed, ["keyWordMissing", "topicChange"], "case 3: the missed list is kept, narrowed to the five meaning signals");
  assert.equal(turn.keyWord, "plomero", "case 3: the keyWord is kept");
  // The dropping half — never rendered, never spoken.
  assert(!("corrections" in turn), "case 3: corrections are dropped");
  assert(!("suggestions" in turn), "case 3: suggestions are dropped");
  assert(!("goalsMet" in turn), "case 3: goalsMet is dropped");
  assert(!("praise" in turn), "case 3: praise is dropped");
  assert(!("ease" in turn), "case 3: ease is dropped");
  // And the meaning set is closed: an invented signal does not travel, and a
  // duplicate collapses.
  const noisy = parseRole(JSON.stringify({ reply: "Vale", missed: ["disconnected", "keyWordMissing", "keyWordMissing", "invented"] }));
  assert.deepEqual(noisy.missed, ["disconnected", "keyWordMissing"], "case 3: an unknown signal is dropped and a duplicate collapses");
}

// --- case 4: the mode is decided from the parameters, not the state ------------
// A source scan cannot see whether `start` reads the `rehearsal` state — the
// state is null on the very first render, so reading it would make the first
// call of a rehearsal behave like an ordinary session. The rule is pinned from
// *behaviour*: render the real `useTalk` hook, call `start(sc, "rehearsal",
// brief)` as the first call, and assert the system prompt it actually chose is
// `rehearsalSystem` — not `buildSystem`. The offer is pinned the same way: with
// a ready baseline the wait would fire an offer, and in role nothing is spoken
// over it.
{
  const { register } = await import("node:module");
  const loader = new URL("./rehearsal.loader.mjs", import.meta.url).href;
  register(loader, import.meta.url);

  const { renderToString } = await import("react-dom/server");
  const React = await import("react");
  const { useTalk } = await import("./useTalk.ts");
  const { defaultSettings } = await import("./settings.ts");
  const { rehearsalScenario } = await import("./rehearsal.ts");
  const { calls } = await import("./rehearsal.mock-providers.mjs");
  const { spoken } = await import("./rehearsal.mock-speech.mjs");

  // Capture the wait machine's timers so the offer can be driven to fire.
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  globalThis.clearTimeout = () => {};

  try {
    const brief4 = { who: "my landlord", about: "the boiler", formality: "formal" };
    const sc4 = rehearsalScenario(brief4);
    let talk;
    function Harness() {
      talk = useTalk(defaultSettings);
      return React.createElement("div", null, "x");
    }
    renderToString(React.createElement(Harness));

    // The first call of a rehearsal: the state has not landed yet, so this is
    // exactly the case that would go wrong if `start` read the state.
    calls.length = 0;
    spoken.length = 0;
    await talk.start(sc4, "rehearsal", brief4);
    const system = calls[0]?.messages?.[0]?.content ?? "";
    assert(system.includes("You are not a tutor"), "case 4: the first call of a rehearsal selects rehearsalSystem, not buildSystem");
    assert(!system.includes("You are Verba"), "case 4: buildSystem is not chosen for a rehearsal");

    // The offer: with a ready baseline the wait arms a deadline; firing it must
    // not speak an offer in role. The reply itself is the only thing spoken.
    const spokenAfterStart = spoken.length;
    for (const fn of [...timers]) {
      try {
        fn();
      } catch {
        /* a timer that re-arms is fine — the gate must hold across them */
      }
    }
    assert.equal(spoken.length, spokenAfterStart, "case 4: in role, firing the wait speaks nothing — the offer is stood down at the wait");
    assert(
      !spoken.some((t) => t.includes("start you off") || t.includes("pista") || t.includes("ayuda")),
      "case 4: no offer line is ever spoken in role",
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
}

// --- case 5: the rewind stops after `repeat` in role ----------------------------
// On the production path: `nextStep("repeat")` is still `unpack` in a normal
// session, and the rehearsal path in useTalk does not drive past `repeat` —
// the drive is called with `stopAfterRepeat`, and an advance is refused.
{
  // The order itself is untouched: a normal session still walks own → repeat
  // → unpack → gift. This is the assertion that would go red if the rehearsal
  // cap were "fixed" by rewriting REWIND_ORDER instead of stopping the drive.
  assert.equal(nextStep("repeat", true), "unpack", "case 5: a normal session's rewind still advances repeat → unpack");

  // The production path: the queued rewind in role is driven with the cap set
  // (fresh rewind) or closed without consulting `nextStep` (an advance), never
  // with a plain call that could reach unpack. The call sites name the mode.
  const src = readFileSync(`${ROOT}src/lib/useTalk.ts`, "utf8");
  const queued = src.slice(src.indexOf("if (pendingRewind.current) {"), src.indexOf("} catch (e: unknown) {", src.indexOf("if (pendingRewind.current) {")));
  assert(queued.includes("rehearsal && !queued.advance"), "case 5: the rehearsal drive stops after repeat");
  assert(queued.includes("rehearsal && queued.advance"), "case 5: an advance in role is refused");
  // And the drive itself consults the cap before `nextStep`.
  const drive = src.slice(src.indexOf("const driveRewind = useCallback"), src.indexOf("const denyRewind"));
  assert(drive.includes("stopAfterRepeat"), "case 5: the drive carries the cap");
  assert(drive.indexOf("if (stopAfterRepeat) {") < drive.indexOf("const to = nextStep("), "case 5: the cap short-circuits before nextStep is consulted");
}

// --- case 6: parseDebrief drops a `stuck` entry that cannot point at the record --
{
  const raw = JSON.stringify({
    stuck: [
      { turn: 1, moment: "when they asked about the deposit", why: "the money words" },
      { turn: 5, moment: "just past the end", why: "there is no turn 5" },
      { turn: -1, moment: "before the start", why: "negative" },
      { turn: 1.5, moment: "not an index", why: "fractional" },
      { moment: "no turn at all", why: "missing" },
      { turn: 2, moment: "a real one", why: "kept" },
    ],
    phrases: [],
  });
  const debrief = parseDebrief(raw, 4);
  // Turn 1 and turn 2 exist (0..3); 5, -1 and 1.5 do not.
  assert.deepEqual(
    debrief.stuck.map((e) => e.turn),
    [1, 2],
    "case 6: an entry just past the end drops exactly like a negative one, and a valid one beside them is kept",
  );
}

// --- case 7: phrases are capped at five; fewer pass through --------------------
{
  const six = parseDebrief(JSON.stringify({ stuck: [], phrases: ["a", "b", "c", "d", "e", "f"] }), 1);
  assert.equal(six.phrases.length, 5, "case 7: six phrases are capped at five");
  assert.deepEqual(six.phrases, ["a", "b", "c", "d", "e"], "case 7: the cap keeps the first five in order");
  const three = parseDebrief(JSON.stringify({ stuck: [], phrases: ["one", "two", "three"] }), 1);
  assert.deepEqual(three.phrases, ["one", "two", "three"], "case 7: fewer pass through unchanged");
  const none = parseDebrief(JSON.stringify({ stuck: [], phrases: [] }), 1);
  assert.deepEqual(none.phrases, [], "case 7: an empty list is the right answer for a smooth rehearsal");
}

// --- case 8: rehearsal turns produce the same signal kinds, plus the marker -----
// Through the real writer — `talkSignals` — with a reflection shaped like the
// one `useTalk.end()` builds for a rehearsal: turns, a verified repair, no
// corrections, no axis, and the mode.
{
  const r = {
    turns: 2,
    corrections: [],
    words: [],
    produced: [
      { text: "Buenas tardes, llamo por el boiler.", fromSuggestion: false, words: 6, latencyMs: 3000, speakMs: 0, speakUnknown: false, missed: [], keyWord: "", breakdown: [], verdict: "clear" as const },
      { text: "No sé qué decir.", fromSuggestion: false, words: 4, latencyMs: 9000, speakMs: 0, speakUnknown: false, missed: ["topicChange"], keyWord: "plomero", breakdown: ["slowResponse"], verdict: "suspect" as const },
    ],
    voice: [],
    reveals: [],
    repairs: [{ category: "HOLD" as const, by: "learner" as const, variant: "espera" }],
    axis: null,
    easeRequested: false,
    rehearsal: { brief, debrief: null },
  };
  const drafts = talkSignals("talk-1", r, "es");
  const kinds = drafts.map((d) => d.kind);
  assert(kinds.includes("unpromptedTurn"), "case 8: an unpromptedTurn lands, same as any session");
  assert(kinds.includes("repairMove"), "case 8: a repairMove lands, same as any session");
  assert.equal(kinds.filter((k) => k === "rehearsal").length, 1, "case 8: exactly one rehearsal marker per batch");
  assert(!kinds.includes("axisUsed"), "case 8: no axisUsed — the axes were off");
  assert(!kinds.includes("correction"), "case 8: no correction signal — nothing was corrected in role");
}

// --- case 9: calibration never counts a rehearsal --------------------------------
// Driven through the real signals: two consecutive rehearsal batches — the exact
// shape that would raise the step — and a rehearsal sitting between an easy
// session and the next read. Neither `recapsFrom` nor `calibrate` may read a
// rehearsal as a session.
{
  const at = 1_000_000_000_000;
  const sig = (kind: Signal["kind"], payload: unknown, stamp: number, id: string): Signal => ({
    id,
    activityId: "a1",
    kind,
    observedAt: stamp,
    payload,
  });
  const learnerTurn = (breakdown: string[], stamp: number, id: string): Signal =>
    sig("unpromptedTurn", { words: 6, sentences: 1, chars: 30, latencyMs: 3000, speakMs: 0, speakUnknown: false, breakdown }, stamp, id);
  const rehearsalBatch = (stamp: number, ids: string): Signal[] => [
    learnerTurn([], stamp, `t${ids}1`),
    learnerTurn([], stamp, `t${ids}2`),
    sig("rehearsal", { label: "rehearsal" }, stamp, `k${ids}`),
  ];

  // Two rehearsals in a row, both with zero breakdowns — the shape that reads
  // as "easy" if the marker were not read.
  const twoRehearsals = [...rehearsalBatch(at), ...rehearsalBatch(at - 60_000)];
  const recaps = recapsFrom(twoRehearsals);
  assert.deepEqual(recaps, [], "case 9: a rehearsal is not a session, so two in a row raise nothing");
  assert.equal(calibrate(2, recaps), 2, "case 9: two rehearsals in a row do not raise the step");

  // A real easy session on either side is still a session: the marker skips the
  // batch it rides in, not the batches beside it.
  const mixed = [...rehearsalBatch(at), ...rehearsalBatch(at - 60_000), learnerTurn([], at - 120_000, "o1"), learnerTurn([], at - 120_000, "o2")];
  const mixedRecaps = recapsFrom(mixed);
  assert.equal(mixedRecaps.length, 1, "case 9: the easy session beside two rehearsals is still a session");
  assert.equal(calibrate(0, mixedRecaps), 0, "case 9: one easy session is not enough to raise, rehearsals included or not");
  // And a rehearsal batch alone is not a session at all.
  assert.deepEqual(recapsFrom(rehearsalBatch(at)), [], "case 9: a rehearsal batch on its own is not a session");
}

// --- case 10: ActivityKind is unchanged; no plan builder emits a rehearsal -------
{
  const src = readFileSync(`${ROOT}src/lib/model.ts`, "utf8");
  const kinds = src.slice(src.indexOf("export type ActivityKind"), src.indexOf("export type PlannedActivity"));
  assert(
    /"talk" \| "read" \| "roleplay" \| "listen" \| "memory" \| "wrapup"/.test(kinds),
    "case 10: ActivityKind is unchanged — a rehearsal is not a thing Verba schedules",
  );
  assert(!kinds.includes("rehearsal"), "case 10: no rehearsal ActivityKind");
  // No plan builder emits a rehearsal activity.
  const learn = readFileSync(`${ROOT}src/lib/learn.ts`, "utf8");
  assert(!learn.includes('"rehearsal"'), "case 10: buildDailyPlan never emits a rehearsal activity");
}

// --- case 11: the announced key set and the working key set agree ----------------
{
  const withRehearsal = keysFor("talk", ["rehearsal"]);
  const plain = keysFor("talk");
  assert(withRehearsal.some((k) => k.does === "end the role-play"), "case 11: the end-role-play key is announced in rehearsal");
  assert(!plain.some((k) => k.does === "end the role-play"), "case 11: an ordinary session announces no end-role-play key");
  // The announced count equals the working count, in both states (invariant 23).
  assert.equal(withRehearsal.length, plain.length + 1, "case 11: exactly one key separates the two states");
}

// --- case 12: both builders are in exactly one list, and the scan finds them ------
{
  const spoken = [...SPOKEN_PROMPTS];
  const structured = [...STRUCTURED_PROMPTS];
  assert(spoken.includes("rehearsal.ts:debriefPrompt") && !structured.includes("rehearsal.ts:debriefPrompt"), "case 12: debriefPrompt is spoken (it carries the coach's style)");
  assert(structured.includes("rehearsal.ts:rehearsalSystem") && !spoken.includes("rehearsal.ts:rehearsalSystem"), "case 12: rehearsalSystem is classified, and not styled");
  const all = [...spoken, ...structured];
  assert.equal(all.filter((n) => n.startsWith("rehearsal.ts:")).length, 2, "case 12: exactly two rehearsal builders, one each");

  // The completeness claim holds: the hand-added builder is in the scan.
  const reh = readFileSync(`${ROOT}src/lib/rehearsal.ts`, "utf8");
  const debrief = reh.slice(reh.indexOf("export function debriefPrompt("), reh.indexOf("export const DEBRIEF_PHRASES_MAX"));
  assert(debrief.includes("styleGuidance(s.coachStyle)"), "case 12: debriefPrompt carries the coach's style");
  assert(!rehearsalSystem(s, brief, sc).includes(styleGuidance(s.coachStyle)), "case 12: rehearsalSystem carries none");
  // And the debrief prompt really does name the numbered transcript.
  const dp = debriefPrompt(s, brief, ["no llegó el gas", "no sé"], undefined);
  assert(dp.includes("0. no llegó el gas") && dp.includes("1. no sé"), "case 12: the transcript is numbered, so a stuck index means something");
}

// --- case 13: a resumed conversation is an ordinary conversation ---------------
// rehearsal ledger 18 — role-play and feedback are separated, and the role ends
// with the session it belonged to.
//
// `resume` is the one door into a session that was not opening a rehearsal, and
// it resets eighteen other per-session things. Left uncleared, the mode leaks:
// the resumed conversation inherits the last rehearsal's silence — no offer, no
// corrections shown, no suggestions, turns parsed as in-role, a `rehearsal`
// marker written into the record and calibration skipped.
//
// The ref half is pinned from behaviour: after a resume the wait fires an offer
// again, which in role it never does. The state half is scanned — `setRehearsal`
// and the ref are mirrored, so a half-fix (one without the other) fails here.
{
  const { renderToString } = await import("react-dom/server");
  const React = await import("react");
  const { useTalk } = await import("./useTalk.ts");
  const { defaultSettings } = await import("./settings.ts");
  const { rehearsalScenario } = await import("./rehearsal.ts");
  const { spoken } = await import("./rehearsal.mock-speech.mjs");

  const timers: (() => void)[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  // @ts-expect-error — the harness only needs the callback, not the timer id.
  globalThis.setTimeout = (fn: () => void) => timers.push(fn);
  // @ts-expect-error — clearing is a no-op so a fired timer stays drivable.
  globalThis.clearTimeout = () => {};

  try {
    const brief13 = { who: "my landlord", about: "the boiler", formality: "formal" as const };
    let talk: ReturnType<typeof useTalk> | undefined;
    function Harness13() {
      talk = useTalk(defaultSettings);
      return React.createElement("div", null, "x");
    }
    renderToString(React.createElement(Harness13));

    await talk!.start(rehearsalScenario(brief13), "rehearsal", brief13);
    // The precondition, and proof the harness can speak at all: the reply was
    // spoken, so a silent offer later is the gate and not a mute adapter.
    assert(spoken.length > 0, "case 13: the coach's own reply is spoken — the adapter is not mute");

    // The wait the rehearsal armed is still on the pile: `clearWait` calls the
    // stubbed `clearTimeout`, so the callback stays drivable. That is the probe —
    // it is the *same* timer, fired after the resume, so what it does depends on
    // nothing but whether `resume` cleared the mode. Driving a wait armed by a
    // later `start` would prove nothing: `start` clears the ref itself.
    await new Promise((r) => realSetTimeout(r, 0));
    const armed = [...timers];
    assert(armed.length > 0, "case 13: the rehearsal armed a wait — there is a timer to drive");

    // Now the learner leaves the rehearsal and resumes a past conversation.
    await talk!.resume(1);
    await new Promise((r) => realSetTimeout(r, 0));

    const before13 = spoken.length;
    for (const fn of armed) {
      try {
        fn();
      } catch {
        /* a timer that re-arms is fine */
      }
    }
    // The offer is whichever locale line the active pack carries — asserting the
    // English wording would pass or fail on the default target language rather
    // than on the mode.
    const { OFFER_LINE } = await import("./patience.ts");
    const offers = Object.values(OFFER_LINE);
    assert(
      spoken.slice(before13).some((t: string) => offers.includes(t)),
      "case 13: after a resume the offer fires again — the rehearsal's silence did not follow the session out",
    );

    // Both halves of the mirror are cleared in `resume`, or a half-fix passes.
    const src13 = readFileSync(`${ROOT}src/lib/useTalk.ts`, "utf8");
    const resumeBlock = src13.slice(src13.indexOf("const resume = useCallback"), src13.indexOf("const driveRewind"));
    assert(/setRehearsal\(null\)/.test(resumeBlock), "case 13: resume clears the rehearsal state");
    assert(/rehearsalRef\.current = null/.test(resumeBlock), "case 13: resume clears the mirrored ref");
    assert(/setOutOfRole\(false\)/.test(resumeBlock), "case 13: resume leaves no previous debrief phase behind");
    assert(/setDebrief\(null\)/.test(resumeBlock), "case 13: resume leaves no previous debrief behind");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
}

console.log("rehearsal.check: ok");
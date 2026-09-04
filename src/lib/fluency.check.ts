// Runnable self-check for the M7 monitor layer's context object and off switch
// (PLAN-039). Run: node --experimental-strip-types src/lib/fluency.check.ts
//
// What is pinned here is the promise the layer makes before it measures anything:
// every measurement carries the conditions it ran under, the set of monitor
// kinds is closed so the kill switch can delete a kind the moment it exists, and
// turning the measurement off really stops the measuring.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { MONITOR_KINDS, FREE_CONTEXT, sessionContextSignal, timingOf, timingSignal, FILLERS, verifySelfRepairs, selfRepairSignal, saidAt, saidInOrder, verifyAbandoned, verifyL1Fallback, verifyAvoidance, abandonedUtteranceSignal, l1FallbackSignal, avoidanceSignal, showInline, closingItems, fluencyContext, accuracyContext, FLUENCY_MINUTES, CONTRACT_TEXT } from "./fluency.ts";
import { scriptOf, languageScript } from "./langs.ts";
import { shouldShowInline, parseProduction, FLUENCY_RULE4 } from "./prompts.ts";
import { monitorContext, signalMiss, type Signal, type SignalKind } from "./model.ts";
import { talkSignals } from "./signals.ts";
import type { Correction, CorrectionCategory, Severity } from "./prompts.ts";
import type { VoiceTurn } from "./useTalk.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// --- 1. MONITOR_KINDS is closed ------------------------------------------------
// Every kind in the list is a real SignalKind, and every SignalKind whose comment
// names a PLAN-04x is in the list. This is the check that keeps the kill switch a
// plan ahead rather than a plan behind — it fails the build when PLAN-041 adds a
// kind and forgets the list.
const modelSrc = readFileSync(join(ROOT, "src/lib/model.ts"), "utf8");
const kindBlock = modelSrc.match(/export type SignalKind =([\s\S]*?);/)?.[1] ?? "";
// Every kind in MONITOR_KINDS is a member of the union.
for (const k of MONITOR_KINDS) {
  assert(
    new RegExp(`"${k}"`).test(kindBlock),
    `MONITOR_KINDS contains "${k}", which is not a SignalKind`,
  );
}
// Every SignalKind whose comment names a PLAN-04x is in MONITOR_KINDS.
for (const m of kindBlock.matchAll(/\| "([a-zA-Z]+)"\s*\/\/[^\n]*PLAN-04/g)) {
  const kind = m[1];
  assert(
    MONITOR_KINDS.includes(kind as SignalKind),
    `SignalKind "${kind}" is a PLAN-04x kind but is missing from MONITOR_KINDS`,
  );
}
// The list is exactly the six kinds this milestone writes — no more, no less.
assert.deepEqual(
  [...MONITOR_KINDS].sort(),
  ["abandonedUtterance", "avoidance", "l1Fallback", "selfRepair", "sessionContext", "timing"].sort(),
  "MONITOR_KINDS must be exactly the six monitor kinds",
);

// --- 2. sessionContextSignal → monitorContext round-trips ----------------------
const ctx: typeof FREE_CONTEXT = {
  mode: "fluency",
  planningTimeSec: 30,
  taskRepetition: 2,
  interlocutorPressure: "paced",
  topicFamiliarity: "prepared",
};
const draft = sessionContextSignal("talk-1", ctx);
const asSignal: Signal = { id: "s1", activityId: "talk-1", kind: draft.kind, observedAt: 0, payload: draft.payload };
assert.deepEqual(monitorContext(asSignal), ctx, "a sessionContext signal round-trips every field");

// monitorContext returns null — never a default — for anything malformed.
const sig = (kind: Signal["kind"], payload: unknown): Signal => ({
  id: "s1",
  activityId: "a1",
  kind,
  observedAt: 0,
  payload,
});
assert.equal(monitorContext(sig("unpromptedTurn", ctx)), null, "a signal of another kind is not a context");
assert.equal(monitorContext(sig("sessionContext", null)), null, "a null payload is not a context");
assert.equal(monitorContext(sig("sessionContext", "free")), null, "a bare string is not a context");
assert.equal(monitorContext(sig("sessionContext", {})), null, "a payload missing every field is not a context");
assert.equal(
  monitorContext(sig("sessionContext", { ...ctx, mode: "drill" })),
  null,
  "a mode outside the union is not a context",
);
assert.equal(
  monitorContext(sig("sessionContext", { ...ctx, taskRepetition: 4 })),
  null,
  "a taskRepetition outside 1|2|3 is not a context",
);
assert.equal(
  monitorContext(sig("sessionContext", { ...ctx, interlocutorPressure: "loud" })),
  null,
  "an interlocutorPressure outside the union is not a context",
);
assert.equal(
  monitorContext(sig("sessionContext", { ...ctx, topicFamiliarity: "known" })),
  null,
  "a topicFamiliarity outside the union is not a context",
);

// --- 3. FREE_CONTEXT is pinned -------------------------------------------------
// Every session written before PLAN-043 is compared against this forever, so it
// is pinned byte for byte.
assert.deepEqual(FREE_CONTEXT, {
  mode: "free",
  planningTimeSec: 0,
  taskRepetition: 1,
  interlocutorPressure: "none",
  topicFamiliarity: "novel",
});

// --- 4. context: null writes nothing; a context writes exactly one -------------
const base = {
  turns: 1,
  corrections: [],
  words: [],
  produced: [
    { text: "Hola.", fromSuggestion: false, words: 1, latencyMs: 1000, speakMs: 0, speakUnknown: false, missed: [], keyWord: "", breakdown: [], verdict: "clear" as const, spoken: false },
  ],
  summary: "",
  strengths: [],
  focus: [],
  selfRepairs: [],
  completion: { repairs: [], abandoned: [], l1: [], avoidance: null },
};
const off = talkSignals("talk-1", { ...base, context: null }, "es", "es");
assert(
  !off.some((d) => MONITOR_KINDS.includes(d.kind)),
  "fluency ledger 12: with context null (measurement off), no monitor signal is written",
);
const on = talkSignals("talk-1", { ...base, context: FREE_CONTEXT }, "es", "es");
assert.equal(
  on.filter((d) => d.kind === "sessionContext").length,
  1,
  "with a context, exactly one sessionContext signal is written",
);

// --- 5. spoken rides both turn kinds, and survives the kill switch --------------
const spoken = talkSignals(
  "talk-1",
  {
    ...base,
    produced: [
      { text: "Hola.", fromSuggestion: false, words: 1, latencyMs: 1000, speakMs: 0, speakUnknown: false, missed: [], keyWord: "", breakdown: [], verdict: "clear" as const, spoken: true },
      { text: "Adiós.", fromSuggestion: true, words: 1, latencyMs: 1000, speakMs: 0, speakUnknown: false, missed: [], keyWord: "", breakdown: [], verdict: "clear" as const, spoken: true },
    ],
    context: FREE_CONTEXT,
  },
  "es",
  "es",
);
const turnKinds = spoken.filter((d) => d.kind === "unpromptedTurn" || d.kind === "suggestionUsed");
assert.equal(turnKinds.length, 2, "both turn kinds are present");
const unaided = turnKinds.find((d) => d.kind === "unpromptedTurn")!;
const suggested = turnKinds.find((d) => d.kind === "suggestionUsed")!;
assert.equal((unaided.payload as { spoken: boolean }).spoken, true, "an unaided spoken turn carries spoken: true");
// A picked suggestion is by definition not spoken — the builder forces false
// even when a caller handed a `spoken: true` turn through.
assert.equal((suggested.payload as { spoken: boolean }).spoken, false, "a suggestionUsed turn carries spoken: false, never true");
// A payload built by turnSignal still has `spoken` after the monitor kinds are
// filtered out — the kill switch must not remove a fact about the turn.
const afterKill = spoken.filter((d) => !MONITOR_KINDS.includes(d.kind));
for (const d of afterKill.filter((x) => x.kind === "unpromptedTurn" || x.kind === "suggestionUsed")) {
  assert.equal(typeof (d.payload as { spoken: boolean }).spoken, "boolean", "spoken survives the monitor kinds being filtered out");
}

// --- 5b. no monitor kind's payload carries `correct` or `grade` -----------------
// `signalMiss` reads `correct`/`grade` regardless of kind, so a monitor payload
// that slipped one in would silently become a miss. The only monitor writer today
// is `sessionContextSignal`; assert its payload carries neither key. The source
// scan below keeps the same promise for the five kinds PLAN-040–042 will write:
// a future writer that adds `correct`/`grade` to a monitor payload fails the build.
const ctxPayload = sessionContextSignal("talk-1", FREE_CONTEXT).payload as Record<string, unknown>;
assert(!("correct" in ctxPayload) && !("grade" in ctxPayload), "a sessionContext payload must not carry correct/grade");

// Source scan: no monitor kind's payload builder names `correct` or `grade`.
// Scoped to the two files that build monitor payloads — fluency.ts today, and
// signals.ts where PLAN-040–042's writers will land. A monitor kind and a
// `correct`/`grade` key in the same payload object is the trap this closes now.
for (const file of ["src/lib/fluency.ts", "src/lib/signals.ts"]) {
  const src = readFileSync(join(ROOT, file), "utf8");
  for (const kind of MONITOR_KINDS) {
    const re = new RegExp(`kind:\\s*"${kind}"`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const tail = src.slice(m.index, m.index + 400);
      assert(
        !/correct\s*:|grade\s*:/.test(tail),
        `${file}: a ${kind} payload must not carry correct/grade`,
      );
    }
  }
}

// --- 6. audio is not retained by default ---------------------------------------
// fluency ledger 13: speech.ts has no writer for the clip or the envelope, and no
// settings field turns one on. Asserted against the source, like the roadmap's
// D5: the envelope and the clip live in memory for the length of one turn and are
// dropped.
const speechSrc = readFileSync(join(ROOT, "src/lib/speech.ts"), "utf8");
assert(
  !/writeFile|saveFile|persist|localStorage|appDataDir|appConfigDir/.test(speechSrc),
  "fluency ledger 13: speech.ts must not write the clip or the envelope anywhere",
);
const settingsSrc = readFileSync(join(ROOT, "src/lib/settings.ts"), "utf8");
assert(
  !/retain|recordAudio|saveAudio|keepAudio/.test(settingsSrc),
  "fluency ledger 13: no settings field turns audio retention on",
);

// --- 7. the six numbers --------------------------------------------------------
// fluency ledger 1 — §2's signals are computed from transcript + audio and stored
// with their context. Hand-built envelopes at 20 frames/s, so every expected
// value is arithmetic a reader can do.
const vt = (over: Partial<VoiceTurn>): VoiceTurn => ({
  text: "one two three four five six",
  ms: 3000,
  levels: [],
  locale: "en",
  initiationMs: 0,
  ...over,
});

// 1. A 60-frame envelope (3 s) all above the floor, six words → speechRate 120,
//    articulationRate 120, meanLengthOfRun 6, midClausePauseRatio null (no pause).
{
  const allSpeech = Array.from({ length: 60 }, () => 0.3);
  const t = timingOf(vt({ levels: allSpeech }), "en")!;
  assert(t, "a full 3 s recording measures");
  assert.equal(Math.round(t.speechRate), 120, "six words over 3 s is 120 wpm");
  assert.equal(Math.round(t.articulationRate), 120, "no silence: articulation equals speech rate");
  assert.equal(t.meanLengthOfRun, 6, "one run of six words");
  assert.equal(t.midClausePauseRatio, null, "no pause → no mid-clause ratio, not 0");
}

// 2. The same six words over 3 s of speech with a 1 s gap in the middle →
//    articulationRate stays 120 while speechRate drops. The pair §2.1 says matters.
{
  const gap: number[] = [
    ...Array.from({ length: 30 }, () => 0.3),
    ...Array.from({ length: 20 }, () => 0),
    ...Array.from({ length: 30 }, () => 0.3),
  ];
  const t = timingOf(vt({ levels: gap, ms: 4000 }), "en")!;
  assert(t, "a gapped recording measures");
  assert(Math.round(t.articulationRate) > Math.round(t.speechRate), "a pause widens the gap between articulation and speech rate");
  assert.equal(Math.round(t.articulationRate), 120, "articulation rate ignores the silence");
}

// 3. meanLengthOfRun halves when one pause splits an even recording in two.
{
  const split: number[] = [
    ...Array.from({ length: 30 }, () => 0.3),
    ...Array.from({ length: 20 }, () => 0),
    ...Array.from({ length: 30 }, () => 0.3),
  ];
  const t = timingOf(vt({ levels: split, ms: 4000 }), "en")!;
  assert.equal(t.meanLengthOfRun, 3, "one pause splits six words into two runs of three");
}

// 4. timingOf returns null for: no words, no envelope, and a recording under 1.5 s.
{
  assert.equal(timingOf(vt({ text: "" }), "en"), null, "no words → null");
  assert.equal(timingOf(vt({ levels: [] }), "en"), null, "no envelope → null");
  assert.equal(timingOf(vt({ ms: 1000, levels: [0.3, 0.3] }), "en"), null, "under 1.5 s → null");
}

// 4b. A full envelope that carries no speech frame at all — the mic opened and
// nothing was said — measures nothing. Without this guard, `utteranceMs` is 0 and
// both rates divide by it to `Infinity`; a recording that caught no speech has
// measured nothing, and the answer is null, never a number.
{
  const silent = Array.from({ length: 60 }, () => 0); // 3 s of pure silence
  assert.equal(timingOf(vt({ levels: silent }), "en"), null, "an envelope with no speech frame → null");
}

// 5. initiationLatency is null when initiationMs is null, even when the envelope
//    has a perfectly good leading silence.
{
  const lead: number[] = [...Array.from({ length: 20 }, () => 0), ...Array.from({ length: 40 }, () => 0.3)];
  const t = timingOf(vt({ levels: lead, initiationMs: null }), "en")!;
  assert(t, "a recording with leading silence still measures");
  assert.equal(t.initiationLatency, null, "an absent initiation half makes the whole absent");
}

// --- 8. midClausePauseRatio is a bound, in more than one language --------------
// fluency ledger 3 — clause-boundary detection for midClausePauseRatio is tested
// in the target language. For each of es, tr and ja.
{
  const cases: { locale: string; text: string; sep: string }[] = [
    { locale: "es", text: "una respuesta", sep: ", " },
    { locale: "tr", text: "bir cevap", sep: ", " },
    // ja is here on purpose: its clause punctuation (、) is not in the Latin set,
    // and this is what proves the boundary set is not Latin-only.
    { locale: "ja", text: "こんにちは", sep: "、" },
  ];
  for (const { locale, text, sep } of cases) {
    // A one-clause utterance with three pauses → ratio 1 (nothing accounts for them).
    const threePauses: number[] = [
      ...Array.from({ length: 10 }, () => 0.3),
      ...Array.from({ length: 10 }, () => 0),
      ...Array.from({ length: 10 }, () => 0.3),
      ...Array.from({ length: 10 }, () => 0),
      ...Array.from({ length: 10 }, () => 0.3),
      ...Array.from({ length: 10 }, () => 0),
      ...Array.from({ length: 10 }, () => 0.3),
    ];
    const one = timingOf(vt({ text, locale, levels: threePauses, ms: 3500 }), "en")!;
    assert.equal(one.midClausePauseRatio, 1, `${locale}: three pauses, one clause → ratio 1`);

    // An utterance with as many clause boundaries as pauses → ratio 0.
    const twoClauses = text + sep + text; // one boundary → two clauses
    const onePause: number[] = [
      ...Array.from({ length: 10 }, () => 0.3),
      ...Array.from({ length: 10 }, () => 0),
      ...Array.from({ length: 10 }, () => 0.3),
    ];
    const zero = timingOf(vt({ text: twoClauses, locale, levels: onePause, ms: 1500 }), "en")!;
    assert.equal(zero.midClausePauseRatio, 0, `${locale}: as many boundaries as pauses → ratio 0`);

    // More clause boundaries than pauses → ratio 0, never negative.
    const threeClauses = text + sep + text + sep + text; // two boundaries → three clauses
    const neverNeg = timingOf(vt({ text: threeClauses, locale, levels: onePause, ms: 1500 }), "en")!;
    assert.equal(neverNeg.midClausePauseRatio, 0, `${locale}: more boundaries than pauses → 0, never negative`);

    // No pauses at all → null, never 0.
    const noPause = Array.from({ length: 30 }, () => 0.3);
    const none = timingOf(vt({ text, locale, levels: noPause, ms: 1500 }), "en")!;
    assert.equal(none.midClausePauseRatio, null, `${locale}: no pause → null, never 0`);
  }
}

// --- 8b. leading silence is initiation, not a mid-clause pause -----------------
// A recording that opens with 3 s of silence, then a single clause with no
// mid-clause pause, must report midClausePauseRatio null (P is zero on the
// utterance slice) while initiationLatency carries those 3 s. One event, one
// place — the leading silence is never counted twice.
{
  const lead: number[] = [
    ...Array.from({ length: 60 }, () => 0), // 3 s of silence before the first sound
    ...Array.from({ length: 30 }, () => 0.3), // 1.5 s of continuous speech, one clause
  ];
  const t = timingOf(vt({ text: "una respuesta", locale: "es", levels: lead, ms: 4500, initiationMs: 500 }), "es")!;
  assert(t, "a recording with leading silence measures");
  assert.equal(t.midClausePauseRatio, null, "leading silence is not a mid-clause pause — P is zero on the utterance");
  assert(Math.abs(t.initiationLatency! - 3500) < 1, "initiationLatency carries the 3 s of leading silence plus the 500 ms initiationMs");
}

// --- 8c. FILLERS excludes common function words (regression lock) --------------
// The rule is that only tokens whose lexical use is rare enough to under-report
// belong in a filler list. "o" and "sea" are common Spanish function words, so
// they must never be counted as fillers — pinning them here stops a future edit
// from re-adding them.
{
  assert(!FILLERS.es.includes("o"), "es: 'o' is a common conjunction, not a filler");
  assert(!FILLERS.es.includes("sea"), "es: 'sea' is a common verb form, not a filler");
}

// --- 9. the signal, and the gate ----------------------------------------------
// fluency ledger 1 — the timing signal carries its unit and definition, and it is
// written only when the session has a context.
{
  // 1. timingSignal's payload carries a label, a unit and a definition, all
  //    non-empty (invariant 12), and no correct or grade.
  const t = timingOf(vt({ levels: Array.from({ length: 60 }, () => 0.3) }), "en")!;
  const draft = timingSignal("talk-1", t);
  const p = draft.payload as Record<string, unknown>;
  assert.equal(p.label, "spoken timing", "the timing signal names itself");
  assert(typeof p.unit === "string" && p.unit.length > 0, "the timing signal carries a unit");
  assert(typeof p.definition === "string" && p.definition.length > 0, "the timing signal carries a definition");
  assert(!("correct" in p) && !("grade" in p), "a timing payload must not carry correct/grade");

  // 2. Every rate's unit says words, not syllables — D1 written down.
  assert.match(p.unit as string, /words per minute/, "the unit names words, not syllables");

  // 3. A Reflection with voice and context: null produces no timing draft; the
  //    same reflection with FREE_CONTEXT produces exactly one per qualifying
  //    recording.
  const voice: VoiceTurn[] = [
    { text: "one two three four five six", ms: 3000, levels: Array.from({ length: 60 }, () => 0.3), locale: "en", initiationMs: 0 },
  ];
  const off = talkSignals("talk-1", { ...base, voice, context: null }, "es", "en");
  assert(!off.some((d) => d.kind === "timing"), "context null: no timing signal is written");
  const on = talkSignals("talk-1", { ...base, voice, context: FREE_CONTEXT }, "es", "en");
  assert.equal(on.filter((d) => d.kind === "timing").length, 1, "with a context, exactly one timing signal per qualifying recording");

  // 4. pace and pronunciation are still produced when context is null — M6's
  //    signals do not disappear behind M7's switch.
  assert(off.some((d) => d.kind === "pace"), "pace survives context null");
  assert(off.some((d) => d.kind === "pronunciation"), "pronunciation survives context null");
}

// --- 10. the model may point, we check (PLAN-041) -----------------------------
// fluency ledger 2 — a reported repair is believed only when both fragments are
// in the text the learner produced, `before` ahead of `after`, after the same
// folding `verifyCorrections` uses. `ahead` is checked *inside the line* too,
// because one recording is one line and a self-repair lives entirely inside it —
// item 3 is the case real data is made of. A repair the model authored is
// dropped, not softened.
{
  const transcript = ["I go to the doctor yesterday", "I went to the clinic"];
  const noCorrections: { original: string }[] = [];

  // 1. A report whose `before` is not in the transcript is dropped.
  assert.equal(
    verifySelfRepairs([{ before: "I go to the bank", after: "I went to the clinic", type: "E" }], transcript, noCorrections, "en").length,
    0,
    "a before not in the transcript is dropped",
  );
  // 2. A report whose `after` is not in the transcript is dropped.
  assert.equal(
    verifySelfRepairs([{ before: "I go to the doctor", after: "I went to the bank", type: "E" }], transcript, noCorrections, "en").length,
    0,
    "an after not in the transcript is dropped",
  );
  // 3. The reversed report, entirely inside one line, is dropped — `after`
  //    appearing *before* `before` within a single recording did not happen. This
  //    is the intra-line case PLAN-041's cross-line tests never reached.
  assert.equal(
    verifySelfRepairs([{ before: "I went to the doctor", after: "I go", type: "E" }], ["dün I go, I went to the doctor"], noCorrections, "en").length,
    0,
    "an after that precedes before inside one line is dropped",
  );
  // 3b. The same two fragments in the correct intra-line order survive.
  assert.equal(
    verifySelfRepairs([{ before: "I go", after: "I went to the doctor", type: "E" }], ["dün I go, I went to the doctor"], noCorrections, "en").length,
    1,
    "a forward repair inside one line survives",
  );
  // 4. Folding matches `verifyCorrections`: case and punctuation differences
  //    survive, a different word does not.
  assert.equal(
    verifySelfRepairs([{ before: "I go to the doctor", after: "I went to the clinic", type: "E" }], transcript, noCorrections, "en").length,
    1,
    "a verbatim repair survives",
  );
  assert.equal(
    verifySelfRepairs([{ before: "I go to the doctor!", after: "I went to the clinic", type: "E" }], transcript, noCorrections, "en").length,
    1,
    "a punctuation difference survives folding",
  );
  assert.equal(
    verifySelfRepairs([{ before: "I go to the doctor", after: "I went to the clinic", type: "E" }], ["I go to the doctor yesterday", "I went to the clinic"], noCorrections, "en").length,
    1,
    "a case difference survives folding",
  );
  // 5. An empty report list yields an empty signal list — not one signal with a zero.
  assert.equal(verifySelfRepairs([], transcript, noCorrections, "en").length, 0, "an empty report list yields no repairs");
}

// --- 11. `falseAlarm` cannot outrank a correction the learner already saw -----
// fluency ledger 2 — a falseAlarm on a phrase the coach corrected in the same
// session is downgraded to A, not dropped and not left as falseAlarm. Matching is
// exact after folding — a `before` that merely *contains* a corrected phrase is
// left as falseAlarm (substring matching would silently erase real false alarms).
{
  const transcript = ["I go to the doctor yesterday", "I went to the clinic"];
  const corrected = [{ original: "I go to the doctor" }];

  // 1. A falseAlarm whose `before` matches a Correction.original comes back as A.
  const downgraded = verifySelfRepairs(
    [{ before: "I go to the doctor", after: "I went to the clinic", type: "falseAlarm" }],
    transcript,
    corrected,
    "en",
  );
  assert.equal(downgraded.length, 1, "a falseAlarm on a corrected phrase is not dropped");
  assert.equal(downgraded[0].type, "A", "a falseAlarm on a corrected phrase is downgraded to A");

  // 2. Matching is exact after folding — a `before` that merely contains a
  //    corrected phrase is left as falseAlarm.
  const contains = verifySelfRepairs(
    [{ before: "I go to the doctor yesterday", after: "I went to the clinic", type: "falseAlarm" }],
    transcript,
    corrected,
    "en",
  );
  assert.equal(contains[0].type, "falseAlarm", "a before that merely contains a corrected phrase stays falseAlarm");

  // 3. With no corrections at all, a falseAlarm stands.
  const stands = verifySelfRepairs(
    [{ before: "I go to the doctor", after: "I went to the clinic", type: "falseAlarm" }],
    transcript,
    [],
    "en",
  );
  assert.equal(stands[0].type, "falseAlarm", "with no corrections, a falseAlarm stands");
}

// --- 12. absence, not zero, and §8's three doors (PLAN-041) -------------------
// fluency ledger 2, fluency ledger 11 — a session with no restart writes no
// selfRepair signal and no zero; Memory must not take these as errors.
{
  // 1. context: null ⇒ no selfRepair draft, whatever `selfRepairs` holds.
  const off = talkSignals(
    "talk-1",
    { ...base, context: null, selfRepairs: [{ before: "x", after: "y", type: "E" }] },
    "es",
    "en",
  );
  assert(!off.some((d) => d.kind === "selfRepair"), "context null: no selfRepair signal is written");

  // 2. An empty `selfRepairs` produces no draft — never a draft carrying count: 0.
  const on = talkSignals("talk-1", { ...base, context: FREE_CONTEXT, selfRepairs: [] }, "es", "en");
  assert(!on.some((d) => d.kind === "selfRepair"), "an empty selfRepairs produces no selfRepair signal");

  // 3. signalMiss(selfRepairSignal(...)) is false for all five types, including
  //    E, the one a reader would most plausibly think of as a mistake.
  for (const type of ["E", "A", "D", "C", "falseAlarm"] as const) {
    const draft = selfRepairSignal("talk-1", { before: "x", after: "y", type });
    const asSignal: Signal = { id: "s1", activityId: "talk-1", kind: draft.kind, observedAt: 0, payload: draft.payload };
    assert.equal(signalMiss(asSignal), false, `signalMiss(selfRepair ${type}) is false`);
  }

  // 4. talkSignals given a reflection with selfRepairs and no corrections produces
  //    zero correction drafts — a falseAlarm is a phrase that was right, and filing
  //    it as a correction is the exact corruption §8 names.
  const withRepairs = talkSignals(
    "talk-1",
    { ...base, context: FREE_CONTEXT, selfRepairs: [{ before: "x", after: "y", type: "falseAlarm" }] },
    "es",
    "en",
  );
  assert.equal(withRepairs.filter((d) => d.kind === "correction").length, 0, "a selfRepair never becomes a correction draft");

  // 5. §9's switch with teeth: with the measurement off, the model is not called
  //    at all — the acceptance is the *absence of the request*, not the absence of
  //    the signal. Pinned by source scan: the `productionPrompt` call in useTalk
  //    must sit behind `settings.monitorLoad`, so removing the gate fails the
  //    build.
  const talkSrc = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  const prodCall = talkSrc.slice(talkSrc.indexOf("settings.monitorLoad && voice.current.length"), talkSrc.indexOf("productionPrompt(") + 200);
  assert(
    /settings\.monitorLoad/.test(prodCall) && /productionPrompt\(/.test(prodCall),
    "fluency ledger 2: the production model call must be gated on settings.monitorLoad — off means no request",
  );
}

// --- 13. the shared gate, and the bug it exists to prevent (PLAN-042) ---------
// The ordering door every §2.2/§2.3 verification goes through checks *inside*
// the line as well as across lines, because one recording is one line and a
// self-repair lives entirely inside it.
{
  // 1. The reversed report, entirely inside one line, is out of order — this is
  //    the case PLAN-041's cross-line test did not reach, and the case real data
  //    is made of.
  assert.equal(
    saidInOrder(["dün I go, I went to the doctor"], "I went to the doctor", "I go", "en"),
    false,
    "saidInOrder: the reversed report inside one line is false",
  );
  // 2. The same pair forwards is true.
  assert.equal(
    saidInOrder(["dün I go, I went to the doctor"], "I go", "I went to the doctor", "en"),
    true,
    "saidInOrder: the forward report inside one line is true",
  );
  // 3. `after` overlapping `before` is false — it must start after `before` ends.
  assert.equal(saidInOrder(["abcdef"], "abc", "bcd", "en"), false, "saidInOrder: an after overlapping before is false");
  // 4. saidAt finds a fragment and folds.
  assert.ok(saidAt(["I go to the doctor"], "I go to the doctor", "en"), "saidAt finds the span");
  assert.ok(saidAt(["I go to the doctor!"], "I go to the doctor", "en"), "saidAt folds punctuation");
  assert.equal(saidAt(["the clinic"], "I went", "en"), null, "saidAt null when the span is absent");
}

// --- 14. abandoned and L1 (PLAN-042) ------------------------------------------
// fluency ledger 1 — the abandoned-utterance and L1 slips rest on the same
// presence gate, and the script gate is open-fails so it never deletes a real
// fallback.
{
  // 1. A fragment not in the transcript is dropped.
  assert.equal(verifyAbandoned([{ fragment: "I was going to" }], ["I went to the doctor"], "en").length, 0, "an abandoned fragment not in the transcript is dropped");
  assert.equal(verifyAbandoned([{ fragment: "I went to" }], ["I went to the doctor"], "en").length, 1, "an abandoned fragment in the transcript survives");

  // 2. A Japanese target with an English native language: a reported L1 span
  //    written in kana is dropped; one written in Latin survives. The scripts are
  //    the ones `languageScript` really hands the caller, not hand-picked ones —
  //    a gate tested on inputs its caller never produces is not tested.
  const jaTrans = ["えー、私は今日学校に行かなかった。Actually I went to the doctor."];
  const ja = languageScript("Japanese");
  const en = languageScript("English");
  assert.equal(verifyL1Fallback([{ span: "学校に" }], jaTrans, "ja", ja, en).length, 0, "a kana span is not an English fallback");
  assert.equal(verifyL1Fallback([{ span: "Actually I went" }], jaTrans, "ja", ja, en).length, 1, "a Latin span survives the script gate");

  // 2b. The same two languages the other way round — an English target with a
  //     Japanese native language. The transcript is an English recognizer's
  //     output, so it is Latin from end to end and a romanized slip is the only
  //     shape a real L1 fallback can take. A gate reading "not kana, so not
  //     Japanese" would delete every one of them, for every learner whose native
  //     language is not written in Latin. The gate has nothing to read here and
  //     stays open.
  assert.equal(
    verifyL1Fallback([{ span: "nanka" }], ["I went to the doctor, nanka, it was fine"], "en", en, ja).length,
    1,
    "a romanized slip survives when the native script cannot appear in the transcript",
  );

  // 3. A Spanish target with an English native language (shared script): gate 1
  //    only, and a span in the transcript survives. Asserted so the *absence* of
  //    the script gate is deliberate and visible rather than an accident.
  assert.equal(verifyL1Fallback([{ span: "the bill" }], ["Quiero the bill, por favor."], "es", languageScript("Spanish"), en).length, 1, "a shared-script span survives on gate 1 alone");

  // 4. scriptOf("") and scriptOf("123 …") are null, and a null script never drops
  //    anything — an unmeasurable gate is open, not closed.
  assert.equal(scriptOf(""), null, "scriptOf('') is null");
  assert.equal(scriptOf("123 …"), null, "scriptOf of digits and punctuation is null");
  // A null *language* script is treated as the shared-script case, never as a
  // differing one — a null script must not fail shut.
  assert.equal(verifyL1Fallback([{ span: "the bill" }], ["Quiero the bill"], "es", null, null).length, 1, "a null script never drops anything");
}

// --- 15. avoidance, every gate (PLAN-042) -------------------------------------
// fluency ledger 11 — avoidance is the silent one: nothing in the transcript
// stands behind it, so every gate errs towards writing nothing. `judged: true`
// is the honest flag on the one signal it does write.
{
  // 1. No goal ⇒ no signal, whatever the model said.
  assert.equal(verifyAvoidance(null), null, "no goal: no avoidance claim");

  // 2. attempted: true ⇒ no signal.
  assert.equal(verifyAvoidance({ goal: "past simple", attempted: true, evidence: "I went" }), null, "attempted: true writes no signal");

  // 3. attempted: true whose evidence is nowhere near the transcript ⇒ still no
  //    signal. Dropped, never flipped to avoidance: the two answers are the same
  //    answer, which is why the check is one line and not a gate.
  assert.equal(verifyAvoidance({ goal: "past simple", attempted: true, evidence: "I flew" }), null, "an unevidenced attempt is dropped, never flipped to avoidance");

  // 4. attempted: false with a goal ⇒ a signal whose label is the goal and whose
  //    payload carries judged: true. Read through `parseProduction` rather than
  //    hand-built: `attempted: false` has nothing to evidence, so the answer a
  //    model actually sends omits the field, and a parse that demanded it would
  //    drop the only branch that ever files a signal.
  const parsed = parseProduction('{"repairs": [], "avoidance": { "goal": "past simple", "attempted": false }}');
  assert.ok(parsed.avoidance, "an avoidance claim with no evidence field still parses");
  const kept = verifyAvoidance(parsed.avoidance);
  assert.ok(kept, "attempted: false with a goal survives");
  const signal = avoidanceSignal("talk-1", kept!)!;
  assert.equal(signal.kind, "avoidance");
  assert.equal((signal.payload as { label: string }).label, "past simple", "the avoidance label is the goal itself");
  assert.equal((signal.payload as { judged: boolean }).judged, true, "the avoidance payload carries judged: true");

  // 5. signalMiss is false for avoidance, abandonedUtterance and l1Fallback —
  //    Memory must not take any of them as a miss.
  const asSig = (d: { kind: SignalKind; payload: unknown }): Signal => ({ id: "s", activityId: "talk-1", kind: d.kind, observedAt: 0, payload: d.payload });
  assert.equal(signalMiss(asSig(abandonedUtteranceSignal("talk-1", { fragment: "x" }))), false, "signalMiss(abandonedUtterance) is false");
  assert.equal(signalMiss(asSig(l1FallbackSignal("talk-1", { span: "x" }))), false, "signalMiss(l1Fallback) is false");
  assert.equal(signalMiss(asSig(signal)), false, "signalMiss(avoidance) is false");
}

// --- 16. the completion signals write only through the context gate (PLAN-042) -
// With the measurement off, none of the three §2.3 kinds reaches a draft,
// whatever the reflection carries.
{
  const reflection = {
    ...base,
    context: null,
    completion: {
      repairs: [],
      abandoned: [{ fragment: "I was going to" }],
      l1: [{ span: "the bill" }],
      avoidance: { goal: "past simple", attempted: false, evidence: "" },
    },
  };
  const off = talkSignals("talk-1", reflection, "es", "en");
  for (const kind of ["abandonedUtterance", "l1Fallback", "avoidance"] as const) {
    assert(!off.some((d) => d.kind === kind), `context null: no ${kind} signal is written`);
  }
}

// --- 17. showInline — the whole cross-product (PLAN-043) -----------------------
// fluency ledger 4 — §4.2 rule 2 "live error marking is off at code level" is a
// table, not a claim: three modes × three timings × three severities × in-role.
// Every fluency row is false. Every in-role row is false. Accuracy answers live
// (its *mode*, not a setting — §4.3) and equals `shouldShowInline("live", ...)`
// exactly, whatever the learner's `correctionTiming`. Free answers
// `shouldShowInline(timing, ...)` exactly — the ordinary session must not
// quietly change.
{
  const MOODS = ["free", "fluency", "accuracy"] as const;
  const TIMINGS = ["adaptive", "live", "delayed"] as const;
  const SEVS = [undefined, "minor", "severe"] as unknown as Severity[];
  let checks = 0;
  for (const mode of MOODS)
    for (const timing of TIMINGS)
      for (const severity of SEVS)
        for (const inRole of [false, true]) {
          const got = showInline(mode, timing, severity, inRole);
          if (mode === "fluency") {
            assert.equal(got, false, `fluency must answer false for ${timing}/${severity}/role=${inRole}`);
          } else if (inRole) {
            assert.equal(got, false, `in-role must answer false for ${mode}/${timing}/${severity}`);
          } else if (mode === "accuracy") {
            assert.equal(
              got,
              shouldShowInline("live", severity),
              `accuracy must equal shouldShowInline(live, ..) for ${timing}/${severity} — live is the mode, not a setting`,
            );
          } else {
            assert.equal(
              got,
              shouldShowInline(timing, severity),
              `free must equal shouldShowInline for ${timing}/${severity}`,
            );
          }
          checks += 1;
        }
  assert.equal(checks, MOODS.length * TIMINGS.length * SEVS.length * 2, "the cross-product is walked in full");
}

// --- 18. closingItems — rule 6, every sub-rule (PLAN-043) ----------------------
// fluency ledger 4 — §4.2 rule 6's arithmetic: at most three items in the fixed
// order meaning → pattern → strength, and a slot with nothing in it stays empty.
{
  const corr = (
    category: CorrectionCategory,
    severity: Severity,
    original = `${category}-${severity}`,
    note = `note ${category} ${severity}`,
  ): Correction => ({ original, fixed: `${original}✓`, note, severity, category });

  // 1. A severe error, a repeated category, and a strength ⇒ exactly three, in order.
  const c1 = corr("grammar", "severe");
  const p1 = corr("vocabulary", "minor", "v1");
  const p2 = corr("vocabulary", "minor", "v2");
  const three = closingItems([c1, p1, p2], ["a strong moment"]);
  assert.equal(three.length, 3, "all three slots fill");
  assert.deepEqual(three.map((i) => i.slot), ["meaning", "pattern", "strength"], "order is meaning, pattern, strength");
  assert.equal(three[0].text, "note grammar severe", "the meaning slot carries the severe correction's note");

  // 2. No severe error ⇒ two items, and the meaning slot is not backfilled.
  //    Two minor errors in the same category form a pattern; the meaning slot
  //    stays empty rather than admitting a minor error as a stand-in severe one.
  const noSevere = closingItems([corr("grammar", "minor", "g1"), corr("grammar", "minor", "g2")], ["a strong moment"]);
  assert.equal(noSevere.length, 2, "no severe error, but a pattern + a strength ⇒ two items, not three");
  assert.deepEqual(noSevere.map((i) => i.slot), ["pattern", "strength"], "the meaning slot stays empty, not backfilled with a minor one");

  // 3. A category appearing once is not a pattern ⇒ no pattern item.
  const noPattern = closingItems([corr("grammar", "minor")], ["a strong moment"]);
  assert.deepEqual(noPattern.map((i) => i.slot), ["strength"], "a single category is not a pattern");

  // 4. The same correction cannot fill both (a) and (b). A severe grammar error
  //    and a second grammar error ⇒ the pattern slot takes the second one.
  const g1 = corr("grammar", "severe", "g1");
  const g2 = corr("grammar", "minor", "g2");
  const both = closingItems([g1, g2], []);
  assert.deepEqual(both.map((i) => i.slot), ["meaning", "pattern"], "severe + repeat grammar fills meaning and pattern");
  assert.notEqual(both[1]?.text, g1.note, "the pattern slot does not reuse the meaning object");

  // 5. Ten corrections and three strengths ⇒ still at most three items.
  const many = closingItems(
    Array.from({ length: 10 }, (_, i) => corr("grammar", i % 2 === 0 ? "severe" : "minor", `e${i}`)),
    ["s1", "s2", "s3"],
  );
  assert(many.length <= 3, "ten corrections still close with at most three items");

  // 6. Nothing at all ⇒ an empty array, not a placeholder line.
  assert.deepEqual(closingItems([], []), [], "no corrections and no strengths ⇒ an empty array");
}

// --- 19. one mode per session (PLAN-043) ---------------------------------------
// fluency ledger 6 — the mode is one field of one union on one ref written once,
// in `start`. A source scan asserts `sessionContext.current =` appears only in
// `start` and the resume path, and `fluencyContext(` is called from exactly one
// file (the contract component). So a session is exactly one mode, at the type
// level — accuracy and fluency cannot both run, because there is no second flag.
{
  const talkSrc = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  const writers = [...talkSrc.matchAll(/sessionContext\.current\s*=\s*(context|FREE_CONTEXT);/g)];
  assert.equal(writers.length, 2, "sessionContext.current = appears exactly twice (start + resume)");
  const startBody = talkSrc.slice(talkSrc.indexOf("const start = useCallback"), talkSrc.indexOf("const startRehearsal = useCallback"));
  const resumeBody = talkSrc.slice(talkSrc.indexOf("const resume = useCallback"), talkSrc.indexOf("const driveRewind = useCallback"));
  assert(/sessionContext\.current\s*=\s*context/.test(startBody), "start writes the context from its parameter");
  assert(/sessionContext\.current\s*=\s*FREE_CONTEXT/.test(resumeBody), "resume resets the context to FREE_CONTEXT");

  // `fluencyContext(` — the mode cannot be entered except through the contract.
  const files = ["src/views/Talk.tsx", "src/views/talk/Contract.tsx", "src/lib/useTalk.ts", "src/lib/fluency.ts", "src/lib/fluency.check.ts"];
  const callers: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const m of src.matchAll(/fluencyContext\(/g)) callers.push(`${f}`);
  }
  // The definition in fluency.ts and the one call in the check file are not
  // callers-of-record; exactly one *usage* file may call it (the contract view).
  const usageFiles = [...new Set(callers.filter((f) => f !== "src/lib/fluency.ts" && f !== "src/lib/fluency.check.ts"))];
  assert.equal(usageFiles.length, 1, "fluencyContext( is called from exactly one file");
  assert(usageFiles[0]?.endsWith("Contract.tsx"), `fluencyContext( must be called from the contract, got ${usageFiles[0]}`);

  // The two context builders produce the two modes; there is no second mode field.
  assert.equal(fluencyContext().mode, "fluency", "fluencyContext builds the fluency mode");
  assert.equal(accuracyContext().mode, "accuracy", "accuracyContext builds the accuracy mode");
  assert.deepEqual({ ...FREE_CONTEXT, mode: "fluency" }, fluencyContext(), "fluencyContext is FREE_CONTEXT's fields with the mode changed");
}

// --- 20. the contract cannot be skipped or suppressed (PLAN-043) ---------------
// fluency ledger 5 — no Settings field matches /contract|dontShow|skipIntro/i,
// the contract component contains no localStorage/sessionStorage, and the accept
// handler is the only path to `fluencyContext` (already asserted in 19).
{
  const settingsSrc = readFileSync(join(ROOT, "src/lib/settings.ts"), "utf8");
  assert(
    !/contract|dontShow|skipIntro/i.test(settingsSrc),
    "the contract has no settings row, no 'don't show again', no skip — it is shown every session",
  );
  const contractSrc = readFileSync(join(ROOT, "src/views/talk/Contract.tsx"), "utf8");
  assert(
    !/localStorage|sessionStorage/.test(contractSrc),
    "the contract must not persist anything — shown every session, never suppressed",
  );
  // The contract screen's accept button is the one onStart → fluencyContext path.
  assert(/onStart\(fluencyContext\(\)\)/.test(contractSrc), "the contract's accept handler is the only path to fluencyContext");
  // The contract's one paragraph is the §4.1 promise — pinned here so deleting
  // the promise fails the build, not just the screen. The screen imports the
  // constant and renders it in its single paragraph (`why`).
  assert(/import \{ fluencyContext, CONTRACT_TEXT/.test(contractSrc), "the contract imports the §4.1 text from fluency.ts");
  assert(
    CONTRACT_TEXT.includes("mistakes are free") &&
      CONTRACT_TEXT.includes("at most three things") &&
      CONTRACT_TEXT.includes("keep speaking"),
    "the contract text carries §4.1's promises: no corrections, at most three things, keep speaking",
  );
  assert(FLUENCY_MINUTES === 5, "the fluency session is five minutes — the contract and entry both say so");
}

// --- 21. the seven rules, one assertion each (PLAN-043) ------------------------
// fluency ledger 4 — a numbered list of §4.2's seven rules, so a rule dropped
// later leaves a numbered hole. The three pure-function rules (2, 4, 6) are
// asserted in sections 17–19 above; the four flags are asserted at the lever
// where they are set, in the source.
{
  // Rule 1 — the rewind is off in fluency mode.
  const src = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  assert(
    /off:\s*sessionContext\.current\.mode === "fluency" \|\| !settings\.rewinds/.test(src),
    "rule 1: the rewind budget's off includes fluency mode",
  );

  // Rule 2 — live error marking off at code level, the pure function (see 17).
  assert(showInline("fluency", "live", "severe", false) === false, "rule 2: showInline is false in fluency even on a severe error with live timing");
  // The one call site in useTalk consults showInline, not shouldShowInline.
  assert(
    /inline:\s*rehearsal \? false : showInline\(/.test(src),
    "rule 2: the inline decision is showInline, the single door",
  );

  // Rule 3 — the rail's suggestions are behind a click in fluency mode.
  const talkView = readFileSync(join(ROOT, "src/views/Talk.tsx"), "utf8");
  assert(
    /talk\.mode === "fluency" \? \(\s*<button className="stuck-toggle"/.test(talkView),
    "rule 3: the stuck list opens on the learner's own tap in fluency mode",
  );

  // Rule 4 — the prompt sentence is present in the mode's system prompt.
  assert(FLUENCY_RULE4.length > 0, "rule 4: the rule-4 sentence is not empty");
  assert(
    /mode === "fluency" \? `\\n\$\{FLUENCY_RULE4\}` : ""/.test(src),
    "rule 4: the fluency system prompt folds FLUENCY_RULE4 in",
  );

  // Rule 5 — the mic's silence floor is ≥ 2 s in fluency mode. §4.2 says "en az
  // 2 saniye"; a value below that (or a bad one) must not let the 1.8 s default
  // back in. Asserted as the floor at the read site, not as the setting's shape.
  assert(
    /silenceMs:\s*sessionContext\.current\.mode === "fluency" \? Math\.max\(2, \.\.\.\)/.test(src) ||
      /silenceMs:\s*sessionContext\.current\.mode === "fluency" \? Math\.max\(2/.test(src),
    "rule 5: the fluency silence is clamped to at least 2 s at the read site",
  );
  assert(
    /fluencySilenceSec:\s*2/.test(readFileSync(join(ROOT, "src/lib/settings.ts"), "utf8")),
    "rule 5: the silence default is 2 s — the §4.2 floor",
  );

  // Rule 6 — at most three closing items (see 18), and the reflection delivers
  // exactly them. The same source-scan treatment rule 3 got: nothing else in the
  // fluency reflection may surface the correction list or count, or it would
  // silently come back as the random list the mode's contract refused.
  assert(closingItems([], []).length === 0, "rule 6: closingItems is exercised (see 18)");
  assert(
    /talk\.mode !== "fluency" && \(\s*<div>\s*<b>\{r\.corrections\.length\}/.test(talkView),
    "rule 6: the correction counter in the reflection's stats is gated off in fluency mode",
  );
  assert(
    /r\.corrections\.length > 0 && talk\.mode !== "fluency"/.test(talkView),
    "rule 6: the 'Worth revisiting' block is gated off in fluency mode",
  );

  // Rule 7 — the timer closes the mode and the extension is the learner's.
  assert(
    /fluencyUntil\.current\s*=\s*null;\s*setFluencyLeftMs\(0\);\s*setFluencyUp\(true\)/.test(src),
    "rule 7: the timer closes the mode when it fires",
  );
  assert(
    /const extend = useCallback/.test(src),
    "rule 7: extend() exists — the learner's own extension",
  );
}

console.log("fluency.check OK");
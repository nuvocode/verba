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
import { MONITOR_KINDS, FREE_CONTEXT, sessionContextSignal } from "./fluency.ts";
import { monitorContext, type Signal, type SignalKind } from "./model.ts";
import { talkSignals } from "./signals.ts";

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
};
const off = talkSignals("talk-1", { ...base, context: null }, "es");
assert(
  !off.some((d) => MONITOR_KINDS.includes(d.kind)),
  "fluency ledger 12: with context null (measurement off), no monitor signal is written",
);
const on = talkSignals("talk-1", { ...base, context: FREE_CONTEXT }, "es");
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

console.log("fluency.check OK");

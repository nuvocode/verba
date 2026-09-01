// Runnable self-check for §1.3 signals: the payload contract and the gate that
// keeps it a contract rather than a comment.
//
// A Signal's payload is `unknown` in the spec and stays that way. Coach still has
// to name what a signal was about to group evidence into a Weakness, so the deal
// is: every writer puts a `{ label: string }` in there, and `signalLabel` is the
// only thing that ever looks inside. The gate at the bottom holds the second half.
// Run: node --experimental-strip-types src/lib/signals.check.ts
import assert from "node:assert";
import { signalLabel, signalMiss, isAssistedReveal, type Signal } from "./model.ts";
import { talkSignals, readSignals, listenSignals, memorySignals, voiceSignals, revealSignal, TURN, SUGGESTED } from "./signals.ts";
import { coachMetrics } from "./coachmetrics.ts";

const sig = (payload: unknown): Signal => ({
  id: "s1",
  activityId: "a1",
  kind: "correction",
  observedAt: 0,
  payload,
});

// A fixed instant for the coachmetrics scan — well past the epoch, so the
// timestamped signals below land inside its seven-day window.
const NOW = 1_000_000_000_000;
const sigAt = (kind: Signal["kind"], payload: unknown, at = NOW): Signal => ({
  id: `s${at}`,
  activityId: "a1",
  kind,
  observedAt: at,
  payload,
});

// --- the door: a well-formed payload names itself, anything else names nothing ---
assert.equal(signalLabel(sig({ label: "ser vs estar" })), "ser vs estar", "a labelled payload reads back");
assert.equal(signalLabel(sig({ label: "x", original: "soy", fixed: "estoy" })), "x", "extra fields ride along unread");
assert.equal(signalLabel(sig(null)), null, "null is not a payload");
assert.equal(signalLabel(sig(undefined)), null, "neither is a missing one");
assert.equal(signalLabel(sig("ser vs estar")), null, "a bare string is not the contract");
assert.equal(signalLabel(sig(42)), null, "nor a number");
assert.equal(signalLabel(sig(["ser vs estar"])), null, "nor an array — it has no label");
assert.equal(signalLabel(sig({})), null, "an object without a label names nothing");
assert.equal(signalLabel(sig({ label: 7 })), null, "a label that is not a string is not a label");
assert.equal(signalLabel(sig({ label: "" })), "", "an empty label is a label — the writer's problem, not the door's");

// --- what a surface hands over: every draft is readable through the door -------
const drafts = talkSignals(
  "talk-1",
  {
    turns: 7,
    corrections: [
      { original: "yo soy cansado", fixed: "yo estoy cansado", note: "ser vs estar", severity: "severe" },
      { original: "x", fixed: "y", note: "   ", severity: "minor" }, // names nothing
    ],
    words: [{ term: "la cuenta", translation: "the bill" }],
    produced: [
      { text: "Hola, buenos días.", fromSuggestion: false, words: 3, latencyMs: 1000 },
      { text: "Quiero la cuenta, por favor.", fromSuggestion: false, words: 5, latencyMs: 1000 },
      { text: "¿Cuánto cuesta?", fromSuggestion: false, words: 2, latencyMs: 1000 },
      { text: "La cuenta, por favor.", fromSuggestion: true, words: 4, latencyMs: 1000 },
    ],
    summary: "",
    strengths: [],
    focus: [],
  },
  "es",
);

assert.deepEqual(
  drafts.map((d) => d.kind),
  ["correction", "lexicalItem", "unpromptedTurn", "unpromptedTurn", "unpromptedTurn", "suggestionUsed"],
  "a noteless correction is not evidence; each produced turn is its own signal",
);
assert(drafts.every((d) => d.activityId === "talk-1"), "every signal hangs off the activity that produced it");
// The whole point of the contract: whatever a surface writes, Coach can name it.
assert.deepEqual(
  drafts.map((d) => signalLabel({ ...d, id: "x", observedAt: 0 })),
  ["ser vs estar", "la cuenta", TURN, TURN, TURN, SUGGESTED],
  "every payload a surface writes must read back through signalLabel",
);
// The old aggregate is gone — no signal may still name the session's turn count.
assert(
  drafts.every((d) => (d.payload as { label: string }).label !== "turns"),
  "the aggregate turn-count signal is removed, not kept alongside",
);
// Each turn is measured where it was produced, and the numbers ride along.
for (const d of drafts.filter((d) => d.kind === "unpromptedTurn" || d.kind === "suggestionUsed")) {
  const p = d.payload as { words: number; sentences: number; chars: number };
  assert(typeof p.words === "number" && p.words > 0, "a non-empty turn measures more than zero words");
  assert(typeof p.sentences === "number" && p.sentences >= 1, "a turn always has at least one sentence");
  assert(typeof p.chars === "number", "the character count rides along as a number");
}
// A turn is an observation, never an accusation — no weakness may form on it.
assert(
  drafts.filter((d) => d.kind === "unpromptedTurn" || d.kind === "suggestionUsed").every((d) => signalMiss({ ...d, id: "x", observedAt: 0 }) === false),
  "a produced turn is never a miss",
);
// A language with no spaces still measures: Japanese is cut by its own rules.
const ja = talkSignals("talk-1", { turns: 1, corrections: [], words: [], produced: [{ text: "こんにちは、元気ですか。", fromSuggestion: false, words: 6, latencyMs: 1000 }], summary: "", strengths: [], focus: [] }, "ja");
assert((ja[0].payload as { words: number }).words > 1, "a no-space language still counts more than one word");

// --- voiceSignals: pace and delivery, both with a unit and a definition --------
// A spoken turn under 1.5 s has no tempo — a one-word answer is not a pace.
const short = voiceSignals("talk-1", { text: "Hola", ms: 1000, levels: [0.1, 0.1, 0.1], locale: "es" });
assert(!short.some((d) => d.kind === "pace"), "a turn under 1.5 s must not emit a pace signal");
// …and neither does an empty transcript.
const empty = voiceSignals("talk-1", { text: "", ms: 5000, levels: [0.1, 0.1], locale: "es" });
assert(!empty.some((d) => d.kind === "pace"), "an empty transcript must not emit a pace signal");

// A real turn emits both, and the wpm comes from the locale's own word count.
const spoken = voiceSignals("talk-1", { text: "Quisiera un café, por favor.", ms: 6000, levels: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], locale: "es" });
const pace = spoken.find((d) => d.kind === "pace")!;
assert(pace, "a real spoken turn must emit a pace signal");
const pacePayload = pace.payload as { wpm: number; unit: string; definition: string };
assert(pacePayload.wpm > 0, "wpm is a positive number");
assert.equal(pacePayload.unit, "words per minute", "pace carries its unit");
assert(typeof pacePayload.definition === "string" && pacePayload.definition.length > 0, "pace carries a definition");

const pron = spoken.find((d) => d.kind === "pronunciation")!;
assert(pron, "a spoken turn with an envelope must emit a pronunciation signal");
const pronPayload = pron.payload as { speechRatio: number; pauses: number; unit: string; definition: string };
assert(pronPayload.speechRatio > 0 && pronPayload.speechRatio <= 1, "speech ratio is a fraction of the recording");
assert(typeof pronPayload.pauses === "number", "the pause count rides along");
assert(typeof pronPayload.unit === "string" && pronPayload.unit.length > 0, "pronunciation carries its unit");
assert(typeof pronPayload.definition === "string" && pronPayload.definition.length > 0, "pronunciation carries a definition");

// A Japanese locale counts its own words — no spaces, so the wpm is not a lie.
const jaSpoken = voiceSignals("talk-1", { text: "こんにちは、元気ですか。", ms: 6000, levels: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1], locale: "ja" });
const jaPace = jaSpoken.find((d) => d.kind === "pace")!;
assert((jaPace.payload as { wpm: number }).wpm > 0, "a no-space language still measures a pace");

// A real pause is counted: a silent break longer than 600 ms (13+ quiet frames at
// ~20/s) between two stretches of speech is one pause, not zero.
const paused = voiceSignals("talk-1", {
  text: "Quisiera un café, por favor.",
  ms: 6000,
  // 5 speech frames, 15 quiet frames (750 ms — a real pause), 5 speech frames.
  levels: [0.1, 0.1, 0.1, 0.1, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.1, 0.1, 0.1, 0.1],
  locale: "es",
});
const pausedPron = paused.find((d) => d.kind === "pronunciation")!;
assert((pausedPron.payload as { pauses: number }).pauses === 1, "a silent break over 600 ms is counted as one pause");
assert((pausedPron.payload as { speechRatio: number }).speechRatio < 1, "a pause lowers the speech ratio below 1");

// The voice signals ride into the reflection's talkSignals output.
const withVoice = talkSignals(
  "talk-1",
  { turns: 1, corrections: [], words: [], produced: [{ text: "Quisiera un café.", fromSuggestion: false, words: 3, latencyMs: 1000 }], summary: "", strengths: [], focus: [], voice: [{ text: "Quisiera un café.", ms: 4000, levels: [0.1, 0.1, 0.1, 0.1], locale: "es" }] },
  "es",
);
assert(withVoice.some((d) => d.kind === "pace"), "a spoken reflection carries a pace signal");
assert(withVoice.some((d) => d.kind === "pronunciation"), "a spoken reflection carries a pronunciation signal");

// --- the other three surfaces: same shape, their own evidence ----------------
const q = (prompt: string, correct: boolean) => ({ prompt, given: "x", answer: "y", correct });

const read = readSignals("read-1", [{ ...q("who paid?", true), qKind: "mcq" }, { ...q("___ la cuenta", false), qKind: "cloze" }], [
  "la cuenta",
]);
assert.deepEqual(
  read.map((d) => d.kind),
  ["comprehension", "comprehension", "lexicalItem"],
  "a right answer is an observation too — Coach decides later what counts as evidence",
);
assert.deepEqual(
  read.map((d) => signalLabel({ ...d, id: "x", observedAt: 0 })),
  ["reading comprehension", "reading comprehension", "la cuenta"],
  "comprehension groups under one stable label; a saved word is named by itself",
);
assert.deepEqual(
  read.slice(0, 2).map((d) => (d.payload as { correct: boolean }).correct),
  [true, false],
  "which way each question went has to survive into the payload",
);
assert(read.every((d) => d.activityId === "read-1"), "every signal hangs off the activity that produced it");

const listen = listenSignals("listen-1", [q("where were they?", false)]);
assert.deepEqual(listen.map((d) => d.kind), ["comprehension"], "listening writes comprehension, nothing else");
assert.equal(signalLabel({ ...listen[0], id: "x", observedAt: 0 }), "listening comprehension", "…under its own label");
assert.notEqual(
  signalLabel({ ...listen[0], id: "x", observedAt: 0 }),
  signalLabel({ ...read[0], id: "x", observedAt: 0 }),
  "reading and listening must not group into one weakness",
);
assert.deepEqual(
  listen[0].payload,
  { label: "listening comprehension", correct: false, prompt: "where were they?", given: "x", answer: "y" },
  "the whole question survives into the payload — 15c reads correct, a Coach screen may want the rest",
);

const mem = memorySignals("memory-1", [{ term: "la cuenta", grade: 0 }, { term: "el mercado", grade: 2 }]);
assert.deepEqual(mem.map((d) => d.kind), ["lexicalItem", "lexicalItem"], "a review is an observation about a word");
assert.deepEqual(
  mem.map((d) => signalLabel({ ...d, id: "x", observedAt: 0 })),
  ["la cuenta", "el mercado"],
  "the card names the signal — a word missed three times is a weakness about that word",
);
assert.deepEqual(mem.map((d) => (d.payload as { grade: number }).grade), [0, 2], "how it went rides along");

// Nothing observed, nothing written — no surface should have to guard its own call.
assert.deepEqual(readSignals("read-1", [], []), [], "a passage with no check and no saved word writes nothing");
assert.deepEqual(listenSignals("listen-1", []), []);
assert.deepEqual(memorySignals("memory-1", []), []);

// --- revealSignal (PLAN-021): recorded, never scored --------------------------
// Asking to see the coach's text is a comprehension signal marked assisted. It
// carries a definition, and it is never a miss — a reveal is not a wrong answer.
const reveal = revealSignal("talk-1", "line");
assert.equal(reveal.kind, "comprehension", "a reveal is a comprehension signal");
assert.equal(reveal.activityId, "talk-1", "a reveal hangs off the activity that produced it");
const revealPayload = reveal.payload as { assisted: boolean; source: string; definition: string; what: string };
assert.equal(revealPayload.assisted, true, "a reveal is marked assisted");
assert.equal(revealPayload.source, "talk-subtitles", "a reveal names its source");
assert.equal(revealPayload.what, "line", "a reveal says what was revealed");
assert(typeof revealPayload.definition === "string" && revealPayload.definition.length > 0, "a reveal carries a definition");
assert.equal(signalMiss({ ...reveal, id: "x", observedAt: 0 }), false, "a reveal is never a miss");
assert.equal(isAssistedReveal({ ...reveal, id: "x", observedAt: 0 }), true, "the door reads a reveal back");
assert.equal(isAssistedReveal(sig({ label: "c", correct: false })), false, "a plain wrong answer is not a reveal");
assert.equal(isAssistedReveal(sig({ label: "c", correct: true })), false, "a plain right answer is not a reveal");
assert.equal(isAssistedReveal(sig({ label: "c", assisted: true })), false, "assisted without the source is not a reveal");
assert.equal(isAssistedReveal(sig({ label: "c", source: "talk-subtitles" })), false, "the source without assisted is not a reveal");

// --- gate: payload is read in exactly one place -------------------------------
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(ROOT, "src");

function isExcluded(rel: string): boolean {
  // *.check.ts — this gate and its siblings are tests, not code that ships.
  if (rel.endsWith(".check.ts")) return true;
  // model.ts — signalLabel lives here. This is the door the gate exists to protect.
  if (rel === "src/lib/model.ts") return true;
  // db.ts — the storage door. It carries the payload to and from disk as opaque
  // JSON and never looks inside; the gate cannot prove that last part, so this
  // one exemption is on the honour system and is deliberately the only one.
  if (rel === "src/lib/db.ts") return true;
  return false;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && (extname(p) === ".ts" || extname(p) === ".tsx")) out.push(p);
  }
  return out;
}

/** Crude comment stripper: keeps newlines so line numbers survive the strip. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * True when this source reaches into a signal's payload itself.
 *
 * Scoped to sources that actually have a Signal in hand — one is either typed as
 * `Signal` or came out of `recentSignals`. `.payload` is a common enough word
 * elsewhere (a Tauri event carries one) that an unscoped scan would fail on code
 * that has nothing to do with §1.3. The seam this leaves: a helper handed signals
 * without naming either goes unseen. That is the price of a static scan, and it is
 * cheaper than a gate nobody can keep green.
 */
function violates(text: string): boolean {
  const src = stripComments(text);
  if (!/\bSignal\b|\brecentSignals\b/.test(src)) return false;
  return /\.payload\b/.test(src);
}

// The gate proves itself before it judges anyone: a slipped character in the
// regexes above would leave it reporting green over every payload read in the app.
assert(violates("const s: Signal = x; const l = s.payload.label;"), "a direct payload read must be caught");
assert(violates('const s: Signal = x; const l = (s.payload as any)["label"];'), "…and an indexed one");
assert(violates("const rows = await recentSignals(lang); rows[0].payload.label;"), "…and one on a fetched row");
assert(!violates("const s: Signal = x; const l = signalLabel(s);"), "going through the door is the point");
assert(!violates("const s: Signal = x; // s.payload.label"), "comments are not reads");
assert(!violates("const s: Signal = x; const payload = { label: y };"), "building a payload is not reading one");
assert(!violates("listen('model-progress', (e) => e.payload.total);"), "an event payload is not a signal's");

const files = walk(SRC).map((p) => relative(ROOT, p));
assert(files.length > 0, "the gate walked no files — a silent green is a lie");

const offenders = files.filter((f) => !isExcluded(f) && violates(readFileSync(join(ROOT, f), "utf8")));
if (offenders.length > 0) {
  assert.fail("a signal payload may only be read through signalLabel (model.ts):\n" + offenders.join("\n"));
}

// --- source scan: confidence.ts does not import reveals -----------------------
// PLAN-021: a reveal must never reach confidence — it is recorded, never scored.
// Assert by construction: confidence.ts must not reference revealSignal or the
// assisted flag at all.
{
  const confidenceSrc = readFileSync(join(ROOT, "src/lib/confidence.ts"), "utf8");
  assert(!/revealSignal/.test(confidenceSrc), "confidence.ts must not import revealSignal");
  assert(!/assisted/.test(confidenceSrc), "confidence.ts must not read the assisted flag");
  assert(!/talk-subtitles/.test(confidenceSrc), "confidence.ts must not reference the reveal source");
}

// --- source scan: coachmetrics excludes assisted reveals ----------------------
// PLAN-021: a reveal is recorded, never scored. Coach's six metrics must be
// identical whether or not reveals are present — feed the same signal set with
// and without reveals and assert the six metrics do not move.
{
  const base = [
    sigAt("comprehension", { label: "c", correct: true }),
    sigAt("comprehension", { label: "c", correct: false }),
    sigAt("unpromptedTurn", { label: "turn", words: 5, sentences: 1, chars: 25 }),
  ];
  const withReveals = [
    ...base,
    sigAt("comprehension", { label: "talk subtitles", assisted: true, source: "talk-subtitles", what: "line", definition: "you asked to see the coach's text" }),
    sigAt("comprehension", { label: "talk subtitles", assisted: true, source: "talk-subtitles", what: "all", definition: "you asked to see the coach's text" }),
  ];
  const without = coachMetrics(base, NOW);
  const withR = coachMetrics(withReveals, NOW);
  for (const m of without) {
    const other = withR.find((x) => x.id === m.id)!;
    assert.equal(other.value, m.value, `metric ${m.id} must not move when reveals are present`);
    assert.equal(other.sample, m.sample, `metric ${m.id} sample must not move when reveals are present`);
  }
}

console.log("signals.check OK");

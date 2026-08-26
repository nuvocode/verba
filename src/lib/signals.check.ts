// Runnable self-check for §1.3 signals: the payload contract and the gate that
// keeps it a contract rather than a comment.
//
// A Signal's payload is `unknown` in the spec and stays that way. Coach still has
// to name what a signal was about to group evidence into a Weakness, so the deal
// is: every writer puts a `{ label: string }` in there, and `signalLabel` is the
// only thing that ever looks inside. The gate at the bottom holds the second half.
// Run: node --experimental-strip-types src/lib/signals.check.ts
import assert from "node:assert";
import { signalLabel, type Signal } from "./model.ts";
import { talkSignals } from "./signals.ts";

const sig = (payload: unknown): Signal => ({
  id: "s1",
  activityId: "a1",
  kind: "correction",
  observedAt: 0,
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
const drafts = talkSignals("talk-1", {
  turns: 7,
  corrections: [
    { original: "yo soy cansado", fixed: "yo estoy cansado", note: "ser vs estar", severity: "severe" },
    { original: "x", fixed: "y", note: "   ", severity: "minor" }, // names nothing
  ],
  words: [{ term: "la cuenta", translation: "the bill" }],
  summary: "",
  strengths: [],
  focus: [],
});

assert.deepEqual(
  drafts.map((d) => d.kind),
  ["correction", "lexicalItem", "unpromptedTurn"],
  "a noteless correction is not evidence; the words and the session each are",
);
assert(drafts.every((d) => d.activityId === "talk-1"), "every signal hangs off the activity that produced it");
// The whole point of the contract: whatever a surface writes, Coach can name it.
assert.deepEqual(
  drafts.map((d) => signalLabel({ ...d, id: "x", observedAt: 0 })),
  ["ser vs estar", "la cuenta", "turns"],
  "every payload a surface writes must read back through signalLabel",
);

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

console.log("signals.check OK");

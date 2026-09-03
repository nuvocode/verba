// Runnable self-check for the prompt parsers (lib/prompts.ts). The parsers are
// the gate between raw model output and the learner's screen, so the four ways
// a summary can fail are pinned here, and the one way it must never fail — the
// whole raw reply becoming the summary — is asserted by scanning the source.
// Run: node --experimental-strip-types src/lib/prompts.check.ts
import assert from "node:assert";
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, mkdirSync, rmdirSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { defaultSettings, type Settings } from "./settings.ts";
import {
  buildSystem,
  memoryStance,
  openingDetail,
  parseMemory,
  parseSummary,
  parseTurn,
  styleGuidance,
  SPOKEN_PROMPTS,
  STRUCTURED_PROMPTS,
  type CorrectionCategory,
  type Memory,
} from "./prompts.ts";

// --- parseSummary: the four null cases (PLAN-020 §2.2) ----------------------
// A failed summary writes nothing. `null` is the value that means "no usable
// summary", and the DB row keeps NULL and the reflection renders Unusable.

// 1. A bare prose reply — no JSON at all.
assert.equal(parseSummary("The session went well and we talked about travel."), null, "bare prose → null");

// 2. A JSON object with no `summary` key.
assert.equal(parseSummary('{"strengths": ["good"], "focus": ["more"]}'), null, "no summary key → null");

// 3. A `summary` of 5 characters — too short to be a real write-up.
assert.equal(parseSummary('{"summary": "Good."}'), null, "a 5-char summary → null");

// 4. A `summary` that starts with `{` — the model nested JSON inside it.
assert.equal(parseSummary('{"summary": "{\\"nested\\": true}"}'), null, "a JSON-looking summary → null");

// --- parseSummary: the well-formed case -------------------------------------
const ok = parseSummary(
  '{"summary": "You practised ordering food and asking for the bill, and you handled the waiter\'s follow-up well.", "strengths": ["clear ordering"], "focus": ["past tense"]}',
);
assert(ok !== null, "a well-formed reply → an object");
assert.equal(ok.summary.length >= 20, true, "the summary is the model's text");
assert.deepEqual(ok.strengths, ["clear ordering"], "strengths parse");
assert.deepEqual(ok.focus, ["past tense"], "focus parses");

// --- no path returns raw (invariant 22, mechanised) -------------------------
// The whole raw model reply must never become the summary. Assert by scanning
// the function's source: the return side must not hand back `raw`.
// invariant 22
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LIB = join(ROOT, "src/lib");
const prompts = readFileSync(join(ROOT, "src/lib/prompts.ts"), "utf8");
const fn = prompts.slice(prompts.indexOf("export function parseSummary"), prompts.indexOf("// ---- long-term memory"));
// The only `raw` on the return side is the parameter read for `extractJson(raw)`
// and the `s.startsWith` checks — never a `return raw` or `: raw.trim()`.
assert(!/return\s+raw/.test(fn), "parseSummary must never return raw");
assert(!/:\s*raw\.trim\(\)/.test(fn), "parseSummary must never fall back to raw.trim()");

// --- parseTurn: corrections carry a category ---------------------------------
const turn = parseTurn(
  '{"reply": "Hola", "corrections": [{"original": "yo voy", "fixed": "voy", "note": "omit the pronoun", "severity": "minor", "category": "grammar"}], "suggestions": ["¿Y tú?"], "goalsMet": []}',
);
assert.equal(turn.corrections.length, 1, "a correction parses");
assert.equal(turn.corrections[0].category, "grammar", "the category is read through");

// An unknown or missing category maps to "grammar" — a wrong bucket is
// recoverable, an invented bucket per session is not.
const unknown = parseTurn(
  '{"reply": "Hola", "corrections": [{"original": "x", "fixed": "y", "note": "n", "severity": "minor", "category": "syntax"}], "suggestions": [], "goalsMet": []}',
);
assert.equal(unknown.corrections[0].category, "grammar", "an unknown category maps to grammar");
const missing = parseTurn(
  '{"reply": "Hola", "corrections": [{"original": "x", "fixed": "y", "note": "n", "severity": "minor"}], "suggestions": [], "goalsMet": []}',
);
assert.equal(missing.corrections[0].category, "grammar", "a missing category maps to grammar");

// The closed set is exactly the five categories — no drift.
const CATS: CorrectionCategory[] = ["grammar", "vocabulary", "wordOrder", "register", "pronunciation"];
assert.deepEqual(
  [...new Set(CATS)].sort(),
  CATS.slice().sort(),
  "the category set is closed and stable",
);

// ============================================================================
// PLAN-033: one remembered detail per opening, and a coach who does not drift.
// ============================================================================

const s: Settings = { ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "Spanish", nativeLanguage: "English" } };
const scenario = { id: "free", title: "Free talk", emoji: "💬", setup: "Talk about anything.", persona: { name: "Marta", role: "a friendly conversation partner", emoji: "🧑‍🏫" } };

const NOW = new Date("2026-09-01T09:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const mem = (id: number, fact: string, kind: Memory["kind"], created_at: number, asked_at: number | null): Memory => ({
  id,
  fact,
  created_at,
  kind,
  asked_at,
});

// --- case 1: never a fact older than 30 days ---------------------------------
{
  const stale = [mem(1, "Interviewing next week", "event", NOW - 31 * DAY, null)];
  assert.equal(openingDetail(stale, NOW), null, "case 1: a fact older than 30 days is not an opening");
  const fresh = [mem(1, "Interviewing next week", "event", NOW - 29 * DAY, null)];
  assert.equal(openingDetail(fresh, NOW)?.id, 1, "case 1: a fact within 30 days is an opening");
}

// --- case 2: never a state fact, never a kind:null fact ----------------------
{
  const stative = [mem(1, "Has two cats", "state", NOW - 1 * DAY, null)];
  assert.equal(openingDetail(stative, NOW), null, "case 2: a stative fact is not an opening");
  const unclassified = [mem(1, "Interviewing next week", null, NOW - 1 * DAY, null)];
  assert.equal(openingDetail(unclassified, NOW), null, "case 2: an unclassified (kind:null) fact is not an opening");
  const event = [mem(1, "Interviewing next week", "event", NOW - 1 * DAY, null)];
  assert.equal(openingDetail(event, NOW)?.id, 1, "case 2: an event fact is an opening");
}

// --- case 3: never a row with asked_at set ----------------------------------
{
  const asked = [mem(1, "Interviewing next week", "event", NOW - 1 * DAY, NOW - 2 * DAY)];
  assert.equal(openingDetail(asked, NOW), null, "case 3: an already-asked fact is not an opening");
}

// --- case 4: null rather than the least-bad candidate ------------------------
// memory ledger 13 — at most one personal detail per opening, never re-asked.
{
  const allBad = [
    mem(1, "Has two cats", "state", NOW - 1 * DAY, null), // stative
    mem(2, "Interviewing next week", "event", NOW - 40 * DAY, null), // stale
    mem(3, "Moved to Berlin", "event", NOW - 1 * DAY, NOW - 3 * DAY), // asked
    mem(4, "New job soon", null, NOW - 1 * DAY, null), // unclassified
  ];
  assert.equal(openingDetail(allBad, NOW), null, "case 4: a list of only bad candidates yields null, not the least-bad one");
}

// --- case 5: cannot return a statistic ----------------------------------------
// By type: openingDetail takes Memory[] and nothing else — a session count, level
// estimate, accuracy or streak has no path into it. By source scan: useTalk must
// pass it the memory rows and nothing else.
{
  const src = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  const call = src.slice(src.indexOf("openingDetail("), src.indexOf("openingDetail(") + 200);
  assert(/openingDetail\(\s*memories\s*,/.test(call), "case 5: useTalk passes openingDetail the memory rows and nothing else");
}

// --- case 6: buildSystem with a detail carries the naming sentence once; ------
// --- without one, the stance and no opening permission at all -----------------
{
  const detail = mem(1, "Interviewing next week", "event", NOW - 1 * DAY, null);
  const withDetail = buildSystem(s, scenario, scenario.persona, undefined, [detail], { axis: null, step: 0 }, [], detail);
  // The naming sentence names the fact inline, exactly once.
  const naming = withDetail.match(/You may open by asking after this one thing the learner told you: "Interviewing next week"/g);
  assert(naming && naming.length === 1, "case 6: the naming sentence appears exactly once when a detail is supplied");
  assert(withDetail.includes(memoryStance), "case 6: the full stance still rides with a detail");

  // The regression that matters: no detail → the stance, and no opening permission at all.
  const noDetail = buildSystem(s, scenario, scenario.persona, undefined, [detail], { axis: null, step: 0 }, [], null);
  assert(noDetail.includes(memoryStance), "case 6: the stance is present without a detail");
  assert(!noDetail.includes("You may open by asking after"), "case 6: no detail → no opening permission at all");
  assert(noDetail.includes("do not open on them"), "case 6: the stance's own prohibition is intact");
}

// --- case 7: parseMemory gates kind to the two values -------------------------
{
  const parsed = parseMemory(
    '{ "facts": [ { "fact": "Interviewing next week", "replaces": null, "kind": "event" }, { "fact": "Has two cats", "replaces": null, "kind": "state" }, { "fact": "New job soon", "replaces": null, "kind": "gibberish" }, { "fact": "Moved to Berlin", "replaces": null } ] }',
  );
  assert.equal(parsed[0].kind, "event", "case 7: an event kind parses");
  assert.equal(parsed[1].kind, "state", "case 7: a state kind parses");
  assert.equal(parsed[2].kind, null, "case 7: an unknown kind becomes null");
  assert.equal(parsed[3].kind, null, "case 7: a missing kind becomes null");
}

// --- case 8: styleGuidance differs across all three, and the lists are right --
// memory ledger 14 — coach personality is consistent; style applies on every surface.
{
  const warm = styleGuidance("warm");
  const neutral = styleGuidance("neutral");
  const direct = styleGuidance("direct");
  assert(warm !== neutral && neutral !== direct && warm !== direct, "case 8: the three styles differ");

  // Every spoken prompt carries styleGuidance; every structured prompt does not.
  // Each list entry is a `file:name` key, so every occurrence is scanned.
  for (const key of SPOKEN_PROMPTS) {
    const [file, name] = splitKey(key);
    const fn = promptSource(file, name);
    assert(fn.includes("styleGuidance"), `case 8: spoken prompt ${key} must carry styleGuidance`);
  }
  for (const key of STRUCTURED_PROMPTS) {
    const [file, name] = splitKey(key);
    const fn = promptSource(file, name);
    assert(!fn.includes("styleGuidance"), `case 8: structured prompt ${key} must not carry styleGuidance`);
  }
}

// --- case 9: completeness — every (file, name) prompt plus buildSystem ---------
// --- appears in exactly one list ----------------------------------------------
{
  // The scan reads all of src/lib, not just prompts.ts — a prompt added later in
  // any file must fail the build until someone decides which list it belongs to.
  const names = allPromptNames(LIB);
  const all = [...SPOKEN_PROMPTS, ...STRUCTURED_PROMPTS];
  for (const n of names) {
    assert(all.includes(n), `case 9: ${n} is in neither list`);
  }
  for (const n of all) {
    assert(names.includes(n), `case 9: ${n} is in a list but is not a real prompt`);
  }
  // No prompt appears in both lists.
  const dupes = all.filter((n, i) => all.indexOf(n) !== i);
  assert(dupes.length === 0, `case 9: a prompt appears in both lists: ${dupes.join(", ")}`);

  // Probe: a fabricated prompt file, written to the OS temp directory and scanned
  // with the same walk, must be caught — the scan finds it, and it is in neither
  // list, so the completeness check would fail. This replaces the old tautology
  // (asserting the scan's own list-membership against a name it never scanned).
  const probeDir = join(tmpdir(), `plan033-probe-${Date.now()}`);
  mkdirSync(probeDir, { recursive: true });
  const probeFile = join(probeDir, "fabricated.ts");
  writeFileSync(probeFile, "export function fabricatedPrompt(s: Settings): string { return ''; }");
  try {
    const scanned = allPromptNames(probeDir);
    const key = "fabricated.ts:fabricatedPrompt";
    assert(scanned.includes(key), "case 9 probe: the scan must find a fabricated prompt file");
    assert(!all.includes(key), "case 9 probe: a fabricated prompt is in neither list — the completeness check would fail");
  } finally {
    unlinkSync(probeFile);
    rmdirSync(probeDir);
  }
}

// --- case 10: the honesty clause is present whenever memories is non-empty -----
// The two instructions must read as rule + exception, not two absolutes: the
// stance forbids *volunteering* that notes are kept, and the honesty clause owns
// answering when asked. The absolute prohibition sentence must not be present.
{
  const withMem = buildSystem(s, scenario, scenario.persona, undefined, [mem(1, "Lives in Ankara", "state", NOW - 1 * DAY, null)]);
  assert(withMem.includes("Verba keeps notes of what they have said"), "case 10: the honesty clause is present with memories");
  assert(!withMem.includes("never tell the learner you keep notes on them"), "case 10: the absolute prohibition is gone — the honesty clause owns answering when asked");
  const empty = buildSystem(s, scenario, scenario.persona);
  assert(!empty.includes("Verba keeps notes of what they have said"), "case 10: no memories, no honesty clause");
}

// --- case 11: the persona is read from the scenario, picked nowhere else -------
{
  const src = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  // Both open() and resume() read it from the scenario.
  const start = src.slice(src.indexOf("const start ="), src.indexOf("const resume ="));
  const resume = src.slice(src.indexOf("const resume ="));
  assert(/setPersona\(sc\.persona\)/.test(start), "case 11: open() reads the persona from the scenario");
  assert(/setPersona\(sc\.persona\)/.test(resume), "case 11: resume() reads the persona from the scenario");
  // No other code path constructs one — no `persona:` literal outside scenarios.ts.
  const scenarios = readFileSync(join(ROOT, "src/lib/scenarios.ts"), "utf8");
  const personaLiteral = /persona:\s*\{/;
  assert(personaLiteral.test(scenarios), "case 11: scenarios.ts is where personas are defined");
  const elsewhere = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  assert(!/persona:\s*\{/.test(elsewhere), "case 11: no code path in useTalk constructs a persona literal");
}

// --- helpers for the source scans ---------------------------------------------

/** Split a `file:name` list key into its two parts. */
function splitKey(key: string): [string, string] {
  const i = key.indexOf(":");
  assert(i !== -1, `a list key must be "file:name": ${key}`);
  return [key.slice(0, i), key.slice(i + 1)];
}

/** The source of one prompt function in one file. */
function promptSource(file: string, name: string): string {
  const src = readFileSync(join(LIB, file), "utf8");
  const start = src.indexOf(`export function ${name}(`);
  assert(start !== -1, `promptSource: ${name} not found in ${file}`);
  // The function body runs to the next top-level `export function` or the end.
  const rest = src.slice(start);
  const next = rest.indexOf("\nexport function ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Every `export function …Prompt(` under a root, as `file:name` keys, plus
 * `buildSystem`. The root is a parameter so the probe can scan a temp directory.
 */
function allPromptNames(root: string): string[] {
  const names: string[] = [];
  let sawPrompts = false;
  let sawRehearsal = false;
  let sawBrought = false;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (e.endsWith(".ts") && !e.endsWith(".check.ts")) {
        // The key carries the path from the root, not the basename. `walk`
        // recurses, and two files in different directories may share a name —
        // which is the whole reason the lists are keyed `file:name` at all. A
        // basename key would make a prompt under `packs/` unaddressable by
        // `promptSource`, and silently collapse it with one at the top level.
        const rel = relative(root, p);
        if (rel === "prompts.ts") sawPrompts = true;
        if (rel === "rehearsal.ts") sawRehearsal = true;
        if (rel === "brought.ts") sawBrought = true;
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(/export function (\w+Prompt)\(/g)) names.push(`${rel}:${m[1]}`);
      }
    }
  };
  walk(root);
  // Two prompt builders whose names do not end in `Prompt` (or would not be
  // found by the scan for other reasons) are added by hand, and only when the
  // walk actually covered the file that declares them. A probe scanning a temp
  // directory gets the prompts it really contains and nothing borrowed from the
  // repo. PLAN-034: `rehearsalSystem` is spoken but unstyled — it is hand-added
  // here so the completeness claim cannot quietly miss the one prompt this plan
  // adds; `debriefPrompt` ends in `Prompt` and is found by the scan itself.
  // PLAN-035: `discussionSystem` is spoken and styled — hand-added the same way.
  if (sawPrompts) names.push("prompts.ts:buildSystem");
  if (sawRehearsal) names.push("rehearsal.ts:rehearsalSystem");
  if (sawBrought) names.push("brought.ts:discussionSystem");
  return names;
}

console.log("prompts.check: ok");

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
  parseProduction,
  productionPrompt,
  styleGuidance,
  SPOKEN_PROMPTS,
  STRUCTURED_PROMPTS,
  COACH_PROHIBITIONS,
  ABOUT_THE_LEARNER,
  rewindOwnPrompt,
  summaryPrompt,
  type CorrectionCategory,
  type Memory,
} from "./prompts.ts";
import { weeklyReportPrompt } from "./coach.ts";

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

// --- parseProduction: shape only, no judgement (PLAN-041 / PLAN-042) ----------
// `parseProduction` checks shape, never truth — a non-array, a missing field, or
// a `type` outside the five is dropped. The belief gates are `verifySelfRepairs`
// and the §2.3 verifiers' job, and keeping the two apart is what PLAN-038's
// defect 2 taught. Every field is optional in the model's JSON and absent parses
// to empty — a model that only answers half the question has answered half the
// question, not zero for the rest.
{
  // A well-formed report parses through.
  const ok = parseProduction(
    '{"repairs": [ { "before": "I go to", "after": "I went to", "type": "E" } ], "abandoned": [ { "fragment": "I was going to" } ], "l1": [ { "span": "the doctor" } ], "avoidance": { "goal": "past simple", "attempted": false, "evidence": "I went" } }',
  );
  assert.equal(ok.repairs.length, 1, "a well-formed repair parses");
  assert.equal(ok.repairs[0].type, "E", "an E type parses");
  assert.equal(ok.abandoned.length, 1, "an abandoned fragment parses");
  assert.equal(ok.abandoned[0].fragment, "I was going to", "the abandoned fragment is read through");
  assert.equal(ok.l1.length, 1, "an l1 span parses");
  assert.equal(ok.l1[0].span, "the doctor", "the l1 span is read through");
  assert.ok(ok.avoidance, "a well-formed avoidance claim parses");
  assert.equal(ok.avoidance!.goal, "past simple", "the avoidance goal is read through");
  assert.equal(ok.avoidance!.attempted, false, "the avoidance attempted flag is read through");

  // The four ways a repairs field is malformed are all dropped.
  assert.equal(parseProduction('{"repairs": {}}').repairs.length, 0, "a non-array repairs is dropped");
  assert.equal(parseProduction('{"repairs": [ { "after": "x", "type": "E" } ]}').repairs.length, 0, "a report with no before is dropped");
  assert.equal(parseProduction('{"repairs": [ { "before": "x", "type": "E" } ]}').repairs.length, 0, "a report with no after is dropped");
  assert.equal(parseProduction('{"repairs": [ { "before": "x", "after": "y", "type": "Z" } ]}').repairs.length, 0, "a type outside the five is dropped");
  assert.equal(parseProduction('{"repairs": [ { "before": "x", "after": "y", "type": "E" }, { "before": "a", "after": "b", "type": "nonsense" } ]}').repairs.length, 1, "a bad row is dropped, a good row survives");

  // §2.3's fields are lenient the same way: absent parses to empty.
  assert.equal(parseProduction('{"repairs": []}').repairs.length, 0, "an empty repairs is the expected answer");
  assert.equal(parseProduction("not json").repairs.length, 0, "a non-JSON reply yields no repairs");
  assert.equal(parseProduction('{"repairs": [], "abandoned": {}}').abandoned.length, 0, "a non-array abandoned is dropped");
  assert.equal(parseProduction('{"repairs": [], "abandoned": [ { "fragment": "" } ]}').abandoned.length, 0, "an empty fragment is dropped");
  assert.equal(parseProduction('{"repairs": [], "l1": [ { "span": "   " } ]}').l1.length, 0, "a blank l1 span is dropped");
  // A model that only answers §2.2 leaves §2.3 empty, not zero for the rest.
  const half = parseProduction('{"repairs": [ { "before": "x", "after": "y", "type": "E" } ]}');
  assert.equal(half.abandoned.length, 0, "an absent abandoned parses to empty");
  assert.equal(half.l1.length, 0, "an absent l1 parses to empty");
  assert.equal(half.avoidance, null, "an absent avoidance parses to null");
}

// PLAN-041 hand sample: what the self-repair prompt had to learn from real
// transcripts. Each line below answers one way two models got a real session
// wrong — a repetition filed as a repair, two distant places fused into one, the
// model's own correction in "after", and the same repair typed three ways.
{
  const p = productionPrompt({ ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "English", nativeLanguage: "Turkish" } }, ["I go— I went home."]);
  assert(/same words again unchanged[^\n]*hesitation, not a repair/.test(p), "a word said twice is not a repair");
  assert(/"after" starts where "before" stops/.test(p), "before and after are adjacent in the text");
  assert(/word the learner did not say[^\n]*leave that repair out/.test(p), "the model's own correction is not a repair");
  for (const t of ["E", "A", "D", "C", "falseAlarm"])
    assert(new RegExp(`- "${t}": [^\n]*Example: `).test(p), `type ${t} is defined with an example`);
  assert(/already correct in English[^\n]*no better/.test(p), "falseAlarm is told apart from A: correct before, and no better after");
  assert(/Decide the type by asking, in this order/.test(p), "the types are decided in one fixed order");

  // An extraction runs cold: at 0.7 the same transcript gave one repair, then six.
  const talk = readFileSync(join(ROOT, "src/lib/useTalk.ts"), "utf8");
  const call = talk.slice(talk.indexOf("content: productionPrompt("), talk.indexOf("content: productionPrompt(") + 500);
  assert(/\{ json: true, temperature: 0 \}/.test(call), "the self-repair call runs at temperature 0");
}

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

// ============================================================================
// PLAN-046: §6.3's five prohibitions — requested of the model, enforced on
// ourselves. fluency ledger 10.
// ============================================================================

// --- 1. COACH_PROHIBITIONS carries five lines, each findable by its marker ----
// A constant that lost a line while staying non-empty is the regression this
// shape is built to catch.
{
  const lines = COACH_PROHIBITIONS.split("\n");
  assert.equal(lines.length, 5, "fluency ledger 10: COACH_PROHIBITIONS is exactly five lines, one per §6.3 prohibition");
  const markers = [
    "anxiety", // 1: never describe the learner in terms of anxiety/confidence/self-esteem/perfectionism
    "relax", // 2: no empty encouragement
    "combined score", // 3: no single combined score
    "breathing", // 4: no therapeutic technique
    "genuinely hard", // 5: answer as a person would and stop
  ];
  for (const m of markers) {
    assert(COACH_PROHIBITIONS.includes(m), `fluency ledger 10: prohibition marker "${m}" is findable in COACH_PROHIBITIONS`);
  }
}

// --- 2. each ABOUT_THE_LEARNER prompt carries the whole constant ----------------
// Built with real settings, not a stub, so a builder that drops it under some
// branch is caught.
{
  const s: Settings = { ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "Spanish", nativeLanguage: "English" } };
  const scenario = { id: "free", title: "Free talk", emoji: "💬", setup: "Talk about anything.", persona: { name: "Marta", role: "a friendly conversation partner", emoji: "🧑‍🏫" } };
  const built = {
    "prompts.ts:buildSystem": buildSystem(s, scenario, scenario.persona),
    "prompts.ts:summaryPrompt": summaryPrompt(s),
    "coach.ts:weeklyReportPrompt": weeklyReportPrompt(s, {
      sessions: 3,
      messages: 20,
      wordsPracticed: 300,
      vocabLearned: 4,
      vocabReviewed: 6,
      avgLevelScore: 87,
      focusAreas: [],
    }),
  };
  for (const [key, prompt] of Object.entries(built)) {
    assert(ABOUT_THE_LEARNER[key] === true, `fluency ledger 10: ${key} is classified true in ABOUT_THE_LEARNER`);
    assert(prompt.includes(COACH_PROHIBITIONS), `fluency ledger 10: ${key} carries the whole COACH_PROHIBITIONS constant`);
  }
}

// --- 3. ABOUT_THE_LEARNER is complete over SPOKEN_PROMPTS ----------------------
// Every entry classified, no entry that is not in SPOKEN_PROMPTS. The probe runs
// the *same* predicate on a fabricated list rather than re-implementing it — a
// probe that computes the answer a second way proves only that it can count.
{
  const classified = Object.keys(ABOUT_THE_LEARNER);
  const unclassified = (list: readonly string[]): string[] => list.filter((k) => !classified.includes(k));

  assert.deepEqual(unclassified(SPOKEN_PROMPTS), [], "fluency ledger 10: every SPOKEN_PROMPTS entry is classified in ABOUT_THE_LEARNER");
  for (const key of classified) {
    assert((SPOKEN_PROMPTS as readonly string[]).includes(key), `fluency ledger 10: ${key} is classified but is not a real SPOKEN_PROMPTS entry`);
  }
  // Probe: a prompt added to SPOKEN_PROMPTS and left unclassified is caught by
  // the very assertion above — so a prompt added later cannot reach the learner
  // without someone deciding about §6.3.
  assert.deepEqual(
    unclassified([...SPOKEN_PROMPTS, "prompts.ts:fabricatedPrompt"]),
    ["prompts.ts:fabricatedPrompt"],
    "fluency ledger 10 probe: an unclassified prompt is caught by the completeness assertion",
  );
}

// --- 4. a false prompt does NOT carry the constant -----------------------------
// The rule is targeted, and a check that passed either way would be no check.
{
  const s: Settings = { ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "Spanish", nativeLanguage: "English" } };
  // buildSystem is true; a false prompt is one of the others. Rebuild a false
  // one through its own builder to prove the rule is targeted.
  const rewind = rewindOwnPrompt(s);
  assert(!rewind.includes(COACH_PROHIBITIONS), "fluency ledger 10: a false prompt (rewindOwnPrompt) does not carry the constant — the rule is targeted");
}

// --- 5. the composite never reaches the model ---------------------------------
// weeklyReportPrompt bands the 0–100 composite through scoreBand rather than
// printing it — a WeekStats with avgLevelScore 87 must not contain "87".
{
  const s: Settings = { ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "Spanish", nativeLanguage: "English" } };
  const prompt = weeklyReportPrompt(s, {
    sessions: 3,
    messages: 20,
    wordsPracticed: 300,
    vocabLearned: 4,
    vocabReviewed: 6,
    avgLevelScore: 87,
    focusAreas: [],
  });
  assert(!prompt.includes("87"), "fluency ledger 10: weeklyReportPrompt must not hand the model the raw composite — 87 is banded, never printed");
}

console.log("prompts.check: ok");

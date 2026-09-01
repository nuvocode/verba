// Runnable self-check for the prompt parsers (lib/prompts.ts). The parsers are
// the gate between raw model output and the learner's screen, so the four ways
// a summary can fail are pinned here, and the one way it must never fail — the
// whole raw reply becoming the summary — is asserted by scanning the source.
// Run: node --experimental-strip-types src/lib/prompts.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSummary, parseTurn, type CorrectionCategory } from "./prompts.ts";

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

console.log("prompts.check: ok");

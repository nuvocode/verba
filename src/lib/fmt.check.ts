// Runnable self-check for the one formatter and the raw-output gate (PLAN-015).
// invariant 22: raw model output (JSON, stack trace) never reaches any learner
// surface — the only door for an error string is `humanError`, and the only
// door for a date is `when`.
// Run: node --experimental-strip-types src/lib/fmt.check.ts
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { when, absolute, headerDate, humanError, SayError, HUMAN_ERRORS } from "./fmt.ts";

// Repo root derived from this file's own location (src/lib/fmt.check.ts).
const ROOT = new URL("../../", import.meta.url);
const srcDir = fileURLToPath(new URL("../../src/", import.meta.url));

const DAY = 86_400_000;

// --- when(): relative under 7 days, absolute at 8+, both en and tr -----------
const now = Date.now();
const six = now - 6 * DAY;
const eight = now - 8 * DAY;
for (const locale of ["en", "tr"] as const) {
  const abs = when(eight, now, locale);
  assert(/Invalid|NaN/.test(abs) === false, `8 days back must be a real date (${locale})`);
  assert(
    !/\bago\b|yesterday|ge\u00e7en|d\u00fcn|saat|dakika/.test(abs),
    `8 days back is outside the relative window, so it must be absolute — got "${abs}" (${locale})`,
  );
  const rel = when(six, now, locale);
  assert(
    rel !== abs && /\bago\b|yesterday|ge\u00e7en|d\u00fcn|\u00f6nce/.test(rel),
    `6 days back must be relative ("${rel}"), never the absolute date (${locale})`,
  );
}
// Absolute omits the year when it's the current one — a "Aug 23" header this year,
// not a repeat of the year the calendar already shows. (At the turn of the year the
// test's 32-day window could straddle the boundary, so it uses two explicit dates.)
const earlierYear = new Date(now - 400 * DAY);
assert(
  !absolute(now - 5 * DAY).includes(String(new Date(now).getFullYear())),
  "a date in the current year must omit the year",
);
assert(
  absolute(now - 400 * DAY).includes(String(earlierYear.getFullYear())),
  "a date in a past year must carry its year",
);
// "now" is the current date, never a distance or gibberish.
const here = when(now);
assert(!/Invalid|NaN/.test(here) && here.length > 0, `"now" must print something real, got "${here}"`);

// headerDate() is the weekday header — it always names the day, never a moment.
const today = new Date(now);
const enWeekday = new Intl.DateTimeFormat("en", { weekday: "long" }).format(today);
assert(
  enWeekday.length > 0 && headerDate(now, "en").startsWith(enWeekday),
  `headerDate must open with the weekday ("${headerDate(now, "en")}" should start with "${enWeekday}")`,
);

// --- humanError(): fixed sentences, no raw detail leaks ----------------------
const KEY = HUMAN_ERRORS[1];
const ANSWER = HUMAN_ERRORS[2];
const BAD = HUMAN_ERRORS[3];
const GENERIC = HUMAN_ERRORS[4];
const cases: { e: unknown; say: string }[] = [
  { e: new TypeError("Failed to fetch"), say: HUMAN_ERRORS[0] },
  { e: new TypeError("fetch failed"), say: HUMAN_ERRORS[0] },
  { e: new Error('ElevenLabs 401: {"detail":"bad key"}'), say: KEY },
  { e: new Error("Gemini 403 rate limit"), say: KEY },
  { e: new Error("Anthropic 429"), say: ANSWER },
  { e: new Error("Ollama 500"), say: ANSWER },
  { e: new Error("Ollama 404: no such model"), say: GENERIC },
  { e: new Error("the request timed out"), say: ANSWER },
  { e: new SyntaxError("Unexpected token < in JSON at position 0"), say: BAD },
  { e: '{"reply":"hello"}', say: BAD },
  { e: undefined, say: BAD },
  { e: null, say: GENERIC },
  { e: new Error("provider exploded"), say: GENERIC },
  // A SayError's message is already learner-facing and passes through untouched.
  { e: new SayError("That folder has no Verba data in it yet."), say: "That folder has no Verba data in it yet." },
];
for (const { e, say: expected } of cases) {
  const got = humanError(e).say;
  assert.equal(got, expected, `humanError(${String(e)}) → "${got}", expected "${expected}"`);
  assert(!/\d{3,}/.test(got), `a learner-facing sentence must not carry a status code: "${got}"`);
  assert(!/[{}<>]/.test(got) && !got.includes("\n"), `a learner-facing sentence must be clean: "${got}"`);
  assert(got.length < 120, `a learner-facing sentence must be short: "${got}"`);
}

// --- invariant 22, mechanised: no raw error string escapes a hook or view ----
// The only way an error string reaches a surface is through `humanError`. Any of
// these patterns anywhere in a hook or view is that invariant broken.
const RAW_PATTERNS = [".message", ".stack", "String(e", "JSON.stringify(e", "err.message"];

function filesUnder(rel: string, filter: (name: string) => boolean): string[] {
  const abs = fileURLToPath(new URL(rel, ROOT));
  const out: string[] = [];
  // `readdirSync` in recursive mode also reports directories — stat each entry
  // so readFileSync is only ever handed a real file.
  for (const name of readdirSync(abs, { recursive: true })) {
    if (typeof name !== "string" || !filter(name)) continue;
    const full = fileURLToPath(new URL(rel + "/" + name, ROOT));
    if (statSync(full).isFile()) out.push(full);
  }
  return out;
}

// Every file under src/views/, plus every src/lib/use*.ts.
const viewFiles = filesUnder("src/views", () => true);
const hookFiles = filesUnder("src/lib", (n) => /^use.*\.ts$/.test(n));
const rawProblems: string[] = [];
for (const file of [...viewFiles, ...hookFiles]) {
  const text = readFileSync(file, "utf8");
  for (const pattern of RAW_PATTERNS) {
    if (text.includes(pattern)) {
      rawProblems.push(`${file.replace(srcDir, "src/")} contains "${pattern}"`);
      break;
    }
  }
}
assert(
  rawProblems.length === 0,
  "invariant 22 broken — raw model output could reach a learner: " + rawProblems.join("; "),
);

// --- invariant 22, dates: the formatter is the one door on every surface -----
const DATE_PATTERNS = ["toLocaleDateString", "toLocaleString", "toLocaleTimeString"];
const dateProblems: string[] = [];
for (const file of viewFiles.filter((f) => f.endsWith(".tsx"))) {
  const text = readFileSync(file, "utf8");
  for (const pattern of DATE_PATTERNS) {
    if (text.includes(pattern)) {
      dateProblems.push(`${file.replace(srcDir, "src/")} calls "${pattern}"`);
      break;
    }
  }
}
assert(
  dateProblems.length === 0,
  "invariant 22 broken — a view formats a date by hand: " + dateProblems.join("; "),
);

console.log("invariant 22 asserted: no raw model output, one formatter, on every surface");
console.log("fmt.check OK");

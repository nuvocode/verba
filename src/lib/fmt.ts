// One formatter, and nothing raw reaches the learner (PLAN-015).
//
// Every date a learner sees goes through `when`, and every caught error a
// learner sees goes through `humanError`. Both are pure: they take values and a
// locale and return strings, so they run in a check process (they must not
// import ./db.ts or anything Tauri).
import { UI_LANGUAGES } from "./langs.ts";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Relative under 7 days; older dates fall to absolute. */
const RELATIVE_WINDOW = 7 * DAY;

/**
 * The learner's locale — the one the interface is in, never `targetLanguage`.
 * Coerced onto the short list of locales the interface actually speaks, so the
 * app never asks Intl for a date format it is not sure it keeps. Falls back to
 * English when the platform won't say.
 */
export function uiLocale(): string {
  const raw = typeof navigator !== "undefined" ? navigator.language : "";
  const base = (raw.split("-")[0] || "").toLowerCase();
  // The region subtag survives ("en-US", "pt-BR") so dates follow the learner's
  // regional conventions, not just their language — but only when the base
  // language is one the interface actually speaks, else English. `settings
  // .uiLanguage` (the choice made on onboarding screen 0) is deliberately NOT
  // read here: the interface itself is not translated yet, so that field is
  // only a record — the learner who picked Turkish for the UI still wants their
  // dates in the region the OS already knows. When translations ship, this
  // should prefer settings.uiLanguage over the browser.
  return (UI_LANGUAGES as readonly string[]).includes(base) ? raw : "en";
}

/**
 * A moment, in the learner's locale. Under 7 days: relative ("2 days ago",
 * "yesterday"). Older: absolute, one format, no time unless `withTime`.
 * A moment that *is* now (within a minute) is absolute — the current date is a
 * header, not a distance.
 */
export function when(at: number, now = Date.now(), locale = uiLocale(), withTime = false): string {
  const age = now - at;
  // A timestamp that is the present is "today" — the date, not a relative label.
  if (Math.abs(age) < MINUTE) return absolute(at, locale, withTime, now);
  if (age >= 0 && age < RELATIVE_WINDOW) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (age < HOUR) return rtf.format(-Math.max(1, Math.floor(age / MINUTE)), "minute");
    if (age < DAY) return rtf.format(-Math.max(1, Math.floor(age / HOUR)), "hour");
    return rtf.format(-Math.floor(age / DAY), "day");
  }
  return absolute(at, locale, withTime, now);
}

/**
 * A moment as an absolute date, one format for the whole app. Omits the year
 * when it's the current one ("Aug 23" this year, "Aug 23 2025" last year),
 * so a recent date doesn't repeat what the calendar already says.
 */
export function absolute(at: number, locale = uiLocale(), withTime = false, now = Date.now()): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (new Date(at).getFullYear() !== new Date(now).getFullYear()) opts.year = "numeric";
  if (withTime) {
    opts.hour = "numeric";
    opts.minute = "2-digit";
  }
  return new Intl.DateTimeFormat(locale, opts).format(at);
}

/**
 * The current date as a page header — weekday first, the way a daily surface
 * should open ("Friday · August 26"). Today's `dateLine` is the only caller;
 * a header is about *today*, never a relative moment.
 */
export function headerDate(at: number = Date.now(), locale = uiLocale()): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(at).replace(/,/g, " ·");
}

/**
 * The fixed set of learner-facing error sentences, in order. `humanError` maps
 * every thrown value onto one of these by `say`; the matching `log` carries the
 * detail a developer wants and a learner is spared. Exporting the set lets a
 * check assert membership rather than re-typing a sentence.
 */
export const HUMAN_ERRORS = [
  "You're offline, or the model isn't reachable.",
  "That key was refused. Check it in Settings.",
  "The model didn't answer. Try again.",
  "The reply came back unusable. Try again.",
  "Something went wrong. Try again.",
] as const;

const [OFFLINE, KEY_REFUSED, NO_ANSWER, UNUSABLE, GENERIC] = HUMAN_ERRORS;

/**
 * An error whose message is *already* a learner-facing sentence — a validation
 * failure (a bad pack, an unwritable folder) the UI wrote itself. `humanError`
 * hands it straight through as its own `say`, because translating it again
 * would bury the one detail the learner actually needs.
 */
export class SayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SayError";
  }
}

/** The first 3-digit status code in an error's text, or 0. Providers raise
 *  `Error("Ollama 500: …")` / `Error("Anthropic 401: …")`, so the code is the
 *  shape that decides the 4xx vs 5xx fork. */
function statusOf(text: string): number {
  const m = text.match(/\b([1-5]\d\d)\b/);
  return m ? Number(m[1]) : 0;
}

/**
 * What a caught error is allowed to say. Maps a thrown value onto one of a set
 * of learner-facing sentences by shape: a network failure, an HTTP status, a
 * bad reply, or anything else. The original is returned separately for the log,
 * never for the screen — a caller that spreads `log` into JSX is the bug the
 * check catches.
 */
export function humanError(e: unknown): { say: string; log: string } {
  const log = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  // First branch: a message the UI already wrote for the learner. Not raw model
  // output, not a status code — pass it through untouched.
  if (e instanceof SayError) return { say: e.message, log: e.message };
  // Fetch failures arrive as a TypeError (`Failed to fetch`) — the network, not
  // the model, is the thing that did not answer.
  if (e instanceof TypeError || /failed to fetch|fetch failed|networkerror/i.test(log))
    return { say: OFFLINE, log };
  const status = statusOf(log);
  // A refused credential is the one thing the learner can act on, so it gets its
  // own sentence; a 429 is the model being busy, not the key being wrong; any
  // other 4xx is the request itself — generic.
  if (status === 401 || status === 403) return { say: KEY_REFUSED, log };
  if (status === 429) return { say: NO_ANSWER, log };
  if (status >= 400 && status < 500) return { say: GENERIC, log };
  if (status >= 500 || /time\s?out|timed out|took too long/i.test(log)) return { say: NO_ANSWER, log };
  // A reply that never became a usable answer: a JSON parse error, a raw JSON
  // string, or nothing at all.
  if (e instanceof SyntaxError || /^\{|^\[/.test(log.trim()) || log.trim() === "" || log === "undefined")
    return { say: UNUSABLE, log };
  return { say: GENERIC, log };
}

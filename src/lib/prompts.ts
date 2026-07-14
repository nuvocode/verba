import { level, type Settings } from "./settings.ts";
import type { Scenario } from "./scenarios";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";

export type { Scenario } from "./scenarios";
export { packGuidance } from "./packs/schema.ts";

/** System prompt for a normal conversational turn. Model must return the turn JSON. */
export function buildSystem(s: Settings, scenario: Scenario, pack?: LanguagePack, memories: Memory[] = []): string {
  return [
    `You are Verba, a warm and encouraging ${s.targetLang} conversation tutor.`,
    `The learner's native language is ${s.nativeLang}. Their self-reported level is ${level(s)}.`,
    `Scenario: ${scenario.setup}`,
    scenario.goals?.length ? `Help the learner practise these goals: ${scenario.goals.join("; ")}.` : "",
    packGuidance(pack),
    memoryBrief(memories),
    memories.length
      ? `Bring one of those up only where it fits — ask after it, or build on it. Never read the list back, and never tell the learner you keep notes on them.`
      : "",
    ``,
    `Hold a natural conversation in ${s.targetLang}. Match your vocabulary and sentence length to a ${level(s)} learner. Always keep the conversation going by ending your reply with a question or prompt.`,
    ``,
    `You MUST answer with ONLY a valid JSON object, no prose outside it, in this exact shape:`,
    `{`,
    `  "reply": "your natural conversational reply in ${s.targetLang} (1-3 sentences)",`,
    `  "corrections": [ { "original": "the learner's exact wording that was wrong", "fixed": "the corrected version", "note": "a short explanation written in ${s.nativeLang}", "severity": "minor or severe" } ],`,
    `  "suggestions": [ "a short example reply the learner could send next, in ${s.targetLang}", "another option" ]`,
    `}`,
    ``,
    `Rules:`,
    `- Do NOT correct the learner inside "reply". Put every correction only in the "corrections" array.`,
    `- Only add a correction for a real grammar, word-choice, or spelling mistake. If the learner's message was fine, return "corrections": [].`,
    `- "severity" is "severe" when the mistake breaks meaning or grammar rules, "minor" when it is understandable but unnatural.`,
    `- Give 2-3 "suggestions". Keep them natural and at the learner's level.`,
    `- Never mention that you are returning JSON.`,
  ].join("\n");
}

export type Severity = "minor" | "severe";

/**
 * Correction policy: does this break the conversation open now, or wait for the
 * reflection? "adaptive" is the default — only a meaning-breaking mistake is
 * worth interrupting a learner mid-flow for.
 */
export function shouldShowInline(timing: "adaptive" | "live" | "delayed", severity?: Severity): boolean {
  if (!severity) return false;
  if (timing === "live") return true;
  if (timing === "delayed") return false;
  return severity === "severe";
}

export interface Correction {
  original: string;
  fixed: string;
  note: string;
  severity: Severity;
}

export interface TurnResult {
  reply: string;
  corrections: Correction[];
  suggestions: string[];
}

/** Defensive parse: models sometimes wrap JSON in prose or code fences. */
export function parseTurn(raw: string): TurnResult {
  let obj = extractJson(raw);
  // A small model under a JSON grammar (Ollama format:"json") can satisfy it by
  // nesting the real answer — fences and all — inside "reply". Unwrap one level.
  if (typeof obj?.reply === "string" && obj.reply.includes('"reply"')) obj = extractJson(obj.reply) ?? obj;
  return {
    reply: typeof obj?.reply === "string" ? obj.reply : raw.trim(),
    corrections: Array.isArray(obj?.corrections)
      ? obj.corrections
          .filter((c: any) => c && c.original && c.fixed)
          .map((c: any) => ({
            original: String(c.original),
            fixed: String(c.fixed),
            note: String(c.note ?? ""),
            // Unknown / missing severity is treated as minor: never escalate an
            // interruption the model didn't actually ask for.
            severity: c.severity === "severe" ? ("severe" as const) : ("minor" as const),
          }))
      : [],
    suggestions: Array.isArray(obj?.suggestions)
      ? obj.suggestions.map((x: any) => String(x)).filter(Boolean).slice(0, 3)
      : [],
  };
}

/** Prompt to pull useful vocabulary out of a finished/ongoing conversation. */
export function vocabPrompt(s: Settings, pack?: LanguagePack): string {
  return [
    `From the conversation so far, pick up to 8 useful ${s.targetLang} words or short phrases that a ${level(s)} learner should study.`,
    packGuidance(pack),
    `Answer with ONLY a JSON object: { "items": [ { "term": "the ${s.targetLang} word/phrase in its dictionary form", "translation": "its meaning in ${s.nativeLang}", "example": "a short example sentence in ${s.targetLang} that uses the term" } ] }.`,
    `Prefer words that actually appeared in the conversation. Skip trivial words (the, a, is).`,
    // The card is studied as a cloze: Memory blanks "term" out of "example", so
    // the two must match literally or the learner gets a blank tacked on the end.
    `The "example" MUST contain "term" written exactly as you wrote it — do not inflect, conjugate or decline it there.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseVocab(raw: string): { term: string; translation: string; example: string }[] {
  const obj = extractJson(raw);
  if (!Array.isArray(obj?.items)) return [];
  return obj.items
    .filter((v: any) => v && v.term)
    .map((v: any) => ({
      term: String(v.term),
      translation: String(v.translation ?? ""),
      example: String(v.example ?? ""),
    }));
}

/** Prompt for an end-of-session summary. */
export function summaryPrompt(s: Settings, pack?: LanguagePack): string {
  return [
    `Summarise this ${s.targetLang} practice session for the learner.`,
    packGuidance(pack),
    `Answer with ONLY a JSON object: { "summary": "2-3 sentences on what was practised, written in ${s.nativeLang}", "strengths": ["short point", ...], "focus": ["short thing to work on next", ...] }.`,
    `Base "strengths" and "focus" on the learner's actual messages. Keep each point under 12 words.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface SessionSummary {
  summary: string;
  strengths: string[];
  focus: string[];
}

/**
 * Prompt for the short name a conversation carries in the history list.
 *
 * Called twice: "opening" right after the first exchange, so the entry has a name
 * the moment it appears, and "settled" once the subject has actually emerged. The
 * second call is told it is replacing a guess — otherwise a model handed a title
 * it already wrote tends to just hand it back.
 */
export function titlePrompt(s: Settings, stage: "opening" | "settled" = "opening"): string {
  return [
    stage === "opening"
      ? `Name this conversation, going on what it opened with.`
      : `The conversation has found its subject. Re-name it for what it actually turned out to be about — do not keep the earlier guess unless it still fits.`,
    `Answer with ONLY a JSON object: { "title": "the name, written in ${s.nativeLang}" }.`,
    `The title is a label in a list, not a sentence: 2-5 words, no final punctuation, no quotes.`,
    `Name the subject, not the exercise — "Cooking and eating out", "Booking a late check-in". Never "${s.targetLang} practice" or the scenario's name.`,
  ].join("\n");
}

/** The title, or "" if the model gave us nothing usable — the old title then stands. */
export function parseTitle(raw: string): string {
  // Models like to quote the label, and to end it with a full stop.
  const clean = (s: string) =>
    s.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”.]+$/g, "").trim();

  const obj = extractJson(raw);
  if (typeof obj?.title === "string") return clean(obj.title).slice(0, 60).trim();

  // No JSON came back. A bare one-liner is still a usable title; a paragraph of
  // prose is a failed call, and a failed call leaves the standing title alone.
  const bare = clean(raw ?? "");
  return !bare || bare.length > 60 ? "" : bare;
}

export function parseSummary(raw: string): SessionSummary {
  const obj = extractJson(raw) ?? {};
  return {
    summary: typeof obj.summary === "string" ? obj.summary : raw.trim(),
    strengths: Array.isArray(obj.strengths) ? obj.strengths.map(String) : [],
    focus: Array.isArray(obj.focus) ? obj.focus.map(String) : [],
  };
}

// ---- long-term memory: what the coach knows about the learner ----
//
// Not the vocabulary deck — that is the "Memory" space in the nav, and it keeps
// the name. This is the learner themselves: who they are, what they do, what they
// are learning the language for. Written at the end of a session, read back at the
// start of the next one, and on show in Settings → User Memory, where the learner
// can strike out anything that is wrong or none of the machine's business.

/**
 * One durable fact, in the learner's own language, with the day it was learned.
 * The date is part of the record: it is what lets the coach say "you mentioned a
 * few weeks ago…", and what lets a fact that has gone stale be spotted.
 */
export interface Memory {
  id: number;
  fact: string;
  created_at: number;
}

/** The date as the record carries it, and as Settings shows it: "14 Jul 2026". */
export const memoryDate = (ts: number): string =>
  new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * At most this many facts out of any one conversation. A session that yields ten
 * durable facts has stopped telling durable facts from small talk, and the cap is
 * cheaper than trusting the model not to.
 */
const MEMORY_PER_SESSION = 6;

/**
 * The memory as every prompt sees it — the knowledge only. What to *do* with it
 * differs by caller (the coach converses, the reader picks topics, the report
 * refers back), so each one adds its own instruction after this block.
 *
 * An empty list gives an empty string: a first-time learner's prompt should not
 * carry a "you know nothing about them" preamble.
 */
export function memoryBrief(memories: Memory[]): string {
  if (!memories.length) return "";
  return [
    `What you know about the learner, from earlier sessions:`,
    ...memories.map((m) => `- ${m.fact} · ${memoryDate(m.created_at)}`),
  ].join("\n");
}

/** Prompt to pull durable facts about the learner out of a finished conversation. */
export function memoryPrompt(s: Settings, known: Memory[]): string {
  return [
    `You keep the long-term memory of this learner — the handful of things a good tutor would still know about them in a month.`,
    known.length
      ? [`Already recorded:`, ...known.map((m) => `${m.id}. ${m.fact}`)].join("\n")
      : `Nothing is recorded yet.`,
    ``,
    `From this conversation, record only what is durable: who they are, what they do, why they are learning ${s.targetLang}, the people and places that recur in their life, what they have said they like and dislike.`,
    `Not what happened today, not what they practised, not how well they did — that is measured elsewhere.`,
    ``,
    `Answer with ONLY a JSON object: { "facts": [ { "fact": "one short fact, written in ${s.nativeLang}", "replaces": null } ] }.`,
    `Rules:`,
    `- Never say the same thing twice. If a fact is already recorded above, leave it out entirely.`,
    `- If this conversation changed a recorded fact — they moved city, changed job, took up something new — write the fact as it now stands and set "replaces" to that fact's number. The old one is dropped, not kept beside it.`,
    `- "replaces" is null for anything genuinely new.`,
    `- A fact is a short third-person phrase, under 12 words: "Works as a backend developer", "Cooks most evenings, eats out at weekends".`,
    `- Record nothing you are not sure of. { "facts": [] } is the right answer for a conversation that revealed nothing durable.`,
  ].join("\n");
}

/** A fact on its way into the record, and the fact it supersedes — if it supersedes one. */
export interface MemoryWrite {
  fact: string;
  /** The id of the recorded fact this one replaces, or null when it is new. */
  replaces: number | null;
}

export function parseMemory(raw: string): MemoryWrite[] {
  const obj = extractJson(raw);
  if (!Array.isArray(obj?.facts)) return [];
  return obj.facts
    .filter((f: any) => f && typeof f.fact === "string" && f.fact.trim())
    .map((f: any) => {
      // Models hand back "3" as often as 3, and null / undefined / "" as often as
      // neither. Anything that is not a positive whole number means "this is new".
      const r = Number(f.replaces);
      return {
        fact: String(f.fact).replace(/\s+/g, " ").trim().slice(0, 120),
        replaces: Number.isInteger(r) && r > 0 ? r : null,
      };
    });
}

/** Two facts are one fact when only case, punctuation or spacing separates them. */
const factKey = (fact: string) =>
  fact
    .toLowerCase()
    .replace(/\p{P}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * What actually gets written, given what is already on file. The model is asked to
 * dedupe and supersede itself and mostly does; this is the half that does not
 * depend on it having behaved.
 *
 * - a fact already on file is dropped — told twice is not two bullets
 * - "replaces" is honoured only when it names a fact that exists: a hallucinated
 *   number would otherwise delete a row the learner never contradicted
 * - a "new" fact whose wording is already recorded is dropped whatever it claims
 *   to replace, because the safe read of that confusion is that nothing changed
 */
export function planMemory(known: Memory[], incoming: MemoryWrite[]): MemoryWrite[] {
  const ids = new Set(known.map((m) => m.id));
  const seen = new Set(known.map((m) => factKey(m.fact)));
  const out: MemoryWrite[] = [];

  for (const w of incoming) {
    if (out.length >= MEMORY_PER_SESSION) break;
    const key = factKey(w.fact);
    if (!key || seen.has(key)) continue; // …and `seen` grows as we go, so not twice within one batch either
    out.push({ fact: w.fact, replaces: w.replaces != null && ids.has(w.replaces) ? w.replaces : null });
    seen.add(key);
  }
  return out;
}

/** Find the first {...} JSON object in a string and parse it. Returns null on failure. */
function extractJson(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // strip code fences / surrounding prose and try the outermost braces
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

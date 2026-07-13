import { level, type Settings } from "./settings.ts";
import type { Scenario } from "./scenarios";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";

export type { Scenario } from "./scenarios";
export { packGuidance } from "./packs/schema.ts";

/** System prompt for a normal conversational turn. Model must return the turn JSON. */
export function buildSystem(s: Settings, scenario: Scenario, pack?: LanguagePack): string {
  return [
    `You are Verba, a warm and encouraging ${s.targetLang} conversation tutor.`,
    `The learner's native language is ${s.nativeLang}. Their self-reported level is ${level(s)}.`,
    `Scenario: ${scenario.setup}`,
    scenario.goals?.length ? `Help the learner practise these goals: ${scenario.goals.join("; ")}.` : "",
    packGuidance(pack),
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

export function parseSummary(raw: string): SessionSummary {
  const obj = extractJson(raw) ?? {};
  return {
    summary: typeof obj.summary === "string" ? obj.summary : raw.trim(),
    strengths: Array.isArray(obj.strengths) ? obj.strengths.map(String) : [],
    focus: Array.isArray(obj.focus) ? obj.focus.map(String) : [],
  };
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

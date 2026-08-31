import type { Settings } from "./settings.ts";
import { levelOf } from "./model.ts";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";
import { memoryBrief, type Memory } from "./prompts.ts";

// Advanced coaching — the two AI features the phase asks for on top of the
// learning engine: a weekly progress report and targeted weak-area drills.
// Both are prompt-builder + parser pairs (same shape as prompts.ts); the view
// gathers the week's numbers from the DB and hands them in.

export interface WeekStats {
  sessions: number;
  messages: number;
  wordsPracticed: number;
  vocabLearned: number; // new cards captured this week
  vocabReviewed: number; // cards reviewed this week (reps advanced)
  avgLevelScore: number | null; // mean metrics-v2 composite, if any
  focusAreas: string[]; // recurring "focus next" points from summaries
}

export function weeklyReportPrompt(s: Settings, w: WeekStats, pack?: LanguagePack, memories: Memory[] = []): string {
  return [
    `You are a ${s.profile.targetLanguage} learning coach writing a short weekly progress report for a ${levelOf(s.profile)} learner.`,
    `Write in ${s.profile.nativeLanguage}. Be specific and encouraging, not generic.`,
    packGuidance(pack),
    memoryBrief(memories),
    // The one place a fact earns its keep unprompted: a week of numbers means
    // something measured against why they are learning at all. But only that —
    // the report is about the week, not about them.
    memories.length
      ? `If why they are learning ${s.profile.targetLanguage} is among those facts, measure the week against it. Leave the rest of them out; the report is about the week's work, not about the learner.`
      : "",
    `This week's data:`,
    `- practice sessions: ${w.sessions}`,
    `- messages written: ${w.messages}`,
    `- words practised: ${w.wordsPracticed}`,
    `- new vocabulary captured: ${w.vocabLearned}`,
    `- vocabulary cards reviewed: ${w.vocabReviewed}`,
    // Verba is CEFR-based, not XP: never expose the raw composite as a number.
    // Feed it only as a qualitative band relative to their CEFR level.
    w.avgLevelScore != null ? `- performance this week: ${scoreBand(w.avgLevelScore)} within ${levelOf(s.profile)}` : "",
    w.focusAreas.length ? `- recurring weak areas: ${w.focusAreas.join("; ")}` : "",
    `Describe progress in CEFR terms (e.g. "progressing within ${levelOf(s.profile)}"). Never state a numeric score, points, or percentage.`,
    // No "focus" field: what to drill next is derived from the signals (lib/weakness),
    // not guessed at by the report — asking for it produced a second, softer answer to
    // a question the plan already answers with evidence.
    `Do not write a headline, a score, a percentage, or a list of wins — those are measured elsewhere and shown beside your text. Write only the paragraph.`,
    `Answer with ONLY a JSON object: { "report": "2-4 sentences of substance" }.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface WeeklyReport {
  report: string;
}

/**
 * Parse a weekly report from the model's reply. Returns `null` when the reply held
 * no usable report — the caller shows the `Unusable` state and offers regeneration
 * rather than putting the raw reply on screen (§3.2, PLAN-015). A parsed report is
 * always a real report string, never the raw text.
 */
export function parseWeeklyReport(raw: string): WeeklyReport | null {
  const o = extractJson(raw) ?? {};
  if (typeof o.report === "string") return { report: o.report };
  return null;
}

/** Generate a small set of focused exercises for the learner's weak areas. */
export function drillPrompt(s: Settings, areas: string[], count = 4, pack?: LanguagePack): string {
  const focus = areas.filter(Boolean);
  return [
    `Create ${count} short ${s.profile.targetLanguage} practice drills for a ${levelOf(s.profile)} learner.`,
    packGuidance(pack),
    focus.length ? `Target these weak areas: ${focus.join("; ")}.` : `Target common ${levelOf(s.profile)} sticking points.`,
    `Each drill is one small task the learner can answer in a sentence or two.`,
    `Answer with ONLY a JSON object: { "drills": [ { "area": "the skill being drilled", "prompt": "the task in ${s.profile.targetLanguage}", "hint": "a short hint in ${s.profile.nativeLanguage}", "example": "a model answer in ${s.profile.targetLanguage}" } ] }.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface Drill {
  area: string;
  prompt: string;
  hint: string;
  example: string;
}

export function parseDrills(raw: string): Drill[] {
  const o = extractJson(raw) ?? {};
  if (!Array.isArray(o.drills)) return [];
  return o.drills
    .filter((d: any) => d && d.prompt)
    .map((d: any) => ({
      area: str(d.area),
      prompt: str(d.prompt),
      hint: str(d.hint),
      example: str(d.example),
    }));
}

/** Coarse, CEFR-friendly band for the internal 0-100 composite — keeps the raw number out of prompts. */
function scoreBand(score: number): string {
  if (score < 40) return "still consolidating the basics";
  if (score < 70) return "steadily progressing";
  return "performing strongly";
}

const str = (x: any) => String(x ?? "");

function extractJson(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
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

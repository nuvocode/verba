import { level, type Settings } from "./settings.ts";
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
    `You are a ${s.targetLang} learning coach writing a short weekly progress report for a ${level(s)} learner.`,
    `Write in ${s.nativeLang}. Be specific and encouraging, not generic.`,
    packGuidance(pack),
    memoryBrief(memories),
    memories.length
      ? `Tie the report to why they are actually learning — a week's numbers mean something against that, and nothing on their own.`
      : "",
    `This week's data:`,
    `- practice sessions: ${w.sessions}`,
    `- messages written: ${w.messages}`,
    `- words practised: ${w.wordsPracticed}`,
    `- new vocabulary captured: ${w.vocabLearned}`,
    `- vocabulary cards reviewed: ${w.vocabReviewed}`,
    // Verba is CEFR-based, not XP: never expose the raw composite as a number.
    // Feed it only as a qualitative band relative to their CEFR level.
    w.avgLevelScore != null ? `- performance this week: ${scoreBand(w.avgLevelScore)} within ${level(s)}` : "",
    w.focusAreas.length ? `- recurring weak areas: ${w.focusAreas.join("; ")}` : "",
    `Describe progress in CEFR terms (e.g. "progressing within ${level(s)}"). Never state a numeric score, points, or percentage.`,
    `Answer with ONLY a JSON object: { "headline": "one upbeat sentence", "report": "2-4 sentences of substance", "wins": ["short win", ...], "focus": ["short area to drill next", ...] }.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface WeeklyReport {
  headline: string;
  report: string;
  wins: string[];
  focus: string[];
}

export function parseWeeklyReport(raw: string): WeeklyReport {
  const o = extractJson(raw) ?? {};
  return {
    headline: str(o.headline),
    report: typeof o.report === "string" ? o.report : raw.trim(),
    wins: arr(o.wins),
    focus: arr(o.focus),
  };
}

/** Generate a small set of focused exercises for the learner's weak areas. */
export function drillPrompt(s: Settings, areas: string[], count = 4, pack?: LanguagePack): string {
  const focus = areas.filter(Boolean);
  return [
    `Create ${count} short ${s.targetLang} practice drills for a ${level(s)} learner.`,
    packGuidance(pack),
    focus.length ? `Target these weak areas: ${focus.join("; ")}.` : `Target common ${level(s)} sticking points.`,
    `Each drill is one small task the learner can answer in a sentence or two.`,
    `Answer with ONLY a JSON object: { "drills": [ { "area": "the skill being drilled", "prompt": "the task in ${s.targetLang}", "hint": "a short hint in ${s.nativeLang}", "example": "a model answer in ${s.targetLang}" } ] }.`,
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
const arr = (x: any) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);

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

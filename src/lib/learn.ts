import { level, type Settings } from "./settings.ts";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";

// Learning engine — turns the app's separate activities into one coherent daily
// session. Everything a learner does in a day hangs off a single theme so the
// conversation, the story they read, and the role-play reinforce the same
// vocabulary. The plan is deterministic given its inputs (level, due-review
// count, focus areas, the day) so it is reproducible and unit-checkable; the
// only AI in the loop is the optional theme suggestion and the end-of-day recap.
//
// "Completed end-to-end" (the phase's done-when) = every block marked done and
// the recap generated. The Daily view drives that; this module owns the shape.

export type BlockKind = "conversation" | "reading" | "scenario" | "vocab" | "listening" | "summary";

export interface DailyBlock {
  kind: BlockKind;
  title: string;
  detail: string;
  minutes: number;
  scenarioId?: string; // conversation / scenario blocks launch this scenario
  goal?: string; // weak-area drill folded into the block
}

export interface DailyPlan {
  date: string; // YYYY-MM-DD
  theme: string;
  level: string;
  focus: string[]; // weak areas this plan drills
  blocks: DailyBlock[];
  totalMinutes: number;
}

export interface PlanContext {
  date: string; // YYYY-MM-DD (passed in — this module stays clock-free)
  dueVocab: number; // cards due for review today
  focus?: string[]; // weak areas from recent summaries / metrics
  theme?: string; // optional override (e.g. an AI suggestion)
}

// A short rotation so an offline day still gets a themed plan without any AI.
const THEMES = [
  "daily routines",
  "food and cooking",
  "travel and directions",
  "work and studies",
  "friends and family",
  "hobbies and free time",
  "shopping and money",
  "health and the body",
];

// What each onboarding interest chip narrows the rotation to. No chips → the full rotation.
const INTEREST_THEMES: Record<string, string[]> = {
  Travel: ["travel and directions", "shopping and money", "food and cooking"],
  Work: ["work and studies", "daily routines", "shopping and money"],
  "Family & friends": ["friends and family", "daily routines", "health and the body"],
  "Books & film": ["hobbies and free time", "friends and family", "work and studies"],
};

/** Deterministic theme for a date, so the same day always yields the same plan. */
export function themeForDate(date: string, interests: string[] = []): string {
  const pool = [...new Set(interests.flatMap((i) => INTEREST_THEMES[i] ?? []))];
  const list = pool.length ? pool : THEMES;
  const day = Number(date.replace(/-/g, "")) || 0;
  return list[day % list.length];
}

/** Build a personalised daily session. Pure — no I/O, no clock. */
export function buildDailyPlan(s: Settings, ctx: PlanContext): DailyPlan {
  const theme = ctx.theme?.trim() || themeForDate(ctx.date, s.goals);
  const focus = (ctx.focus ?? []).filter(Boolean).slice(0, 3);
  const drill = focus[0];

  const blocks: DailyBlock[] = [
    {
      kind: "conversation",
      title: `Conversation — ${theme}`,
      detail: `Hold a ${s.targetLang} conversation about ${theme}.`,
      minutes: 10,
      scenarioId: "free",
      goal: drill,
    },
    {
      kind: "reading",
      title: `Reading — ${theme}`,
      detail: `Read a short level-${level(s)} story about ${theme}.`,
      minutes: 5,
      goal: focus[1] ?? drill,
    },
    {
      kind: "scenario",
      title: "Role-play",
      detail: `Practise a real-world ${s.targetLang} scenario.`,
      minutes: 5,
      scenarioId: pickScenario(theme),
    },
  ];

  if (ctx.dueVocab > 0) {
    blocks.push({
      kind: "vocab",
      title: `Vocabulary review — ${ctx.dueVocab} due`,
      detail: `Review the ${ctx.dueVocab} card(s) due today.`,
      minutes: Math.min(10, Math.max(2, Math.ceil(ctx.dueVocab / 4))),
    });
  }

  // A listening cool-down before the recap — an input skill to close the working
  // blocks, kept last so it never displaces the conversation-first running order.
  blocks.push({
    kind: "listening",
    title: "Listening",
    detail: `Hear a short ${s.targetLang} story and answer what you caught.`,
    minutes: 6,
    goal: focus[2] ?? drill,
  });

  blocks.push({
    kind: "summary",
    title: "Wrap-up",
    detail: "Review what you practised and get your recap.",
    minutes: 2,
  });

  return {
    date: ctx.date,
    theme,
    level: level(s),
    focus,
    blocks,
    totalMinutes: blocks.reduce((n, b) => n + b.minutes, 0),
  };
}

/**
 * The first block of the plan the learner still owes — the day's running order, honoured.
 * Pure and given both inputs explicitly, so a screen that has just finished a block can
 * ask "what now?" with the `done` list it just wrote, instead of the one React has caught
 * up to. `null` means the day is finished: there is nothing left to hand them.
 */
export function nextBlock(plan: DailyPlan | null, done: BlockKind[]): BlockKind | null {
  return plan?.blocks.map((b) => b.kind).find((k) => !done.includes(k)) ?? null;
}

// Nudge the role-play toward a scenario that fits the theme; default to a café.
function pickScenario(theme: string): string {
  if (/food|cook|shop|money/.test(theme)) return "restaurant";
  if (/travel|direction/.test(theme)) return "airport";
  if (/work|stud/.test(theme)) return "interview";
  return "restaurant";
}

/** Prompt for the end-of-day recap that ties the whole session together. */
export function recapPrompt(s: Settings, plan: DailyPlan, done: BlockKind[], pack?: LanguagePack): string {
  return [
    `The learner just finished a daily ${s.targetLang} session themed "${plan.theme}" (level ${plan.level}).`,
    packGuidance(pack),
    `They completed: ${done.join(", ") || "nothing"}.`,
    plan.focus.length ? `They are working on: ${plan.focus.join("; ")}.` : "",
    `Answer with ONLY a JSON object: { "recap": "2-3 encouraging sentences in ${s.nativeLang} on what they practised", "nextFocus": ["one short thing to work on tomorrow", ...] }.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface DayRecap {
  recap: string;
  nextFocus: string[];
}

export function parseRecap(raw: string): DayRecap {
  const o = extractJson(raw) ?? {};
  return {
    recap: typeof o.recap === "string" ? o.recap : raw.trim(),
    nextFocus: Array.isArray(o.nextFocus) ? o.nextFocus.map(String).filter(Boolean) : [],
  };
}

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

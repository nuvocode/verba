import type { Settings } from "./settings.ts";
import { makePlan, planActivity, levelOf } from "./model.ts";
import type { ActivityKind, DailyPlan, PlannedActivity } from "./model.ts";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";

// Learning engine — turns the app's separate activities into one coherent daily
// session. Everything a learner does in a day hangs off a single theme so the
// conversation, the story they read, and the role-play reinforce the same
// vocabulary. The plan is deterministic given its inputs (due-review count, focus
// areas, the day) so it is reproducible and unit-checkable; the only AI in the
// loop is the optional theme suggestion and the end-of-day recap.
//
// The plan's *shape* lives in lib/model.ts (the shared §1.2 DailyPlan); this
// module is the engine that fills one in. "Completed end-to-end" (the phase's
// done-when) = every activity marked done and the recap generated. The Daily view
// drives that; this module owns the build.

export interface PlanContext {
  date: string; // YYYY-MM-DD (passed in — this module stays clock-free)
  dayIndex: number; // the learner's nth day (passed in — not counted here)
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
  const theme = ctx.theme?.trim() || themeForDate(ctx.date, s.profile.interests);
  const focus = (ctx.focus ?? []).filter(Boolean).slice(0, 3);
  const drill = focus[0];

  const activities: PlannedActivity[] = [
    planActivity({
      id: "talk",
      kind: "talk",
      title: "Conversation",
      rationale: drill
        ? `Yesterday ${drill} gave you trouble, so you drill it in conversation first, while it is easiest to catch.`
        : "Conversation comes first so the day's words are ones you produced yourself.",
      estimatedMinutes: 10,
      scenarioId: "free",
      goal: drill,
    }),
    planActivity({
      id: "read",
      kind: "read",
      title: "Reading",
      rationale: `The passage reuses what you just said about ${theme}, so you meet those words again in someone else's sentences.`,
      estimatedMinutes: 5,
      goal: focus[1] ?? drill,
    }),
    planActivity({
      id: "roleplay",
      kind: "roleplay",
      title: "Role-play",
      rationale: `A scripted situation puts the same ${theme} language under a little pressure.`,
      estimatedMinutes: 5,
      scenarioId: pickScenario(theme),
    }),
  ];

  if (ctx.dueVocab > 0) {
    activities.push(
      planActivity({
        id: "memory",
        kind: "memory",
        title: "Vocabulary review",
        rationale: `${ctx.dueVocab} cards are due today, and reviewing them after you have used the words is when they stick.`,
        estimatedMinutes: Math.min(10, Math.max(2, Math.ceil(ctx.dueVocab / 4))),
      }),
    );
  }

  // A listening cool-down before the recap — an input skill to close the working
  // activities, kept last so it never displaces the conversation-first running order.
  activities.push(
    planActivity({
      id: "listen",
      kind: "listen",
      title: "Listening",
      rationale: "Listening closes the day on input, so the last thing you do is understand rather than produce.",
      estimatedMinutes: 6,
      goal: focus[2] ?? drill,
    }),
    planActivity({
      id: "wrapup",
      kind: "wrapup",
      title: "Wrap-up",
      rationale: "A recap of what you actually practised, and one thing to carry into tomorrow.",
      estimatedMinutes: 2,
    }),
  );

  // focus is deliberately not written to the plan — it stays in PlanContext and
  // rides into recapPrompt as a parameter. targetedWeaknesses is filled by #15.
  return makePlan({
    date: ctx.date,
    dayIndex: ctx.dayIndex,
    theme,
    targetedWeaknesses: [],
    activities,
  });
}

/**
 * The first activity of the plan the learner still owes — the day's running order, honoured.
 * Pure and given both inputs explicitly, so a screen that has just finished an activity can
 * ask "what now?" with the `done` list it just wrote, instead of the one React has caught
 * up to. `null` means the day is finished: there is nothing left to hand them.
 */
export function nextActivity(plan: DailyPlan | null, done: ActivityKind[]): ActivityKind | null {
  return plan?.activities.map((a) => a.kind).find((k) => !done.includes(k)) ?? null;
}

/**
 * True when a stored plan predates the shared model — an old `{blocks:[...]}` row.
 * Such rows are treated as absent by useDay and rebuilt; they stay on disk until the
 * day is reopened (there is no migration).
 */
export function isLegacyPlanShape(plan: unknown): boolean {
  return typeof plan === "object" && plan !== null && "blocks" in plan;
}

// Nudge the role-play toward a scenario that fits the theme; default to a café.
function pickScenario(theme: string): string {
  if (/food|cook|shop|money/.test(theme)) return "restaurant";
  if (/travel|direction/.test(theme)) return "airport";
  if (/work|stud/.test(theme)) return "interview";
  return "restaurant";
}

/** Prompt for the end-of-day recap that ties the whole session together. */
export function recapPrompt(
  s: Settings,
  plan: DailyPlan,
  focus: string[],
  done: ActivityKind[],
  pack?: LanguagePack,
): string {
  return [
    `The learner just finished a daily ${s.profile.targetLanguage} session themed "${plan.theme}" (level ${levelOf(s.profile)}).`,
    packGuidance(pack),
    `They completed: ${done.join(", ") || "nothing"}.`,
    focus.length ? `They are working on: ${focus.join("; ")}.` : "",
    `Answer with ONLY a JSON object: { "recap": "2-3 encouraging sentences in ${s.profile.nativeLanguage} on what they practised", "nextFocus": ["one short thing to work on tomorrow", ...] }.`,
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

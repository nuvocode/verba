import type { Settings } from "./settings.ts";
import { makePlan, planActivity, levelOf } from "./model.ts";
import type { ActivityKind, DailyPlan, PlannedActivity, Weakness } from "./model.ts";
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
  /** Declared weaknesses, strongest first. When present they are the focus, and the plan says so. */
  weaknesses?: Weakness[];
  theme?: string; // optional override (e.g. an AI suggestion)
}

/**
 * Which activities carry the day's drills, in the order the focus list fills them.
 * Exported because Coach promises the learner that tomorrow drills their weakest
 * areas, and a promise made on one screen and kept by another has to come from one
 * rule — this one. Only activities that are always in the plan may appear here:
 * memory is skipped on a day with nothing due, and a weakness pointing at an
 * activity that is not there is invariant 6's failure case.
 */
export const DRILL_SLOTS = ["talk", "read", "listen"] as const;

/**
 * What each drill slot works on, index-aligned with DRILL_SLOTS. A short focus list
 * does not leave the later slots idle: they fall back to the first item, so a single
 * weak area is drilled three ways rather than once.
 */
export function drillGoals(focus: string[]): (string | undefined)[] {
  const drill = focus[0];
  return [drill, focus[1] ?? drill, focus[2] ?? drill];
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

/**
 * Which activities a day of this length contains.
 *
 * The three lengths are not three sizes of one day — the shortest is a different
 * day, and setup already said so in as many words: "Three short pieces —
 * conversation, a passage, the words that are due." Squeezing six activities into
 * twenty minutes would honour the number and break the promise, so the short day
 * drops the two the copy never claimed and gives their minutes to the rest.
 */
const SHORT_DAY = 20;

/**
 * The activities whose length is a choice rather than a fact.
 *
 * A role-play is a scripted situation and a wrap-up is a paragraph; neither gets
 * better with more minutes. Review takes exactly as long as the cards that came
 * due. Conversation, reading and listening are the three that genuinely stretch,
 * so the day's remaining minutes go to them in proportion to what they were
 * already worth.
 */
const STRETCHY: Partial<Record<ActivityKind, number>> = { talk: 5, read: 3, listen: 4 };

/**
 * Spend the learner's stated minutes on the day (§4.2: "Süre, ayarlardaki günlük
 * süre hedefiyle tutarlıdır").
 *
 * The floors are what each activity is still worth doing at — below them the row
 * would be a number rather than an activity. When the fixed half already costs
 * more than the budget (a big review on a short day) everything lands on its floor
 * and the day simply runs long; `shortfallNote` is what says so out loud, because
 * a plan quietly ignoring the setting is the contradiction §6 forbids.
 */
function fitToBudget(activities: PlannedActivity[], budget: number): PlannedActivity[] {
  const stretchy = activities.filter((a) => STRETCHY[a.kind] !== undefined);
  if (!stretchy.length) return activities;

  const fixed = activities.filter((a) => STRETCHY[a.kind] === undefined).reduce((n, a) => n + a.estimatedMinutes, 0);
  const base = stretchy.reduce((n, a) => n + a.estimatedMinutes, 0);
  const room = Math.max(0, budget - fixed);

  const minutes = new Map<string, number>();
  for (const a of stretchy)
    minutes.set(a.id, Math.max(STRETCHY[a.kind]!, Math.round((a.estimatedMinutes / base) * room)));

  // Rounding three shares independently loses or gains a minute or two, and the
  // total is the number on screen — so the drift lands on the longest of them,
  // where one minute either way changes nothing anybody can feel.
  const longest = stretchy.reduce((b, a) => (minutes.get(a.id)! > minutes.get(b.id)! ? a : b));
  const drift = room - [...minutes.values()].reduce((n, m) => n + m, 0);
  minutes.set(longest.id, Math.max(STRETCHY[longest.kind]!, minutes.get(longest.id)! + drift));

  return activities.map((a) => (minutes.has(a.id) ? { ...a, estimatedMinutes: minutes.get(a.id)! } : a));
}

/**
 * Why today does not add up to the time the learner asked for (§7 row 8).
 *
 * Only one thing can do this: the words that came due. Everything else is already
 * at its floor, and a review is not something the plan gets to shorten — the cards
 * are due or they are not. Under three minutes over is rounding, not a shortfall,
 * and saying so would train the learner to stop reading these.
 */
export function shortfallNote(plan: DailyPlan, dailyMinutes: number): string | null {
  if (plan.estimatedMinutes - dailyMinutes < 3) return null;
  const review = plan.activities.find((a) => a.kind === "memory");
  if (!review) return null;
  return `Today comes to about ${plan.estimatedMinutes} minutes rather than the ${dailyMinutes} you asked for. The words that came due need ${review.estimatedMinutes} of them on their own, and everything else is already as short as it is worth doing.`;
}

/** Build a personalised daily session. Pure — no I/O, no clock. */
export function buildDailyPlan(s: Settings, ctx: PlanContext): DailyPlan {
  const theme = ctx.theme?.trim() || themeForDate(ctx.date, s.profile.interests);
  // Declared weaknesses outrank the recap's parting note: they are what the signals
  // actually show, and Coach has already told the learner these are what tomorrow drills.
  const declared = (ctx.weaknesses ?? []).slice(0, DRILL_SLOTS.length);
  const focus = (declared.length ? declared.map((w) => w.label) : (ctx.focus ?? []).filter(Boolean)).slice(0, 3);
  const [talkGoal, readGoal, listenGoal] = drillGoals(focus);
  const drill = talkGoal;

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
      goal: talkGoal,
    }),
    planActivity({
      id: "read",
      kind: "read",
      title: "Reading",
      rationale: readGoal
        ? `The passage works ${readGoal} back in — you keep slipping on it, and reading it in someone else's sentences is the gentlest way to meet it again.`
        : `The passage reuses the words you just used about ${theme}, so you meet them again in someone else's sentences.`,
      estimatedMinutes: 5,
      dependsOn: "talk",
      goal: readGoal,
    }),
  ];

  // "Three short pieces — conversation, a passage, the words that are due."
  const short = s.dailyMinutes <= SHORT_DAY;
  if (!short)
    activities.push(
      planActivity({
        id: "roleplay",
        kind: "roleplay",
        title: "Role-play",
        rationale: `A scripted situation puts the same ${theme} language under a little pressure.`,
        estimatedMinutes: 5,
        scenarioId: pickScenario(theme),
      }),
    );

  if (ctx.dueVocab > 0) {
    activities.push(
      planActivity({
        id: "memory",
        kind: "memory",
        title: "Vocabulary review",
        rationale: `${ctx.dueVocab} cards come back today — reviewing them after you have used the words is when they stick.`,
        // Not capped. A review is the one part of the day whose length is a fact
        // rather than a choice — forty cards are forty cards, and a plan that
        // called them ten minutes would be describing a different afternoon.
        estimatedMinutes: Math.max(2, Math.ceil(ctx.dueVocab / 4)),
      }),
    );
  }

  // A listening cool-down before the recap — an input skill to close the working
  // activities, kept last so it never displaces the conversation-first running order.
  if (!short)
    activities.push(
      planActivity({
        id: "listen",
        kind: "listen",
        title: "Listening",
        rationale: listenGoal
          ? `Listening closes the day on input, and this one is picked to put ${listenGoal} in your ear rather than in your mouth.`
          : "Listening closes the day on input, so the last thing you do is understand rather than produce.",
        estimatedMinutes: 6,
        goal: listenGoal,
      }),
    );

  activities.push(
    planActivity({
      id: "wrapup",
      kind: "wrapup",
      title: "Wrap-up",
      rationale: "A recap of what you actually practised, and one thing to carry into tomorrow.",
      estimatedMinutes: 2,
    }),
  );

  // focus is deliberately not written to the plan — it stays in PlanContext and
  // rides into recapPrompt as a parameter. The weaknesses behind it are named here,
  // by id: the plan has to be able to say which weaknesses it set out to address.
  return makePlan({
    date: ctx.date,
    dayIndex: ctx.dayIndex,
    theme,
    targetedWeaknesses: declared.map((w) => w.id),
    activities: fitToBudget(activities, s.dailyMinutes),
  });
}

// ---- what Today says about the plan ----

/**
 * The day in one paragraph (§4.2): what it is about, how many pieces, how long,
 * and — when the signals have something to say — what it is trying to fix.
 *
 * Not a template with a slot in it. A plan that targets nothing says why the order
 * is what it is; a plan that targets something names it, because "conversation
 * first, then a passage" is true of every day and therefore tells the learner
 * nothing about this one.
 */
export function daySummary(plan: DailyPlan, weaknesses: Weakness[] = []): string {
  const n = plan.activities.length;
  const opening = `${n} ${n === 1 ? "piece" : "pieces"} on ${plan.theme}, about ${plan.estimatedMinutes} minutes in all`;
  // The plan names the weaknesses it set out to address, by id; the labels live
  // with the evidence. A weakness the plan targeted but that no longer shows in
  // the signals is simply not mentioned — the alternative is citing something the
  // learner can no longer see.
  const targeted = weaknesses.filter((w) => plan.targetedWeaknesses.includes(w.id)).map((w) => w.label);
  if (!targeted.length) return `${opening}. Conversation comes first, so the rest of the day reuses words you produced yourself.`;
  return `${opening}, built around ${list(targeted)} — what your last few sessions kept tripping on.`;
}

/** "a, b and c" — the serial list every sentence here needs and none should rebuild. */
export function list(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Where the day stands, above the list (§4.2: "Oturum yarıda kesilip dönüldüğünde
 * kullanıcı nerede kaldığını arayarak bulmaz").
 *
 * The minutes left are the minutes of what is actually unfinished, not the total
 * minus elapsed time — nobody is holding a stopwatch, and the useful number is how
 * much is still in front of them.
 */
export function progressLine(plan: DailyPlan, done: ActivityKind[]): string {
  const total = plan.activities.length;
  const finished = plan.activities.filter((a) => done.includes(a.kind)).length;
  const left = plan.activities.filter((a) => !done.includes(a.kind)).reduce((n, a) => n + a.estimatedMinutes, 0);
  if (finished === 0) return `${total} to go · about ${plan.estimatedMinutes} minutes`;
  if (finished === total) return `All ${total} finished`;
  return `${finished} of ${total} done · about ${left} minutes left`;
}

/**
 * A row's state (§4.2: tamamlandı / sırada / bekliyor).
 *
 * Three, not four. An activity cannot be "skipped": `nextActivity` hands back the
 * first one not finished, so nothing can sit before the active row and still be
 * waiting. There is no fourth state to track because nothing in the app can put an
 * activity into it.
 */
export type ActivityStatus = "done" | "next" | "waiting";

export function activityStatus(plan: DailyPlan, done: ActivityKind[], kind: ActivityKind): ActivityStatus {
  if (done.includes(kind)) return "done";
  return nextActivity(plan, done) === kind ? "next" : "waiting";
}

/** Has the activity this one leans on actually run yet? */
export function dependencyMet(plan: DailyPlan, done: ActivityKind[], kind: ActivityKind): boolean {
  const activity = plan.activities.find((a) => a.kind === kind);
  if (!activity?.dependsOn) return true;
  const dep = plan.activities.find((a) => a.id === activity.dependsOn);
  return !dep || done.includes(dep.kind);
}

/**
 * What to say when a learner opens an activity ahead of what it was built on
 * (§2.1). Not a block — they may work in any order they like. It says what they
 * will get instead, because the alternative is a passage that quietly does not
 * do what its own rationale claims.
 *
 * `null` when there is nothing to warn about.
 */
export function dependencyNote(plan: DailyPlan, done: ActivityKind[], kind: ActivityKind): string | null {
  if (dependencyMet(plan, done, kind)) return null;
  const activity = plan.activities.find((a) => a.kind === kind);
  const dep = plan.activities.find((a) => a.id === activity?.dependsOn);
  if (!activity || !dep) return null;
  return `${activity.title} was built to reuse what you say in ${dep.title.toLowerCase()}, and you have not done that yet. This one stands on its own instead — ${dep.title.toLowerCase()} first if you would rather have the version that connects.`;
}

/** What the last day the learner worked leaves behind. */
export interface Trace {
  theme: string;
  done: number;
  total: number;
}

/**
 * §4.2's "dünün izi" — one line at the bottom of Today, from the session before
 * this one.
 *
 * `null` on day one rather than an empty row: a reminder with nothing in it is
 * worse than no reminder, and a learner on their first day has nothing to be
 * reminded of.
 *
 * It names the topic rather than the words due for review. The spec allows either,
 * but a day with cards due already carries them as an activity in the list above,
 * and a line repeating that would be furniture.
 */
export function traceLine(prev: Trace | null): string | null {
  if (!prev || !prev.total) return null;
  if (prev.done >= prev.total) return `Last time you finished the day on ${prev.theme}.`;
  if (prev.done === 0) return `Last time you opened a day on ${prev.theme} and did not get into it.`;
  return `Last time you were on ${prev.theme}, ${prev.done} of ${prev.total} done.`;
}

/**
 * The line under a fallback plan (§2.1). It names what went wrong in the learner's
 * terms and what they are looking at instead — a plan presented as today's when it
 * was built from nothing is worse than no plan at all.
 */
export function fallbackNote(plan: DailyPlan): string {
  return `Today's plan could not be built from your history, so this is a general ${plan.estimatedMinutes}-minute day on ${plan.theme}. Everything in it still counts.`;
}

/**
 * What tomorrow holds, shown when today is finished (§2.1). One sentence off the
 * real plan for the next date — not a description of one, so the preview and the
 * day the learner wakes up to cannot disagree.
 */
export function tomorrowPreview(plan: DailyPlan): string {
  const n = plan.activities.length;
  return `Tomorrow: ${n} ${n === 1 ? "piece" : "pieces"} on ${plan.theme}, about ${plan.estimatedMinutes} minutes.`;
}

/**
 * A different theme from this one — §4.2's "başka bir konu".
 *
 * The rotation is deterministic per date, so "another" has to mean stepping along
 * it rather than rolling dice: pressing it twice gets you a third topic, not the
 * first one back. A pool with only one entry in it falls through to the full
 * rotation, because a link promising another topic has to produce one.
 */
export function anotherTheme(current: string, interests: string[] = []): string {
  const pool = [...new Set(interests.flatMap((i) => INTEREST_THEMES[i] ?? []))];
  const list = pool.length > 1 ? pool : THEMES;
  const at = list.indexOf(current);
  return at === -1 ? list[0] : list[(at + 1) % list.length];
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

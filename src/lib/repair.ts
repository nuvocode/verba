// The repair inventory (PLAN-027): what the learner can do when understanding
// breaks. Six categories, tracked independently — a learner who can say "sorry,
// what?" may never once have said "so you mean…".
//
// The inventory is derived, never stored: `model.ts` deliberately omits derived
// values from the stored shapes (`srs.strength`, `levelEstimate`) because a
// stored copy drifts from the observations it is supposed to summarise. So a
// repair observation is a `repairMove` signal like any other, and `inventoryFrom`
// is a pure function over those signals. There is exactly one door into the
// payload (model.ts's `repairMoveInfo`) and one door into an entry — the literal
// is built here and nowhere else.
import { repairMoveInfo, turnVerdict, type Signal, type SignalDraft, type ActivityId } from "./model.ts";

// --- the six codes ------------------------------------------------------------

/** Teaching order is this array's order. `HOLD` → `REPEAT` → `SLOW` first because
 * they pull the learner out of panic and pay off immediately; `CONFIRM` and
 * `PARAPHRASE` last because they need a learner who is already comfortable enough
 * to build a sentence about the sentence. */
export const REPAIR_CATEGORIES = ["HOLD", "REPEAT", "SLOW", "CLARIFY", "CONFIRM", "PARAPHRASE"] as const;
export type RepairCategory = (typeof REPAIR_CATEGORIES)[number];

/** The states an entry can be in, weakest to strongest. `unknown` is not an error
 * — it is the honest answer for a category the inventory has never seen. */
export const REPAIR_STATES = ["unknown", "recognises", "uses", "fluent"] as const;
export type RepairState = (typeof REPAIR_STATES)[number];

/** A category the learner knows how to reach for. "recognises" is the only state
 * the coach can move a category to; a learner saying they know a pattern changes
 * nothing — there is no input that writes `recognises` as a learner's own doing. */
export const isRepairCategory = (c: string): c is RepairCategory =>
  (REPAIR_CATEGORIES as readonly string[]).includes(c);

// --- the observation ----------------------------------------------------------

/**
 * A repair observation carries who made it.
 *
 * The turn channel (PLAN-027's observation channel) is always `by: "learner"`:
 * the model classifies what the learner actually did. The coach also *teaches* a
 * pattern (called by PLAN-030), and that is a different observation — it moves a
 * category to `recognises`, never to `uses`.
 */
export interface RepairObservation {
  category: RepairCategory;
  by: "learner" | "coach";
  /** The learner's own words, copied verbatim. Empty when `by: "coach"`. */
  variant: string;
}

/** The reported shape as it leaves the turn JSON — a model's claim, not yet believed. */
export interface ReportedRepair {
  category: string;
  variant: string;
  by?: "learner" | "coach";
}

/**
 * Trim + lowercase + drop punctuation + collapse whitespace, the same
 * normalisation `questions.ts` uses to score answers — so "Hold on," and
 * "hold on" are the same words, and a variant the learner never wrote is still
 * detectable.
 */
const repairNorm = (s: string, locale: string): string =>
  s.toLocaleLowerCase(locale).replace(/\p{P}/gu, "").replace(/\s+/g, " ").trim();

/**
 * The gate that turns a model's report into a believed observation — or nothing.
 *
 * `parseTurn` only checks the shape; it cannot see the learner's message. This is
 * where the variant is checked against what the learner actually wrote, so the
 * model may classify what the learner did but may never author it. A reported
 * variant that is not literally present — after case, punctuation and whitespace
 * folding — is dropped wholesale, as is an unknown category and an empty variant
 * from a learner observation. `null` means "no signal is written". Coach
 * observations carry no variant and are not checked against the message.
 */
export function verifyRepair(reported: ReportedRepair, msg: string, locale: string): RepairObservation | null {
  if (!isRepairCategory(reported.category)) return null;
  const by = reported.by === "coach" ? "coach" : "learner";
  if (by === "learner") {
    const variant = reported.variant ?? "";
    if (!repairNorm(variant, locale)) return null; // an empty variant from a learner names nothing
    if (!repairNorm(msg, locale).includes(repairNorm(variant, locale))) return null; // never said it → nothing is recorded
    return { category: reported.category, by, variant };
  }
  // A coach observation is a modelling move — it carries no learner words.
  return { category: reported.category, by, variant: "" };
}

// --- the payload, through one door --------------------------------------------

/** The definition every repair signal carries, so Coach can print what a move is. */
const DEFINITION: Record<RepairCategory, string> = {
  HOLD: "a phrase that buys a moment before answering",
  REPEAT: "asking for the exact words to be said again",
  SLOW: "asking for slower speech",
  CLARIFY: "asking what a word or phrase meant",
  CONFIRM: "checking that you understood",
  PARAPHRASE: "restating what you heard in your own words",
};

/** The payload that rides on a `repairMove` signal — built here, read only
 * through `repairMoveInfo` (model.ts). Nothing outside this file writes it. */
export function repairPayload(obs: RepairObservation): { label: string; by: "learner" | "coach"; variant: string; definition: string } {
  return {
    label: obs.category,
    by: obs.by,
    variant: obs.variant,
    definition: DEFINITION[obs.category],
  };
}

// --- the inventory is a function ----------------------------------------------

export interface RepairEntry {
  category: RepairCategory;
  state: RepairState;
  /** The learner's own phrasings, most recent first, deduplicated, capped at 5. */
  variants: string[];
  lastUsedAt: number | null;
  total: number; // learner uses, all time
  last7: number; // learner uses in the last 7 days
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_VARIANTS = 5;

/** A local calendar day (the learner's day, not UTC) — the "distinct days" unit. */
const dayKey = (t: number): number => new Date(t).setHours(0, 0, 0, 0);

/** The variant as a dedup key — same phrase in different case or punctuation is one phrase. */
const variantKey = (v: string): string => repairNorm(v, "en");

/**
 * The state of one category given its learner and coach observations.
 *
 * State is derived from `by: "learner"` counts except where noted:
 * - `fluent` — at least 3 learner uses in the last 7 days, spread over at least 2
 *   distinct days. One session where the learner found a phrase and repeated it
 *   four times is `uses`, not `fluent`.
 * - `uses` — at least 2 learner uses (and not yet fluent). A single use is not
 *   yet "uses": one encounter may be a lucky reach, and §2.2 asks for "a few"
 *   before a category is counted as used.
 * - `recognises` — coach observations only, or a lone learner use. A learner
 *   saying they know a pattern still changes nothing: there is no input that
 *   writes this on its own.
 * - `unknown` — nothing of any kind.
 */
function stateOf(learner: { total: number; last7: number; recentDays: number }, coach: number): RepairState {
  if (learner.total === 0) return coach > 0 ? "recognises" : "unknown";
  if (learner.last7 >= 3 && learner.recentDays >= 2) return "fluent";
  if (learner.total >= 2) return "uses";
  return "recognises";
}

/**
 * The inventory over a set of signals. Six entries, always — a category with no
 * signal is `unknown`, never absent; `nextTarget` walks the same six in order.
 */
export function inventoryFrom(signals: Signal[], now: number): RepairEntry[] {
  // Per-category working state.
  const learner: {
    total: number;
    last7: number;
    recentDays: Set<number>;
    lastUsedAt: number | null;
    variants: { variant: string; at: number }[];
  }[] = REPAIR_CATEGORIES.map(() => ({ total: 0, last7: 0, recentDays: new Set(), lastUsedAt: null, variants: [] }));
  const coach: number[] = REPAIR_CATEGORIES.map(() => 0);
  const idx = new Map<RepairCategory, number>(REPAIR_CATEGORIES.map((c, i) => [c, i]));

  const cutoff = now - 7 * DAY_MS;
  for (const s of signals) {
    const info = repairMoveInfo(s);
    if (!info) continue;
    const i = idx.get(info.category as RepairCategory);
    if (i === undefined) continue;
    if (info.by === "coach") {
      coach[i] += 1;
      continue;
    }
    const l = learner[i];
    l.total += 1;
    l.variants.push({ variant: info.variant, at: s.observedAt });
    if (l.lastUsedAt === null || s.observedAt > l.lastUsedAt) l.lastUsedAt = s.observedAt;
    if (s.observedAt >= cutoff) {
      l.last7 += 1;
      l.recentDays.add(dayKey(s.observedAt));
    }
  }

  return REPAIR_CATEGORIES.map((category, i) => {
    const l = learner[i];
    // Most recent first, deduplicated by normalised key, capped at 5.
    const seen = new Set<string>();
    const variants: string[] = [];
    for (const v of [...l.variants].sort((a, b) => b.at - a.at)) {
      const key = variantKey(v.variant);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      variants.push(v.variant);
      if (variants.length === MAX_VARIANTS) break;
    }
    return {
      category,
      state: stateOf({ total: l.total, last7: l.last7, recentDays: l.recentDays.size }, coach[i]),
      variants,
      lastUsedAt: l.lastUsedAt,
      total: l.total,
      last7: l.last7,
    };
  });
}

/**
 * The next category to teach: the first category in teaching order whose state is
 * `unknown` or `recognises`. `null` when all six are at `uses` or better.
 *
 * Walks the teaching order (`REPAIR_CATEGORIES`) and looks each one up in the
 * inventory, rather than trusting the array's own order — an inventory handed in
 * any arrangement still answers the same way.
 */
export function nextTarget(inventory: RepairEntry[]): RepairCategory | null {
  const byCategory = new Map(inventory.map((e) => [e.category, e]));
  for (const category of REPAIR_CATEGORIES) {
    const entry = byCategory.get(category);
    if (entry && (entry.state === "unknown" || entry.state === "recognises")) return category;
  }
  return null;
}

// --- the surfaces: what Today and Coach say -----------------------------------

/**
 * The practice goal for a category — the phrase folded into the activity's `goal`
 * field, which rides the seam `App.tsx` → `talk.start(…, goal)` → `buildSystem`'s
 * "Quietly give the learner practice with: …". This is the half that makes Today's
 * sentence true: a card that says the session will work on a move, over a session
 * the coach runs identically, is the invented metric with a friendlier face.
 */
const TARGET_GOAL: Record<RepairCategory, string> = {
  HOLD: "pausing to ask for a moment before answering",
  REPEAT: "asking for the exact words to be said again",
  SLOW: "asking for slower speech",
  CLARIFY: "asking what a word or phrase meant",
  CONFIRM: "checking that you understood",
  PARAPHRASE: "restating what you heard in your own words",
};

/** The practice goal for a category, as a phrase the coach gives practice with. */
export function targetGoal(category: RepairCategory): string {
  return TARGET_GOAL[category];
}

/**
 * The card's rationale for a repair target — an outcome, in the second person,
 * about the coach. Never a mechanism, never a code, never a number. This is what
 * Today writes on the one activity that carries the day's repair target.
 */
const TODAY_LINE: Record<RepairCategory, string> = {
  HOLD: "Today we'll work on stopping me when I go too fast.",
  REPEAT: "Today we'll work on asking me to say things again.",
  SLOW: "Today we'll work on asking me to slow down.",
  CLARIFY: "Today we'll work on asking me what a word means.",
  CONFIRM: "Today we'll work on checking that you understood me.",
  PARAPHRASE: "Today we'll work on putting what I said in your own words.",
};

/** The sentence Today writes on the card that carries the day's repair target. */
export function todayLine(category: RepairCategory): string {
  return TODAY_LINE[category];
}

/**
 * The readable title for a category — what Coach's inventory panel puts in its
 * heading instead of the code. Same register as `todayLine`/`targetGoal`: an
 * outcome the learner recognises, never the mechanism, never the code. The code
 * is the engine's vocabulary; the title is the learner's.
 */
const CATEGORY_TITLE: Record<RepairCategory, string> = {
  HOLD: "Buying a moment",
  REPEAT: "Asking to hear it again",
  SLOW: "Asking for slower speech",
  CLARIFY: "Asking what a word meant",
  CONFIRM: "Checking you understood",
  PARAPHRASE: "Saying it back in your own words",
};

/** The heading a category shows under on Coach — never the code itself. */
export function categoryTitle(category: RepairCategory): string {
  return CATEGORY_TITLE[category];
}

/**
 * The one sentence Coach writes about what is next. `null` — every category at
 * `uses` or better — says so and names nothing.
 */
export function targetSentence(target: RepairCategory | null): string {
  if (!target) return "Every repair move is in your hands now — nothing new to work on.";
  return `Next we'll work on ${TARGET_GOAL[target]}.`;
}

// --- the direction: a verdict distribution, in words --------------------------

/**
 * How the learner's asking is changing, as a direction — never a figure. The
 * verdict distribution becomes a sentence about behaviour, and nothing numeric
 * leaves this function, so a later edit cannot casually print a percentage.
 */
export type Direction = "better" | "same" | "worse" | "tooEarly";

const DIRECTION_WINDOW = 14 * DAY_MS;
/** A window needs this many judged turns before it says anything at all. */
const MIN_JUDGED_TURNS = 20;

/**
 * Whether the two windows' bluff shares are close enough to be one story.
 *
 * A direction read off exact equality would flip on one turn: with 20 turns a
 * window, a single extra bluff moves the share by 5 points, so "same" would
 * almost never survive two consecutive windows and the sentence would swing
 * better/worse on noise the learner can feel is not a trend. So the gap has to
 * be bigger than one turn's worth of movement in the smaller window.
 *
 * Compared as integers, because that sentence cannot be written as a constant.
 * A 0.05 threshold splits one-turn gaps by binary rounding alone: at 20 turns
 * 2→3 computes as 0.049999999999999996 and reads "same", 3→4 as
 * 0.05000000000000002 and reads "worse". Both are one turn. Cross-multiplying
 * the counts settles it exactly, and it scales the right way: with 200 turns
 * behind it, five points is signal rather than noise, and the window says so.
 */
function withinOneTurn(rb: number, rn: number, pb: number, pn: number): boolean {
  return Math.abs(rb * pn - pb * rn) * Math.min(rn, pn) <= rn * pn;
}

/**
 * The direction of the learner's asking: the bluff share of the last 14 days
 * against the 14 before it. `tooEarly` whenever either window holds fewer than
 * 20 judged turns — a judged turn being one `turnVerdict` answers for. Reads the
 * verdict through `turnVerdict` (model.ts) and through nothing else.
 */
export function direction(signals: Signal[], now: number): Direction {
  const judged: { at: number; verdict: "clear" | "suspect" | "bluff" }[] = [];
  for (const s of signals) {
    const v = turnVerdict(s);
    if (v !== null) judged.push({ at: s.observedAt, verdict: v });
  }
  const recent = judged.filter((t) => t.at > now - DIRECTION_WINDOW);
  const prior = judged.filter((t) => t.at <= now - DIRECTION_WINDOW && t.at > now - 2 * DIRECTION_WINDOW);
  if (recent.length < MIN_JUDGED_TURNS || prior.length < MIN_JUDGED_TURNS) return "tooEarly";
  const bluffs = (ts: { verdict: string }[]): number => ts.filter((t) => t.verdict === "bluff").length;
  const rb = bluffs(recent);
  const pb = bluffs(prior);
  // Within one turn's movement the two windows are one behaviour, not two:
  // "same" is the honest answer for a gap one turn's noise could have made.
  if (withinOneTurn(rb, recent.length, pb, prior.length)) return "same";
  // rb/recent < pb/prior, cross-multiplied — a falling bluff share is better.
  return rb * prior.length < pb * recent.length ? "better" : "worse";
}

/**
 * The direction as a sentence about behaviour. `tooEarly` is the empty state's
 * line — the panel renders `Nothing` for it, never a number.
 */
export function directionSentence(d: Direction): string {
  switch (d) {
    case "better":
      return "When you don't catch something, you ask more often than you used to.";
    case "same":
      return "When you don't catch something, you ask about as often as you used to.";
    case "worse":
      return "When you don't catch something, you ask less often than you used to.";
    case "tooEarly":
      return "Not enough sessions yet to say how your asking is changing.";
  }
}

// --- the surface door: one signal per observation ------------------------------

/**
 * A repair observation written as a signal. The `kind` belongs to the signals
 * layer; the payload itself is `repair.ts`'s and arrives built.
 */
export function repairSignal(activityId: ActivityId, obs: RepairObservation): SignalDraft {
  return { activityId, kind: "repairMove", payload: repairPayload(obs) };
}

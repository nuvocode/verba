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
import { repairMoveInfo, type Signal, type SignalDraft, type ActivityId } from "./model.ts";

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

// --- the surface door: one signal per observation ------------------------------

/**
 * A repair observation written as a signal. The `kind` belongs to the signals
 * layer; the payload itself is `repair.ts`'s and arrives built.
 */
export function repairSignal(activityId: ActivityId, obs: RepairObservation): SignalDraft {
  return { activityId, kind: "repairMove", payload: repairPayload(obs) };
}

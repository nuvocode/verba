// §1.5 Weaknesses, derived from signals — never stored.
//
// A weakness is a reading of the evidence, and the evidence is the signals table.
// Storing the reading would let it drift from what the signals say, the same way a
// stored levelEstimate drifted from the scores behind it (see model.ts's header).
// It would also travel badly: backup.ts syncs localStorage wholesale but not
// SQLite, so a stored weakness would reach the second machine with no evidence
// under it. Recompute it; it is a group-by over a few hundred rows.
import { MIN_WEAKNESS_EVIDENCE, signalLabel, signalMiss } from "./model.ts";
import type { Signal, SignalKind, Weakness } from "./model.ts";
import { DRILL_SLOTS, drillGoals, list } from "./learn.ts";

/**
 * Which part of the language a signal kind speaks about. `comprehension` under
 * "lexis" is the loosest of these — understanding a passage is not only vocabulary
 * — but the spec's five categories have no slot for comprehension, and inventing a
 * sixth would put this file at odds with §1.5.
 * ponytail: revisit if Coach ever groups its display by category.
 */
const CATEGORY: Record<SignalKind, Weakness["category"]> = {
  correction: "grammar",
  comprehension: "lexis",
  lexicalItem: "lexis",
  pronunciation: "pronunciation",
  pace: "fluency",
  unpromptedTurn: "fluency",
  suggestionUsed: "fluency",
  // PLAN-027: a repair move is never a miss (signalMiss returns false for it), so
  // it can never become a weakness — this entry is unreachable, but SignalKind is
  // exhaustive and must stay so. "fluency" is the least-wrong slot.
  repairMove: "fluency",
  // PLAN-031: an axis marker and an ease request are facts about the session, not
  // observations of failure — neither is ever a miss (signalMiss returns false for
  // kinds it does not special-case). Entries keep SignalKind exhaustive.
  axisUsed: "fluency",
  easeRequest: "fluency",
  // PLAN-034: a rehearsal batch marker is a fact about the record, not an
  // observation of failure — never a miss. Entry keeps SignalKind exhaustive.
  rehearsal: "fluency",
};

/** Same input, same id: the id has to survive being recomputed, since nothing stores it. */
const weaknessId = (kind: SignalKind, label: string): string => `${kind}:${label}`;

/**
 * Which way a weakness is moving, judged inside its own history: misses in the
 * older half of the span it covers against misses in the newer half.
 * ponytail: a count comparison, not a rate — it cannot tell "practised twice as
 * much, missed twice as often" from "got worse". Enough to label a card; give it
 * per-session denominators when Coach charts trends.
 */
function trendOf(times: number[]): Weakness["trend"] {
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (first === last) return "new"; // everything arrived at once — there is no history yet
  const mid = (first + last) / 2;
  const older = times.filter((t) => t <= mid).length;
  const newer = times.length - older;
  if (newer > older) return "worsening";
  if (newer < older) return "improving";
  return "flat";
}

/**
 * The declared weaknesses in the evidence, strongest first.
 *
 * Signals are observations, not accusations: only the ones that went badly
 * (signalMiss) are evidence, and a label needs MIN_WEAKNESS_EVIDENCE of them
 * before it is called a weakness at all. Severity is the weight of that evidence —
 * the spec leaves the scale open, and a count is the one number here that is not
 * invented.
 *
 * `addressedBy` is filled from the planner's own drill rule, so a weakness Coach
 * shows names activities that tomorrow's plan really contains (invariant 6). Only
 * the first DRILL_SLOTS.length weaknesses get one; the rest are real but unaddressed,
 * and a screen that shows them would be promising something the plan has no room for.
 */
export function weaknessesFrom(signals: Signal[]): Weakness[] {
  const groups = new Map<string, { kind: SignalKind; label: string; ids: string[]; times: number[] }>();
  for (const s of signals) {
    if (!signalMiss(s)) continue;
    const label = signalLabel(s);
    if (!label) continue; // an unlabelled miss cannot be grouped with anything
    const key = weaknessId(s.kind, label);
    const g = groups.get(key) ?? { kind: s.kind, label, ids: [], times: [] };
    g.ids.push(s.id);
    g.times.push(s.observedAt);
    groups.set(key, g);
  }

  const declared = [...groups.values()]
    .filter((g) => g.ids.length >= MIN_WEAKNESS_EVIDENCE)
    .sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));

  const goals = drillGoals(declared.slice(0, DRILL_SLOTS.length).map((g) => g.label));
  return declared.map((g) => ({
    id: weaknessId(g.kind, g.label),
    label: g.label,
    category: CATEGORY[g.kind],
    evidence: g.ids,
    severity: g.ids.length,
    addressedBy: DRILL_SLOTS.filter((_, i) => goals[i] === g.label),
    trend: trendOf(g.times),
  }));
}

/** What Coach may show: a weakness it can also say tomorrow's plan does something about. */
export const addressed = (ws: Weakness[]): Weakness[] => ws.filter((w) => w.addressedBy.length > 0);

/**
 * A weakness card, in the three parts §2.6 asks for: what was observed, what the
 * evidence is, and what tomorrow does about it.
 *
 * Each part is a function of *this* weakness — its category, its trend, its own
 * count of signals and its own activities. Two cards on one screen therefore
 * cannot read the same, which is the failure this replaces: one template rendered
 * three times says nothing about any of the three.
 */
export interface WeaknessCard {
  observed: string; // what is going wrong, in the learner's terms
  evidence: string; // how many signals, over what
  plan: string; // which activity tomorrow, named
}

export function weaknessCard(w: Weakness, activityTitles: Record<string, string>): WeaknessCard {
  const observedByCategory: Record<Weakness["category"], string> = {
    grammar: `You are being corrected on ${w.label}.`,
    lexis: `${w.label} is not landing yet — you meet it and it does not stay.`,
    pronunciation: `${w.label} is coming out differently from the way it is said.`,
    fluency: `${w.label} is where your turns slow down.`,
    pragmatics: `${w.label} is right in form but reads wrong in the situation.`,
  };
  const trendClause =
    w.trend === "worsening" ? " It has been happening more lately." : w.trend === "improving" ? " It is happening less than it was." : "";

  const n = w.evidence.length;
  const evidence = `${n} ${n === 1 ? "slip" : "slips"} on record${w.trend === "new" ? ", the first of them today" : ""}`;

  const titles = w.addressedBy.map((id) => activityTitles[id] ?? id);
  const plan = `Tomorrow's ${list(titles)} ${titles.length === 1 ? "is built" : "are built"} around it.`;

  return { observed: observedByCategory[w.category] + trendClause, evidence, plan };
}

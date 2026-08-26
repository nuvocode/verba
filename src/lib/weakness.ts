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
import { DRILL_SLOTS, drillGoals } from "./learn.ts";

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

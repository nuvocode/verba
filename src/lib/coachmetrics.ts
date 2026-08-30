// §2.6 — the six metrics, computed from signals and nothing else.
//
// Every number Coach shows is countable back to rows in the signals table. That is
// the whole point of the file: session_metrics is a table of text heuristics, and a
// screen that measured from it could not answer "which of my sessions is this?".
//
// A metric that cannot be computed has value `null`, and null is not rendered.
// An empty week is an honest empty screen (§0, principle 1).
import { turnStats, signalLabel, signalMiss } from "./model.ts";
import type { Signal } from "./model.ts";

export type MetricId =
  | "complexity"
  | "accuracy"
  | "vocabulary"
  | "consistency"
  | "comprehension"
  | "fluency";

export interface Metric {
  id: MetricId;
  label: string;      // what the learner reads
  value: number | null; // null = not computable from this window's signals
  unit: string;       // invariant 12: no number without one
  definition: string; // invariant 12: reachable from the screen
  sample: number;     // how many signals it stands on
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** A local calendar day — the learner's day, not UTC. */
const dayKey = (t: number): number => new Date(t).setHours(0, 0, 0, 0);

const round = (n: number, decimals = 0): number => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function coachMetrics(signals: Signal[], now: number): Metric[] {
  // The window Coach measures over: the week ending at `now`. A signal older than
  // that is the previous period's business, not this one's.
  const inWindow = signals.filter((s) => s.observedAt >= now - WEEK_MS && s.observedAt <= now);

  // complexity — mean words per sentence over unprompted turns
  const turns = inWindow.filter((s) => s.kind === "unpromptedTurn");
  const measuredTurns = turns.map(turnStats).filter((t): t is { words: number; sentences: number; chars: number } => t !== null);
  const complexityValue =
    measuredTurns.length === 0
      ? null
      : round(measuredTurns.reduce((sum, t) => sum + t.words / t.sentences, 0) / measuredTurns.length, 1);

  // accuracy — 100 * (1 - corrections / turns), clamped to 0-100
  const corrections = inWindow.filter((s) => s.kind === "correction").length;
  const accuracyValue =
    turns.length === 0 ? null : clamp(round(100 * (1 - corrections / turns.length)), 0, 100);

  // vocabulary — distinct labels over lexical items
  const lexical = inWindow.filter((s) => s.kind === "lexicalItem");
  const vocabValue = lexical.length === 0 ? null : new Set(lexical.map(signalLabel).filter((l): l is string => l !== null)).size;

  // consistency — distinct local days carrying at least one signal
  const consistencyValue = inWindow.length === 0 ? null : new Set(inWindow.map((s) => dayKey(s.observedAt))).size;

  // comprehension — 100 * correct / answered
  const comprehension = inWindow.filter((s) => s.kind === "comprehension");
  const answered = comprehension.length;
  const correct = comprehension.filter((s) => !signalMiss(s)).length;
  const comprehensionValue = answered === 0 ? null : round((100 * correct) / answered);

  // fluency — 100 * unprompted / (unprompted + suggested)
  const suggested = inWindow.filter((s) => s.kind === "suggestionUsed").length;
  const fluencyDenom = turns.length + suggested;
  const fluencyValue = fluencyDenom === 0 ? null : round((100 * turns.length) / fluencyDenom);

  return [
    {
      id: "complexity",
      label: "Sentence complexity",
      value: complexityValue,
      unit: "words per sentence",
      definition: "Average words per sentence in the turns you produced without help.",
      sample: measuredTurns.length,
    },
    {
      id: "accuracy",
      label: "Accuracy",
      value: accuracyValue,
      unit: "%",
      definition: "How often you produce a turn without needing a correction.",
      sample: turns.length,
    },
    {
      id: "vocabulary",
      label: "Vocabulary depth",
      value: vocabValue,
      unit: "distinct words met",
      definition: "The number of different words you met or saved.",
      sample: lexical.length,
    },
    {
      id: "consistency",
      label: "Consistency",
      value: consistencyValue,
      unit: "days of 7",
      definition: "The number of days in the week you practiced.",
      sample: inWindow.length,
    },
    {
      id: "comprehension",
      label: "Comprehension",
      value: comprehensionValue,
      unit: "%",
      definition: "How often you understood a question correctly.",
      sample: answered,
    },
    {
      id: "fluency",
      label: "Fluency",
      value: fluencyValue,
      unit: "% unaided",
      definition: "The share of your turns you produced without a suggestion.",
      sample: fluencyDenom,
    },
  ];
}

export interface MetricPair {
  metric: Metric;
  /** Change against the previous window of the same length. `null` when there is nothing to compare with. */
  delta: number | null;
  /** True when this window has a value and the previous one has no sample at all. */
  isNew: boolean;
}

/**
 * The panel: this week's six metrics, each against the week before it.
 *
 * A delta needs two comparable periods (invariant 8). When the previous window has
 * no sample for a metric there is no comparison to make, so the metric is new and
 * says so — it does not get a delta equal to its own value, which is the exact
 * shape of the bug this rule exists to prevent.
 */
export function coachPanel(signals: Signal[], now: number, window = WEEK_MS): MetricPair[] {
  const current = coachMetrics(signals.filter((s) => s.observedAt >= now - window), now);
  const previous = coachMetrics(signals.filter((s) => s.observedAt < now - window && s.observedAt >= now - 2 * window), now - window);

  return current.map((metric) => {
    const prev = previous.find((p) => p.id === metric.id);
    const comparable = prev && prev.sample > 0 && metric.sample > 0 && prev.value !== null && metric.value !== null;
    const decimals = metric.id === "complexity" ? 1 : 0;
    const delta = comparable ? round((metric.value as number) - (prev.value as number), decimals) : null;
    const isNew = metric.value !== null && (prev?.sample ?? 0) === 0;
    return { metric, delta, isNew };
  });
}

/** The metrics with something to show. Coach renders these; there is no other list. */
export const measured = (panel: MetricPair[]): MetricPair[] => panel.filter((p) => p.metric.value !== null);

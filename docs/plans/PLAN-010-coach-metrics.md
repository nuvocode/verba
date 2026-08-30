---
id: PLAN-010
title: Coach — six metrics, from signals only
branch: plan/m4-signal-coach-loop
base: master
status: ready
executor: unassigned
created: 2026-08-30
issue: https://github.com/nuvocode/verba/issues/50
milestone: M4 · Signal → Coach loop
---

# PLAN-010: six metrics, from signals only

## Context

`src/views/Coach.tsx` shows four cells — complexity, accuracy, vocabulary depth,
consistency — and every one of them comes from `session_metrics`, a table of text
heuristics written at the end of a Talk session, or from `activeDays()`, which
counts rows in `sessions` and `review_log`. §2.6 is explicit that Coach's input is
**only** `Signal` records, and it names six metrics, each with a definition the
learner can reach from the screen (invariant 12).

PLAN-009 put the numbers in the payloads. This plan computes the six metrics from
them and renders them. It does not touch the headline, the wins, or the charts —
PLAN-011 owns those.

Depends on PLAN-009. Work on `plan/m4-signal-coach-loop`, on top of PLAN-009's commit.

## Repo conventions

- **No new dependencies.** No chart library, no stats library, no date library.
- A metric that cannot be computed is **not displayed**. `null` is the value that
  says so, and the screen renders nothing for it — not a zero, not a dash.
- Every number on screen carries a unit and a definition (invariant 12).
- Only two functions in the codebase read a signal payload structurally:
  `signalLabel` and `signalMiss` in `src/lib/model.ts`. This plan needs the
  numeric fields of a turn payload, so it adds **exactly one** more reader,
  `turnStats`, and it lives in `src/lib/model.ts` beside the other two so the
  doors stay in one file. `src/lib/signals.check.ts` runs a static gate that fails
  the build if any file outside `model.ts`, `db.ts` and the checks touches
  `.payload` — putting the reader anywhere else would break it, and adding a new
  exclusion to that gate is forbidden by this plan.
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  import **without** it.
- `src/lib/coachmetrics.ts` must not import `./db.ts` (it loads a Tauri plugin and
  cannot run in a check process). It takes `Signal[]` and a `now` and returns data.
- Checks: `*.check.ts`, `node --experimental-strip-types`, no DOM, no DB.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/model.ts` | EDIT | after `signalMiss` |
| `src/lib/coachmetrics.ts` | NEW | — |
| `src/lib/coachmetrics.check.ts` | NEW | — |
| `src/lib/db.ts` | EDIT | after `recentSignals` |
| `src/views/Coach.tsx` | EDIT | the load effect, the `Cells` type, the `mgrid` block |
| `src/lib/invariants.check.ts` | EDIT | LEDGER row 12 |

## Specification

### src/lib/model.ts

The third and last structural payload reader, directly after `signalMiss`:

```ts
/**
 * The measurement a produced turn carries (§2.6). The third and final structural
 * payload reader, and it lives here for the same reason the other two do: a reader
 * somewhere else is a reader nothing can find.
 *
 * `null` when the payload is not a measured turn — an older row written before
 * turns were measured reads as "no measurement", never as a zero-word turn.
 */
export function turnStats(s: Signal): { words: number; sentences: number; chars: number } | null {
  const p = s.payload;
  if (p === null || typeof p !== "object") return null;
  const { words, sentences, chars } = p as { words?: unknown; sentences?: unknown; chars?: unknown };
  if (typeof words !== "number" || typeof sentences !== "number" || typeof chars !== "number") return null;
  if (sentences <= 0) return null;
  return { words, sentences, chars };
}
```

### src/lib/db.ts

One query, after `recentSignals`, reusing its row mapping:

```ts
/** Every signal since a moment, oldest first — the window Coach measures over. */
export async function signalsSince(lang: string, since: number): Promise<Signal[]> {
```

`SELECT … FROM signals WHERE lang = $1 AND observed_at >= $2 ORDER BY observed_at ASC`.
Map rows exactly the way `recentSignals` does, including the `parseJson` fallback.
Factor the mapping into a small local helper rather than copying it, and leave
`recentSignals` behaviourally identical.

### src/lib/coachmetrics.ts (NEW)

```ts
// §2.6 — the six metrics, computed from signals and nothing else.
//
// Every number Coach shows is countable back to rows in the signals table. That is
// the whole point of the file: session_metrics is a table of text heuristics, and a
// screen that measured from it could not answer "which of my sessions is this?".
//
// A metric that cannot be computed has value `null`, and null is not rendered.
// An empty week is an honest empty screen (§0, principle 1).
import { turnStats, signalLabel } from "./model.ts";
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
```

Then `export function coachMetrics(signals: Signal[], now: number): Metric[]`,
returning the six in this order, each computed only from the kinds §2.6 names:

| id | label | value | unit | inputs |
|---|---|---|---|---|
| `complexity` | Sentence complexity | mean `words / sentences` over `unpromptedTurn` turns, rounded to 1 decimal | `words per sentence` | `unpromptedTurn` |
| `accuracy` | Accuracy | `round(100 * (1 - corrections / turns))`, clamped to 0–100 | `%` | `correction`, `unpromptedTurn` |
| `vocabulary` | Vocabulary depth | count of distinct `signalLabel` values over `lexicalItem` | `distinct words met` | `lexicalItem` |
| `consistency` | Consistency | number of distinct local calendar days in the window carrying ≥ 1 signal | `days of 7` | every kind |
| `comprehension` | Comprehension | `round(100 * correct / answered)` over `comprehension` signals, where correct is `signalMiss === false` | `%` | `comprehension` |
| `fluency` | Fluency | `round(100 * unprompted / (unprompted + suggested))` | `% unaided` | `unpromptedTurn`, `suggestionUsed` |

Rules that hold for all six:

- `sample` is the number of signals the value actually stands on. `sample === 0`
  ⇒ `value === null`. Accuracy's sample is turns, not corrections: zero
  corrections over ten turns is 100%, not "not measured".
- `value` is never `NaN` and never `Infinity`. Guard every division on its
  denominator.
- The `definition` strings are the spec's own wording, in English, one sentence,
  no numbers in them. E.g. complexity: `"Average words per sentence in the turns
  you produced without help."`
- A local calendar day is derived with `new Date(t).setHours(0,0,0,0)` — the
  learner's day, not UTC. Write it as a small local helper `dayKey(t: number)`.

Then the comparison, which PLAN-011 renders and this plan already needs so a delta
is never invented:

```ts
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
export function coachPanel(signals: Signal[], now: number, window = WEEK_MS): MetricPair[]
```

Implementation: split `signals` into `[now - window, now]` and
`[now - 2*window, now - window)`, run `coachMetrics` on each, pair by id.
`delta` is `null` unless both windows have `sample > 0` and both values are
non-null; otherwise `delta = round(current - previous)` (1 decimal for
complexity). `isNew` is `current.value !== null && previous.sample === 0`.

Finally:

```ts
/** The metrics with something to show. Coach renders these; there is no other list. */
export const measured = (panel: MetricPair[]): MetricPair[] => panel.filter((p) => p.metric.value !== null);
```

### src/lib/coachmetrics.check.ts (NEW)

Build fixtures by hand — a `sig(kind, payload, at)` helper, no DB, no clock beyond
a fixed `NOW` constant. Assert:

1. **Empty in, empty out.** `coachMetrics([], NOW)` returns six metrics, all with
   `value === null` and `sample === 0`, and `measured(coachPanel([], NOW))` is empty.
2. **Complexity** over three turns of 4/1, 10/2, 6/1 words/sentences gives the mean
   words-per-sentence, and a `suggestionUsed` turn in the same window does **not**
   move it.
3. **Accuracy** with 10 turns and 2 corrections is 80; with 10 turns and 0
   corrections is 100 and `sample === 10`; with 0 turns is `null` even when
   corrections exist (there is nothing to divide by, and a correction rate with no
   denominator is the invented number §0 forbids).
4. **Vocabulary** counts distinct labels: the same word met three times is 1.
5. **Consistency** counts days, not signals: 30 signals on one day is 1; signals
   on three different local days is 3; a signal 8 days old is outside the window.
6. **Comprehension** with 4 correct and 1 wrong is 80.
7. **Fluency** with 6 unaided and 4 suggested is 60.
8. **invariant 12:** every metric has a non-empty `unit` and a `definition` of at
   least 20 characters, and no two metrics share a `definition`. Mark it
   `// invariant 12`.
9. **invariant 8 (early half):** with one week of signals and nothing before it,
   every pair has `delta === null` and `isNew === true` — and assert explicitly
   that no `delta` equals its own metric's value.
10. With two comparable weeks, a metric that fell from 90 to 80 has `delta === -10`
    and `isNew === false`.
11. A payload with no numeric fields (an old row) is skipped by `turnStats` and
    lowers no metric: complexity over one good turn plus one malformed row equals
    complexity over the good turn alone, with `sample === 1`.

End with `console.log("coachmetrics.check OK")`.

### src/views/Coach.tsx

1. The load effect replaces `recentMetrics` / `recentMetricScores` / `activeDays`
   **for the metric grid only** with one call:

```ts
        const signals = await signalsSince(settings.profile.targetLanguage, Date.now() - 2 * WEEK_MS);
        setPanel(coachPanel(signals, Date.now()));
```

Keep `weekStats`, `recentMemories` and the written report exactly as they are —
that prose is PLAN-011's problem, not this plan's. Keep `recentMetricScores` if
the momentum chart still uses it; keep `day.levelEstimate` and the CEFR rail
untouched.

2. Delete the `Cells` interface and the four hand-written `.mcell` blocks. Render
   the grid from the panel:

```tsx
        <div className="mgrid">
          {measured(panel).map(({ metric, delta, isNew }) => (
            <div className="mcell" key={metric.id}>
              <div className="h">
                <span>{metric.label}</span>
                <b>
                  {metric.value}
                  <span className="unit"> {metric.unit}</span>
                </b>
              </div>
              <div className="meter">
                <div style={{ width: `${meterWidth(metric)}%` }} />
              </div>
              <div className="mnote">{metric.definition}</div>
            </div>
          ))}
        </div>
```

`delta` and `isNew` are rendered by PLAN-011 — bind them here so the shape is
already right, and leave a `{/* PLAN-011: delta / new badge */}` comment where
they go rather than inventing a rendering now.

3. `meterWidth` is a local helper in this file: a percentage metric fills to its
   own value; `consistency` fills to `value / 7 * 100`; `complexity` fills to
   `min(100, value / 20 * 100)`; `vocabulary` fills to `min(100, value / 50 * 100)`.
   Add a `// ponytail:` comment naming the two arbitrary spans (20 words per
   sentence, 50 distinct words) as display scales, not thresholds.

4. When `measured(panel)` is empty, keep the existing "Finish a conversation and
   your measured signals … appear here" fallback, with its wording updated to name
   what actually produces signals now: a conversation, a passage, or a review.

### src/lib/invariants.check.ts

```ts
  {
    id: 12,
    claim: "Ekrandaki her sayının bir birimi ve bir tanımı vardır.",
    assertedIn: [{ file: "src/lib/coachmetrics.check.ts", marker: "invariant 12" }],
  },
```

Rows 8–11 stay pending — PLAN-011 owns them.

## Do not touch

- `src/lib/metrics.ts`, `session_metrics`, `saveMetrics`, `estimateLevelV2`,
  `levelEstimateFrom`. The level estimate keeps its own pipeline and its own
  table; this plan only stops the **metric grid** from reading it.
- The CEFR rail, `levelGapNote`, `progressionSuggested` and the "ready for the
  next band" line in `Coach.tsx`.
- The headline, the written report, the wins chips and the momentum chart. All
  four are PLAN-011's.
- `src/lib/weakness.ts` and the weakness cards.
- `signalLabel` / `signalMiss` — extended by a sibling in the same file, not
  modified.
- `isExcluded` in `src/lib/signals.check.ts`. `model.ts` is already exempt, so
  `turnStats` needs no change there. `coachmetrics.ts` must reach payloads through
  `turnStats` and `signalLabel` only — if the gate fails, the fix is in
  `coachmetrics.ts`, never in the gate.
- `package.json`, `package-lock.json`, `src-tauri/**`.

## Acceptance

```bash
npm run check                                                    # 0 failed
node --experimental-strip-types src/lib/coachmetrics.check.ts    # ends "coachmetrics.check OK"
node --experimental-strip-types src/lib/signals.check.ts         # still green — the payload gate is untouched
grep -n "recentMetrics\|activeDays" src/views/Coach.tsx          # no hits in the metric grid path
grep -c "definition" src/lib/coachmetrics.ts                     # >= 6
npm run build                                                    # succeeds
```

Then, in the running app: open Coach on a fresh profile and confirm the grid is
absent rather than showing zeros; hold one conversation, reopen Coach, and confirm
only the metrics that have signals behind them appear, each with a unit and a
definition line.

## Manifest

When implementation is complete, write `docs/plans/PLAN-010.done.md` with
`## Changed`, `## Deviations`, `## Not done`, `## Acceptance results`.

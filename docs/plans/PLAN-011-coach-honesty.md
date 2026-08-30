---
id: PLAN-011
title: Coach says what the data says
branch: plan/m4-signal-coach-loop
base: master
status: ready
executor: unassigned
created: 2026-08-30
issue: https://github.com/nuvocode/verba/issues/51
milestone: M4 · Signal → Coach loop
---

# PLAN-011: Coach says what the data says

## Context

Coach's headline and its "Wins this week" chips come from the model
(`weeklyReportPrompt` asks for `{ headline, report, wins }`), so the screen can
open with "A consistent week!" over three practised days out of seven, and can
list a win nothing in the data supports. §2.6's honesty rules forbid both. Three
more rules are unmet: a delta must not appear without a comparable period, the
consistency visual must draw a 7-day series rather than one total bar, and the
momentum chart must label its axis and its range.

PLAN-010 produced the metrics and the deltas. This plan makes the writing on the
screen follow them.

Depends on PLAN-010. Work on `plan/m4-signal-coach-loop`, on top of PLAN-010's commit.

## Repo conventions

- **No new dependencies.** The charts are hand-written SVG, as the momentum line
  already is.
- **No sentence is composed in JSX.** The headline and the wins are pure
  functions in `src/lib/coachmetrics.ts`, so `coachmetrics.check.ts` can hold
  them to the invariants.
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  import **without** it.
- Checks: `*.check.ts`, `node --experimental-strip-types`, no DOM, no DB.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/coachmetrics.ts` | EDIT | append after `measured` |
| `src/lib/coach.ts` | EDIT | `weeklyReportPrompt`, `WeeklyReport`, `parseWeeklyReport` |
| `src/views/Coach.tsx` | EDIT | the `<h1 className="display">`, the metric cells, the wins block, the momentum block |
| `src/lib/coachmetrics.check.ts` | EDIT | append before the final `console.log` |
| `src/theme.css` | EDIT | append at the end of the file |
| `src/lib/invariants.check.ts` | EDIT | LEDGER rows 8, 9, 10, 11 |

## Specification

### src/lib/coachmetrics.ts

1. The headline, derived — never chosen from a pool:

```ts
/**
 * The sentence at the top of Coach (§2.6, invariant 10).
 *
 * Rules, in order, first one that holds. There is no pool of praise to draw from:
 * a headline that could be written before the week was measured is a headline that
 * can contradict it, and "a consistent week" over 3 of 7 days is exactly that.
 */
export function headline(panel: MetricPair[]): string
```

Rules, in this order:

1. `measured(panel)` is empty → `"Nothing measured yet — this week is still blank."`
2. consistency has a value ≤ 2 → `` `A quiet week — you practised ${n} of the last 7 days.` `` (`"1 of the last 7 days"` singular).
3. the largest positive delta among the measured metrics is ≥ 5 → names that metric: `` `${label} is up ${d} ${unit} on last week.` ``
4. the largest negative delta is ≤ −5 → `` `${label} slipped ${|d|} ${unit} this week.` ``
5. consistency ≥ 5 → `` `${n} of 7 days practised — the week held.` ``
6. otherwise → `` `A steady week: ${n} ${n === 1 ? "metric" : "metrics"} measured, none of them moving much.` ``

Every branch is a function of the panel, and none of them can be reached with a
panel that says the opposite.

2. The wins, each on a threshold:

```ts
/**
 * What actually went well, one chip per threshold that held (§2.6, invariant 11).
 * An empty list is a correct answer and renders as nothing at all — an invented
 * win costs more than a missing one.
 */
export function wins(panel: MetricPair[]): string[]
```

Thresholds, each producing at most one chip, in this order:

| Condition | Chip |
|---|---|
| consistency `value >= 5` | `` `${n} of 7 days practised` `` |
| accuracy `value >= 90` and `sample >= 5` | `` `${v}% accuracy over ${sample} turns` `` |
| comprehension `value >= 80` and `sample >= 5` | `` `${v}% of comprehension questions right` `` |
| fluency `value >= 70` and `sample >= 5` | `` `${v}% of your turns were unaided` `` |
| vocabulary `value >= 15` | `` `${v} distinct words met` `` |
| any metric with `delta >= 10` | `` `${label} up ${delta} ${unit} on last week` `` |

3. The 7-day series the consistency cell draws next to its boxes:

```ts
/**
 * One entry per day of the window, oldest first — the series invariant 9 asks for.
 * `active` is what the seven boxes mark, `count` is what the line draws. The two
 * come from one pass so a box and its point can never disagree.
 */
export function daySeries(signals: Signal[], now: number, days = 7): { active: boolean; count: number }[]
```

The last entry is today. Days are local (`setHours(0,0,0,0)`), matching the
`dayKey` helper `coachMetrics` already uses — export it rather than writing a
second one.

### src/lib/coach.ts

The model no longer writes the headline or the wins:

1. `weeklyReportPrompt`'s final line becomes:

```ts
    `Answer with ONLY a JSON object: { "report": "2-4 sentences of substance" }.`,
```

2. Add one line above it, so the prose does not re-invent what the metrics say:

```ts
    `Do not write a headline, a score, a percentage, or a list of wins — those are measured elsewhere and shown beside your text. Write only the paragraph.`,
```

3. `WeeklyReport` becomes `{ report: string }`, and `parseWeeklyReport` drops
   `headline` and `wins`. Keep the `extractJson` fallback and the
   "unparseable ⇒ the raw text is the report" behaviour exactly as it is.

Leave everything else in `coach.ts` alone — `scoreBand`, `drillPrompt`,
`parseDrills`, the memory brief, and the CEFR-not-XP rules are all still correct.

### src/views/Coach.tsx

1. The headline:

```tsx
      <h1 className="display">{busy ? "Reading your week…" : headline(panel)}</h1>
```

`report?.headline` disappears with the field.

2. Each metric cell gains its delta or its "new" badge. This is invariant 8:

```tsx
                <b>
                  {metric.value}
                  <span className="unit"> {metric.unit}</span>
                  {isNew ? <em className="new">new</em> : delta !== null && delta !== 0 ? (
                    <i style={delta < 0 ? { color: "var(--warn)" } : undefined}>
                      {delta > 0 ? "+" : ""}
                      {delta}
                    </i>
                  ) : null}
                </b>
```

A `delta` of `null` renders nothing — not a `+0`, not a dash.

3. The consistency cell keeps its seven boxes and gains the series beside them.
   Render `daySeries` as a 7-point polyline in a small inline SVG, the same shape
   as the momentum chart, and assert nothing about it in JSX: the number of boxes
   comes from `daySeries(...).length`, so the boxes and the series cannot
   disagree. Do not hardcode `7` in the render.

4. The wins block reads the panel:

```tsx
      {wins(panel).length > 0 && ( … wins(panel).map((w) => <div className="chip" key={w}>{w}</div>) … )}
```

Keep the existing `eyebrow` heading and the chip styling.

5. The momentum chart gains its axis and its range (§2.6, last bullet). Above the
   SVG, keep the existing eyebrow but make it name the range in dates; inside the
   SVG add a baseline and two y labels (`0` and `100`) as `<text>` elements, and
   under it keep the existing rising/dipping sentence. If the chart still reads
   `recentMetricScores`, label it for what it is: a per-session series, with its
   own unit named in the eyebrow.

### src/lib/coachmetrics.check.ts

Append:

1. **invariant 10:** a panel with consistency 3 must not produce a headline
   matching `/consistent|great|strong|excellent/i`, and must contain `"3"`. Mark
   it `// invariant 10`.
2. An empty panel's headline names nothing measured, and `wins([])` is `[]`.
3. **invariant 11:** every string `wins(panel)` returns for a given panel
   disappears when the driving metric is lowered below its threshold. Assert at
   least three of the six thresholds this way. Mark it `// invariant 11`.
4. **invariant 8:** for a panel built from one window only, no rendered delta
   exists — assert every `delta === null` and that no `delta` equals its metric's
   value for any panel in the file. Mark it `// invariant 8`.
5. **invariant 9:** `daySeries(signals, NOW).length === 7`, and the count of
   `active === true` entries equals the `consistency` metric's value for the same
   signals and the same `now`. Mark it `// invariant 9`. This is the assertion
   that matters most in the file: the boxes and the reported number are the same
   fact, computed once.
6. `daySeries` puts today last: a signal stamped `NOW` marks index 6, and one
   stamped `NOW - 6 days` marks index 0.

### src/theme.css

```css
.mcell .unit { font-size: 12px; color: var(--ink3); font-weight: 400; letter-spacing: .02em; }
.mcell .new { font-style: normal; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); margin-left: 8px; }
.spark { display: block; width: 100%; height: 34px; margin-top: 10px; }
.axis { font-size: 10px; fill: var(--ink3); }
```

### src/lib/invariants.check.ts

Rows 8, 9, 10 and 11 all become
`assertedIn: [{ file: "src/lib/coachmetrics.check.ts", marker: "invariant N" }]`.

## Do not touch

- The written report paragraph itself, `memoryBrief`, `packGuidance`, and the
  "never state a numeric score" rules in the prompt. The model still writes prose;
  it just stops writing verdicts.
- The CEFR rail, `levelGapNote`, `progressionSuggested`, `day.levelEstimate`.
- `src/lib/metrics.ts` and `session_metrics`.
- The weakness cards — PLAN-014 owns them.
- `coachMetrics`, `coachPanel` and `measured` from PLAN-010. This plan appends to
  that file; it does not change what is already in it.
- `package.json`, `package-lock.json`, `src-tauri/**`.

## Acceptance

```bash
npm run check                                                  # 0 failed
node --experimental-strip-types src/lib/coachmetrics.check.ts  # ends "coachmetrics.check OK"
node --experimental-strip-types src/lib/invariants.check.ts    # asserted count is 4 higher than before
grep -n "report?.headline\|report.wins\|report?.wins" src/views/Coach.tsx   # no hits
grep -n "\"headline\"\|\"wins\"" src/lib/coach.ts              # no hits
npm run build                                                  # succeeds
```

Then, in the running app, on a profile with two or three practised days: confirm
the headline names the number of days rather than praising the week, that a
first-week metric shows a "new" badge and no `+n`, and that the consistency cell
shows seven boxes with a line beside them.

## Manifest

When implementation is complete, write `docs/plans/PLAN-011.done.md` with
`## Changed`, `## Deviations`, `## Not done`, `## Acceptance results`.

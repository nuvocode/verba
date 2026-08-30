# PLAN-010 done

## Changed

- `src/lib/model.ts` — added `turnStats`, the third and final structural payload
  reader, directly after `signalMiss`. It reads `words` / `sentences` / `chars`
  from a turn payload and returns `null` when the payload is not a measured turn
  (an older row reads as "no measurement", never as a zero-word turn).
- `src/lib/db.ts` — added `signalsSince(lang, since)`, a query returning every
  signal since a moment, oldest first. The row mapping was factored into a local
  `mapSignalRow` helper shared with `recentSignals`, which stays behaviourally
  identical (including the `parseJson` fallback).
- `src/lib/coachmetrics.ts` (NEW) — `coachMetrics` computes the six §2.6 metrics
  (complexity, accuracy, vocabulary, consistency, comprehension, fluency) from
  signals only. `coachPanel` pairs each against the previous window of the same
  length, producing `delta` / `isNew`; `measured` filters to the metrics with a
  value. `null` means "not computable" and is never rendered. `WEEK_MS` exported.
- `src/lib/coachmetrics.check.ts` (NEW) — hand-built fixtures, no DB, fixed `NOW`.
  Asserts the eleven spec points including invariant 12 (every metric has a unit
  and a ≥20-char definition, no two share one) and invariant 8 (no delta equals
  its own metric's value; a metric with no prior sample is new, not a delta).
- `src/views/Coach.tsx` — the metric grid now measures from signals only. The
  load effect calls `signalsSince` (two windows back) and `coachPanel`; the
  `Cells` interface, the four hand-written `.mcell` blocks, and the `activeDays`
  consistency cell are gone. The grid renders from `measured(panel)` with
  `meterWidth` (a local helper; the 20-words-per-sentence and 50-distinct-words
  spans are marked `// ponytail:` as display scales). `delta` / `isNew` are bound
  as data attributes with a `{/* PLAN-011: delta / new badge */}` comment. The
  empty fallback now names a conversation, a passage, or a review. `weekStats`,
  `recentMemories`, `recentMetricScores` (momentum chart), the written report,
  the CEFR rail and the level estimate are untouched.
- `src/lib/invariants.check.ts` — LEDGER row 12 now `assertedIn`
  `src/lib/coachmetrics.check.ts` with marker `invariant 12`. Rows 8–11 stay
  pending (PLAN-011 owns them).

## Deviations

- `coachMetrics` filters its window to `[now - WEEK_MS, now]` rather than taking
  every signal passed in. This is required for the consistency metric to mean
  "days of 7" and for the 8-day-old-signal case in the spec's own check to land
  outside the window. `coachPanel` still splits the full two-window span itself.
- `vocabulary` and `consistency` return `null` (not `0`) when their window is
  empty, matching the plan's "`sample === 0` ⇒ `value === null`" rule.
- In `Coach.tsx`, `delta` / `isNew` are bound as `data-*` attributes on the cell
  rather than left as unused destructured variables — TypeScript's
  `noUnusedLocals` would otherwise fail the build, and the plan's own snippet
  destructures them. The `{/* PLAN-011: delta / new badge */}` comment marks where
  the visible rendering goes.

## Not done

- The headline, the written report, the wins chips and the momentum chart —
  PLAN-011 owns all four.
- `session_metrics`, `saveMetrics`, `estimateLevelV2`, `levelEstimateFrom` and the
  level-estimate pipeline are untouched; only the metric grid stopped reading
  them.
- The CEFR rail, `levelGapNote`, `progressionSuggested` and the "ready for the
  next band" line are untouched.
- `src/lib/weakness.ts` and the weakness cards are untouched.
- `signalLabel` / `signalMiss` were extended by a sibling in the same file, not
  modified; `isExcluded` in `signals.check.ts` is unchanged.

## Acceptance results

- `npm run check` — 34 check files, 34 passed, 0 failed.
- `node --experimental-strip-types src/lib/coachmetrics.check.ts` — ends
  "coachmetrics.check OK".
- `node --experimental-strip-types src/lib/signals.check.ts` — "signals.check OK"
  (the payload gate is untouched).
- `grep -n "recentMetrics\|activeDays" src/views/Coach.tsx` — no hits (exit 1).
- `grep -c "definition" src/lib/coachmetrics.ts` — 7 (≥ 6).
- `npm run build` — succeeds (only pre-existing chunk-size / dynamic-import
  warnings).

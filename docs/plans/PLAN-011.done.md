# PLAN-011: Coach says what the data says — done

## Changed

- `src/lib/coachmetrics.ts`
  - Exported `dayKey` (was module-private) so `daySeries` shares the same local-day
    definition `coachMetrics` already uses.
  - Added `headline(panel)` — a pure function of the panel with six ordered rules,
    no pool of praise. An empty panel says the week is blank; a ≤2-day week names
    the number of days; a ≥5 positive delta names the metric; a ≤−5 negative delta
    names the slip; a ≥5-day week says the week held; otherwise a steady-week line.
  - Added `wins(panel)` — one chip per threshold that held (consistency ≥5,
    accuracy ≥90 & sample ≥5, comprehension ≥80 & sample ≥5, fluency ≥70 & sample
    ≥5, vocabulary ≥15, any delta ≥10). Empty list is a correct answer.
  - Added `daySeries(signals, now, days = 7)` — one entry per local day, oldest
    first, today last; `active` (boxes) and `count` (line) come from one pass.
- `src/lib/coach.ts`
  - `weeklyReportPrompt` no longer asks for `headline`/`wins`; the final line is
    `{ "report": "2-4 sentences of substance" }`, with a line above telling the
    model not to re-invent what the metrics say.
  - `WeeklyReport` is now `{ report: string }`; `parseWeeklyReport` drops
    `headline` and `wins`, keeping the `extractJson` fallback and the
    "unparseable ⇒ raw text is the report" behaviour. Removed the now-unused
    `arr` helper.
- `src/views/Coach.tsx`
  - Headline reads `headline(panel)` (busy state unchanged).
  - Each metric cell renders its delta (`+n`/`−n`) or a `new` badge; a `null`
    delta renders nothing.
  - The consistency cell keeps seven boxes and gains a 7-point polyline beside
    them, both from `daySeries(...).length` — no hardcoded `7` in the render.
  - The wins block reads `wins(panel)`.
  - The momentum chart gains a baseline, `0`/`100` y labels, and a date range in
    its eyebrow.
- `src/lib/coachmetrics.check.ts`
  - Appended checks for invariants 8, 9, 10, 11 plus the empty-panel headline,
    `wins([]) === []`, and the today-last / oldest-first `daySeries` ordering.
- `src/lib/phase3.check.ts`
  - Updated the `parseWeeklyReport` fixture to the new `{ report }` shape so the
    suite stays green.
- `src/theme.css`
  - Added `.mcell .unit`, `.mcell .new`, `.spark`, `.axis`, `.consistency` and its
    `.boxes`/`.on` styles.
- `src/lib/invariants.check.ts`
  - Rows 8, 9, 10, 11 moved from `pending` to `assertedIn` on
    `coachmetrics.check.ts` with markers `invariant 8/9/10/11`.

## Deviations

- `phase3.check.ts` was not in the plan's file list, but its `parseWeeklyReport`
  fixture asserted the removed `headline`/`wins` fields and would have failed
  `npm run check`. It was updated to the new shape — a necessary consequence of
  the plan's own `coach.ts` change, not a scope addition.
- The consistency series is rendered inside an IIFE in JSX so `daySeries` is
  computed once for both the boxes and the polyline (the plan's "one pass"
  intent), rather than twice.

## Not done

- The written report paragraph, `memoryBrief`, `packGuidance`, and the
  "never state a numeric score" rules are untouched.
- The CEFR rail, `levelGapNote`, `progressionSuggested`, `day.levelEstimate` are
  untouched.
- `src/lib/metrics.ts` and `session_metrics` are untouched.
- The weakness cards (PLAN-014 owns them) are untouched.
- `coachMetrics`, `coachPanel`, `measured` from PLAN-010 are unchanged.
- `package.json`, `package-lock.json`, `src-tauri/**` are untouched.

## Acceptance results

- `npm run check` → 34 check files, 34 passed, 0 failed.
- `node --experimental-strip-types src/lib/coachmetrics.check.ts` → ends
  "coachmetrics.check OK".
- `node --experimental-strip-types src/lib/invariants.check.ts` → asserted count
  is 16 (was 12), 4 higher than before.
- `grep -n "report?.headline\|report.wins\|report?.wins" src/views/Coach.tsx` →
  no hits.
- `grep -n "\"headline\"\|\"wins\"" src/lib/coach.ts` → no hits.
- `npm run build` → succeeds (only pre-existing chunk-size / dynamic-import
  warnings).

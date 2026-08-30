# PLAN-013: Today's four states — done

## Changed

- `src/lib/useDay.ts` — `Day` gains `planSource: "fresh" | "resumed" | "fallback"`,
  set on each of the load effect's three paths (stored row → `"resumed"`, freshly
  built → `"fresh"`, catch → `"fallback"`). The catch's comment now says what the
  fallback is and carries a `// ponytail:` note about carrying yesterday's theme
  in from `previousDay` once that read is known to be independent.
- `src/lib/learn.ts` — two pure functions after `traceLine`: `fallbackNote(plan)`
  (the line under a fallback plan, naming the theme and minute total) and
  `tomorrowPreview(plan)` (one sentence off the real plan for the next date).
- `src/views/Today.tsx` — the `if (!day.plan)` guard now covers the two states it
  actually has (planning / building) and loses "No plan"; the fallback notice
  renders under `ModelWarning` reusing `.dep-note`; the day-complete state shows
  the summary plus a `tomorrowPreview` of a `buildDailyPlan`-built tomorrow, after
  the spine and before the existing recap block. `useMemo` guards the preview
  against re-renders.
- `src/lib/learn.check.ts` — a `// state 10` group asserting `fallbackNote` names
  the theme and minutes, `tomorrowPreview` names its own count and minutes and
  differs from `daySummary`, and neither throws on the smallest plan.
- `src/lib/states.check.ts` — row 10 added and the final count assertion bumped
  from 9 to 10.

## Deviations

None. The plan was applied verbatim.

## Not done

- The manual in-app verification (finish a day and confirm the summary + "Tomorrow:"
  line; break the plan and confirm the fallback notice) — the checks and build are
  green, but the running-app walkthrough was not performed here.

## Acceptance results

```bash
npm run check                                              # 34 check files, 34 passed, 0 failed
node --experimental-strip-types src/lib/learn.check.ts     # learn.check OK
node --experimental-strip-types src/lib/states.check.ts    # states: 10 of 10 answered, 0 pending
grep -n "No plan" src/views/Today.tsx                      # no hits
grep -n "planSource" src/lib/useDay.ts src/views/Today.tsx # 7 hits across the two
npm run build                                              # ✓ built
```

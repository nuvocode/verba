# PLAN-014: weakness → tomorrow's activity — done

## Changed

- `src/lib/weakness.ts` — `weaknessCard(w, activityTitles)` and the `WeaknessCard`
  interface, appended after `addressed`. Each part is a function of the one
  weakness: `observed` is chosen by category with the trend folded in only when
  `worsening`/`improving`; `evidence` is a countable slip count with a "first of
  them today" clause when `trend === "new"`; `plan` names the activities by title
  via the shared `list()` helper (now exported from `learn.ts`), falling back to
  the id when a title is missing.
- `src/lib/learn.ts` — `list` is exported so `weakness.ts` reuses it rather than
  copying it. The `read` and `listen` activities in `buildDailyPlan` now carry a
  drill-aware rationale when they have a goal, and keep their original copy when
  they do not. `talk`'s rationale is untouched.
- `src/views/Coach.tsx` — the weakness card body now renders `weaknessCard`'s
  three parts (`observed` / `evidence` / `plan`) instead of the one shared
  template. A `titles` map is built from `day.plan` so cards name the activities
  the learner will actually see. The heading, the `addressed` gate and the empty
  state are unchanged.
- `src/theme.css` — a `.weak .ev` rule (small, `var(--ink3)`, letter-spaced) in the
  file's single-line style.
- `src/lib/weakness.check.ts` — a `// invariant 6 — one card, one argument` group
  asserting: no two cards read alike; every part is non-empty and free of
  `undefined`/`NaN`/raw ids; evidence counts and the "today" clause; the id
  fallback for a missing title; and the round trip — a plan built from
  `weaknessesFrom`-derived weaknesses carries each label in the rationale of the
  activity that addresses it.

## Deviations

- The round-trip assertion builds its weaknesses through `weaknessesFrom` rather
  than a hand-written fixture, so `addressedBy` is the planner's own rule and the
  test cannot point at an activity the plan never actually drills.

## Not done

- The manual in-app walkthrough (open Coach on a profile with three slips of the
  same kind and confirm each card argues its own case; open Today and confirm the
  named activity's rationale mentions the weakness) — the checks and build are
  green, but the running-app pass was not performed here.

## Acceptance results

```bash
npm run check                                              # 34 check files, 34 passed, 0 failed
node --experimental-strip-types src/lib/weakness.check.ts  # weakness.check OK
node --experimental-strip-types src/lib/learn.check.ts     # learn.check OK
grep -n "slips so far" src/views/Coach.tsx                 # no hits
grep -c "weaknessCard" src/views/Coach.tsx src/lib/weakness.ts  # 2 and 1
npm run build                                              # ✓ built
```

## M4 close-out

This is the last plan of M4. Issue satisfaction across the epic:

- **#50 "Signals carry what Coach measures"** — satisfied. PLAN-009 (one measured
  signal per produced turn) and PLAN-010 (six metrics from signals only) build the
  loop's measurement side.
- **#51 "Coach says what the data says"** — satisfied. PLAN-011 moved the
  consistency series and momentum line onto measured data and dropped the dead
  `activeDays`/`recentMetrics`.
- **#52 "Weakness → tomorrow's activity, as a data link"** — satisfied by this
  plan. The card argues its own case and the named activity's rationale refers
  back, closing the loop.
- **#53 "Memory — the scheduler writes what it schedules"** — satisfied. PLAN-006
  (lapses + capped ask), PLAN-007 (card origin + coach gate) and PLAN-008 (deck
  view) build the memory side.
- **#54 "The plan's dependencies are real, and a surface opens the planned
  activity"** — satisfied. PLAN-012 (real `dependsOn` + `enter`) and PLAN-013
  (Today's four states) build the plan side.

Done-when boxes I could not tick: the manual in-app walkthroughs named in the
PLAN-013 and PLAN-014 manifests (finish a day / break the plan / open Coach with
three slips) — the checks and builds are green, but those are pixel-level
confirmations best done in the running app.

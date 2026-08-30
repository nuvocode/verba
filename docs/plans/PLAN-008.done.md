# PLAN-008 — done

## Changed

- `src/lib/deck.ts` (NEW) — the pure deck logic: `DeckCard` (structurally satisfied
  by `db.VocabRow`), `LEARNED_INTERVAL_DAYS`, `groupOf`/`groupDeck` (due / soon /
  learned), `reviewAsk`/`reviewCall`/`backlogNote` (the capped ask and the calm
  backlog sentence), `DeckFilter`/`FRAGILE`/`filterDeck`, `facets`, `typeLabel`,
  `originLine`. Imports `strength` and `DAILY_REVIEW_CAP` from `./srs.ts`; does not
  import `./db.ts`.
- `src/lib/deck.check.ts` (NEW) — asserts the seven spec points, including
  invariant 15 (a deck at intervals 0/1/5/21 and eases 1.3/2.5 draws ≥ 4 distinct
  strengths). Ends `deck.check OK`.
- `src/views/Memory.tsx` — the collection view now groups by `groupDeck`, the CTA
  reads `reviewCall(due.length)` ("N reviews today"), the backlog sits under the
  intro as `.backlog`, filter chips render from `facets(good)` (type / surface /
  band / Fragile), each row gains a `.wmeta` line (`typeLabel` · `originLine`),
  the `.bar`'s `weak` class comes from `FRAGILE`, and a filter that matches nothing
  shows a "No cards match that" empty state with a clear-filters button. `start()`
  queues the capped ask, oldest first, ignoring the filter. Review mode, `drop`,
  `dropAllJunk`, key handling, `Hints`, and the `day.complete("memory", …)` signal
  emission are untouched.
- `src/lib/useDay.ts` — both `vocabCounts(...)` call sites destructure
  `{ today, due: backlog }`; `buildDailyPlan` is given `dueVocab: today` (the
  capped number); `Day` gains `backlog` next to `due` (which now holds `today`);
  both are returned; the `due` doc comment now says it is the capped ask.
- `src/lib/learn.ts` — the `memory` activity's rationale reads the capped number
  and says the backlog is handled. `estimatedMinutes` and its comment unchanged.
- `src/theme.css` — appended `.backlog`, `.wmeta`, `.deck-filters`.
- `src/lib/invariants.check.ts` — LEDGER row 15 now `assertedIn`
  `src/lib/deck.check.ts` with marker `invariant 15`.

## Deviations

None. The plan was applied as written.

## Not done

- No schema change, no new query, no new dependency, no table rewrite.
- `src/lib/db.ts`, `src/lib/srs.ts`, `package.json`, `package-lock.json`,
  `src-tauri/**` untouched.
- The in-app visual confirmation (three group headings, "N reviews today" button,
  differing strength bars) is a manual step in the running app and was not
  exercised here.

## Acceptance results

```bash
npm run check
# ✓ version 0.4.0 in all three files
# ✓ manifest self-check
# ✓ src/lib/backup.check.ts … src/lib/weakness.check.ts
# 33 check files, 33 passed, 0 failed

node --experimental-strip-types src/lib/deck.check.ts
# deck.check OK

grep -c "deck" src/views/Memory.tsx
# 6

grep -n "due.length} due" src/views/Memory.tsx
# (no hits — the raw backlog is off the button)

grep -n "Due today\|Coming back soon\|Learned" src/views/Memory.tsx
# 273: Due today · …
# 274: Coming back soon · …
# 275: Learned · …

grep -n "dueVocab: today" src/lib/useDay.ts
# 159: const fresh = buildDailyPlan(settings, { date, dayIndex, dueVocab: today, … })

npm run build
# ✓ built in 587ms
```

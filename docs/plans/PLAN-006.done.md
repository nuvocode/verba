# PLAN-006 done

## Changed
- `src/lib/srs.ts` — added `DAILY_REVIEW_CAP = 20`; `CardState` and `newCard` gained `lapses`; `schedule` increments `lapses` only on a miss (grade 0) and passes it through otherwise; `strength` now reads both `interval` and `ease` (0.7/0.3 blend, clamped to 0.05..1).
- `src/lib/db.ts` — `vocab` CREATE TABLE gained `lapses INTEGER NOT NULL DEFAULT 0`; added the additive `ALTER TABLE vocab ADD COLUMN lapses …` migration; `VocabRow` gained `lapses`; `dueVocab` now takes a `limit` defaulting to `DAILY_REVIEW_CAP`; `vocabCounts` returns `{ total, due, today }` with `today = min(due, cap)`; `reviewVocab` persists `lapses` as the fifth field.
- `src/lib/srs.check.ts` — appended invariant 13 (a reviewed deck is not all due), invariant 14 (a review moves the card), lapse-counting assertions, the cap assertion, and `strength`-reads-both-fields assertions.
- `src/lib/invariants.check.ts` — rows 13 and 14 moved from `pending` to `assertedIn` pointing at `src/lib/srs.check.ts`.
- `src/lib/phase4.check.ts` — one line: `strength({ interval: 999 })` → `strength({ interval: 999, ease: 2.5 })`.

## Deviations
- `src/lib/phase4.check.ts` was edited even though the plan's file list names only four files. The plan's acceptance requires `npm run check` to be green, and that pre-existing check called `strength({ interval: 999 })` with the old single-field parameter type. Widening `strength`'s parameter to `{ interval; ease }` made that call pass `ease: undefined`, so `strength` returned `NaN` and the assertion `strength({ interval: 999 }) === 1` failed. The fix is the minimal one-line change to satisfy the widened signature; no behavior of the plan's four files was altered to accommodate it.

## Not done
- Nothing. PLAN-008 owns the screen changes; PLAN-007 and PLAN-008 own invariant rows 15 and 16, which remain `pending`.

## Acceptance results
- `npm run check` → `32 check files, 32 passed, 0 failed` (tsc, version, manifest, and all checks green).
- `node --experimental-strip-types src/lib/srs.check.ts` → `srs.check OK`
- `node --experimental-strip-types src/lib/invariants.check.ts` → `invariants: 9 asserted, 0 pending, 18 out of scope (M1+)` — asserted count is 2 higher than before this plan (was 7).
- `grep -c "lapses" src/lib/db.ts` → `7` (≥ 5)
- `grep -n "LIMIT \$3" src/lib/db.ts` → exactly one hit, inside `dueVocab`
- `grep -rn "ADD COLUMN" src/lib/db.ts | wc -l` → `6` (5 pre-existing + the new lapses one)

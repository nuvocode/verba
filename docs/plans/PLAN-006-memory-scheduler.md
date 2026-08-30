---
id: PLAN-006
title: Memory — the scheduler writes what it schedules
branch: plan/m4-signal-coach-loop
base: master
status: ready
executor: unassigned
created: 2026-08-30
issue: https://github.com/nuvocode/verba/issues/53
milestone: M4 · Signal → Coach loop
---

# PLAN-006: the scheduler writes what it schedules

## Context

`src/lib/srs.ts` is an SM-2 lite scheduler that tracks `ease`, `interval` and
`reps`. The spec (§2.5) asks for five persisted fields — `interval`, `ease`,
`dueAt`, `reps`, `lapses` — and `lapses` exists nowhere: not in `CardState`, not
in the `vocab` table, not in `strength()`. A card failed ten times and a card
failed once look identical.

The second half of this plan is the daily cap. `dueVocab()` returns every due
row, so the call to action reads "112 due" on a deck that has been left alone —
which is the number that makes a learner close the app. §2.5 asks for a cap
(default 20) to be what is asked of them, with the backlog stated separately.

This plan is data and arithmetic only. Nothing on screen changes; PLAN-008 does
that.

## Repo conventions

The worker's harness will not load this project's config, so:

- **No new dependencies.** Not for SRS, not for anything.
- `src/lib/*.ts` import each other **with** the `.ts` extension. `src/views/*.tsx`
  import **without** it.
- Checks are plain files named `*.check.ts` that run under
  `node --experimental-strip-types` with **no DOM and no database**. They use
  `node:assert` and end with a `console.log("<name>.check OK")`.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- A deliberate simplification is marked with a `// ponytail:` comment naming the
  ceiling and the upgrade path.
- Verify with `npm run check` (runs `tsc --noEmit`, the version/manifest scripts,
  and every `*.check.ts`).

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/srs.ts` | EDIT | `CardState`, `newCard`, `schedule`, `strength` |
| `src/lib/db.ts` | EDIT | the `vocab` CREATE TABLE in `init()`; the ALTER block after the `reading_sessions … cefr` line; `VocabRow`; `dueVocab`; `vocabCounts`; `reviewVocab` |
| `src/lib/srs.check.ts` | EDIT | append before the final `console.log` |
| `src/lib/invariants.check.ts` | EDIT | LEDGER rows 13 and 14 |

## Specification

### src/lib/srs.ts

1. Add the review cap, next to `DAY_MS`:

```ts
/** How many cards a learner is asked for in one day (§2.5). The backlog is stated separately. */
export const DAILY_REVIEW_CAP = 20;
```

2. `CardState` gains `lapses`:

```ts
export interface CardState {
  ease: number; // ~1.3 (hard) .. 2.5+ (easy)
  interval: number; // days until next review
  reps: number; // consecutive successful reviews
  lapses: number; // how many times this card has been failed, ever
}

export const newCard: CardState = { ease: 2.5, interval: 0, reps: 0, lapses: 0 };
```

3. `schedule` keeps its signature (`(card: CardState, grade: Grade, now: number) => CardState & { due: number }`)
   and its existing arithmetic. Two changes only:
   - destructure `lapses` alongside the rest;
   - in the `grade === 0` branch, return `lapses: lapses + 1`. Every other path
     returns `lapses` unchanged.

4. `strength` now reads both fields the spec names:

```ts
/**
 * How settled a card is, 0..1. Both halves of the schedule show: how long it is
 * parked for, and how easily it has been coming back. A card at the same interval
 * as another but with a lower ease reads weaker, which is what a learner scanning
 * the deck for what is fragile actually wants.
 */
export function strength(card: { interval: number; ease: number }): number {
  const parked = Math.min(1, card.interval / 21);
  const easy = Math.max(0, Math.min(1, (card.ease - 1.3) / 1.2));
  return Math.max(0.05, Math.min(1, parked * 0.7 + easy * 0.3));
}
```

The parameter type widens from `{ interval }` to `{ interval; ease }`. `VocabRow`
already carries `ease`, and `src/lib/model.ts` re-exports this as `vocabStrength`
— neither needs an edit.

### src/lib/db.ts

1. In `init()`, add one column to the `vocab` CREATE TABLE, after `reps`:

```sql
      lapses INTEGER NOT NULL DEFAULT 0,
```

2. Directly below the existing `ALTER TABLE reading_sessions ADD COLUMN cefr TEXT`
   line and above `await migrateVocabToPerLanguage(db);`, add:

```ts
  // A failed card and a card that has never been failed used to look the same:
  // the schedule tracked reps but threw the lapses away (§2.5). Existing decks
  // start at 0 — that is "not recorded", and it is the only honest starting count.
  await db.execute("ALTER TABLE vocab ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0").catch(() => {});
```

3. `VocabRow` gains `lapses: number;` after `reps`.

4. `dueVocab` takes the cap:

```ts
export async function dueVocab(lang: string, now = Date.now(), limit = DAILY_REVIEW_CAP): Promise<VocabRow[]> {
  const db = await getDb();
  return db.select<VocabRow[]>(
    `SELECT * FROM vocab WHERE lang = $1 AND due <= $2 AND ${REVIEWABLE} ORDER BY due ASC LIMIT $3`,
    [lang, now, limit],
  );
}
```

Import `DAILY_REVIEW_CAP` from `./srs.ts` alongside the existing `schedule, newCard`
import.

5. `vocabCounts` reports the backlog and the ask separately:

```ts
/**
 * What the deck owes and what the learner is asked for. `due` is the whole
 * backlog; `today` is the capped ask — the number every call to action shows,
 * because "112 due" is the number that makes a learner close the app (§2.5).
 */
export async function vocabCounts(
  lang: string,
  now = Date.now(),
): Promise<{ total: number; due: number; today: number }> {
```

Keep both existing queries unchanged, and return
`{ total, due, today: Math.min(due, DAILY_REVIEW_CAP) }`.

6. `reviewVocab` persists the fifth field:

```ts
export async function reviewVocab(card: VocabRow, grade: Grade): Promise<void> {
  const next = schedule(
    { ease: card.ease, interval: card.interval, reps: card.reps, lapses: card.lapses },
    grade,
    Date.now(),
  );
  await write("UPDATE vocab SET ease = $1, interval = $2, reps = $3, due = $4, lapses = $5 WHERE id = $6", [
    next.ease,
    next.interval,
    next.reps,
    next.due,
    next.lapses,
    card.id,
  ]);
  await write("INSERT INTO review_log (created_at) VALUES ($1)", [Date.now()]);
}
```

Leave the `review_log` insert and its comment exactly as they are.

### src/lib/srs.check.ts

Append before the final `console.log`, keeping the file's existing terse style:

```ts
// invariant 14: a review moves the card. Same card, same clock, different schedule.
const before = { ease: 2.5, interval: 3, reps: 2, lapses: 0 };
const after = schedule(before, 1, now);
assert.notEqual(after.interval, before.interval, "a good review must change the interval");
assert.notEqual(after.due, now, "a good review must park the card in the future");

// lapses only ever count up, and only on a miss.
assert.equal(schedule(before, 1, now).lapses, 0, "a good review is not a lapse");
assert.equal(schedule(before, 2, now).lapses, 0, "an easy review is not a lapse");
assert.equal(schedule(before, 0, now).lapses, 1, "a miss is a lapse");
assert.equal(schedule(schedule(before, 0, now), 0, now).lapses, 2, "lapses accumulate");

// invariant 13: a deck that has been reviewed is not a deck that is all due. Ten
// cards graded on the same day come back on ten different schedules, and none of
// them today — if they were all due again, the scheduler is not writing.
const deck = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => schedule({ ease: 2.5, interval: n, reps: n, lapses: 0 }, 1, now));
assert.equal(deck.filter((c) => c.due <= now).length, 0, "invariant 13: nothing is due the moment it was reviewed");
assert(new Set(deck.map((c) => c.due)).size > 1, "invariant 13: a reviewed deck comes back spread out, not all at once");

// The day's ask is capped, and the backlog is not the ask.
assert.equal(DAILY_REVIEW_CAP, 20, "the default daily cap is 20 (§2.5)");

// strength reads both fields of the schedule, so two cards parked equally long
// but returning differently do not draw the same bar.
const solid = strength({ interval: 21, ease: 2.5 });
const shaky = strength({ interval: 21, ease: 1.3 });
assert(solid > shaky, "ease has to move the bar, or every mature card looks identical");
assert(strength({ interval: 0, ease: 2.5 }) < strength({ interval: 10, ease: 2.5 }), "interval has to move it too");
assert(strength({ interval: 999, ease: 2.5 }) <= 1 && strength({ interval: 0, ease: 1.3 }) >= 0.05, "bars stay in 0.05..1");
```

Extend the file's import to `import { schedule, newCard, DAY_MS, DAILY_REVIEW_CAP, strength } from "./srs.ts";`.

### src/lib/invariants.check.ts

Replace rows 13 and 14's `pending` with `assertedIn`:

```ts
  {
    id: 13,
    claim: "Due öğe sayısı < toplam öğe sayısı (deck 1 günden eskiyse).",
    assertedIn: [{ file: "src/lib/srs.check.ts", marker: "invariant 13" }],
  },
  {
    id: 14,
    claim: "Bir tekrar sonrası ilgili öğenin `dueAt` ve `interval` değerleri değişmiştir.",
    assertedIn: [{ file: "src/lib/srs.check.ts", marker: "invariant 14" }],
  },
```

Leave rows 15 and 16 pending — PLAN-008 and PLAN-007 own them. Change nothing
else in that file: the ledger audits its own bookkeeping and the final
`assert.deepEqual` over 27 ids must keep passing untouched.

## Do not touch

- `migrateVocabToPerLanguage` — a one-shot, irreversible table rebuild. Do not
  call it, do not change its guard, do not add a second table rebuild anywhere.
- Any `DROP TABLE`, `RENAME`, `DELETE`, or backfill `UPDATE` over `vocab`. The
  only schema change this plan permits is the single additive `ADD COLUMN` above.
- `REVIEWABLE` — the SQL capture gate. It is correct as it stands.
- `package.json`, `package-lock.json`, `src-tauri/**`.
- `src/views/**` — no screen changes in this plan. `Memory.tsx` calls
  `strength(w)` with a `VocabRow`, which already satisfies the widened parameter
  type; it must compile untouched.
- `session_metrics` and everything that reads it.

## Acceptance

```bash
npm run check                                          # 0 failed
node --experimental-strip-types src/lib/srs.check.ts   # ends "srs.check OK" (or the file's existing final line)
node --experimental-strip-types src/lib/invariants.check.ts
#   prints "invariants: N asserted, …" with N two higher than before this plan
grep -c "lapses" src/lib/db.ts                         # >= 5
grep -n "LIMIT \$3" src/lib/db.ts                      # exactly one hit, inside dueVocab
grep -rn "ADD COLUMN" src/lib/db.ts | wc -l            # 6  (5 pre-existing + the new lapses one)
```

## Manifest

When implementation is complete, write `docs/plans/PLAN-006.done.md`:

```markdown
## Changed
- path — one line on what changed

## Deviations
- Anything done differently from this plan, and why. "none" if there were none.

## Not done
- Anything left unimplemented, and what blocked it.

## Acceptance results
- Each command above, with its actual output pasted.
```

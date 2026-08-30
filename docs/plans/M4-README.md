# M4 · Signal → Coach loop — the plan

**Milestone:** [M4 · Signal → Coach loop](https://github.com/nuvocode/verba/milestone/5)
**Spec:** `docs/plans/3-verba-activity-layer-spec.md` §1.3, §1.4, §1.5, §2.1, §2.5, §2.6
**Branch:** `plan/m4-signal-coach-loop`, off `master`. Every plan below lands on that
one branch, in order, each on top of the previous plan's commit.

## What the milestone is for

The loop the product exists to close:

```
activity → signal → Coach → weakness → tomorrow's plan → activity
```

Three of those arrows already exist. Signals are written (`src/lib/signals.ts`,
`useDay.complete`), weaknesses are derived from them (`src/lib/weakness.ts`), and
the plan fills its drill slots from the declared weaknesses
(`buildDailyPlan` → `DRILL_SLOTS`). M4 closes the two that do not:

- **Coach still measures from `session_metrics`**, a table of text heuristics
  written at the end of a Talk session — not from signals. Its headline and its
  wins come from the model, so the screen can praise a week the numbers do not
  support.
- **Memory's scheduler writes three of the five fields it must persist.** There
  are no `lapses`, no item type, no origin and no level band on a card, so the
  deck cannot be filtered, cannot refuse a word two bands below the learner, and
  its strength bars stand on `interval` alone.

## The nine sections

| # | Plan | Closes | Files |
|---|---|---|---|
| 1 | [PLAN-006](PLAN-006-memory-scheduler.md) — the scheduler writes what it schedules | #53 (a) | 4 |
| 2 | [PLAN-007](PLAN-007-memory-card-origin.md) — what a card carries, and who put it there | #53 (b) | 7 |
| 3 | [PLAN-008](PLAN-008-memory-deck-view.md) — due today, soon, learned | **#53** | 5 |
| 4 | [PLAN-009](PLAN-009-signals-carry-measurement.md) — signals carry what Coach measures | #50 (a) | 4 |
| 5 | [PLAN-010](PLAN-010-coach-metrics.md) — six metrics, from signals only | **#50** | 4 |
| 6 | [PLAN-011](PLAN-011-coach-honesty.md) — Coach says what the data says | **#51** | 5 |
| 7 | [PLAN-012](PLAN-012-plan-dependencies.md) — dependencies are real, a surface opens the planned activity | #54 (a) | 6 |
| 8 | [PLAN-013](PLAN-013-today-four-states.md) — Today's four states | **#54** | 4 |
| 9 | [PLAN-014](PLAN-014-weakness-to-tomorrow.md) — weakness → tomorrow's activity | **#52** | 4 |

Order matters. 006 → 007 → 008 touch the same three files in sequence; 010 cannot
compute anything until 009 has put the numbers in the payloads; 011 reads 010's
metrics; 014 reads 012's plan.

## The invariant ledger is the scoreboard

`src/lib/invariants.check.ts` carries spec §5's 27 claims. M4 owns nine of them,
all currently `pending: "M1+ (…)"`:

| # | Claim | Plan that flips it |
|---|---|---|
| 8 | No delta equals the metric's own value | PLAN-011 |
| 9 | 7 consistency boxes; marked boxes === reported days | PLAN-011 |
| 10 | The headline does not contradict the metrics | PLAN-011 |
| 11 | Every "win" rests on a signal threshold | PLAN-011 |
| 12 | Every number on screen has a unit and a definition | PLAN-010 |
| 13 | Due count < total count (on a deck older than a day) | PLAN-006 |
| 14 | A review changes that item's `dueAt` and `interval` | PLAN-006 |
| 15 | Strength bars vary across the deck | PLAN-008 |
| 16 | Items two bands below the learner are not auto-added | PLAN-007 |
| 7 | A `dependsOn` activity really consumes its dependency | PLAN-012 (already owned, currently vacuous) |

A plan is not finished until its row is `assertedIn` and `npm run check` is green.

## Out of scope for M4

- Invariants 17–21 (content quality gates) — M5, `docs/plans/3-…-spec.md` §2.2–2.4.
- Invariants 22–27 (surface states, keymap, duplication) — M5/M6.
- FSRS. SM-2 with lapses is what §2.5 asks for ("SM-2 **or** FSRS"), and the
  deck has no review history to fit FSRS parameters against.
- Any change to `session_metrics`. It stays where it is and keeps feeding the
  level estimate; Coach simply stops reading it for the six metrics.

## The one thing worth reading twice

Every plan below states its **Do not touch** list, and every one of them forbids
the same two things: adding a dependency, and rewriting a table. `src/lib/db.ts`
carries a one-shot, irreversible migration (`migrateVocabToPerLanguage`) that
rebuilds `vocab`. Nothing in M4 may touch it, and no new migration in M4 may do
more than `ALTER TABLE … ADD COLUMN … DEFAULT`.

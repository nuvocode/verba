---
id: PLAN-029
title: Two signals, or nothing happens
branch: plan/m6-repair-layer
base: master
status: todo
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/63
milestone: M6 · Repair layer
---

# PLAN-029: the bluff decision

## Context

Spec §3.2 and §3.3. The decision half. PLAN-028 hands over a list of signals per
turn; this plan is the only place that turns a list into a verdict, and the only
place that says a rewind may happen.

§3.3 is the load-bearing part and it is a policy about being wrong: **a false bluff
call costs more than a missed one.** A learner stopped mid-flow when they had in
fact understood learns that the app misreads them, and stops trusting the moments
when it is right. Every constant below leans toward doing nothing.

Depends on PLAN-028. Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- Nothing here renders, speaks, or interrupts. It returns a verdict; PLAN-030 acts.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/breakdown.ts` | EDIT | `Verdict`, `judge`, `SessionBudget` |
| `src/lib/breakdown.check.ts` | EDIT | new cases |
| `src/lib/signals.ts` | EDIT | verdict rides the turn payload |
| `src/lib/useTalk.ts` | EDIT | hold the session budget; call `judge` per turn |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 5–6 |

## Specification

### The verdict

```ts
export type Verdict = "clear" | "suspect" | "bluff";

export function judge(
  signals: BreakdownSignal[],
  repair: RepairObservation | null,
  budget: SessionBudget,
): { verdict: Verdict; intervene: boolean };
```

A turn is `bluff` when **all three** hold (§3.2):

1. at least two breakdown signals were observed in that turn, **and**
2. the learner produced no repair move in it, **and**
3. the conversation continued — the learner said something rather than falling
   silent. Silence is not a bluff; it is the thing `HOLD` exists to make sayable,
   and PLAN-032's patience rules own it.

One signal and no repair → `suspect`. It is recorded, and `intervene` is false.
Everything else → `clear`.

A turn carrying a repair move is `clear` **regardless of how many breakdown signals
it carries**. That is the whole point of the layer: a learner who did not understand
and said so did the right thing. Two signals plus a `CLARIFY` is a success, and
recording it as anything else would teach the opposite of the lesson.

### The session budget

```ts
export interface SessionBudget {
  /** Rewinds already spent this session. */
  used: number;
  /** Extra signals required this session — raised by a denied rewind. */
  handicap: number;
  /** The learner asked not to be interrupted (§10, row 5). */
  off: boolean;
}

export const REWIND_LIMIT = 2;
```

`intervene` is true only when the verdict is `bluff`, `budget.used < REWIND_LIMIT`,
and `budget.off` is false. A third bluff in one session is **recorded exactly like
the first two and does not interrupt** — the measurement never stops, only the
interruption does. Same for `off`: the inventory and every signal keep filling; §10
turns off the intervention, not the observation.

`handicap` implements §3.3's last rule. When the learner says they did understand
(PLAN-030 raises this), the turn's mark is dropped and `handicap` goes to 1 for the
rest of the session, meaning `bluff` then needs three signals rather than two. It is
never persisted: it expires with the session, because a learner having a sharp day
is not a fact about the learner.

### Where the verdict is kept

On the turn signal's payload beside `breakdown`, as `verdict`. Two consequences,
both asserted:

- `signalMiss` still returns `false`. A bluff is not a wrong answer; it does not
  enter accuracy, comprehension, confidence, or any weakness.
- Nothing reads `verdict` to compute a number the learner sees. PLAN-037 turns the
  distribution into a direction in words, and that is the only reader there will be.

### Checks

`breakdown.check.ts`:
1. Two signals, no repair, learner spoke → `bluff`. One signal → `suspect`. Zero →
   `clear`.
2. Two signals **plus** a repair move → `clear`, and `intervene` false.
3. Two signals with an empty learner turn → not a bluff.
4. `intervene` is false on the third bluff of a session while the verdict is still
   `bluff` — the record and the interruption are separated.
5. `budget.off` suppresses `intervene` and changes no verdict.
6. `handicap: 1` makes a two-signal turn `suspect` instead of `bluff`.
7. Source scan: `confidence.ts` does not import `breakdown.ts`, and adding a bluff
   verdict to every turn in a fixed signal set changes no value returned by
   `coachMetrics` or `confidence`.
8. Source scan: no `.tsx` file reads `verdict`. (PLAN-037 will change this check to
   name exactly one file.)

## Do not touch

- The rewind interaction itself.
- Anything that scores. A bluff must remain arithmetically invisible.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` rows 5–6 asserted.
- A session with five bluffs records five and interrupts twice.
- A learner who asks "sorry, what does that mean?" after visibly struggling is never
  marked as bluffing.
- Nothing in the UI changes.

## Commit

```
feat(repair): a bluff needs two signals and no repair, and never more than two rewinds (PLAN-029)
```

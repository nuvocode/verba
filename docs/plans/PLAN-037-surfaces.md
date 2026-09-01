---
id: PLAN-037
title: What the learner actually sees
branch: plan/m6-repair-layer
base: master
status: todo
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/69
milestone: M6 · Repair layer
---

# PLAN-037: the surfaces

## Context

Spec §9, §10 and the tail of §12. Ten plans of measurement, and this is the only one
the learner reads.

Which makes it the plan most able to undo the milestone. Every restraint M6 has
imposed — no number that was not measured, no metric the learner owns that is really
the coach's, no text that points at them — is enforceable in the engine but *visible*
only here. A bluff-rate percentage on Today would waste the whole layer.

The three things §9 asks for:

- **Today** — at least one activity a day carries a repair target, said as an
  outcome ("today we work on stopping me"), never as a mechanism. No bluff rate.
- **Coach** — the six categories, each with the learner's own phrasings; the change
  over time as a **direction in words**, not a number; the one category being worked
  on next, in one sentence; and an empty state when there is not enough to say.
- **Talk / Listen** — the rewind is a calm marker (PLAN-030 shipped it), and the
  breakdown moments can be replayed or reread at the end of a session.

Plus §10's boundary table in full, of which the load-bearing row is: with no
microphone, the whole layer runs over text.

Last plan of M6. Depends on all of them.

## Repo conventions

- **No new dependencies.**
- No number reaches a surface unless it was measured and carries a unit and a
  definition — invariant 12, still binding.
- Style and check conventions as in PLAN-015. The four states, per PLAN-016.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/repair.ts` | EDIT | `direction`, `targetSentence`, `todayLine` |
| `src/lib/repair.check.ts` | EDIT | new cases |
| `src/views/Coach.tsx` | EDIT | the inventory panel |
| `src/views/Today.tsx` | EDIT | the repair target on a card |
| `src/lib/learn.ts` | EDIT | one activity a day carries the target |
| `src/views/Talk.tsx` | EDIT | end-of-session breakdown replay |
| `src/views/Listening.tsx` | EDIT | the same, for chapters |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 21–24 |

## Specification

### Today

`buildDailyPlan` marks **one** activity a day with the current repair target
(`nextTarget`, PLAN-027) and writes its rationale accordingly. The card says what
the learner will get, in the second person, about the coach:

> Today we'll work on stopping me when I go too fast.

Not "HOLD practice", not "repair category 2 of 6", not a code. `todayLine(category)`
holds one such sentence per category, in the UI language, and the category code
appears in no user-facing string anywhere in the repo — a source scan asserts it.

Nothing else about the layer appears on Today. No bluff rate, no breakdown count, no
"3 rewinds this week" — §9.1, and the scan covers it.

### Coach

One new panel, below the metrics, in the four states PLAN-016 defined.

**The six categories.** Each with its state as a word, and — the part that does the
work — **the learner's own phrasings**, verbatim, from the inventory's `variants`.
A learner reading "*wait, one second*" and "*sorry, can you say it again*" in their
own voice is being shown evidence that they can do this. A list of textbook phrases
would be the flashcards §11 forbids.

A category at `unknown` shows no variants and says so plainly. It does not show a
suggested phrase to learn — that is the same forbidden list, one row at a time.

**The direction.** `direction(signals, now)` compares the bluff share of the last
two weeks against the fortnight before, and returns one of:

```ts
type Direction = "better" | "same" | "worse" | "tooEarly";
```

rendered as a sentence about behaviour, never a figure:

> When you don't catch something, you ask more often than you used to.

`tooEarly` is returned whenever either window has fewer than 20 judged turns, and it
renders the empty state — §10's last row and §12's twenty-third claim. There is no
path from `direction` to a percentage: the function returns the union above and
nothing numeric, so a later edit cannot casually print one.

**The next target.** One sentence, from `targetSentence(nextTarget(inventory))`. When
every category is at `uses` or better it says that instead, and names nothing.

### Talk and Listen: what broke, at the end

At the end of a session, the moments that broke are available to go back over. Not a
report — a short list, in the reflection block that already exists:

- **Talk** — each rewind and each bluff-verdict turn, as the coach's line and the
  learner's reply, with the coach's line replayable at `SLOW_RATE` (PLAN-030's rate
  path, one key).
- **Listen** — each chapter where a walk-back happened (PLAN-036), replayable over
  PLAN-025's timeline at the grade it was finally understood at.

Neutral framing throughout: these are the parts worth another listen, not the parts
you got wrong. No count is shown, no colour beyond the neutral ramp, and a session
with none of them shows nothing at all rather than an empty heading.

### §10, row by row

| Row | Where it is implemented | How it is checked |
|---|---|---|
| No mic / mic refused | `pace`, `hesitation` and PLAN-036's audio variables stand down; every text signal, the inventory, the bluff decision and the rewind keep working | assert the full layer over a text-only fixture: signals, verdict, rewind, inventory all produced |
| Signals unreliable (short session, thin data) | `Baseline.ready === false` (PLAN-028) gates every timing signal; the inventory still fills from positive observations | assert an 8-turn session yields inventory entries and no bluff verdicts |
| Model latency mixed into the learner's | `speakUnknown` excludes the turn (PLAN-028) | asserted there; re-asserted here end-to-end |
| Learner falls back to their native language | counts as a breakdown signal; the coach bridges briefly and returns to the target language — a prompt rule, and the native-language turn is never corrected as an error | assert the prompt rule is present; assert no `correction` signal from a native-language turn |
| Learner says rewinds bother them | rewinds off for that learner (`settings.rewinds: boolean`, default true); inventory and measurement continue | assert verdicts still produced with rewinds off |
| Coach opened with thin data | empty state; no invented percentage, no chart | asserted in the Coach checks below |

### Checks

`repair.check.ts`:
1. `direction` returns `tooEarly` below 20 judged turns in either window, and the
   panel renders `Nothing` for it.
2. `direction`'s return type admits no number — assert exhaustively over the union,
   and assert the rendered string for each contains no digit.
3. `todayLine` and `targetSentence` exist for all six categories, in every shipped UI
   language, and contain no category code.
4. Source scan: no `.tsx` file contains any of the six category codes as a rendered
   string; no `.tsx` file renders a bluff count, share or percentage. Both probed
   with seeded violations.
5. `buildDailyPlan` marks exactly one activity a day with a repair target, and its
   `rationale` is non-empty (invariant 5 still holds).
6. The Coach panel implements all four states (invariant 27's pattern, extended to
   the new panel via `surfaces.ts`).
7. An inventory with variants renders the learner's exact strings, including
   punctuation; an `unknown` category renders no suggested phrase.
8. End-to-end text-only fixture: a mic-less session produces breakdown signals, a
   verdict, a rewind and inventory movement.
9. With `settings.rewinds: false`, verdicts are still produced and `intervene` is
   never true.
10. The end-of-session breakdown list is absent, not empty, when nothing broke.

## Do not touch

- The existing Coach metrics panel and its `MetricPair` rendering.
- `confidence.ts`, and every number already on screen.
- PLAN-030's rewind marker. This plan adds the end-of-session review, not a second
  in-conversation treatment.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` prints **24 asserted, 0 pending** — spec 4
  §12's checklist is closed, and the milestone with it.
- Coach shows six categories in the learner's own words, one sentence about
  direction, one about what is next, and an honest empty state on a fresh profile.
- Today names a repair target as an outcome, once a day, with no metric attached.
- The word "bluff" and the six codes appear nowhere a learner can read them.
- With the microphone denied, everything except the audio variables still works.

## Commit

```
feat(coach): the repair layer, in the learner's own words (PLAN-037)
```

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

Spec §9, §10 and the tail of §12. Eleven plans of measurement, and this is the only
one the learner reads.

Which makes it the plan most able to undo the milestone. Every restraint M6 has
imposed — no number that was not measured, no metric the learner owns that is really
the coach's, no text that points at them — is enforceable in the engine but *visible*
only here. A bluff-rate percentage on Today would waste the whole layer.

And there is a second way to waste it, which the draft of this plan did not see: a
surface that **promises** something the session then does not do. Today saying "today
we'll work on stopping me when I go too fast" while the coach's system prompt is
byte-identical to yesterday's is a fabrication on the one screen the learner trusts —
the same failure as an invented percentage, wearing better clothes. Whatever this
plan puts on a card, the session has to keep.

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

Last plan of M6. Lands on top of PLAN-036's commit (`ec9cc5e`). Depends on all of them.

## Repo conventions

- **No new dependencies.**
- No number reaches a surface unless it was measured and carries a unit and a
  definition — invariant 12, still binding.
- Structural payload fields are read through one door in `model.ts`, never by
  reaching into `payload` from a caller (`signalMiss`, `turnStats`, `turnTiming`,
  `repairMoveInfo` are the precedent). This plan adds one more.
- Style and check conventions as in PLAN-015. The four states, per PLAN-016.

## What is already there, and what is not

Read before writing — the draft of this plan assumed four things the repo does not
have and one it already has:

- **There is no UI-language layer.** The locale-keyed string tables that exist
  (`OFFER_LINE`, the rewind lines) are what the coach *says*, in the target
  language. Today and Coach are English, like every other view string. So the new
  sentences are English, one per category, and "in every shipped UI language" is
  struck from the checks — it would have produced nine copies of a claim nothing
  can test.
- **`learn.ts` is pure**: `buildDailyPlan` takes `(Settings, PlanContext)` and its
  own comment says "no I/O, no clock". It cannot read signals, so it cannot call
  `nextTarget` itself. The target arrives the way `weaknesses` already does — on
  `PlanContext`, computed by `useDay`.
- **The verdict is already persisted.** It rides the `unpromptedTurn` /
  `suggestionUsed` payload, and the comment beside it in `signals.ts` names this
  plan as its only intended reader: *"PLAN-037 turns the distribution into a
  direction in words, and that is the only reader there will be."* So `direction`
  has its data — through a new single door, not by reading `payload` in `repair.ts`.
- **`settings.rewinds` does not exist**, so §10's row 5 is unbuilt. What does exist
  is `SessionBudget.off`, set by PLAN-031's `ease()` for one session and
  deliberately never persisted. The standing preference is a different thing from
  "don't push me today", so it earns a setting — but it must feed that same `off`,
  not a second gate beside it.
- **The prompt reports repair moves; nothing asks for one.** `buildSystem`'s schema
  carries `"repair"` so the model can *report* what the learner did. No instruction
  anywhere asks the coach to leave an opening for a particular move. That gap is
  what would make Today's sentence a bluff, and closing it is this plan's real work.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/model.ts` | EDIT | `turnVerdict` — the one door onto a turn's verdict |
| `src/lib/repair.ts` | EDIT | `direction`, `targetSentence`, `todayLine`, `targetGoal` |
| `src/lib/repair.check.ts` | EDIT | the cases below |
| `src/lib/learn.ts` | EDIT | `PlanContext.repairTarget`; one activity carries it |
| `src/lib/useDay.ts` | EDIT | derives the target from signals and passes it in |
| `src/lib/settings.ts` | EDIT | `rewinds: boolean` (default true) |
| `src/lib/useTalk.ts` | EDIT | `rewinds` → `budget.off`; expose the session's broken turns and a slow replay |
| `src/views/Today.tsx` | EDIT | the repair target on one card |
| `src/views/Coach.tsx` | EDIT | the inventory panel |
| `src/views/settings/Learning.tsx` | EDIT | the rewinds row, beside patience and style |
| `src/views/Talk.tsx` | EDIT | end-of-session review |
| `src/views/Listening.tsx` | EDIT | the same, for chapters |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 21–24 |

## Specification

### Today, and the promise it has to keep

`useDay` already derives `weaknesses` from signals before calling `buildDailyPlan`.
The repair target arrives the same way:

```ts
// useDay.ts, beside the weakness derivation
const repairTarget = nextTarget(inventoryFrom(signals, Date.now()));
```

and rides `PlanContext.repairTarget?: RepairCategory | null`. `learn.ts` stays pure.

`buildDailyPlan` marks **one** activity a day with it — the conversation, when the
day has one — and does two things with it, not one:

1. writes the card's rationale as an outcome, in the second person, about the coach:

   > Today we'll work on stopping me when I go too fast.

   `todayLine(category)` holds one such sentence per category. Not "HOLD practice",
   not "repair category 2 of 6", not a code.

2. folds `targetGoal(category)` into that activity's existing `goal` field — the
   seam that already runs `App.tsx` → `talk.start(scenario, "normal", undefined,
   goal)` → `buildSystem`'s "Quietly give the learner practice with: …". This is
   the half that makes the sentence true. A card that says the session will work on
   stopping the coach, over a session the coach runs identically, is the invented
   metric with a friendlier face.

   Where the activity already carries a weakness drill, the two are joined rather
   than one silently winning — and if joining them would make the goal a paragraph,
   the weakness drill keeps the slot and **no repair line is written on the card**.
   Saying nothing is always available; saying something untrue is not.

Nothing else about the layer appears on Today. No bluff rate, no breakdown count, no
"3 rewinds this week" — §9.1, and the scan covers it.

### Coach

One new panel, below the metrics, inside the coach surface. It does **not** get a
row in `SURFACES`: that table is one row per surface, and the four states the panel
needs are the coach surface's own, already pinned. What the panel owes is the
`Nothing` state on thin data, and the checks assert that directly.

**The six categories.** Each with its state as a word, and — the part that does the
work — **the learner's own phrasings**, verbatim, from `RepairEntry.variants`. A
learner reading "*wait, one second*" and "*sorry, can you say it again*" in their own
voice is being shown evidence that they can do this. A list of textbook phrases would
be the flashcards §11 forbids.

A category at `unknown` shows no variants and says so plainly. It does not show a
suggested phrase to learn — that is the same forbidden list, one row at a time.

**The direction.** The verdict distribution becomes a direction, and never a figure.
`model.ts` gains the door:

```ts
/** The verdict a turn signal carries, or null when it is not a turn. */
export function turnVerdict(s: Signal): "clear" | "suspect" | "bluff" | null;
```

and `repair.ts` gains:

```ts
export type Direction = "better" | "same" | "worse" | "tooEarly";
export function direction(signals: Signal[], now: number): Direction;
```

comparing the bluff share of the last 14 days against the 14 before it, rendered as
a sentence about behaviour:

> When you don't catch something, you ask more often than you used to.

`tooEarly` whenever either window holds fewer than 20 judged turns — a judged turn
being one `turnVerdict` answers for. It renders the empty state: §10's last row and
§12's twenty-third claim. There is no path from `direction` to a percentage: the
function returns the union above and nothing numeric, so a later edit cannot casually
print one.

"same" is a threshold, not exact equality. With 20 turns to a window, one extra
bluff moves a share by 5 points, so a direction read off `r === p` would swing
better/worse on a single turn's noise and never hold "same" across two windows —
a sentence the learner can watch flip is a number in words. The windows read as
one behaviour while the gap is no wider than **one turn's movement in the smaller
window** — a difference one turn could have made is not a trend.

That band is compared in integers (`withinOneTurn`, beside `direction`), because
it cannot be written as a constant. A fixed 0.05 splits one-turn gaps by binary
rounding alone: at 20 turns 2→3 computes as 0.049999999999999996 and reads
"same", 3→4 as 0.05000000000000002 and reads "worse", and both are one turn. The
integer form also scales the way the claim should — with 200 turns behind it,
five points is signal rather than noise. The check pins every one-turn pair
across the window as "same", a two-turn gap as the direction the sign says, and
both halves of the scaling.

**The next target.** One sentence, from `targetSentence(nextTarget(inventory))`. When
every category is at `uses` or better it says that instead, and names nothing.

### Talk and Listen: what broke, at the end

At the end of a session, the moments that broke are available to go back over. Not a
report — a short list, in the reflection block that already exists.

Neither hook exposes what this needs today, so both exposures are part of the work:

- **Talk** — `useTalk` holds the produced turns with their `verdict` and the rewind
  record for the life of the session, and returns neither. It gains one read-only
  list: the turns whose verdict was not `clear`, each as the coach's line, the
  learner's reply, and its turn index; plus a replay that reaches the existing
  `say(line, SLOW_RATE)` (PLAN-030's rate path, one key). No new speech path.
- **Listen** — PLAN-036's `walkBacks` is already returned; the completion screen
  lists each chapter a walk-back happened in, replayable over PLAN-025's timeline at
  the grade it was finally understood at.

Neutral framing throughout: these are the parts worth another listen, not the parts
you got wrong. No count is shown, no colour beyond the neutral ramp, and a session
with none of them shows nothing at all rather than an empty heading.

### §10, row by row

| Row | Where it is implemented | How it is checked |
|---|---|---|
| No mic / mic refused | `hesitation` is the only audio-only breakdown signal; the five meaning signals plus `slowResponse` and `shortening` all work over typed turns, so `judge`'s two-signal floor is reachable text-only. The inventory, the verdict and the rewind keep working | drive a text-only session through the production path: breakdown signals, a `bluff` verdict, a rewind and inventory movement, with no `levels` anywhere |
| Signals unreliable (short session, thin data) | `Baseline.ready === false` (PLAN-028) gates every timing signal; the inventory still fills from positive observations | assert an 8-turn session yields inventory entries and no bluff verdicts |
| Model latency mixed into the learner's | `speakUnknown` excludes the turn (PLAN-028) | asserted there; re-asserted here end-to-end |
| Learner falls back to their native language | counts as a breakdown signal; the coach bridges briefly and returns to the target language — a prompt rule, and the native-language turn is never corrected as an error | assert the prompt rule is present in the built system prompt; assert no `correction` signal from a native-language turn |
| Learner says rewinds bother them | `settings.rewinds: boolean`, default true, in Learning beside patience and style. It feeds `SessionBudget.off` — the same gate PLAN-031's `ease()` sets — so there is one door, not two. Measurement continues: only the interruption stops. PLAN-031's in-session `ease` still persists nothing | assert verdicts are still produced with `rewinds: false` and `intervene` is never true; assert `ease()` still writes no setting |
| Coach opened with thin data | empty state; no invented percentage, no chart | asserted in the Coach checks below |

### Checks

`repair.check.ts`:

1. `turnVerdict` answers for a turn signal and `null` for every other kind — the
   door, pinned, so `direction` never reads a payload itself. **repair ledger 22**
2. `direction` returns `tooEarly` below 20 judged turns in either window, and the
   panel renders `Nothing` for it. **repair ledger 23**
3. `direction`'s return admits no number: assert exhaustively over the union, and
   assert the rendered sentence for each of the four contains no digit.
4. `todayLine` and `targetSentence` exist for all six categories, contain no
   category code, and no digit.
5. Source scan over `src/views`: no rendered string contains a category code or the
   word "bluff". Scoped to string literals and JSX text — `SLOW_RATE` and an
   identifier named `HOLD` are not violations, and a scan that cannot tell them
   apart is a scan nobody will keep. Probed with a seeded violation in each
   direction: a real one is caught, an identifier is not.
6. `buildDailyPlan` with a `repairTarget` marks exactly one activity with it, its
   `rationale` is non-empty (invariant 5), and **the same activity's `goal` carries
   `targetGoal(category)`**. Without a target, the plan is byte-identical to today's.
7. End-to-end: a plan built with a repair target produces a system prompt that
   actually names the target — drive `buildSystem` through the activity's `goal`.
   Removing the `goal` fold must turn this red. This is the case that stops Today
   promising what the session does not do. **repair ledger 21**
8. An inventory with variants renders the learner's exact strings, including
   punctuation and case; an `unknown` category renders no suggested phrase.
9. Text-only fixture, driven from the production path: no `levels` on any turn,
   breakdown signals still observed, a `bluff` verdict still reached, a rewind still
   offered, and the inventory still moves. **repair ledger 24**
10. With `settings.rewinds: false`, `judge` still returns verdicts and `intervene`
    is never true; `ease()` still writes nothing to settings.
11. The end-of-session breakdown list is absent, not empty, when nothing broke.

**On the checks themselves.** Cases 5, 6, 7 and 9 are the ones that pass vacuously if
written against fixtures instead of the production path. Each must fail when its own
rule is removed — verify by removing it and running, not by reading.

## Do not touch

- The existing Coach metrics panel and its `MetricPair` rendering.
- `confidence.ts`, and every number already on screen.
- PLAN-030's rewind marker. This plan adds the end-of-session review, not a second
  in-conversation treatment.
- PLAN-031's rule that an in-session `ease` persists nothing. The new setting is a
  standing preference; it does not make `ease` durable.
- `SURFACES`. The new panel is inside the coach surface, not a surface of its own.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` prints **24 asserted, 0 pending** — spec 4
  §12's checklist is closed, and the milestone with it.
- Coach shows six categories in the learner's own words, one sentence about
  direction, one about what is next, and an honest empty state on a fresh profile.
- Today names a repair target as an outcome, once a day, with no metric attached —
  and the session that follows really is built around it.
- The word "bluff" and the six codes appear nowhere a learner can read them.
- With the microphone denied, everything except `hesitation` still works.
- Turning rewinds off stops the interruption and nothing else.

## Commit

```
feat(coach): the repair layer, in the learner's own words (PLAN-037)
```

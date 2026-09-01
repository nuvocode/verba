---
id: PLAN-032
title: Waiting, and the praise economy
branch: plan/m6-repair-layer
base: master
status: todo
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/66
milestone: M6 · Repair layer
---

# PLAN-032: patience and praise

## Context

Spec §6.1 and §6.2. Two behaviours, one purpose: removing the tells that give away
that the learner is talking to a machine.

**Patience.** A person who asks you something waits. Software fills the silence —
after two seconds it offers a hint, after four a suggestion, after six it asks if
you need help. Every one of those is an interruption of the exact moment the learner
is doing the work, and it teaches them that thinking too long summons a rescue.

**Praise.** The single loudest tell is positive feedback after every sentence.
"Great!" after a sentence the learner knows was mediocre is worth less than nothing:
it proves nobody was reading. The default response to a correct sentence is to
*keep talking*, which is what a person does, and which is itself the approval.

Depends on PLAN-028 (the baseline the wait is derived from). Work on top of
PLAN-031's commit.

## Repo conventions

- **No new dependencies.**
- No timer in this plan may render a countdown, a spinner or a progress hint.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/patience.ts` | NEW | `waitMs`, `PATIENCE_STEPS`, the offer text rules |
| `src/lib/patience.check.ts` | NEW | the cases below |
| `src/lib/prompts.ts` | EDIT | the praise rules in `buildSystem`; `praise` in the turn schema |
| `src/lib/useTalk.ts` | EDIT | the wait timer, `HOLD` reset, the per-session praise cap |
| `src/views/Talk.tsx` | EDIT | nothing renders while waiting; the offer when it expires |
| `src/lib/settings.ts` | EDIT | `patience: "patient" \| "normal" \| "quick"` |
| `src/views/settings/Learning.tsx` | EDIT | the three-step control |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 10–12 |

## Specification

### How long to wait

```ts
export const PATIENCE_STEPS = { quick: 1.5, normal: 2.5, patient: 4 } as const;
export function waitMs(baseline: Baseline, step: keyof typeof PATIENCE_STEPS): number | null;
```

The wait is a multiple of **the learner's own median latency** (PLAN-028), which is
what makes it "noticeably longer than their own average" for every learner rather
than for the average one. Clamped to `[8_000, 90_000]` so a very fast learner is not
interrupted after five seconds and a very slow one does not wait forever.

`waitMs` returns `null` when the baseline is not ready. **A null wait means the coach
does not interrupt at all** — before Verba knows what normal is for this learner, it
has no business deciding they have stalled.

Default step is `normal`. The setting is three radio options in Settings → Learning,
labelled by behaviour ("waits a long time" / "waits" / "steps in sooner"), not by
number: the number is per-learner and printing it invites the learner to tune a
value that is not theirs to hold.

### While waiting, nothing

For the whole wait: no hint, no suggestion chips, no "need a hand?", no typing
indicator, no dots, no dimming, no shift of layout. The screen is exactly what it
was when the coach finished speaking.

This is mostly a deletion. `Talk.tsx` renders suggestions as soon as a turn lands;
they now appear only after the wait expires, or immediately when the learner has
already started typing — a learner who is mid-sentence has not stalled, and the
timer resets on input, as it does on mic activity.

### `HOLD` resets it

When PLAN-027's channel reports a learner `HOLD` — "one second", "let me think" —
the timer resets and the coach genuinely stays quiet. Not "waits a bit more":
resets, so the learner gets the full wait again from the moment they asked for it.
A second `HOLD` resets it again. There is no cap; a learner who keeps asking for
time is doing the thing this milestone exists to teach.

### The offer, when it expires

One line, offering and not imposing: *"want me to start you off?"* — and then it
waits again. It is a question, so a learner who ignores it is not helped anyway. It
appears at most twice per turn; after that the coach stays silent until the learner
says something.

### Praise needs a receipt

`buildSystem` gains an explicit rule, in the same register as the existing
"do NOT correct the learner inside reply":

> Do not praise the learner's language. Do not write "great", "well done",
> "excellent", "perfect", "nice job", or any equivalent. When the learner produces a
> correct sentence, the correct response is to answer what they said and keep the
> conversation moving. Praise is allowed **only** when you can point at something
> specific in the record below that they used to get wrong and just got right, and
> you must say what that thing was.

The record is supplied: `buildSystem` already receives `memories`, and now also
receives the last N `correction` labels for this learner. Praise without a
referenced record is not a style violation, it is a fabrication — the same class of
error as an invented metric, and treated the same way.

The turn schema gains `"praise": { "for": "the exact record referred to" }`, optional.
Verba gates it: if `for` does not match a record actually handed to the model, the
praise field is dropped and the reply is shown as-is.

**Cap: at most two per session.** Held in `useTalk`, enforced after the gate. Past
the cap the field is dropped silently — the coach's reply already stands on its own,
because the prompt asked for a reply that does not depend on the praise.

### Checks

`patience.check.ts`:
1. `waitMs` scales with the baseline median: doubling the median doubles the wait,
   inside the clamp.
2. `waitMs` respects the clamp at both ends.
3. `waitMs` returns `null` for an unready baseline, and the caller treats `null` as
   "never interrupt" — assert no offer is scheduled.
4. The three steps are ordered `quick < normal < patient` for every baseline.
5. A `HOLD` observation resets the deadline to a full wait from the moment it
   arrived; a second one resets it again.
6. Typing resets the deadline.
7. The offer fires at most twice per turn.
8. `praise` is dropped when `for` matches no supplied record — including a
   near-miss paraphrase of a real record.
9. The third praise of a session is dropped, and the reply is unchanged by the drop.
10. Source scan: `buildSystem` output always contains the no-groundless-praise rule,
    and the banned-word list is checked against a seeded violation so the scan
    cannot pass vacuously.
11. Source scan: `Talk.tsx` renders no suggestion, hint or helper element on any
    code path reachable while the wait is pending. Probed with a seeded violation.

## Do not touch

- The correction flow and its timing setting. Praise is not a correction.
- `confidence.ts`. Time spent thinking is not a confidence input, and this plan must
  not make it one.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` rows 10–12 asserted.
- Sitting silent in Talk for thirty seconds produces an unchanged screen and then
  one question.
- Saying "one second" and then thinking for a minute produces no interruption.
- A session of ten correct sentences produces at most two pieces of praise, each
  naming what it is about.

## Commit

```
feat(coach): a coach that waits, and praise that has to cite something (PLAN-032)
```

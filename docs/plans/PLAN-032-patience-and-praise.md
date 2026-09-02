---
id: PLAN-032
title: Waiting, and the praise economy
branch: plan/m6-repair-layer
base: master
status: done
executor: nuvocode
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
you need help. Every one of those interrupts the exact moment the learner is doing
the work, and it teaches them that thinking too long summons a rescue.

**Praise.** The single loudest tell is positive feedback after every sentence.
"Great!" after a sentence the learner knows was mediocre is worth less than nothing:
it proves nobody was reading. The default response to a correct sentence is to
*keep talking*, which is what a person does, and which is itself the approval.

Lands on top of PLAN-031's commit (`a250aae`). Depends on PLAN-028 for the baseline
the wait is derived from, and on PLAN-027 for the verified `HOLD` that resets it.

## Repo conventions

- **No new dependencies.**
- No timer in this plan may render a countdown, a spinner, or a progress hint.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/patience.ts` | NEW | `PATIENCE_STEPS`, `waitMs`, `OFFER_LINE`, `OFFER_CAP`, `PraiseGate` |
| `src/lib/patience.check.ts` | NEW | the cases below |
| `src/lib/prompts.ts` | EDIT | the praise rules in `buildSystem`; `praise` in the turn JSON; `parseTurn` |
| `src/lib/useTalk.ts` | EDIT | the wait timer, `HOLD` reset, the per-session praise cap |
| `src/views/Talk.tsx` | EDIT | nothing renders while waiting |
| `src/lib/settings.ts` | EDIT | `patience: "quick" \| "normal" \| "patient"`, default `"normal"` |
| `src/views/settings/Learning.tsx` | EDIT | the three-step control |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 10–12 |

`patience.ts` is pure by contract, the same contract `difficulty.ts` holds: no
provider, no `./db.ts`, no React, no settings screen. It takes a baseline and
values and returns milliseconds, a line, and a verdict.

## Specification

### How long to wait

```ts
export const PATIENCE_STEPS = { quick: 1.5, normal: 2.5, patient: 4 } as const;
export type PatienceStep = keyof typeof PATIENCE_STEPS;

export const WAIT_FLOOR = 8_000;
export const WAIT_CEILING = 90_000;

export function waitMs(baseline: Baseline, step: PatienceStep): number | null;
```

The wait is a multiple of **the learner's own median latency** — `Baseline.median`
from PLAN-028, which is already speech-corrected by `measuredLatency`, so it is
thinking time and not the coach's talking time. That is what makes the wait
"noticeably longer than their own average" for every learner rather than for the
average one.

Clamped to `[WAIT_FLOOR, WAIT_CEILING]`, and the floor is load-bearing: for a
median under about 5 s all three steps clamp to the same 8 s, and that is the
intended behaviour, not a bug to design around. **Never interrupt a learner inside
eight seconds** outranks the setting. So the ordering claim is
`quick <= normal <= patient`, non-strict, and strict only where the clamp is not
binding. A check that asserts strict ordering for every baseline is asserting
something false; write it as the two cases it really is.

`waitMs` returns `null` when `baseline.ready` is false. **A null wait means the
coach does not interrupt at all** — not "use a default". Before Verba knows what
normal is for this learner, it has no business deciding they have stalled. The
caller must schedule nothing on `null`; it is not a number with a fallback.

### When the clock starts

The wait begins **when the coach stops speaking**, not when the turn lands. The
turn lands while the coach is still talking; a timer armed there is eaten by TTS
and fires while the learner is still listening.

`say()`'s queue already knows the moment: it is where `playNext` finds the queue
empty and clears `speaking.current`. Arm there. When speech is off or unavailable
`say` returns without queueing anything and the coach never "stops speaking" — arm
at the turn instead. One helper, both call sites, no third rule.

A rewind is three clips (PLAN-030); the wait starts after the last of them, for the
same reason `spokeMs` sums all three.

### While waiting, nothing

For the whole wait: no hint, no suggestion chips, no "need a hand?", no typing
indicator, no dots, no dimming, no shift of layout. The screen is exactly what it
was when the coach finished speaking.

This is mostly a deletion. `Talk.tsx` renders `talk.suggestions` as soon as a turn
lands; the array stays exactly as it is — it is data, and PLAN-021's reveal machinery
reads it — and the *render* is gated on a new `talk.waiting`. Suggestions appear when
the wait expires, or at once when the learner has already started typing or holding
the mic: a learner mid-sentence has not stalled. Input resets the deadline and ends
the wait.

### `HOLD` resets it

When PLAN-027's channel reports a learner `HOLD` — "one second", "let me think" —
the deadline is re-armed at a **full** wait from the moment the HOLD landed, and the
turn's offer count goes back to zero. Not "waits a bit more": a full wait again. A
second `HOLD` resets it again, with no cap; a learner who keeps asking for time is
doing the thing this milestone exists to teach.

Only a `HOLD` that survived `verifyRepair` counts — the observation in
`repairs.current`, not `turn.repair`. A reported move the learner never wrote
changes nothing here, exactly as it changes nothing in the inventory (PLAN-027).

### The offer, when it expires

One line, offering and not imposing, and it is a coach line like any other:

```ts
export const OFFER_LINE: Record<string, string>; // the nine pack ids, as OWN_FALLBACK
export const OFFER_CAP = 2;
```

- Keyed by pack id with an `en` fallback, the same shape and the same nine locales
  as `OWN_FALLBACK`, and every entry must pass `bannedShape` — an offer that says
  "you seem stuck" points at the learner and is the thing this plan removes.
- It is a question, so a learner who ignores it is not helped anyway.
- It goes through `say()`, so its duration lands in `spokeMs` and the next turn's
  latency stays honest.
- It does **not** touch `prevCoachLine`. A REPEAT after an offer must repeat the
  sentence the conversation was about, not "want me to start you off?".
- It does not enter `history.current`, is not a message, and produces no signal.
- After it fires the deadline re-arms at a full `waitMs`. At most `OFFER_CAP` per
  turn; past that the coach is silent until the learner says something.

### Praise needs a receipt

`buildSystem` gains an explicit rule, in the same register as the existing
"do NOT correct the learner inside reply":

> Do not praise the learner's language. Do not write "great", "well done",
> "excellent", "perfect", "nice job", or any equivalent. When the learner produces a
> correct sentence, the correct response is to answer what they said and keep the
> conversation moving. Praise is allowed **only** when you can point at something
> specific in the record below that they used to get wrong and just got right, and
> you must say what that thing was.

The record is supplied. `buildSystem` already receives `memories`; it now also
receives the recent `correction` labels for this learner, read from the signals
`open()` already loads through the single door `signalLabel` — no second reader, and
no new query.

The turn JSON gains an optional `"praise": { "for": "the exact record referred to" }`.
Verba gates it:

```ts
export function praiseGate(
  praise: { for: string } | undefined,
  records: string[],
  usedThisSession: number,
): { keep: boolean };
```

- `for` must match a supplied record exactly, comparing on trimmed, case-folded
  text and nothing else. **No fuzzy matching, no substring, no paraphrase.** Praise
  without a referenced record is not a style violation, it is a fabrication — the
  same class of error as an invented metric, and treated the same way.
- **Cap: `PRAISE_CAP = 2` per session.** Held in `useTalk`, enforced after the match.
- A dropped praise drops the field only. `turn.reply` is passed through byte-identical,
  because the prompt asked for a reply that does not depend on the praise.

### Checks

`patience.check.ts`:

1. `waitMs` scales with the baseline median: doubling the median doubles the wait,
   at a median well inside the clamp.
2. The clamp holds at both ends — a very fast learner is not interrupted before
   `WAIT_FLOOR`, a very slow one not after `WAIT_CEILING`.
3. `waitMs` returns `null` for an unready baseline, for every step. Assert `null`
   and not a number, so a "sensible default" cannot creep in.
4. Ordering, as the two cases it is: `quick <= normal <= patient` for every
   baseline, **strictly** increasing for a median above the floor, and all three
   equal to `WAIT_FLOOR` for a median below it.
5. A verified `HOLD` re-arms a full wait from the moment it arrived and zeroes the
   turn's offer count; a second one does it again. An unverified reported `HOLD`
   changes neither.
6. Learner input ends the wait and shows the suggestions.
7. The offer fires at most `OFFER_CAP` times per turn, re-arming a full wait between
   them, and never a third time.
8. Every `OFFER_LINE` locale exists for all nine pack ids and passes `bannedShape`.
9. `praiseGate` drops a `for` that matches no record — including a near-miss
   paraphrase of a real one, and a substring of a real one.
10. The third praise of a session is dropped, and `reply` is byte-identical either way.
11. Source scan: `buildSystem`'s output always contains the no-groundless-praise rule
    and the banned-word list. Probe it against a seeded violation, in `tmpdir()`, so
    the scan cannot pass vacuously.
12. Source scan: `Talk.tsx` renders no suggestion, hint, or helper element on a path
    reachable while the wait is pending. Seeded violation, `tmpdir()`.

Ledger markers: `patience ledger 10`, `patience ledger 11`, `patience ledger 12`.

**On the checks themselves.** Every case above must fail when its rule is removed.
Cases 5, 7 and 10 are the ones with a habit of passing vacuously — assert against
the value the production path actually produces, not against a hand-built fixture
that bypasses the timer or the gate.

## Do not touch

- The correction flow and its timing setting. Praise is not a correction.
- `confidence.ts`. Time spent thinking is not a confidence input, and this plan must
  not make it one.
- `spokeMs` / `speakGeneration` accounting (PLAN-028/030). The offer adds to the
  floor through `say`; nothing else about the measurement moves.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` rows 10–12 asserted.
- Sitting silent in Talk for thirty seconds produces an unchanged screen and then
  one question.
- Saying "one second" and then thinking for a minute produces no interruption.
- A session of ten correct sentences produces at most two pieces of praise, each
  naming what it is about.
- A first session, with no baseline yet, produces no offer at all.

## Commit

```
feat(coach): a coach that waits, and praise that has to cite something (PLAN-032)
```

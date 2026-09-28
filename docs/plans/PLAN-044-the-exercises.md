---
id: PLAN-044
title: The four exercises — planning time, 4/3/2, the pressure ladder, and naming what was dodged
branch: plan/m7-fluency
base: PLAN-043
issue: "#74"
spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §5
ledger: FLUENCY_LEDGER rows 7, 8
status: done
---

# PLAN-044 — The exercises

PLAN-043 produced the first `MonitorContext.mode`. This plan produces the other
three fields — `planningTimeSec`, `taskRepetition`, `interlocutorPressure` — which
is to say it produces **both sides of every comparison PLAN-045 will make**. Until
this lands, the profile has one condition and nothing to compare it against.

Four exercises, and they are not four machines. Every one of them is the same
`MonitorContext` builder pattern PLAN-043 established: a pure function that turns
a choice into a context, handed to `start`'s sixth parameter. No new
`ActivityKind`, no new table, no new session machinery.

## 0. The two things that will go wrong

**One: shipping `falseAlarmRepair` to a screen.** §5.2 says the 4/3/2 card shows
three numbers, and the third is `falseAlarmRepair`. PLAN-041 left its
`## Hand sample` section **blank on purpose** — ledger row 2 is not honest until a
human has sat with twenty real turns, and the bar written there is that if a human
disagrees with more than a fifth of the surviving `falseAlarm`s, the metric does
not reach a screen. This plan is the first one that would put it on one.

So: **the 4/3/2 card ships with two numbers, not three.** `speechRate` and
`meanLengthOfRun` are measured; the accuracy column renders only once the hand
sample is filled in. The card says the column is not there yet rather than
inventing it — the same "absent, never zero" rule, applied to a whole column. The
check pins it: the card's third column is gated on a constant that PLAN-041's hand
sample flips, and the constant is `false` until then.

**Two: a mid-session change of conditions, silently filed as a measurement.**
§5.3's fourth rung must be leavable with one key. If leaving it rewrites the
session's context, PLAN-043's ledger row 6 — one mode, one writer, written once —
is broken, and worse, the session is filed as if it ran under conditions it did
not. See §4.

## 1. §5.1 — planning time

Every conversation task starts with a planning parameter: **0 / 30 / 60 seconds**.

- During planning the screen shows **the topic and a countdown, and nothing else**.
  There is no notes field: written preparation destroys the thing being measured.
- The system walks the same learner 60 → 30 → 0 over time.

### The screen

A `Planning.tsx` beside `Contract.tsx`, and the absence of the notes field is a
**checkable** invariant, not a promise in a comment: the component contains no
`<input`, no `<textarea`, no `contentEditable`, and the check asserts all three.
That is the same treatment the contract's "no persisted key" got, and for the same
reason — an absence nobody can see is an absence nobody maintains.

The countdown is PLAN-043's `setTimeout` chain, not an interval. That lesson is
already paid for: an interval left running holds a handle for the length of the
session and hangs any check file that drives a real one.

### The progression

```ts
// src/lib/fluency.ts
/**
 * The planning time this learner gets next (§5.1). 60 → 30 → 0, moved down after
 * two sessions at a rung, and never moved back up on its own: the walk down is
 * the exercise. `past` is this learner's planning times, most recent first.
 *
 * With no history the answer is 60 — the most support, not the least. A learner
 * with nothing recorded is not a learner who needs no planning time.
 */
export function nextPlanningSec(past: number[]): 0 | 30 | 60;
```

Two consecutive sessions at 60 ⇒ 30. Two at 30 ⇒ 0. Anything else holds. Pure
arithmetic over the `sessionContext` signals already on the record — no new
storage, and PLAN-045 reads the same signals to measure the difference the walk
was for.

## 2. §5.2 — 4/3/2, the layer's main exercise

The learner tells one topic in four minutes, then the same topic in three, then in
two. Three rounds, one topic.

### Three sessions, not one

The signals are per-activity. Three rounds that must be shown side by side are
three `activityId`s, so 4/3/2 is **three consecutive sessions sharing a topic**,
with `taskRepetition` 1, 2, 3. Nothing new is needed to store that — the existing
`sessionContext` signal already carries the field, and the card groups by
`activityId` out of `recentSignals`.

The round's context:

| Round | minutes | `taskRepetition` | `topicFamiliarity` | `interlocutorPressure` |
|---|---|---|---|---|
| 1 | 4 | 1 | `novel` | `none` |
| 2 | 3 | 2 | `prepared` | `paced` |
| 3 | 2 | 3 | `prepared` | `paced` |

Rounds 2 and 3 are `prepared` because the learner has now told this topic once —
that is the whole point of the exercise, and calling them `novel` would be filing
a false condition. `paced` is what the shrinking clock is: this is the third value
of the pressure union, and this exercise is what it was for.

`ponytail:` the exercise's three activity ids live in React state for the length of
the exercise. Close the app mid-exercise and the exercise is lost, not corrupted —
the finished rounds keep their own signals. A resumable exercise is a table, and it
is not worth one until a learner asks for it.

### The listener

§5.2: the listener attends with **the same interest** each round and never says
"you already told me this". One prompt constant, the `FLUENCY_RULE4` treatment:

```ts
export const REPETITION_RULE =
  "The learner is telling you this topic again, on purpose, to tell it better. Listen as if for the first time. Never say that they already told you, never say it is shorter or faster, and never compare this telling to the last one.";
```

Asserted present in the prompt rounds 2 and 3 send, and **absent** from round 1's —
a rule about repetition in a prompt with nothing to repeat is noise.

### The card — ledger row 7

Shown after round 3, three rows side by side:

| | round 1 | round 2 | round 3 |
|---|---|---|---|
| words per minute | | | |
| words per run | | | |
| ~~accuracy~~ | *(withheld — see §0)* | | |

Every number carries its unit and its definition (invariant 12). A round whose
`timing` signal is missing — nothing spoken, no envelope — renders **empty, not
zero**: an unmeasured round did not score nothing, it was not measured.

The expected result is stated on the card as what the exercise is testing, not as
what happened: speed up, pause less, and **accuracy does not fall**. With the third
column withheld, the card says the third claim is the one it cannot show yet. It
does not imply it.

## 3. §5.3 — the pressure ladder

Four rungs. **The learner picks; the system never pushes.** §5.3's table, as data:

```ts
// src/lib/fluency.ts
/** §5.3's four rungs, as the contexts they are. The table is the spec's table. */
export function rungContext(rung: 1 | 2 | 3 | 4): MonitorContext;
```

| Rung | Condition | `planningTimeSec` | `topicFamiliarity` | `interlocutorPressure` |
|---|---|---|---|---|
| 1 | prepared topic, planning time, patient interlocutor | 60 | `prepared` | `none` |
| 2 | prepared topic, no planning | 0 | `prepared` | `none` |
| 3 | new topic, no planning | 0 | `novel` | `none` |
| 4 | new topic, the other side speaks fast and politely interrupts | 0 | `novel` | `interrupting` |

Rung 4 is only offered when the learner asks for it in as many words, and §5.3's
last line is a product rule with teeth: **a session does not have to end on the
highest rung.** When rung 4 is left, the session continues at rung 3's conditions
rather than ending — the learner gets to finish somewhere they can stand.

## 4. Leaving rung 4 — the design question this plan turns on

One key leaves rung 4 (ledger row 8). The coach stops interrupting immediately.
And then the session's conditions are no longer what its context says.

Three ways to handle it, and only one is honest:

- *Rewrite the context.* Breaks PLAN-043's one-writer invariant, and files a
  session as "interrupting" that spent half its length not being interrupted.
- *End the session.* The spec asks for an exit, not a punishment.
- **Withhold the measurement.** The pressure stops, the conversation continues,
  and the session writes **no `sessionContext` signal at all** — which, through the
  existing gate, means it writes no monitor signal at all.

The third. A session whose conditions changed under it is not a measurement of
either condition, and filing it as one corrupts both sides of every comparison
PLAN-045 makes. It costs one ref:

```ts
// src/lib/useTalk.ts
// PLAN-044 §4: the session's conditions stopped being what its context says.
// `end()` then passes `context: null` — the same door the kill switch uses, so
// no monitor signal is written for a session that is not comparable to anything.
const conditionsBroken = useRef(false);
```

`sessionContext.current` is **not** rewritten — row 6's invariant holds byte for
byte, and the check that pins the two writers keeps passing without an exception
carved into it. The learner loses nothing they can see; the record loses a row it
was never entitled to.

## 5. §5.4 — naming what was dodged

When avoidance is high, the coach puts the target structure on the table **before**
the task, out loud: *"I picked a topic this time where you'll need the past tense.
Getting it wrong is fine — not building it is the problem."*

This reads PLAN-042's `avoidance` signals, and every one of them carries
`judged: true` — a model's opinion with no transcript behind it. PLAN-042 said the
consequence plainly: a higher bar than a measured signal. So the gate is written
here, conservatively, and PLAN-045 inherits **this** door rather than opening a
second one:

```ts
// src/lib/fluency.ts
/**
 * Whether the coach names a structure out loud before the task (§5.4).
 *
 * Three `avoidance` signals for the same label, across at least three different
 * sessions. The bar is higher than a measured signal's because every avoidance
 * signal is `judged: true` — a model's opinion about something that did not
 * happen, with nothing in the transcript behind it (PLAN-042 §4). One opinion
 * repeated three times in one session is one opinion; three sessions is a pattern.
 *
 * Returns the label to name, or null. Null is the normal answer, and the coach
 * says nothing at all — never a hedge, never "you may have been avoiding".
 */
export function goalToName(signals: Signal[], label: string): string | null;
```

The sentence itself is one prompt constant with §6.3's shape rules on it: it names
the structure, it says getting it wrong is fine, and it never characterises the
learner. No adjectives, no "you tend to", no comparison.

## 6. Entry

All four ride PLAN-043's armed-mode pattern on the Talk picker — one row of
choices, applied when the learner picks a scenario. No new screen except
`Planning.tsx`, and no new `ActivityKind`.

- **Planning time** is not a separate exercise: every task starts with it, and the
  value comes from `nextPlanningSec`. The learner may override it on the entry row.
- **4/3/2** arms the three-round runner.
- **The ladder** is four buttons; the fourth carries its own confirm, in the
  learner's words rather than a warning.

## 7. Files

| File | Change |
|---|---|
| `src/lib/fluency.ts` | `nextPlanningSec`, `rungContext`, `fourThreeTwoContext`, `goalToName`, `FOUR_THREE_TWO_MINUTES`, `FALSE_ALARM_ON_SCREEN` (false) |
| `src/lib/prompts.ts` | `REPETITION_RULE`, the §5.4 naming sentence |
| `src/lib/useTalk.ts` | `conditionsBroken` ref + `leaveRung4()`, the repetition rule in `start` |
| `src/views/talk/Planning.tsx` | NEW — topic + countdown, and nothing else |
| `src/views/talk/Rounds.tsx` | NEW — the 4/3/2 side-by-side card |
| `src/views/Talk.tsx` | the entry row, the runner's three rounds, rung 4's one-key exit |
| `src/lib/fluency.check.ts` | sections 22–26 |
| `src/lib/invariants.check.ts` | rows 7, 8 asserted |

## 8. Checks — sections 22 to 26

**22 — `nextPlanningSec`.** No history ⇒ 60. One session at 60 ⇒ 60. Two ⇒ 30.
Two at 30 ⇒ 0. Zero never walks back up on its own. A history of mixed values holds
rather than guessing.

**23 — `rungContext` is §5.3's table.** All four rungs, every field, asserted
against the spec's four rows. Rung 4 is the only `interrupting` one; rungs 1–3 are
`none`.

**24 — the 4/3/2 rounds.** Three contexts, `taskRepetition` 1/2/3, rounds 2 and 3
`prepared` and `paced`, round 1 `novel` and `none`. `REPETITION_RULE` is in rounds
2 and 3's prompt and **not** in round 1's. A round with no `timing` signal renders
empty, not zero. `FALSE_ALARM_ON_SCREEN === false` — pinned with the reason, so
flipping it is a deliberate act tied to PLAN-041's hand sample. *fluency ledger 7*

**25 — leaving rung 4.** `leaveRung4()` sets `conditionsBroken`; `end()` then
passes `context: null` and `talkSignals` writes no monitor kind at all — asserted
through `talkSignals`, the same way the kill switch is. And `sessionContext.current`
is **unchanged** after leaving: PLAN-043's two-writer scan still finds exactly two
writers. *fluency ledger 8*

**26 — `goalToName`.** Three signals, same label, three sessions ⇒ the label. Three
signals in one session ⇒ null. Two sessions ⇒ null. A different label each time ⇒
null. No signals ⇒ null. The bar is asserted as three *sessions*, not three rows.

## 9. Ledger

Rows 7 and 8 move to `assertedIn`. Eleven of thirteen closed; rows 9 and 10 belong
to PLAN-045 and PLAN-046.

## 10. Fixup decisions (post-review)

Three things the plan left open, and what the review settled them as.

**The walk's input is the walk's own record.** `nextPlanningSec` reads
`planningTimeSec` off past `sessionContext` signals — but *every* session files
that field, and an ordinary conversation, a 4/3/2 round and the ladder's rungs
2–4 all file `0`. A `0` on the record is indistinguishable from a `0` the walk
handed out, so counting them pinned every learner at 0 for good after their first
exercise ("zero never walks back up"). The caller filters to `> 0`: what remains
is the record of the sessions that actually had a planning door. Once the walk
reaches 0 its head stays `[30, 30, …]` and the answer is 0 and stays 0 — the rung
it walked to.

**§5.3's table sets the ladder, not the walk.** Rung 1 is 60 seconds because the
table says 60. Letting the derived walk set it turned rung 1 into rung 2 the
moment the walk reached 0 — silently, with §23 still green, because §23 tests the
pure function and the caller was overriding it.

**A `paced` context with no clock is withheld, not relabelled.** `paced` is the
shrinking clock; a round that never armed one measured no tempo. §4 already
answered this shape for rung 4 and its answer holds here: *withhold the
measurement*. Rewriting the context on the way out — filing the session as
`none` — is the option §4 rejected, and it is the same rewrite whether it happens
to the ref or to a copy on its way into the signal.

**And the clock has to actually tick.** Arming `fluencyUntil` for a round is not
a clock: the countdown effect was gated on `mode === "fluency"`, so a round armed
a deadline nothing counted down, and `paced` was filed with no tempo behind it.
The gate is the timed flag now — fluency mode *or* a round's minutes — the
composer closes when a round's time is up, the learner sees the round's banner,
and a round is never extended: its length is the exercise.

## Do not touch

- `sessionContext.current`'s two writers. §4 exists precisely so this stays true.
- PLAN-043's `showInline`, `closingItems`, and the contract's single-caller scan.
- `FREE_CONTEXT`. Still the baseline every unconditioned session is compared to.
- PLAN-041's blank `## Hand sample`. This plan does not fill it and does not route
  around it.

## Deliberately not built

- **A resumable 4/3/2.** The exercise lives in React state. See §2's `ponytail:`.
- **An automatic ladder.** §5.3 says the learner picks and the system does not
  push. No suggestion, no nudge, no "ready for rung 3?".
- **A 3/2/1 variant.** §5.2 offers it; one ratio is enough until a learner asks,
  and `FOUR_THREE_TWO_MINUTES` is the one constant that would change.
- **The comparison itself.** Measuring the difference the 60 → 30 → 0 walk makes is
  §3, and §3 is PLAN-045.

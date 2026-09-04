---
id: PLAN-031
title: One axis, never announced
branch: plan/m6-repair-layer
base: master
status: done
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/65
milestone: M6 · Repair layer
---

# PLAN-031: controlled difficulty

## Context

Spec §5. Repair is only learned when something breaks, and in a well-behaved
language app nothing ever does. Every sentence arrives at the learner's exact level,
at teaching pace, in the words they were expecting. So breakage has to be produced —
deliberately, in one dimension at a time, and without saying so.

The target is *a few* breakdowns per session. Zero means the coach is being polite;
every turn means the learner is drowning and will stop coming back.

Lands after PLAN-030 on purpose. Manufacturing breakdowns before the rewind is kind
is just making the app harder.

## Repo conventions

- **No new dependencies.**
- Nothing about difficulty appears on any surface, ever. This is the one plan whose
  correctness is partly defined by what it does *not* render.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/difficulty.ts` | NEW | axes, `pickAxis`, `calibrate`, `axisGuidance` |
| `src/lib/difficulty.check.ts` | NEW | the cases below |
| `src/lib/prompts.ts` | EDIT | `buildSystem` takes the active axis |
| `src/lib/useTalk.ts` | EDIT | pick at session start, calibrate at end, honour the ask |
| `src/lib/settings.ts` | EDIT | `difficultyStep` — persisted, invisible |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 15–17 |

## Specification

### The axes

```ts
export const AXES = ["pace", "vocabulary", "length", "structure", "direction"] as const;
export type Axis = (typeof AXES)[number];
```

- **pace** — normal conversational tempo, not teaching tempo.
- **vocabulary** — one word above the learner's level, inferable from context.
- **length** — two or three sentences in one turn instead of one.
- **structure** — a construction they can understand but cannot yet produce.
- **direction** — the conversation leaves the answer the learner had ready.

`pickAxis(inventory, history, level)` returns **exactly one** for the session, or
`null`. `null` is a real answer and must stay reachable: a learner below
`BASELINE_MIN` measured turns (PLAN-028), a learner whose last session drowned, and
a learner who asked not to be pushed all get a session with no axis at all.

Selection rotates rather than optimising — the last two sessions' axes are excluded,
so a learner does not spend a fortnight being spoken to quickly. `pace` is skipped
when there is no working TTS: an axis that cannot be applied must not be chosen, the
same rule PLAN-036 applies to listening grades.

### The step

`settings.difficultyStep`, an integer `0..4`, default `0`. It is persisted because
it is a fact about the learner, and it appears in **no settings screen** — there is
no control for it, because §5.2's calibration is the control.

`axisGuidance(axis, step)` returns the sentence appended to `buildSystem`. It is
written for the model, not for the learner, and `buildSystem` gains one hard rule
beside it: *never comment on the difficulty of the conversation, never announce that
you are making it harder or easier, and never ask the learner whether it was too
hard.* §5.2's last line, at the prompt level, where it can actually hold.

### Calibration

`calibrate(step, session)` runs once, at the end of a session, over that session's
turn verdicts:

- **two consecutive sessions with zero breakdowns → `step + 1`.** Two, not one: a
  single easy session is more likely to be a short session than a learner who has
  outgrown the level.
- **a session where breakdowns left the learner unable to speak → immediate drop.**
  "Unable to speak" is defined, not judged: at least half the learner's turns in the
  session carried two or more breakdown signals, over at least four turns. This one
  does not wait for the end of the session — `useTalk` re-checks it per turn, and
  on a hit sets the session's axis to `null` for the remainder and drops
  `difficultyStep` immediately, both without a word.
- otherwise unchanged.

The consecutive-zero counter lives with the session record, not in settings: it is
derivable from the last two sessions' signals, and a stored counter would be a
second copy of that.

### "Do not push me today"

Reachable two ways, and both must work:

- the learner says it in the conversation — the turn JSON gains `"ease": true`,
  reported when the learner asks for an easier session in any wording;
- ⌘K, which already routes intents, gains the same command so it works with no mic
  and no ambiguity.

Effect, unconditionally: the axis becomes `null` for the rest of that session, and
PLAN-029's `budget.off` is set so no rewind interrupts. It **does not persist** —
not to `settings`, not anywhere — because §5.3 says the request is for that session.

What does persist is that it happened, as a `lexicalItem`-style note on the day's
record, so §5.3's last clause holds: if a learner asks this most days, Coach can see
that pattern and say something about it. That is a Coach conversation, not a switch.

### Checks

`difficulty.check.ts`:
1. `pickAxis` returns at most one axis, ever — assert over 200 seeded profiles.
2. `pickAxis` returns `null` below `BASELINE_MIN`, after a drowned session, and after
   an ease request.
3. `pickAxis` never returns the axis used in either of the last two sessions.
4. `pickAxis` never returns `pace` when TTS is unavailable.
5. `calibrate` needs two consecutive zero-breakdown sessions to raise the step; one
   does not.
6. The drowning rule fires at half of turns over four turns, and not at three turns.
7. The drop is immediate: `calibrate` is not what applies it — assert the in-session
   path sets the axis to `null` on the turn the rule trips.
8. An ease request sets `off` and clears the axis, and `settings.difficultyStep` is
   byte-identical before and after.
9. Source scan: no `.tsx` file reads `difficultyStep` or `Axis`; no user-facing
   string in the repo contains an announcement of difficulty change. The scan is
   probed with a seeded violation.
10. `buildSystem` output contains the no-announcement rule whenever an axis is active.

## Do not touch

- The level system. `difficultyStep` is not a level and must not feed
  `levelEstimateFrom`, `levelOf`, or anything the learner reads as their level.
- Read, Listen and Memory. This plan's axes apply to the conversation; PLAN-036 owns
  listening's own variables.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` rows 15–17 asserted.
- Two easy sessions in a row are followed by a noticeably harder third, with nothing
  said about it.
- A session that goes badly gets easier within it, not after it.
- "Don't push me today" works, in the conversation and from ⌘K, and is forgotten
  tomorrow.

## Commit

```
feat(repair): one difficulty axis a session, calibrated and never announced (PLAN-031)
```

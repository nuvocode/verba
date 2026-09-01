---
id: PLAN-034
title: Rehearsal — play the other side, then step out
branch: plan/m6-repair-layer
base: master
status: todo
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/67
milestone: M6 · Repair layer
---

# PLAN-034: rehearsal mode

## Context

Spec §7.1. The one feature in M6 the learner will ask for by name.

What holds an adult learner is not a streak. It is that tomorrow, at 10:00, they
have to explain a delay to a supplier in a language they are not confident in, and
tonight they can practise exactly that. Everything else in Verba is training;
rehearsal is the reason the training was worth it.

Two rules make it work, and both are about *not* being a lesson:

- **The difficulty axes are off.** PLAN-031 exists to manufacture breakdowns.
  Manufacturing one in a rehearsal is sabotaging a dress rehearsal for practice.
- **Role-play and feedback are separated.** The coach plays the other side straight,
  in role, without teaching — and then stops, steps out, and talks about it. A coach
  who corrects grammar mid-role-play is not the supplier, and the rehearsal stops
  being one.

Depends on the Talk loop as PLAN-033 leaves it. Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- Rehearsal reuses Talk's loop. A parallel conversation implementation is the wrong
  answer to every question this plan raises.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/rehearsal.ts` | NEW | `RehearsalBrief`, `rehearsalSystem`, `debriefPrompt`, parse |
| `src/lib/rehearsal.check.ts` | NEW | the cases below |
| `src/lib/useTalk.ts` | EDIT | rehearsal mode: no axes, two phases |
| `src/views/Talk.tsx` | EDIT | the brief, the phase change, the debrief |
| `src/lib/keys.ts` | EDIT | the rehearsal entry and the "end the role-play" key |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` row 18 |

## Specification

### The brief

Three short questions, one screen, all optional except the first:

```ts
export interface RehearsalBrief {
  who: string;      // "my landlord", "a customer at work"
  about: string;    // "the boiler that has not been fixed"
  formality: "casual" | "neutral" | "formal";
}
```

Free text, no list of scenarios to pick from — the whole premise is that the
conversation the learner needs is not in our catalogue. It is entered once and shown
at the top of the session, so a learner returning to a half-finished rehearsal knows
what they were preparing for.

### Phase one: in role

`rehearsalSystem(brief, settings, pack)` builds a system prompt that is emphatically
not the tutor prompt:

- the coach **is** the other party, and stays in role;
- no corrections, no suggestions, no goals — the turn JSON for this phase carries
  `reply` and nothing else, and `parseTurn` is not the parser used;
- difficulty axes are absent from the prompt entirely (not set to a low value —
  absent), and `useTalk` asserts `axis === null` in rehearsal mode;
- the other party is realistic, which means they may be brisk or unhelpful, but they
  are never a test: no trick questions, no deliberate obscurity.

Breakdown detection and the repair inventory **stay on**, because a rehearsal is
where the learner most needs to hear themselves not ask for repair. Rewinds stay
available and are the coach stepping out for a moment, in the same calm marker
PLAN-030 defines. The signals are real signals and feed the profile like any others
— §7.1's last line.

### Phase two: out of role

One control, and one key, to end the role-play — the learner decides when it is
over. Then the coach steps out explicitly ("okay, out of role") and the debrief
arrives as its own block:

```
{
  "stuck": [ { "moment": "when they asked about the deposit", "why": "..." } ],
  "phrases": [ "...", "...", "...", "...", "..." ]
}
```

- **stuck** — where the learner ran aground, from what actually happened in the
  conversation: a rewind, a bluff verdict, a long silence, a turn they abandoned.
  Every entry must reference a turn that exists; one that does not is dropped.
- **phrases** — exactly five, in the target language, usable in *that* conversation,
  not five generic phrases about the topic. Fewer than five parses fine and shows
  what there is; more are truncated.

The five phrases are offered to Memory through the existing vocab save path — the
learner chooses, nothing is auto-saved.

### What it is not

Not a new surface, not a new route, not a new activity kind in the plan. It is Talk
opened in a different mode, entered from Today's overflow and from ⌘K. If the
implementation is adding `"rehearsal"` to `ActivityKind` and a card to the day's
plan, it has gone wrong: this is something the learner reaches for when life
demands it, not something Verba schedules for them.

### Checks

`rehearsal.check.ts`:
1. `rehearsalSystem` contains no correction instruction, no suggestion instruction,
   and no difficulty guidance — asserted by absence of each marker string.
2. In rehearsal mode `pickAxis` is never called, and the session's axis is `null`.
3. The in-role parse ignores a `corrections` array the model sends anyway.
4. The debrief drops a `stuck` entry referencing a turn index that does not exist.
5. `phrases` is capped at five and passes fewer through unchanged.
6. Rehearsal turns produce the same signal kinds as a normal session — assert a
   `repairMove` and an `unpromptedTurn` both land.
7. Source scan: `ActivityKind` is unchanged, and no plan builder emits a rehearsal
   activity.
8. `keysFor("talk")` announces the end-role-play key only in rehearsal mode, and the
   announced count equals the working count (invariant 23 still holds).

## Do not touch

- `ActivityKind`, `buildDailyPlan`, and Today's card list.
- The scenario catalogue. Rehearsal does not add a scenario.
- PLAN-031's calibration: a rehearsal session must not feed the consecutive-zero
  counter, because an axis was never active in it.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` row 18 asserted.
- A rehearsal about a plumber stays in role until the learner ends it, then produces
  five phrases that mention the boiler.
- Nothing is corrected while in role.
- The rehearsal's signals show up in Coach the next day.

## Commit

```
feat(talk): rehearsal — the coach plays the other side, then steps out (PLAN-034)
```

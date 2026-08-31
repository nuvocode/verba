---
id: PLAN-021
title: Talk — subtitles you can hide, and asking for them costs nothing
branch: plan/m5-surface-contracts
base: master
status: ready
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/79
milestone: M5 · Surface contracts
---

# PLAN-021: subtitles you can hide

## Context

Talk prints every coach line while it speaks it. A learner who means to practise
listening reads instead, and never notices they made the trade — there is no moment
where they chose. Listen has the same control in the opposite direction (transcript
closed by default, opening it marks the signal assisted); Talk needs it with
subtitles **on** by default, because reading along is the right starting point for
most people and hiding is the deliberate step up.

The requirement that shapes the design: **revealing must be free.** If asking for
the text feels like a failure, the learner freezes rather than asks — which is the
exact behaviour the repair layer (`docs/plans/4-verba-repair-katmani-spec.md` §8)
exists to remove. So: recorded, never scored, never surfaced as a penalty, and one
control that is always there — not a menu, not a long-press.

Depends on PLAN-018 (the composer's draft is the learner's own text and is never
hidden; only the coach's lines are). Work on top of PLAN-020's commit.

## Repo conventions

- **No new dependencies.**
- The setting persists in `Settings` (the existing `localStorage`-backed store), not
  in component state — §2.2's "oturumlar arasında sıfırlanmaz".
- Every shortcut goes in `src/lib/keys.ts` and nowhere else, so announced === working
  stays true by construction (invariant 23).
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/settings.ts` | EDIT | `Settings`, `defaultSettings` |
| `src/lib/keys.ts` | EDIT | new `talk` shortcut |
| `src/lib/signals.ts` | EDIT | `revealSignal` |
| `src/views/Talk.tsx` | EDIT | the message stream, the composer bar |
| `src/lib/signals.check.ts` | EDIT | new cases |

## Specification

### The setting

```ts
subtitles: boolean; // default true — the coach's lines are shown as they are spoken
```

One flag, both talking modes (free conversation and role-play). Two flags would be
two things to find; the spec asks for the control, not for per-mode memory.

It appears in **Settings → Learning** as a labelled row, and in Talk as the live
control below — the same fact, one home each, no third place (invariant 25).

### The control

In the composer bar, permanently visible, beside the mic:

- reads `Subtitles on` / `Subtitles off`, as a labelled toggle — not a bare icon;
- keyboard: `s` on the `talk` surface, added to `KEYS` with
  `does: "show or hide subtitles"`. Single-letter, so it stands down while the input
  has focus — which `live()` already guarantees;
- toggling writes the setting immediately.

### What hiding hides

- Hidden: the text of coach messages in the stream, and the streaming bubble.
- **Not hidden**: the learner's own messages, the composer, corrections, the
  suggestion rail, the persona name, the goal rail. A learner must always be able to
  see what *they* said.
- The coach voice, the mic, and every other affordance keep working unchanged.
  Hiding subtitles is not a mode; it is a curtain over one column.

With subtitles off, each coach message renders a compact placeholder that says the
message exists and offers the reveal — a full-width bar reading
`Coach spoke · Show this line`, plus a global `Show all` in the bar. Both are
reachable by keyboard, both are the same free action.

### The signal

```ts
/** A comprehension signal marked assisted. Recorded, never scored. */
export function revealSignal(activityId: ActivityId, what: "line" | "all"): SignalDraft;
```

Payload: `{ kind: "comprehension", assisted: true, source: "talk-subtitles" }` with
a definition string ("you asked to see the coach's text").

Where it must **not** appear:

- not in `confidence()` (PLAN-019) — assert this;
- not in Coach's six metrics as a negative term;
- not in any "win" or headline.

`signals.check.ts` asserts the first two by construction: `confidence.ts` does not
import it, and `coachmetrics.ts` filters `assisted` reveals out of its accuracy term
rather than counting them against it.

### Copy

The reveal never apologises for the learner and never congratulates them for waiting.
`Show this line` and `Show all` are the whole vocabulary. The Settings row explains
what the toggle does in one sentence and states plainly that asking for the text is
recorded and costs nothing.

### Checks

`signals.check.ts`:
- `revealSignal` carries `assisted: true` and a definition;
- a source scan: `confidence.ts` does not reference reveals;
- `coachmetrics.ts` excludes assisted reveals from every metric it computes (feed it
  a signal set with and without reveals; the six metrics are identical).

## Do not touch

- Listen's transcript toggle. It is the mirror of this and PLAN-026 owns it.
- `src/lib/db.ts` schema.
- The persona, the goals, the corrections rendering.
- No new dependency.

## Acceptance

- `npm run check` green.
- Subtitles are on for a new install; turning them off survives quitting the app.
- `s` toggles them, and the hint line announces exactly one new shortcut.
- Revealing a line writes one assisted comprehension signal and moves no number the
  learner can see.

## Commit

```
feat(talk): subtitles you can hide, and asking for them costs nothing (PLAN-021)
```

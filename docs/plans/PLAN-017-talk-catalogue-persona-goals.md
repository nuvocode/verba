---
id: PLAN-017
title: Talk — the catalogue sorts itself, the persona holds, the goals are real
branch: plan/m5-surface-contracts
base: master
status: done
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/55
milestone: M5 · Surface contracts
---

# PLAN-017: catalogue, persona, live goals

## Context

§2.2's first three blocks, none of which the screen keeps today.

**The catalogue.** `Scenario.level` is already a `[from, to]` band and `Talk.tsx`
prints it as `A2–B2`, but every scenario sits in one flat `grid3`. A B2 learner is
offered the A1 restaurant next to the C1 interview, with nothing to say which is
which. Learner-made scenarios (`origin: "imported"`) look exactly like bundled ones,
and the only thing that can be done to one is delete it — from Settings, not from here.

**The persona.** `Scenario.setup` describes a role ("You are a waiter"), and that is
all. The coach has no name, no face, and its voice is whatever the TTS tier hands
back — which can change mid-session when a tier falls back. §2.2: "isim, rol, avatar
ve ses birbiriyle uyumlu olur ve oturum boyunca değişmez."

**The goals.** `Talk.tsx` line ~430:

```tsx
// ponytail: goals tick off by turn count. Real per-goal detection
// needs another model call per turn — not worth it for a side rail.
const hit = talk.userTurns > i;
```

That comment was right when a side rail was decoration. It is wrong now: §2.2 calls
the nine-item static list unacceptable and asks for pending / met / missed, ticking
the moment the learner meets one, and the reflection (PLAN-020) reports a scorecard
built on it. The way out is not a second call per turn — it is one more field on the
reply the coach is already returning.

Depends on PLAN-016. Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- `src/lib/scenarios.ts` stays pure data + validation, no React, no Tauri.
- A bundled scenario is never mutated in place. "Edit a bundled scenario" means
  duplicate-then-edit, and the duplicate is an import like any other.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/scenarios.ts` | EDIT | `Scenario`, `BUNDLED_SCENARIOS`, new `bandSplit`, `duplicateScenario`, `saveScenario` |
| `src/lib/scenarios.check.ts` | NEW | — |
| `src/lib/prompts.ts` | EDIT | the Talk system prompt + reply shape |
| `src/lib/useTalk.ts` | EDIT | reply parse, `goalState` |
| `src/views/Talk.tsx` | EDIT | picker grid, goals rail |
| `src/views/talk/Face.tsx` | EDIT | persona avatar |

## Specification

### Scenario gains a persona and keeps its band

```ts
export interface Persona {
  name: string;       // "Marta"
  role: string;       // "waiter" — the role the name is attached to
  emoji: string;      // the avatar, until there is art
  voiceHint?: string; // substring passed to the TTS tier; "" means the pack's default
}

export interface Scenario {
  …
  persona: Persona;   // required on bundled literals; validated on import
  goals?: string[];   // ≤ 5, enforced by validateScenario
}
```

- `validateScenario` rejects an import with more than five goals, and rejects a
  missing or partial `persona`. Both with a sentence the import dialog can show.
- Every bundled scenario gets a persona. The free-conversation one included — a
  coach with no name is still a persona, so give it one.
- The persona is resolved **once** when the session starts and held in `useTalk`
  state. A TTS fallback mid-session does not re-pick a voice.

### The catalogue splits by band

```ts
/** Scenarios at or above the learner's level, and the easier ones, in that order. */
export function bandSplit(all: Scenario[], level: string): { main: Scenario[]; easier: Scenario[] };
```

A scenario is "easier" when the **top** of its band is below the learner's level.
`level` comes from `levelOf(profile)` — the one door (invariant 3), never from the
profile field directly.

`Talk.tsx` renders `main` in the grid and `easier` under a collapsed
"Easier — below your level" heading, closed by default.

### Learner-made scenarios are first class

- `saveScenario(s: Scenario): void` — writes to the same `verba.scenarios` key
  `importScenario` uses, replacing by id.
- `duplicateScenario(s: Scenario): Scenario` — new id (`${s.id}-copy-${n}`), title
  suffixed, `formatVersion` set. A duplicate of a bundled scenario is an import.
- In the picker, an imported card carries a visible mark (a corner dot with a title,
  never a bare dot — §3.3) and a row of three: Edit, Duplicate, Delete. Edit opens a
  small inline form over the grid: title, emoji, setup, goals (max 5), band, persona.
  No route, no modal library — the same inline-panel pattern `Settings` uses.
- Deleting asks once and says what is lost, per the §7 state table's rule.

### Goals tick because the coach says so

The Talk reply is already JSON (`partialReply` streams the text out of it). Add one
field:

```
"goalsMet": [0, 2]   // indices into the scenario's goals, met by THIS turn
```

The prompt says: list the index of every goal the learner has *just* satisfied with
their last message; an empty list is the normal answer; never re-list a goal already
met; never credit a goal the learner only asked about.

`useTalk` keeps `goalState: ("pending" | "met" | "missed")[]`:

- starts all `pending`;
- a returned index moves that goal to `met` and never moves back;
- on `end()`, every still-`pending` goal becomes `missed`.

`Talk.tsx` renders the three states with three distinct marks and a label for each
(no unlabelled glyphs). Delete the ponytail comment and the `userTurns > i` line.

### src/lib/scenarios.check.ts

1. Every bundled scenario validates against `validateScenario`, has a persona with a
   non-empty name and role, and has ≤ 5 goals.
2. `bandSplit` at B2 puts the A1–B1 restaurant in `easier` and the B1–C1 interview
   in `main`; at A1 nothing is `easier`; a scenario with no band is always `main`.
3. `duplicateScenario` produces a new id, never collides on a second call, and the
   duplicate validates.
4. `validateScenario` rejects six goals and a personaless scenario, with a message
   naming the field.

## Do not touch

- `src/lib/db.ts`. Scenarios live in `localStorage`; that is not changing here.
- The streaming path (`partialReply`). One more JSON field is parsed after the
  stream closes, not during it.
- The suggestion mechanism — PLAN-018 owns it.
- No second model call per turn. No new dependency.

## Acceptance

- `npm run check` green.
- A B2 learner's picker shows the interview in the grid and the restaurant under
  "Easier", collapsed.
- Meeting a goal mid-conversation ticks that goal and no other.
- Ending a session with two of three goals met leaves the third marked missed.

## Commit

```
feat(talk): the catalogue sorts by band, the persona holds, the goals are real (PLAN-017)
```

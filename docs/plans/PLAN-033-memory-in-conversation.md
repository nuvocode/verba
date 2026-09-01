---
id: PLAN-033
title: One detail, and a coach who stays the same
branch: plan/m6-repair-layer
base: master
status: todo
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/66
milestone: M6 · Repair layer
---

# PLAN-033: memory in the conversation, and a consistent coach

## Context

Spec §6.3 and §6.4. The other half of "behaves like a person".

The Memory layer exists and works: facts are stored per language, surfaced in the
system prompt through `memoryBrief`, and shown on the Memory screen. What §6.3 adds
is not more memory — it is memory appearing **inside the conversation** rather than
as a list. A coach who remembers you is not a coach with a good database; it is a
coach who opens with *"did the move happen?"*

The failure modes are specific and both are worse than saying nothing: opening with
a *system* fact ("you've done 4 sessions this week", "your level is B1"), which is
surveillance rather than interest; and asking the same question every session,
which proves nothing was heard the first time.

§6.4 is smaller and mostly enforcement: the coach's name, voice and directness do
not drift between sessions or between surfaces.

Depends on PLAN-032 — the opening detail is capped the same way praise is, through
the same session counters. Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- Nothing here invents a fact. Every detail used is one the learner told Verba.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/prompts.ts` | EDIT | `openingDetail`, `memoryStance` extension, style guidance |
| `src/lib/prompts.check.ts` | EDIT | new cases |
| `src/lib/db.ts` | EDIT | `memories` gains `asked_at` |
| `src/lib/settings.ts` | EDIT | `coachStyle: "warm" \| "neutral" \| "direct"` |
| `src/views/settings/Learning.tsx` | EDIT | the style control |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 13–14 |

## Specification

### Choosing the one detail

```ts
export function openingDetail(memories: Memory[], now: number): Memory | null;
```

Three rules, in order, from §6.3:

1. **Recent.** Older than 30 days is not an opening, it is an archive.
2. **Open-ended.** A fact that can be asked about again ("interviewing next week")
   rather than a closed attribute ("has two cats"). Closed facts are recognised by
   the absence of any time reference and by being stative; the classification is
   made once, at write time, by the memory prompt — which already produces the fact
   — with a `kind: "state" | "event"` field, gated to those two values.
3. **Told, not derived.** `memories` rows only. Session counts, level estimates,
   accuracy and streaks are excluded structurally: `openingDetail` takes `Memory[]`
   and nothing else, so there is no path by which a statistic could reach it.

Returns `null` freely — a learner with three stative facts gets an opening with no
personal detail, which is fine. It is one detail **at most**, never a requirement.

### Asked once

`memories` gains `asked_at INTEGER` (`ALTER TABLE … ADD COLUMN`, nullable, the only
schema change in this plan). `openingDetail` skips any row with a non-null
`asked_at`; `useTalk` stamps it when the session opens with that detail.

The answer, when it comes, lands as a new memory through the existing memory write
path — so "did the move happen?" asked once becomes "moved in March" stored once,
and the question is never asked again. That is the whole mechanism: a fact that
generated a question is spent.

### "How do you know that?"

The turn schema gains nothing. `buildSystem`'s memory stance gains one clause: if
the learner asks how the coach knows something, answer honestly — Verba keeps notes
of what they have said, they can read and delete all of them on the Memory screen —
and never deny it, deflect, or claim to have guessed.

Verba does its half: ⌘K already routes to Memory, and the coach's honest answer
names that screen in words the learner can act on.

### A coach who does not drift

`settings.coachStyle`, three values, default `warm`. `styleGuidance(style)` returns
the paragraph appended to `buildSystem` — and to **every other prompt that speaks to
the learner**: `summaryPrompt`, `weeklyReportPrompt`, `drillPrompt`, the Read note
prompt, the Listen question prompt. §6.4's "applies identically on every surface" is
a claim about coverage, so the check is a source scan: every function in the repo
that builds a learner-facing prompt includes `styleGuidance`, and a new one that
does not fails the build.

The persona (name, role, voice) is already resolved once per session and held
(§2.2, M5). This plan extends it across sessions: the persona for a **resumed**
conversation is the one it started with, not a fresh pick, which means storing the
persona id on the session row — `sessions.persona TEXT`, nullable, older rows fall
back to today's behaviour.

Style is not level and not difficulty. `direct` means fewer softeners, not harder
content; PLAN-031 owns difficulty and nothing here touches `difficultyStep`.

### Checks

`prompts.check.ts`:
1. `openingDetail` never returns a fact older than 30 days.
2. It never returns a `state` fact.
3. It never returns a row with `asked_at` set.
4. It returns `null` rather than reaching for a worse candidate.
5. It cannot return a statistic: assert by type — the function takes `Memory[]` — and
   by a source scan that `useTalk` passes it nothing but the memory rows.
6. `buildSystem` asks for at most one opening detail, and the string containing it
   appears once.
7. `styleGuidance` output differs across the three styles, and each is present in
   `buildSystem`, `summaryPrompt`, `weeklyReportPrompt`, `drillPrompt`, and the Read
   and Listen prompts. Seeded violation: a new prompt builder without it fails.
8. The honesty clause is present in `buildSystem` whenever `memories` is non-empty.
9. A resumed session rebuilds the same persona, asserted against a stored id.

## Do not touch

- The memory write path and `planMemory`'s dedupe. This plan reads memories and
  stamps one column; it does not change what gets written.
- `memoryPaused`. A learner who paused memory gets no opening detail, and that
  falls out of `memories` being empty — no special case needed.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` rows 13–14 asserted.
- Two sessions in a row never open with the same question.
- A session opens with at most one personal thing, and never with a number.
- Switching style to `direct` changes the tone of Talk, the weekly report and the
  Read notes together.

## Commit

```
feat(coach): one remembered detail per opening, and a coach who does not drift (PLAN-033)
```

---
id: PLAN-033
title: One detail, and a coach who stays the same
branch: plan/m6-repair-layer
base: master
status: done
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

Lands on top of PLAN-032's commit (`02e2a5b`).

## Repo conventions

- **No new dependencies.**
- Nothing here invents a fact. Every detail used is one the learner told Verba.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/prompts.ts` | EDIT | `openingDetail`, the stance's one exception, `styleGuidance`, `Memory` |
| `src/lib/prompts.check.ts` | EDIT | the cases below |
| `src/lib/db.ts` | EDIT | `memories` gains `kind` and `asked_at`; the two SELECTs carry them |
| `src/lib/useTalk.ts` | EDIT | pick the detail at the door, stamp it, pass it to `buildSystem` |
| `src/lib/coach.ts`, `src/lib/reading.ts`, `src/lib/listening.ts`, `src/lib/learn.ts` | EDIT | `styleGuidance` in the spoken prompts |
| `src/lib/settings.ts` | EDIT | `coachStyle: "warm" \| "neutral" \| "direct"` |
| `src/views/settings/Learning.tsx` | EDIT | the style control |
| `src/lib/settingsIndex.ts` | EDIT | the row for it |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 13–14 |

## Specification

### The contradiction this plan has to resolve first

`memoryStance` (prompts.ts) currently says, in the same prompt this plan edits:

> Do not steer towards them, **do not open on them**, and do not reach for one to
> show that you remembered.

That rule is right, and §6.3 is also right. They are reconciled by *who chooses*.
The stance forbids the model from **reaching into the list** for something to open
with — that is the behaviour that produces a coach performing recall. §6.3 permits
Verba to hand it **one specific fact, already chosen, already checked for staleness
and already checked for having been asked**, and to say: you may open by asking
after this one thing.

So the stance stays, word for word, as the rule for the list. Beside it, and only
when a detail was supplied, `buildSystem` gains one sentence naming that fact and
permitting one question about it. No detail supplied → no sentence → the stance is
the whole instruction, exactly as today. The exception must name the fact inline;
a general "you may open on something you remember" re-opens the door the stance
closes.

### Choosing the one detail

```ts
export function openingDetail(memories: Memory[], now: number): Memory | null;
```

Four rules, in order:

1. **Recent.** Older than 30 days is not an opening, it is an archive.
2. **Open-ended.** A fact that can be asked about again ("interviewing next week")
   rather than a closed attribute ("has two cats"). See `kind`, below.
3. **Unasked.** `asked_at` is null.
4. **Told, not derived.** `memories` rows only. Session counts, level estimates,
   accuracy and streaks are excluded structurally: `openingDetail` takes `Memory[]`
   and nothing else, so there is no path by which a statistic could reach it.

Returns `null` freely — a learner with three stative facts gets an opening with no
personal detail, which is fine. It is one detail **at most**, never a requirement.

### `kind`, and what an unclassified fact is

`Memory` gains `kind: "state" | "event" | null` and `asked_at: number | null`.
`memories` gains two columns, both nullable, both added the way every other
migration in `db.ts` is added (`ALTER TABLE … ADD COLUMN`, `.catch(() => {})`), and
both SELECTs in the memory read path carry them.

The classification is made once, at write time, by `memoryPrompt` — which already
produces the fact — with a `kind` field gated to those two values at parse. Anything
else parses to null.

**A null `kind` is not an opening.** Every fact recorded before this plan has one,
and there is no way to classify them without another model call, which this plan
does not make. The conservative reading is the correct one: an unclassified fact
has not been shown to be open-ended, and a coach that opens on "has two cats" is
the failure §6.3 describes. Existing learners get quiet openings until new facts
land, which is the right side to be wrong on.

### Asked once

`useTalk` stamps `asked_at` when the session opens with that detail — at the door,
when the detail is supplied to `buildSystem`, not when the model is observed to
have used it. Whether the coach actually asked is not verifiable from the reply,
and the two failure modes are not equal: a spent fact that went unused costs one
opening, while an unspent fact asked every session is exactly the failure §6.3
names. A fact that generated a question is spent.

The answer, when it comes, lands as a new memory through the existing memory write
path — so "did the move happen?" asked once becomes "moved in March" stored once.

### "How do you know that?"

The turn schema gains nothing. `memoryStance` gains one clause: if the learner asks
how the coach knows something, answer honestly — Verba keeps notes of what they
have said, and they can read and delete all of them on the Memory screen — and
never deny it, deflect, or claim to have guessed.

### A coach who does not drift

`settings.coachStyle`, three values, default `warm`. `styleGuidance(style)` returns
the paragraph appended to the prompts the learner hears the coach through.
`direct` means fewer softeners, not harder content; PLAN-031 owns difficulty and
nothing here touches `difficultyStep`.

§6.4's "applies identically on every surface" is a claim about coverage, and the
repo has **twenty** `*Prompt` builders — so "every prompt" is both too many and
wrong. A JSON extraction prompt (`memoryPrompt`, `vocabPrompt`, `parseTurn`'s
schema, `comprehensionPrompt`) has no voice to be consistent in; a tone paragraph
there is noise the learner never reads.

Two lists, in `prompts.ts`, exported so the check can read them:

```ts
export const SPOKEN_PROMPTS = [ ... ] as const;     // must carry styleGuidance
export const STRUCTURED_PROMPTS = [ ... ] as const; // must not
```

`SPOKEN_PROMPTS` is where the learner meets the coach's voice: `buildSystem`,
`rewindOwnPrompt`, `rewindUnpackPrompt`, `summaryPrompt`, `weeklyReportPrompt`,
`drillPrompt`, `recapPrompt`, `notesPrompt`, `explainWordPrompt`. Everything else
in the repo is structured. Classify each of the twenty deliberately; the point of
writing both lists down is that the check can then assert **completeness** — every
`export function …Prompt(` in `src/lib` appears in exactly one list — so a prompt
added later fails the build until someone decides which it is. A coverage claim
that cannot see a new prompt is not a coverage claim.

### The persona is already stable — assert it, do not store it

The draft of this plan called for `sessions.persona TEXT` so a resumed conversation
keeps its coach. It is not needed: `persona` is a field on the scenario
(`scenarios.ts`), `open()` and `resume()` both read `sc.persona`, and a resumed
conversation resumes the same scenario. Storing it would be a second copy of a fact
the scenario already holds — the thing this codebase refuses everywhere else.

So §6.4's persona half is a **check, not a change**: assert that the persona is
read from the scenario in both paths and picked nowhere else.

### Checks

`prompts.check.ts`:

1. `openingDetail` never returns a fact older than 30 days.
2. It never returns a `state` fact, and never returns a `kind: null` fact.
3. It never returns a row with `asked_at` set.
4. It returns `null` rather than reaching for a worse candidate — a list of only
   stale, stative, already-asked and unclassified facts yields `null`, not the
   least-bad one.
5. It cannot return a statistic: by type (`Memory[]`), and by a source scan that
   `useTalk` passes it the memory rows and nothing else.
6. `buildSystem` with a detail carries the naming sentence exactly once and still
   carries the full stance; `buildSystem` without one carries the stance and no
   opening permission at all. Assert the second — that is the regression that
   matters, and it is the one a happy-path check skips.
7. `parseMemory` gates `kind` to the two values; anything else becomes null.
8. `styleGuidance` output differs across all three styles, and each spoken prompt
   in `SPOKEN_PROMPTS` contains it while each structured prompt does not.
9. **Completeness:** every `export function …Prompt(` in `src/lib`, plus
   `buildSystem`, appears in exactly one of the two lists. Probe with a seeded
   violation (a temp file is not enough here — the scan reads `src/lib`, so seed by
   asserting the scan's own list-membership logic against a fabricated name).
10. The honesty clause is present in `buildSystem` whenever `memories` is non-empty.
11. The persona: `open()` and `resume()` both read it from the scenario, and no
    other code path constructs one. Source scan, seeded.

Ledger markers: `memory ledger 13`, `memory ledger 14`.

**On the checks themselves.** Cases 2, 4 and 6 are the ones with a habit of passing
vacuously. Each must fail when its own rule is removed — check that by removing it,
not by reading the code.

## Do not touch

- The memory write path and `planMemory`'s dedupe. This plan reads memories, adds
  one classification field, and stamps one column; it does not change what gets
  written or how duplicates are resolved.
- `memoryPaused`. A learner who paused memory gets no opening detail, and that
  falls out of `memories` being empty — no special case.
- `difficultyStep`, and PLAN-032's wait and praise counters.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` rows 13–14 asserted.
- Two sessions in a row never open with the same question.
- A session opens with at most one personal thing, and never with a number.
- A learner whose facts all predate this plan gets no opening detail and no error.
- Switching style to `direct` changes the tone of Talk, the weekly report and the
  Read notes together, and changes no extraction prompt.

## Commit

```
feat(coach): one remembered detail per opening, and a coach who does not drift (PLAN-033)
```

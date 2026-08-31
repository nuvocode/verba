---
id: PLAN-026
title: Listen — the transcript is a choice, and a wrong answer teaches
branch: plan/m5-surface-contracts
base: master
status: ready
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/60
milestone: M5 · Surface contracts
---

# PLAN-026: transcript, ranges, and useful wrong answers

## Context

The rest of §2.4, all of it downstream of PLAN-025's timeline.

**The transcript** is locked until every question is answered, then revealed by a
button. §2.4 asks for the opposite arrangement: it toggles, it defaults to closed,
and opening it marks that chapter's comprehension signal **assisted** — recorded, not
punished. Locking it is the wrong instrument; a learner who is stuck should be able
to look, and the app's job is to know that they did.

**Questions** carry `line: string` — the source sentence, shown on a miss. With a
timeline, that becomes an `audioRange`, and "shown on a miss" becomes "played on a
miss, with one key".

**Wrong answers** currently end at wrong. §2.4: the right answer is explained, and
the range it came from replays. And the distractors are whatever the model felt like
— `questionInstructions` asks for options, not for options that each test a specific
misunderstanding.

**The page** stacks at the top and leaves the bottom empty — the last bullet of #60,
and the only one that is purely CSS.

Last plan of M5. Depends on PLAN-025. Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- A signal that records assistance never feeds a penalty. Same rule as PLAN-021, same
  check pattern.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/listening.ts` | EDIT | `Question` → `audioRange`, `chapterPrompt` distractors |
| `src/lib/listening.check.ts` | EDIT | new cases |
| `src/lib/useListening.ts` | EDIT | reveal, `replayRange`, signals |
| `src/views/Listening.tsx` | EDIT | transport row, transcript toggle, miss panel |
| `src/theme.css` | EDIT | `.listen` layout |

## Specification

### Questions bind to a range

```ts
export interface ListenQuestion extends Question {
  /** Index of the line the answer sits in — resolved from `line` at parse time. */
  lineIdx: number;
}
```

The model keeps returning `line` (the sentence text): asking it for a timestamp it
cannot know is asking it to invent one. `parseChapter` resolves `line` → `lineIdx` by
matching against the chapter's lines (normalised, as `questions.ts` already
normalises answers). A question whose line cannot be matched is **dropped** — a
question that cannot be replayed is half a question, and §2.4 is explicit that every
question is bound to a range.

`audioRange` itself is `spans[lineIdx]` (PLAN-025), computed at playback time and
never stored: durations belong to the synthesis, not to the content.

### Distractors that mean something

`chapterPrompt`'s question instructions gain the three failure modes §2.4 names.
Every MCQ returns exactly three wrong options, each labelled by what it tests:

```
"options": [
  { "text": "...", "why": "correct" },
  { "text": "...", "why": "wrongSubject" },
  { "text": "...", "why": "wrongTense" },
  { "text": "...", "why": "irrelevantDetail" }
]
```

`why` is never shown as a label — it is what makes the explanation on a miss
specific ("that happened, but to her sister, not to her"). Parse validates that all
four kinds are present exactly once; a question that does not comply is dropped, like
an unmatched line. The options are shuffled at render, deterministically per
question, so the correct one is not always first.

### A wrong answer replays

On a miss, the panel under the question shows, in this order:

1. the right answer, and one line saying why the chosen one is wrong — from its `why`;
2. **Replay that part** — plays `spans[lineIdx]` and stops at its end. Bound to one
   key, declared in `src/lib/keys.ts` on the `listening` surface (`r`), so the count
   announced is the count that works;
3. the source line's text, only if the transcript is open. If it is closed, the miss
   panel does not open it — that is the learner's choice, not the app's.

### The transcript toggles

- Available from the start of a chapter, closed by default, one labelled toggle in
  the transport row. Keyboard: `t`, in `KEYS`.
- Opening it once in a chapter sets `assisted` on that chapter's comprehension
  signals — every question in the chapter, not only the ones answered after. The
  learner had the text available; that is the fact being recorded.
- `listenSignals` (`src/lib/signals.ts`) takes the flag and writes it into the
  payload with its definition ("you had the transcript open for this chapter").
- Nothing about the screen changes when it is set. No warning, no colour, no count.
  The end-of-session line reports accuracy and, where any chapter was assisted, says
  so as a plain fact beside it.

### The page balances

`.listen` becomes a three-row grid — head, player, work — that fills the viewport,
with the transport vertically centred in its row and the question block growing into
the space rather than the page ending halfway down. No fixed pixel heights; `dvh` and
`minmax`, so it survives a resized window.

### Checks

`listening.check.ts`:
1. `parseChapter` drops a question whose `line` matches nothing.
2. It resolves `lineIdx` correctly with differing punctuation and casing.
3. A question missing one of the four `why` kinds is dropped; one with all four is kept.
4. The shuffle is deterministic for the same question and does not always place the
   answer at index 0 across a set of ten.
5. `listenSignals` with `assisted: true` writes it on **every** question of that
   chapter, and the payload carries a definition.
6. Source scan: `coachmetrics.ts` treats an assisted comprehension signal as a
   recorded result, not a wrong one — feed it two signal sets differing only in the
   flag and assert accuracy is unchanged.

## Do not touch

- The generation flow (outline → chapter per call). It works and is out of scope.
- `questions.ts`'s scoring.
- PLAN-025's timeline API.
- No new dependency.

## Acceptance

- `npm run check` green, and the ledger prints **27 asserted, 0 pending, 0 out of scope**.
- The transcript opens and closes at any time; opening it marks the chapter assisted
  and changes nothing the learner can see.
- A wrong answer explains the right one and replays its line with one key.
- The four options test four different things, and the answer is not always first.
- The page fills the window at 900×600 and at 1600×1000.

## Commit

```
feat(listen): a transcript you choose, ranges you can replay, and answers that teach (PLAN-026)
```

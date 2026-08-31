---
id: PLAN-024
title: Read — close reading by keyboard, and a teleprompter that listens
branch: plan/m5-surface-contracts
base: master
status: ready
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/59
milestone: M5 · Surface contracts
---

# PLAN-024: close reading, and a prompter that listens

## Context

The remaining half of #59, and the half that is about the two modes rather than the
content in them.

**Close reading.** Clicking a sentence focuses it and clicking a word opens the
popover — both already work, by mouse only. §2.3 asks for arrow keys to move focus
and `Esc` to clear it, and PLAN-016 already settled where the focused note is shown
(the margin, highlighted; never twice).

**The prompter.** `src/views/read/Prompter.tsx` already computes its countdown from
`secondsFor(words, wpm)` and `Read.tsx` shows an estimate — check they are the same
call on the same numbers, and make it so if not (§2.3: "süre hesabı tek kaynaktan
gelir"). Then the real gap:

> Dinlemeyen bir teleprompter yalnızca kaydırma yapan bir metin kutusudur; bu modun
> varlık sebebi ölçümdür.

Today the prompter scrolls and nothing listens. PLAN-018 built exactly what is
needed — a `listen()` that returns text, duration and a level envelope — and Read
already knows which words should have been said, and when. Comparing the two is the
measurement, and it produces the `pace` and `pronunciation` signals §2.3 promises.

Depends on PLAN-018 (the STT shape) and PLAN-023 (the notes it highlights). Work on
top of PLAN-023's commit.

## Repo conventions

- **No new dependencies.**
- `src/lib/readaloud.ts` is pure comparison — expected words in, spoken words in,
  a report out. No microphone, no React.
- Keyboard: `src/lib/keys.ts` or nothing. Arrow keys and `Esc` on `read` go in the
  table like everything else (invariants 23, 24).
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/readaloud.ts` | NEW | — |
| `src/lib/readaloud.check.ts` | NEW | — |
| `src/lib/keys.ts` | EDIT | `read` arrows, `read` Esc |
| `src/lib/useRead.ts` | EDIT | focus moves, `measure()` |
| `src/views/read/Passage.tsx` | EDIT | focus + note highlight |
| `src/views/read/Prompter.tsx` | EDIT | the mic path, the two states |

## Specification

### Focus by keyboard

- `ArrowDown` / `ArrowRight` → next sentence; `ArrowUp` / `ArrowLeft` → previous.
  From no focus, `ArrowDown` focuses the first sentence.
- `Esc` clears focus. It does **not** leave Read — that is one level up from the
  focus, which is exactly what §3.1 means, and it matches the entry PLAN-016 put in
  the table.
- Focus scrolls the sentence into view and highlights its note in the margin (the
  one place, per PLAN-016). A sentence with no note highlights nothing and says
  nothing — no "no note for this sentence" line.
- The word popover keeps the mouse path and gains `Enter` on the focused sentence to
  open the first unknown word? **No** — out of scope. One focus model, sentences
  only; word selection stays a pointer action until someone asks for it.

### One reading-time formula

`secondsFor(words, wpm)` is already the shared function. The plan's job is to prove
it is shared:

- `Read.tsx`'s estimate and `Prompter.tsx`'s remaining time both call it;
- both count words with `countWords(sentences, locale)` — the same tokenizer, so a
  Japanese passage is not estimated by counting spaces;
- changing wpm in the prompter updates the estimate on the passage view, because
  both read `settings.prompterWpm`. Assert this in `prompter.check.ts` by computing
  both numbers from the same inputs and asserting equality at three wpm values.

### The prompter listens

Two states, both real, chosen by whether STT is available:

**Microphone on** — the prompter starts `speech.listen({ onLevel, silenceMs: 0 })`
when the scroll starts and stops it at the end. On stop:

```ts
export interface AloudReport {
  /** Expected words that never appeared in the transcript, in order. */
  skipped: string[];
  /** Spoken words per minute, from the transcript and the elapsed time. */
  wpm: number;
  /** The prompter's own wpm — what they were asked to match. */
  targetWpm: number;
  /** |wpm − targetWpm| / targetWpm, 0–1. */
  paceMatch: number;
  /** Share of the run that carried speech, and pauses over 600 ms. See PLAN-018. */
  delivery: { voiced: number; breaks: number };
}

export function compare(expected: string[], heard: string[], ms: number, targetWpm: number, locale: string): AloudReport;
```

Matching is order-preserving and forgiving: a longest-common-subsequence walk over
normalised tokens (`bareWord`), so one misheard word does not desynchronise the rest
and mark forty words skipped. Words the transcript adds are ignored — a learner
saying "um" is not an error.

The report renders under the finished prompter as three plain numbers with units and
definitions (invariant 12), and emits `pace` and `pronunciation` signals through the
same path PLAN-018 established.

**Microphone off** — the prompter runs exactly as it does today, and shows the
`Nothing` state (PLAN-016) in the report's place: "No measurement — the microphone is
off", with the one action that changes it (Settings → Speech). Not an error, not a
nag, and never a blocked prompter.

### src/lib/readaloud.check.ts

1. A perfect read: `skipped` empty, `paceMatch` 0.
2. Three words dropped from the middle: exactly those three in `skipped`, in order.
3. One word misheard (`"marcado"` for `"mercado"`): at most one entry in `skipped` —
   the LCS does not cascade.
4. Extra filler words in the transcript: `skipped` still empty.
5. Reading at half the target wpm gives `paceMatch ≈ 0.5`, and the sign is not lost
   (a `wpm` field the caller can compare).
6. A non-Latin locale counts words with the same tokenizer Read estimates with.

## Do not touch

- The prompter's scrolling engine (`pxPerSecond`, `lineAt`, `ended`). It works; this
  plan reads from it, it does not rewrite it.
- The word popover's model call.
- `src/lib/db.ts` schema.
- No new dependency.

## Acceptance

- `npm run check` green.
- Arrows walk sentences, `Esc` clears, and the margin highlights exactly one note.
- Changing wpm in the prompter changes the estimate on the passage view.
- Reading a passage aloud with the mic on produces a report naming the words that
  were skipped, and writes a `pace` signal.
- With the mic off, the prompter still runs and says there is no measurement.

## Commit

```
feat(read): focus by keyboard, and a teleprompter that measures the read (PLAN-024)
```

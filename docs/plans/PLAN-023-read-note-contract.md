---
id: PLAN-023
title: Read — notes have their own schema, and every one is anchored
branch: plan/m5-surface-contracts
base: master
status: ready
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/59
milestone: M5 · Surface contracts
---

# PLAN-023: the note contract

## Context

A Read note today is a string hanging off a sentence:

```ts
export interface Sentence {
  target: string;
  native: string;
  note?: string; // optional one-line coach note — shown in the reader's margin
}
```

and the prompt asks for "an optional one-line coach note about a grammar point or
word choice in **this sentence**". Three problems, one per invariant:

- **17** — the note is attached to a sentence, not anchored to an expression. Nothing
  checks that the phrase it discusses exists in the passage, and models routinely
  explain a phrase they *would have* written.
- **18** — the shape invites a note per sentence, and a compliant model produces ten
  notes for ten sentences. §2.3: the cap is half the sentence count, and no note is
  better than filler.
- **19** — "a grammar point or word choice" is Talk's correction schema wearing a
  different name. Read does not correct what the learner wrote; it opens what they
  read. The two schemas must not meet.

§2.3 gives the replacement outright: five note types, an anchor that must appear in
the text, a cap, and level-based prioritisation.

Depends on PLAN-022 (notes are generated against a gated passage). Work on top of its
commit.

## Repo conventions

- **No new dependencies.**
- `src/lib/notes.ts` must not import `./prompts.ts`. That import is invariant 19
  failing at the module level, and the check enforces its absence.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/notes.ts` | NEW | — |
| `src/lib/notes.check.ts` | NEW | — |
| `src/lib/reading.ts` | EDIT | `Sentence.note` removed, `notesPrompt` added, `jsonShape` |
| `src/lib/useRead.ts` | EDIT | a second call after the gates; `notes` |
| `src/lib/invariants.check.ts` | EDIT | LEDGER rows 17, 18, 19 |

## Specification

### The schema

```ts
export type NoteType = "lexis" | "structure" | "register" | "culture" | "contrast";

export interface ReadNote {
  type: NoteType;
  /** The expression as it appears in the passage — verbatim, including inflection. */
  anchor: string;
  /** Index of the sentence the anchor was found in. Filled by validation, not the model. */
  sentence: number;
  /** One or two lines, in the learner's language. */
  body: string;
}
```

No `original`/`fixed`/`severity`. No `Correction` import. A note names something and
explains it; it never proposes a replacement.

### Generation is its own call

Notes are generated **after** the passage passes PLAN-022's gates, in a second call.
Generating them alongside the draft is what produced note-per-sentence: a model
writing prose and annotating it at once annotates every line it writes.

`notesPrompt(text, level, nativeLanguage, want)`:

- passes the passage with sentence indices;
- states the five types with one example each, and that a note must quote an
  expression **exactly as it appears**;
- states the cap as a number (`want`), and says plainly that returning fewer is the
  right answer when there is nothing worth saying;
- asks for what a learner *at this level* would not know, in priority order.

`want = Math.floor(sentences.length / 2)`.

### Validation is where the invariants live

```ts
/**
 * Drops every note that cannot be anchored, caps what survives, and orders by
 * priority. Silent by design: a rejected note is not an error, it is a note that
 * was not worth keeping.
 */
export function validateNotes(raw: unknown, text: ReadingText, locale: string, cap: number): ReadNote[];
```

Rules, in order:

1. Shape: `type` in the five, `anchor` a non-empty string, `body` ≥ 10 characters.
2. **Anchor**: `anchor` must occur in some sentence's `target`. Match on the
   normalised form (`bareWord` per token, whitespace collapsed, case-folded) so
   punctuation and casing do not reject a real anchor — but no stemming, no fuzzy
   match. Not found → dropped. `sentence` is set from where it was found.
3. One note per anchor; one note per sentence maximum. Duplicates dropped.
4. Priority: `lexis` and `structure` before `register`, `culture`, `contrast`; within
   a type, longer anchors first (a phrase is worth more than a word); ties by
   sentence order.
5. Cap: take the first `cap`. Zero notes is a valid outcome and renders as nothing —
   not as an empty rail with a heading.

### useRead

- `text.sentences[i].note` is gone. `read.notes` is `ReadNote[]`.
- A failed notes call is **not** a failed passage. The passage renders with no notes
  and a quiet line saying notes did not come back, with a retry that asks only for
  notes. This is the one place in Read where a partial result is worth showing.
- Old passages restored from `reading_sessions` have no notes and render none. No
  migration; the column stays and is ignored by the reader.

### src/lib/notes.check.ts

```
// invariant 17
// invariant 18
// invariant 19
```

1. A note whose anchor is absent from the passage is dropped — including the near
   miss (`"run out"` when the text says `"ran out"`).
2. Case and punctuation do not cause a drop (`"Run out of,"` anchors to `"run out of"`).
3. 10 sentences, 9 valid notes returned → exactly 5 survive.
4. 6 sentences, 1 note → 1 survives; 6 sentences, 0 notes → `[]`, no error.
5. Two notes on the same sentence → one survives.
6. Priority: a `culture` note and a `lexis` note with a cap of 1 → the `lexis` one.
7. **Schema separation**: scan `src/lib/notes.ts` and `src/lib/reading.ts` for
   `Correction`, `severity`, `fixed`, `original` — none may appear. And
   `notes.ts` must not import `prompts.ts`.
8. `NoteType` and `CorrectionCategory` (PLAN-020) share no member.

### src/lib/invariants.check.ts

Rows 17, 18, 19 → `src/lib/notes.check.ts`.

## Do not touch

- `Correction`, `TurnResult`, and everything else in `prompts.ts`. Talk's schema is
  not edited by this plan — it is merely never reached from here.
- `reading_sessions` schema.
- The passage gates. Notes are downstream of them.
- No new dependency.

## Acceptance

- `npm run check` green; ledger rows 17, 18, 19 asserted.
- A 10-sentence passage never shows more than 5 notes.
- Every note on screen quotes a phrase that can be found in the passage.
- A passage where the model has nothing to say shows no notes rail at all.

## Commit

```
feat(read): notes get their own schema, an anchor, and a ceiling (PLAN-023)
```

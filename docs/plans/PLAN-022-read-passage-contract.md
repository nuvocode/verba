---
id: PLAN-022
title: Read — the passage generation contract
branch: plan/m5-surface-contracts
base: master
status: done
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/58
milestone: M5 · Surface contracts
---

# PLAN-022: the passage generation contract

## Context

`useRead.generate()` is one call:

```ts
const raw = await provider.chat([{ role: "user", content: storyPrompt(…) }], { json: true });
const t = parseReading(raw);
if (!t.sentences.length) throw new Error("The model returned no readable sentences. Try again.");
setText(t);
```

The only quality bar in the pipeline is "at least one sentence came back". A 3B model
handed "write 10 sentences at A2 about the market" will happily produce ten
grammatical sentences that say nothing, repeat one beat, and contradict each other in
the middle — and every one of them reaches the learner. §2.3 calls this a defect in
this product, and spells out the five-step flow that replaces the one call.

The reuse promise makes it worse. PLAN-012 wired `begin('read')` to carry the words
from the conversation, and `storyPrompt` asks for them — "they are words the learner
has just used themselves". Nothing checks whether any arrived. The app makes a claim
on screen ("this passage reuses what you said") that it does not verify: invariant 21.

Depends on PLAN-016 (this plan is the first real user of `Unusable`). Work on top of
PLAN-021's commit.

## Repo conventions

- **No new dependencies.** Every gate below is arithmetic over sentences and words.
- `src/lib/passage.ts` must not import `./db.ts`, React, or a provider. It takes text
  and returns verdicts; the hook does the calling.
- The gates are **deterministic**. A gate that asks the model whether its own output
  is good is not a gate.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/passage.ts` | NEW | — |
| `src/lib/passage.check.ts` | NEW | — |
| `src/lib/reading.ts` | EDIT | `outlinePrompt`, `draftPrompt`, `rewritePrompt` |
| `src/lib/useRead.ts` | EDIT | `generate()` becomes the pipeline |
| `src/lib/invariants.check.ts` | EDIT | LEDGER rows 20, 21 |

## Specification

### The five steps, in `useRead.generate()`

Each step reports through `Generating`'s `step` (PLAN-016), so the learner sees
"Planning the passage… / Writing it… / Checking it reads properly…" rather than a
spinner that lasts twenty seconds.

1. **Outline** — `outlinePrompt` asks for 4–6 beats, each one claim or event, as
   `{ beats: [{ claim: string }] }`. Fewer than 4 or more than 6 → one retry, then
   the fallback (below). `listening.ts`'s `parseOutline` is the shape to copy; do
   not import it — Listen's outline carries chapters, this one carries claims.
2. **Draft** — `draftPrompt(outline, …)` writes the passage *from the beats*, at the
   level's sentence length and word distribution. Same `ReadingText` shape as today,
   so nothing downstream changes.
3. **Coherence gate** — per sentence, four deterministic tests (below). A failing
   sentence goes back with `rewritePrompt(sentence, previous, why)` — one sentence,
   not the passage. Two failures on the same sentence and the passage is rejected.
4. **Reuse gate** — if `reuse` was passed, at least half of those words must appear
   (stem-insensitively, via `bareWord`). Below half → back to step 2 **once**, with
   the missing words named. Still below → rejected.
5. **Level gate** — measured band within ±1 of the target.

### src/lib/passage.ts

```ts
export interface GateResult { ok: boolean; failed: number[]; why: string[] }

/**
 * Per-sentence coherence, deterministically. Each test is a thing a bad generation
 * actually does, not a proxy for "good writing":
 *  - connection: shares a content word, a named entity, or a pronoun antecedent with
 *    the previous sentence, or opens with a discourse marker from the pack.
 *  - contradiction: the same subject + the negation of a predicate already asserted.
 *  - tautology: the clause after the copula repeats the clause before it, or the
 *    sentence's content words are a subset of the previous sentence's.
 *  - emptiness: fewer than 3 content words, or every content word is a stopword.
 */
export function coherence(t: ReadingText, locale: string, stopwords: Set<string>): GateResult;

/** ≥ 50% of `want` present in the passage, by `bareWord`. Returns what is missing. */
export function reuse(t: ReadingText, want: string[]): GateResult & { hit: string[]; missing: string[] };

/** Measured band from sentence length and word rarity, and whether it is within one of `target`. */
export function level(t: ReadingText, target: string, locale: string): { band: string; ok: boolean };
```

`stopwords` comes from the active language pack; a pack without a list falls back to
"content word = length ≥ 3", which is weak but never wrong in a way that rejects good
text. **Bias every gate toward passing**: a gate that rejects a good passage costs a
regeneration the learner waits through, and a false reject is invisible — so where a
test is unsure, it passes and says so in `why`.

### Rejection has somewhere to go

```ts
/** A passage that failed the gates, and what to do about it. */
type PassageOutcome =
  | { ok: true; text: ReadingText; gates: { coherence: GateResult; reuse?: …; level: … } }
  | { ok: false; why: string; fallback: ReadingText | null };
```

- `useRead` renders `ok: false` as `Unusable` (PLAN-016): what failed in the
  learner's words ("The passage didn't hang together"), a **Try again**, and — where
  one exists — "Read a saved passage instead".
- The fallback is not new content and is not bundled prose: it is the most recent
  passage from `reading_sessions` at the same level. If there is none, `fallback` is
  `null` and `Unusable` offers regenerate alone. `db.ts` already stores these; add
  the query only.
- **Nothing rejected is ever rendered**, not greyed out, not behind a "show anyway".
  That link is the invariant with a bypass button on it.

### The reuse claim is conditional

Read's header may say a passage reuses the learner's words **only** when the reuse
gate actually ran and passed. `useRead` exposes `reusedWords: string[]` — the `hit`
list — and the header prints the count from it, or says nothing at all. That is
invariant 21 made unfakeable: the copy reads the gate's output, not the request.

### src/lib/passage.check.ts

```
// invariant 20
// invariant 21
```

Fixtures, hand-written, in `en` and one non-Latin locale:

1. A coherent 6-sentence passage passes all three gates.
2. A passage whose sentence 4 repeats sentence 3 fails coherence at index 3.
3. `"The market is a market."` fails as a tautology.
4. `"It was nice. Yes."` fails as empty.
5. A passage sharing no content word with the previous sentence fails connection —
   and the same passage with a discourse marker added passes.
6. `reuse` with 4 of 8 words present passes at exactly 50%; 3 of 8 fails and names
   the five missing.
7. `level` puts a 30-word-sentence C1 passage outside an A2 target and inside a B2 one.
8. **The bypass scan**: `useRead.ts` has exactly one `setText(` on a success path,
   and no path assigns a passage whose outcome was `ok: false`.

### src/lib/invariants.check.ts

Rows 20, 21 → `src/lib/passage.check.ts`.

## Do not touch

- `ReadingText` / `Sentence` shape — PLAN-023 changes notes, this plan does not.
- `continueReadingPrompt` (flow reading). It appends to an already-gated passage; a
  separate concern, and out of scope.
- The provider layer, `src/lib/db.ts` schema.
- No new dependency.

## Acceptance

- `npm run check` green; ledger rows 20, 21 asserted.
- Generating with a deliberately broken model (a stub returning three tautologies)
  shows `Unusable` and the fallback offer — never the text.
- A passage generated after a conversation prints a reuse count that matches the
  words actually present.

## Commit

```
feat(read): outline, draft and three gates — a passage that fails is never shown (PLAN-022)
```

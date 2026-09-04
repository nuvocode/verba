---
id: PLAN-027
title: Six repair moves, filled by observation only
branch: plan/m6-repair-layer
base: master
status: done
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/62
milestone: M6 · Repair layer
---

# PLAN-027: the repair inventory

## Context

Spec §2. The layer's vocabulary, and the channel every later plan observes through.

Six categories, tracked independently, because a learner who can say "sorry, what?"
may never once have said "so you mean…". `HOLD` counts as a repair move and is
taught first: the learner bluffs because silence feels like failure, and a phrase
that legitimises silence removes the pressure that produces the bluff.

Nothing in Verba currently notices any of this. A learner who writes "wait, one
second" and a learner who writes "yes, sure" produce the same `unpromptedTurn`
signal with the same shape.

First plan of M6. Everything after it names these six codes.

## Repo conventions

- **No new dependencies.**
- **No new table.** The inventory is derived from signals, for the same reason
  `model.ts` gives for omitting `srs.strength` and `levelEstimate`: a stored copy
  drifts from the observations it is supposed to summarise.
- Style and check conventions as in PLAN-015. Model output is gated before it is
  believed, as in every M5 plan.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/repair.ts` | NEW | categories, states, `inventoryFrom`, `nextTarget` |
| `src/lib/repair.check.ts` | NEW | the cases below |
| `src/lib/model.ts` | EDIT | `SignalKind` gains `repairMove` |
| `src/lib/prompts.ts` | EDIT | turn JSON gains `repair`; `parseTurn` gates it |
| `src/lib/signals.ts` | EDIT | `repairSignals` |
| `src/lib/useTalk.ts` | EDIT | collect per-turn repair observations into the reflection |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER`, rows 1–2 |

## Specification

### The six codes

```ts
export const REPAIR_CATEGORIES = ["HOLD", "REPEAT", "SLOW", "CLARIFY", "CONFIRM", "PARAPHRASE"] as const;
export type RepairCategory = (typeof REPAIR_CATEGORIES)[number];
```

Teaching order is this array's order, and that is the default `nextTarget` walks —
`HOLD` → `REPEAT` → `SLOW` first because they pull the learner out of panic and pay
off immediately; `CONFIRM` and `PARAPHRASE` last because they need a learner who is
already comfortable enough to build a sentence about the sentence.

### The observation channel

`buildSystem`'s turn JSON gains one optional field:

```
"repair": { "category": "HOLD | REPEAT | SLOW | CLARIFY | CONFIRM | PARAPHRASE", "variant": "the learner's exact words" }
```

with the instruction: report it **only** when the learner's last message actually
performed one of these moves, and set `variant` to the learner's own wording,
copied verbatim, never rephrased. Omit the field otherwise — that is the normal
answer, exactly as `goalsMet: []` is.

`parseTurn` gates it, and the gate is the point of this plan:

1. `category` must be one of the six. Anything else → the field is dropped.
2. `variant` must appear in the learner's message, compared after the same
   normalisation `questions.ts` already uses for answers (case, punctuation,
   whitespace). If it does not, **the whole field is dropped and nothing is
   recorded.** The model may classify what the learner did; it may not author it.

`parseTurn` has no access to the learner's message today, so the check happens where
it does: `useTalk.send` holds `msg` and calls a `verifyRepair(reported, msg, locale)`
exported from `repair.ts`. `parseTurn` only validates the shape.

### The coach's side of it

The coach also *teaches* a pattern (PLAN-030 §4.4 will call this). That is an
observation too, and it is a different one: it moves a category to `recognises`, not
to `uses`. So a repair observation carries who made it:

```ts
export interface RepairObservation {
  category: RepairCategory;
  by: "learner" | "coach";
  /** The learner's own words. Empty when `by: "coach"`. */
  variant: string;
}
```

### The signal

One `repairMove` signal per observation, written through the existing door:

```ts
{ kind: "repairMove", payload: { label: category, by, variant, definition: "…" } }
```

`label` is the category code, so Coach can group on it like any other signal, and
`signalMiss` must return `false` for it — a repair move is the opposite of a miss,
and nothing in `coachmetrics.ts` may count one against the learner.

### The inventory is a function

```ts
export interface RepairEntry {
  category: RepairCategory;
  state: "unknown" | "recognises" | "uses" | "fluent";
  /** The learner's own phrasings, most recent first, deduplicated, capped at 5. */
  variants: string[];
  lastUsedAt: number | null;
  total: number;   // learner uses, all time
  last7: number;   // learner uses in the last 7 days
}

export function inventoryFrom(signals: Signal[], now: number): RepairEntry[];
```

State is derived, and only from `by: "learner"` counts except where noted:

- `unknown` — no signal of any kind.
- `recognises` — coach observations only, or a lone learner use. **A learner
  saying they know a pattern changes nothing**: there is no input that writes this,
  which is how §2.2's rule is enforced rather than asserted.
- `uses` — at least 2 learner uses.
- `fluent` — at least 3 learner uses in the last 7 days, spread over at least 2
  distinct days. One session where the learner discovered a phrase and repeated it
  four times is `uses`, not `fluent`.

`nextTarget(inventory)` returns the first category in teaching order whose state is
`unknown` or `recognises`, or `null` when all six are at `uses` or better.

### Checks

`repair.check.ts`:
1. `verifyRepair` accepts a variant that differs from the message only in case and
   punctuation, and rejects one the learner never said — including a plausible
   paraphrase of what they said.
2. `verifyRepair` rejects an unknown category, and rejects an empty variant from a
   `learner` observation.
3. `inventoryFrom` over an empty set returns six entries, all `unknown`, all counts
   zero — no category ever disappears from the list.
4. Coach observations alone produce `recognises`, never `uses`.
5. Four learner uses on one day produce `uses`; three across two days produce
   `fluent`; one learner use produces `recognises`, two produce `uses` — §2.2's
   "a few" is a real threshold.
6. `last7` excludes an 8-day-old use that `total` still counts.
7. `nextTarget` follows the documented order and returns `null` when everything is
   at `uses`; an inventory passed in a different array order still names the same
   first target.
8. Source scan: no file outside `repair.ts` writes a `repairMove` payload, and no
   file constructs a `RepairEntry` literal — the derivation has one door.
9. `signalMiss` returns `false` for a `repairMove` signal, and `coachMetrics`
   accuracy is unchanged by adding twenty of them.

## Do not touch

- `migrateVocabToPerLanguage`, or any existing table.
- The correction / suggestion / goalsMet parts of the turn schema.
- Coach's rendering. PLAN-037 owns the inventory panel; this plan ships the data
  and nothing that shows it.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` prints rows 1–2 asserted.
- A conversation where the learner writes "hold on, let me think" ends with one
  `HOLD` signal carrying those exact words.
- A model that reports a category with a variant the learner never wrote leaves no
  signal behind at all.
- Nothing in the UI changes.

## Commit

```
feat(repair): six repair moves, observed and never claimed (PLAN-027)
```

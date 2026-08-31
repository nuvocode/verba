---
id: PLAN-019
title: Talk — confidence is measured, not seeded
branch: plan/m5-surface-contracts
base: master
status: ready
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/57
milestone: M5 · Surface contracts
---

# PLAN-019: confidence is measured, not seeded

## Context

`src/lib/useTalk.ts`:

```ts
const CONF_START = 50;
…
const [confidence, setConfidence] = useState(CONF_START);
…
setConfidence((c) => Math.min(100, c + gain));
```

The rail shows `50` and a meter half full before the learner has said one word, and
the reflection shows `confDelta = confidence - 50` as though the 50 had been earned.
Invariant 26 — "no measured value is shown before measurement starts" — is failed on
the first paint of the surface the product is named after.

§2.2 defines confidence exactly: **the unprompted-production rate**, from four
components — unaided turn ratio, turn length, suggestion-use ratio, reply latency.
It also says the screen must state that it is a signal and not a score, and that the
claim has to stay true: no reward or punishment language anywhere near it.

PLAN-018 put `ms` on a spoken turn, which is where latency comes from. PLAN-017 made
`fromSuggestion` reliable per turn. Both inputs exist now.

Depends on PLAN-018. Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- `src/lib/confidence.ts` must not import `./db.ts` or React. It takes turns and
  returns a value or `null`.
- **`null` is the value that means "not measured yet"**, and the screen renders `—`
  plus a "measuring" caption for it — never 0, never 50.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/confidence.ts` | NEW | — |
| `src/lib/confidence.check.ts` | NEW | — |
| `src/lib/useTalk.ts` | EDIT | delete `CONF_START`, the `setConfidence` calls, derive instead |
| `src/views/Talk.tsx` | EDIT | the rail's Confidence block, the reflection's stat |
| `src/lib/invariants.check.ts` | EDIT | LEDGER row 26 |

## Specification

### src/lib/confidence.ts

```ts
export interface Turn {
  words: number;         // in the learner's own message
  fromSuggestion: boolean;
  latencyMs: number | null; // time from the coach's line landing to the send; null if unknown
}

/** Below this many turns there is nothing to report. §2.2: "ilk anlamlı turdan önce". */
export const MEASURES_AT = 3;

export interface Confidence {
  value: number;        // 0–100
  turns: number;        // what it was computed from — the screen prints it
  parts: { unaided: number; length: number; suggestion: number; latency: number };
}

/** `null` until MEASURES_AT turns have been produced. Never a placeholder number. */
export function confidence(turns: Turn[]): Confidence | null;
```

The four components, each 0–1, then a plain mean — no tuned weights, because there
is nothing yet to tune them against:

- **unaided** — `1 − suggested / total`.
- **length** — median words per turn against the level's expected turn length, capped
  at 1. The expectation comes from `levelOf(profile)` via a small table in this file;
  a B2 learner producing A1-length turns is not at 100%.
- **suggestion** — the *recency*-weighted version of unaided: the last five turns
  count double, so a learner who needed help early and stopped needing it moves.
- **latency** — a decay over median latency; `null` latencies are excluded, and if
  every latency is null this component drops out of the mean instead of scoring 0.

`parts` is returned so the caption can name what moved, and so the check can pin each
component independently.

### useTalk

- Delete `CONF_START`, `setConfidence`, and the `gain` arithmetic.
- `produced` (already a `ProducedTurn[]`) gains `words` and `latencyMs`; the hook
  timestamps the moment a coach reply finishes rendering and the moment a send fires.
- `confidence` becomes derived: `useMemo(() => confidence(produced), [produced])`,
  typed `Confidence | null`.
- `confDelta` is deleted outright. A delta against a fabricated baseline was the
  original defect; a real one is Coach's job over signals, not this session's.

### The screen

The rail, before measurement:

```
Confidence
—
Measuring. Three turns in, this starts reporting.
```

After:

```
Confidence
64          ← the number, with the meter
Your unprompted-production rate over 7 turns. A signal, not a score.
```

The reflection's fourth stat cell reads the same value from the same source, or
renders nothing at all if it is `null` (PLAN-016's rule: a value that cannot be
computed is not displayed).

**Copy gate.** No "well done", "great", "keep it up", "you dropped", "you lost"
anywhere in the confidence block or the reflection header. `That went well.` — the
current reflection headline — is exactly the language §2.2 forbids beside an
unearned number; replace it with the scenario and the date.

### src/lib/confidence.check.ts

```
// invariant 26
```

1. `confidence([])`, one turn, two turns → all `null`.
2. Three turns → a number, and `turns === 3`.
3. All-suggested turns score strictly below all-unaided turns of the same length.
4. A learner who used suggestions for the first five turns and none for the last
   five scores higher than the reverse order — the recency component is real.
5. All-`null` latencies do not drag the value down: same input with latencies
   removed gives a value within 5 points.
6. **Source scan**: `useTalk.ts` contains no numeric literal assigned to confidence,
   and `Talk.tsx` renders `—` on the `null` branch. Mechanising 26 is the point.

### src/lib/invariants.check.ts

Row 26 → `src/lib/confidence.check.ts`.

## Do not touch

- `session_metrics` and the level estimate. Confidence is a session-local signal;
  the level estimate stays where M4 left it.
- Coach's six metrics. This is not one of them.
- `src/lib/db.ts`.
- No new dependency.

## Acceptance

- `npm run check` green; ledger row 26 asserted.
- A fresh conversation shows `—` and "Measuring" until the third turn.
- Using every suggestion offered visibly lowers the number, and the caption says why.

## Commit

```
feat(talk): confidence is the unprompted-production rate, and shows nothing before it has one (PLAN-019)
```

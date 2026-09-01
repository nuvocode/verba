---
id: PLAN-028
title: The learner's own baseline, and the eight breakdown signals
branch: plan/m6-repair-layer
base: master
status: todo
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/63
milestone: M6 · Repair layer
---

# PLAN-028: baseline and breakdown signals

## Context

Spec §3.1, and §10's third and fourth rows. The collection half of breakdown
detection; PLAN-029 owns the decision.

The spec is explicit that **no threshold is hardcoded**. Four seconds of silence is
a comfortable pause for one learner and a panic for another, so every timing
threshold normalises against that learner's own history. Verba already measures the
input: `ProducedTurn.latencyMs` has been recorded since M5. It goes nowhere — the
turn signal payload carries words, sentences and chars, and drops the timing on the
floor. This plan writes it down and builds the baseline over it.

The contamination problem is real and specific. `coachReplyAt` is stamped when the
reply *text* lands. When `settings.speak` is on, the coach then speaks for several
seconds, and the learner cannot answer while it does. That speaking time is inside
`latencyMs` today, so a learner practising with voice looks slower than the same
learner practising with text. It has to come out.

Depends on PLAN-027. Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- A signal that is unmeasurable is absent, not zero. §10: a turn whose latency
  cannot be separated from the coach's is **excluded**, not estimated.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/breakdown.ts` | NEW | `Baseline`, `baselineFrom`, `turnSignalsFor`, the eight signals |
| `src/lib/breakdown.check.ts` | NEW | the cases below |
| `src/lib/signals.ts` | EDIT | turn payload gains `latencyMs`, `speakMs` |
| `src/lib/useTalk.ts` | EDIT | measure TTS duration; carry it on `ProducedTurn` |
| `src/lib/speech.ts` | EDIT | `speak()` resolves with what it played |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 3–4 |

## Specification

### Separating the coach's time from the learner's

`Tts.speak` currently resolves `Promise<void>`. It becomes `Promise<number>` — the
milliseconds it actually held the floor, measured around `playClip` / the
`SpeechSynthesis` utterance, `0` when it was cancelled before starting and `0` on a
tier that could not speak. Every tier returns it; nobody is required to read it.

`useTalk` keeps a `spokeMs` ref, set from that resolution for the turn currently on
screen, and `ProducedTurn` gains:

```ts
  /** How long the coach's audio held the floor before this send, in ms. 0 when silent. */
  speakMs: number;
  /** True when the coach spoke but the duration could not be measured. */
  speakUnknown: boolean;
```

The measured learner latency is `latencyMs - speakMs`, floored at 0. When
`speakUnknown` is true the turn is **excluded from the baseline and from timing
signals entirely** — §10's rule, implemented as an absence rather than a guess.

### The baseline

```ts
export interface Baseline {
  /** Median measured latency, ms. */
  median: number;
  /** Median absolute deviation, ms — the spread this learner normally has. */
  mad: number;
  /** Measured turns behind it. */
  sample: number;
  /** False until `sample >= BASELINE_MIN`. Everything timing-related stands down. */
  ready: boolean;
}

export const BASELINE_MIN = 12;
export function baselineFrom(signals: Signal[], now: number): Baseline;
```

Median and MAD rather than mean and standard deviation: one 90-second turn where
the learner answered the door should not move the bar for the next month.

`baselineFrom` reads `unpromptedTurn` and `suggestionUsed` signals across the last
30 days for that language, takes those carrying a measured latency, and ignores the
rest. Below `BASELINE_MIN` it returns `ready: false` and **no timing signal is ever
emitted** — §10's "signals are unreliable" row, which is also why the first sessions
of a new learner are quiet by construction rather than by a special case.

### The eight signals

```ts
export type BreakdownSignal =
  | "slowResponse"      // measured latency > median + 3 × mad
  | "disconnected"      // the reply does not answer what was asked
  | "overGeneral"       // "yes", "maybe", "sure" and nothing else
  | "apologyThenOn"     // "sorry"/"pardon" followed by carrying on
  | "keyWordMissing"    // the coach's key word appears nowhere in the reply
  | "topicChange"       // the reply starts a different subject
  | "hesitation"        // audible: broken delivery in the RMS envelope
  | "shortening";       // this turn is far shorter than the learner's own norm
```

Three are measured here, in code, and are the ones the checks can be strict about:

- **slowResponse** — from the baseline above. `3 × mad` is a deliberately quiet bar.
- **shortening** — this turn's word count below half the learner's median turn
  length, computed from the same signal window as the baseline, and only when that
  median stands on `BASELINE_MIN` turns.
- **hesitation** — from `VoiceTurn.levels`, the envelope `record()` already returns:
  a turn whose speech ratio is under 0.4 *and* which contains two or more pauses
  over 600 ms, using the same 0.02 RMS threshold `voiceSignals` uses. Text-only
  turns never carry it, which is §10's first row falling out for free rather than
  being special-cased.

Five are judgements about meaning, and Verba has exactly one component that can make
those. They ride the turn JSON `buildSystem` is already producing, in the same style
as PLAN-027's `repair` field:

```
"missed": ["disconnected", "overGeneral", "apologyThenOn", "keyWordMissing", "topicChange"]
```

with the instruction: list only what is *observably* true of the learner's last
message, an empty list is the normal answer, and never guess at what they were
thinking. `parseTurn` drops any member that is not one of those five strings.

`keyWordMissing` gets one extra gate on our side: `buildSystem` also asks for
`"keyWord"` — the one word in the coach's own last line that carries the meaning —
and `breakdown.ts` verifies the claim itself, by checking that word's absence from
the learner's reply. A model that reports `keyWordMissing` about a word the learner
plainly used has that member dropped. The same principle as PLAN-027: the model may
point; we check.

`turnSignalsFor(turn, baseline, ctx)` returns the `BreakdownSignal[]` for one turn
by combining the measured three with the verified model-reported five.

### What is stored

Nothing new is stored as its own row type. The per-turn breakdown signals ride the
existing turn signal's payload as `breakdown: BreakdownSignal[]`, so a week of
conversation can be re-derived without a schema change, and `signalMiss` continues
to return `false` for those turns — **a breakdown is not a mistake**, and no metric
in `coachmetrics.ts` may move because one was observed.

### Checks

`breakdown.check.ts`:
1. `baselineFrom` with 11 measured turns returns `ready: false`; with 12, `true`.
2. A single 90-second outlier among twelve 4-second turns does not move `median`
   more than 500 ms — the MAD/median choice, asserted, not asserted-in-a-comment.
3. A turn with `speakUnknown` is excluded from the sample entirely: adding ten of
   them changes neither `median` nor `sample`.
4. `latencyMs - speakMs` is what is measured: two turns identical except that one
   had 6 s of coach audio produce the same measured latency.
5. `slowResponse` does not fire below `median + 3 × mad`, and does fire above it.
6. No timing signal is produced at all when `ready` is false, however extreme the
   latency.
7. `hesitation` fires on a synthetic envelope with two long gaps, and never on a
   turn with no `levels` at all.
8. `keyWordMissing` reported by the model is dropped when the key word is present in
   the reply (including with different case and trailing punctuation).
9. An unknown string in `missed` is dropped and the rest survive.
10. Source scan: `coachmetrics.ts` accuracy and comprehension are unchanged by
    adding breakdown payloads to every turn signal in a fixed set.

## Do not touch

- The bluff decision. PLAN-029 owns it; this plan produces signals and draws no
  conclusion from them.
- `voiceSignals`' existing pace and delivery drafts.
- The 0.02 RMS constant's home. It is still duplicated on purpose; if this plan
  makes it a third copy, move it to a shared constant instead.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` rows 3–4 asserted.
- A new learner's first eleven turns produce no timing signals of any kind.
- With voice on, the coach's own speaking time is not counted as the learner's
  thinking time — verifiable by comparing a spoken and a typed session of the same
  script.
- Nothing in the UI changes.

## Commit

```
feat(repair): a baseline that belongs to the learner, and the signals it grades (PLAN-028)
```

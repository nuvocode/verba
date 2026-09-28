---
id: PLAN-040
title: The six timing numbers, and the two that cannot be measured honestly
branch: plan/m7-fluency
base: PLAN-039
status: done
executor: unassigned
created: 2026-09-04
issue: https://github.com/nuvocode/verba/issues/70
milestone: M7 · Fluency & monitor load
spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §2.1
roadmap: docs/plans/M7-roadmap.md (D1, D2, D3)
---

# PLAN-040: the timing signals

## Context

Spec §2.1: six numbers per spoken turn. PLAN-039 built the place they go and the
switch that stops them; this plan is the first that actually measures something.

Two of the six cannot be computed the way the spec defines them, and the roadmap
already settled what to do instead:

- **D1** — there is no syllable counter and a correct one is per-language. Every
  rate is counted in **words**, and the payload's `unit` and `definition` say so.
  Invariant 12 is the reason this is allowed to be a deviation rather than a lie:
  the number on screen names what it is. Every use in §3.1 and §5.2 compares the
  learner against themselves, and a unit that is consistent is worth more there
  than one that is canonical.
- **D2** — there are no word-level timestamps, so a pause cannot be placed inside
  the transcript. `midClausePauseRatio` ships as a **lower bound**: the pauses the
  clause boundaries cannot account for, over all pauses. It under-reports and
  never over-reports, which is the right direction for the one number §6.1 has
  the coach read out loud.

And one rule from D3 governs the whole file: **a number that cannot be measured
is absent, not zero.** `speakUnknown` is the precedent already in the repo.

Second plan on `plan/m7-fluency`, on top of PLAN-039.

## What this measures, and what it deliberately does not

The `timing` signal is written **once per spoken recording**, never for a typed
turn.

That is a narrowing of §2.1 and it is deliberate. A typed turn's "latency" is
typing speed, keyboard familiarity and how long the learner stared at the box —
three things that are not the formulation pressure this layer exists to measure.
Filing them under the same name would put an unrelated number into §3.1's
comparisons. The written side of this layer is `spoken: false` on the turn payload
(PLAN-039), and it feeds the **accuracy** comparison, not the timing one.

The signal is built from `VoiceTurn` alone — text, duration, envelope, locale —
and not from a `ProducedTurn`. `voice.current` and `produced.current` are separate
arrays that can already drift (a recording the learner abandons, two recordings
into one send), so joining them would be a source of quiet mismatches for no gain.
One recording, one measurement of that recording.

## Repo conventions

- **No new dependencies.** No new files.
- `fluency.ts` stays pure: no provider, no `./db.ts`, no React, no clock.
- **No third copy of the speech floor.** `SPEECH_FLOOR` lives in `breakdown.ts`
  (itself the second copy of `speech.ts`'s detector floor, and the comment there
  says so). Every envelope reader this plan adds goes *beside* it, and
  `countPauses` is refactored to call the new general one rather than gaining a
  twin.
- Every number carries a `unit` and a `definition` (invariant 12), and the
  definition is the one a learner reads, not the one a developer would write.
- Style and check conventions as in PLAN-015. `npm run check` green.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/breakdown.ts` | EDIT | `countPauses`, beside `speechRatio` |
| `src/lib/breakdown.check.ts` | EDIT | the pause-count assertions |
| `src/lib/text.ts` | EDIT | after `sentenceCount` |
| `src/lib/fluency.ts` | EDIT | after `sessionContextSignal` |
| `src/lib/fluency.check.ts` | EDIT | new sections 7–9 |
| `src/lib/useTalk.ts` | EDIT | `VoiceTurn`, `mic()` |
| `src/lib/signals.ts` | EDIT | `voiceSignals`, `talkSignals` |
| `src/lib/invariants.check.ts` | EDIT | `FLUENCY_LEDGER` rows 1 and 3 |

## Specification

### 1. `breakdown.ts` — one pause detector, three readers

`countPauses` currently hardcodes 0.6 s. Generalise it and keep the caller's
meaning byte for byte:

```ts
/**
 * The gaps in an envelope longer than `minSec`, in seconds, at ~20 frames/s.
 * The single pause detector — `countPauses` and every timing signal read through
 * it, so "a pause" means one thing in this repo.
 *
 * Leading silence is not a pause: a learner who opened the mic and thought for
 * three seconds has not paused mid-utterance, they have not started. That gap is
 * `leadingSilence`, and it belongs to `initiationLatency`.
 */
export function pauseLengths(levels: number[], minSec: number): number[];

/** Pauses over 600 ms — what the hesitation checker has always counted. Unchanged. */
export const countPauses = (levels: number[]): number => pauseLengths(levels, 0.6).length;

/**
 * Silence before the first speech frame, in ms. The learner's own hesitation
 * before starting — part of initiation, never a pause. Returns null for an
 * envelope with no speech frame at all: a recording that caught nothing measures
 * nothing.
 */
export function leadingSilence(levels: number[]): number | null;

/**
 * How many runs of speech an envelope holds, separated by pauses over `minSec`.
 * `meanLengthOfRun`'s divisor. 0 for an envelope with no speech.
 */
export function speechRuns(levels: number[], minSec: number): number;
```

**`countPauses` must keep returning exactly what it returns today.** M6's
`hesitation` signal is gated on `countPauses(levels) >= 2`, which feeds
`judge()`, which decides whether the coach interrupts a learner. Moving that by
one is a behaviour change in M6 with no plan behind it. `breakdown.check.ts` keeps
its existing assertions unchanged, and gains one: `countPauses(x)` equals
`pauseLengths(x, 0.6).length` for a hand-built envelope.

Note the leading-silence exclusion is a *change* in `countPauses`'s current
implementation — today's loop starts `quiet = 0` and only counts a gap once a
speech frame has been seen, so leading silence is already excluded. Confirm this
when refactoring rather than assuming it; if it is not, the existing behaviour
wins and `pauseLengths` is written to match it.

### 2. `text.ts` — clause boundaries

```ts
/**
 * How many clauses `text` holds, near enough. `Intl.Segmenter` has word and
 * sentence granularity and no clause granularity, so this is sentences plus the
 * punctuation that opens a clause inside one: , ; : and their CJK forms.
 *
 * Never returns 0, so it is safe as a divisor and as a subtrahend.
 *
 * ponytail: punctuation, not a parser. It misses an unpunctuated coordinate
 * clause ("I went home and I ate") and over-counts a list ("bread, milk, eggs").
 * Both errors make `midClausePauseRatio` report *fewer* mid-clause pauses than
 * there are, which is the safe direction — see D2. A dependency parser per pack
 * is the upgrade, and it is not worth it until a learner disputes the number.
 */
export function clauseCount(text: string, locale: string): number;
```

The boundary set is `[,;:、，；：]`. It is written once, here, and no other file
carries a copy.

### 3. `fluency.ts` — the six numbers

```ts
/** What one spoken recording measured (§2.1). Every field may be null: absent, never zero. */
export interface Timing {
  /** ms from the coach finishing to the learner's first sound. Null when unmeasurable. */
  initiationLatency: number | null;
  /** words per minute over the whole recording, pauses included. */
  speechRate: number;
  /** words per minute over the speaking time only. */
  articulationRate: number;
  /** mean words per run of speech, runs separated by pauses over 250 ms. */
  meanLengthOfRun: number;
  /** 0–1, a lower bound (D2). Null when the recording holds no pause at all. */
  midClausePauseRatio: number | null;
  /** filled pauses per 100 words. Null for a pack with no filler list. */
  filledPauseRate: number | null;
}

export function timingOf(v: VoiceTurn, packId: string): Timing | null;
export function timingSignal(activityId: ActivityId, t: Timing): SignalDraft;
```

`timingOf` returns `null` — no signal at all — when the recording has no words, no
envelope, or is under 1.5 s. That is the same floor `voiceSignals`'s `pace` already
uses, and for the same reason: a one-word answer has no tempo.

The arithmetic, in words, so the check can be read against it:

| Field | Computed from |
|---|---|
| `initiationLatency` | `v.initiationMs` (below) + `leadingSilence(v.levels)`. Null when either is null |
| `speechRate` | `words / (v.ms / 60000)` |
| `articulationRate` | `words / ((v.ms × speechRatio(v.levels)) / 60000)` |
| `meanLengthOfRun` | `words / max(1, speechRuns(v.levels, 0.25))` |
| `midClausePauseRatio` | `max(0, P − (clauseCount − 1)) / P`, where `P = pauseLengths(v.levels, 0.25).length`. Null when `P === 0` |
| `filledPauseRate` | `100 × fillers / words`. Null when the pack has no list |

`speechRatio` returns 1 for an empty envelope, which would make
`articulationRate` equal `speechRate` — but `timingOf` has already returned null
for an empty envelope, so that path is unreachable. Say so in a comment rather
than adding a second guard.

**The filler list.** No pack schema field, and adding one means touching every
pack, the validator and the community-pack contract for six words. Instead a map
in `fluency.ts` keyed by pack id with an `en` fallback — the same shape and the
same nine locales as `OFFER_LINE` in `patience.ts`, which is the precedent:

```ts
/** Filled pauses, per pack. Matched as whole words against `words(text, locale)`. */
export const FILLERS: Record<string, string[]> = {
  en: ["uh", "um", "er", "like", "well"],
  es: ["eh", "este", "pues", "o", "sea"],   // ← "o sea" is two words; see the note
  tr: ["şey", "yani", "işte", "hani"],
  …
};
```

A multi-word filler ("o sea", "you know") cannot be matched against a word list.
Ship single words only and say so in the comment: a missed filler under-reports,
which is the safe direction, and the alternative is a phrase matcher for a number
nobody reads on its own.

`timingSignal`'s payload carries every field plus, per invariant 12:

```
label:      "spoken timing"
unit:       "words per minute, ms, ratio"
definition: "how fast you spoke, how long before you started, and where you paused"
```

**And the payload carries no `correct` and no `grade`** — `signalMiss` reads those
regardless of kind (PLAN-039's third finding), and `fluency.check.ts`'s source
scan already fails the build if one appears.

### 4. `useTalk` — the initiation clock

`VoiceTurn` gains one field:

```ts
  /**
   * ms from the coach finishing its line to the learner opening the mic (§2.1's
   * `initiationLatency`, before the leading silence inside the recording is
   * added). Null when the coach was still speaking at mic-open, or when there
   * was no coach line to measure from — an unmeasured initiation is absent, not
   * an instant one. The same rule `speakUnknown` follows.
   */
  initiationMs: number | null;
```

Computed in `mic()` at the moment recording starts, from the clocks that already
exist:

```ts
const initiationMs =
  speaking.current || coachReplyAt.current === null
    ? null
    : Math.max(0, performance.now() - coachReplyAt.current - spokeMs.current);
```

`speaking.current` being true is the whole guard: the coach still has the floor,
so `spokeMs` holds only part of this turn's audio and the subtraction would
under-count. That is exactly `floorInProgress`'s reasoning in `send()`, applied at
the other end.

### 5. `signals.ts` — one more draft, behind the same gate

`voiceSignals` gains a `timing` draft. It is a monitor kind, so it is written
**only when the session has a context** — `r.context` non-null is the in-band form
of `monitorLoad`, and it is already the gate `sessionContext` uses. One gate, two
readers, and `talkSignals` stays pure.

That means `voiceSignals` needs the context and the pack id. Rather than widen its
signature for two callers, `talkSignals` does the filtering:

```ts
    ...(r.voice ?? []).flatMap((v) => voiceSignals(activityId, v)),
    // §2.1's six timing numbers, one per spoken recording. A monitor kind, so it
    // rides the same gate `sessionContext` does: no context means the learner
    // has the measurement off, and nothing here is written.
    ...(r.context ? timingSignals(activityId, r.voice ?? [], packId) : []),
```

`pace` and `pronunciation` are **not** moved behind the gate. They are M6 signals
that predate this layer and Coach already reads them; putting them behind M7's
switch would silently take two numbers off a screen the learner has been reading
for two milestones.

`talkSignals` gains a `packId` parameter. It already takes `locale`; the pack id is
the second thing the fillers need and there is no way to derive one from the other.

### 6. `fluency.check.ts` — sections 7, 8, 9

```
// fluency ledger 1
// fluency ledger 3
```

**7 — the six numbers.** Hand-built envelopes at 20 frames/s, so every expected
value is arithmetic a reader can do:

1. A 60-frame envelope (3 s) all above the floor, six words → `speechRate` 120,
   `articulationRate` 120, `meanLengthOfRun` 6, `midClausePauseRatio` null (no
   pause), `speechRate === articulationRate` because nothing was silent.
2. The same six words over 3 s of speech with a 1 s gap in the middle →
   `articulationRate` stays 120 while `speechRate` drops. **This is the pair §2.1
   says matters** ("ikisi yakınsa… arada büyük fark varsa…"), so it is asserted as
   a relationship, not just two numbers.
3. `meanLengthOfRun` halves when one pause splits an even recording in two.
4. `timingOf` returns null for: no words, no envelope, and a recording under
   1.5 s. Null, not a zeroed `Timing`.
5. `initiationLatency` is null when `initiationMs` is null, **even when the
   envelope has a perfectly good leading silence.** An absent half makes the whole
   absent — the assertion is on `null`, not on the leading silence alone.

**8 — `midClausePauseRatio` is a bound, and it is a bound in more than one
language (`fluency ledger 3`).** For each of `es`, `tr` and `ja`:

- a one-clause utterance with three pauses → ratio 1 (nothing accounts for them);
- an utterance with as many clause boundaries as pauses → ratio 0;
- more clause boundaries than pauses → ratio 0, never negative;
- no pauses at all → null, never 0. A learner who did not pause did not pause
  mid-clause, and `0` is the answer to a different question.

`ja` is in the list on purpose: it is the language whose clause punctuation
(`、`) is not in the Latin set, and the check is what proves the boundary set is
not Latin-only. This is ledger row 3's whole content — "cümle sınırı tespiti
hedef dilde test edildi".

**9 — the signal, and the gate (`fluency ledger 1`).**

1. `timingSignal`'s payload carries a `label`, a `unit` and a `definition`, all
   non-empty (invariant 12), and no `correct` or `grade`.
2. Every rate's `unit` says **words**, not syllables — D1 written down where it
   cannot drift back.
3. A `Reflection` with voice and `context: null` produces **no** `timing` draft;
   the same reflection with `FREE_CONTEXT` produces exactly one per qualifying
   recording. This is `fluency ledger 12` extended to the first kind that
   actually measures something, and it is the assertion that makes row 1's
   "stored with its context" true rather than claimed.
4. `pace` and `pronunciation` are still produced when `context` is null — M6's
   signals do not disappear behind M7's switch.

### 7. `FLUENCY_LEDGER`

Rows 1 and 3 stop being `pending`:

| id | claim | now |
|---|---|---|
| 1 | §2's signals are computed from transcript + audio and stored with their context | `fluency.check.ts`, `fluency ledger 1` |
| 3 | Clause-boundary detection for `midClausePauseRatio` is tested in the target language | `fluency.check.ts`, `fluency ledger 3` |

Row 1 says "§2's signals" and §2 is three subsections; this plan builds §2.1 only.
The row stays honest because PLAN-041 and PLAN-042 add their assertions under the
same marker — the ledger row is closed when the marker exists, and it is the
plans, not the row, that carry the remaining subsections.

## Do not touch

- `countPauses`'s return value. `judge()` decides whether the coach interrupts a
  learner off it.
- `voiceSignals`'s existing two drafts, their payloads, or their thresholds.
- `coachMetrics`. Its `fluency` metric is still the unaided-turn share.
- Anything a learner can see. This plan renders nothing. `midClausePauseRatio`
  reaching a screen is PLAN-046's, and it may not arrive before §3.2's sample
  gates exist to hold it back.

## Acceptance

- `npm run check` green.
- A spoken Talk turn over 1.5 s with the measurement on writes exactly one
  `timing` signal; with it off, none, and `pace`/`pronunciation` are unaffected.
- A typed turn writes no `timing` signal at all.
- A recording made while the coach was still speaking writes a `timing` signal
  whose `initiationLatency` is `null` — not 0.
- `FLUENCY_LEDGER` rows 1 and 3 point at real markers; nine rows still pending.

## Commit

```
feat(fluency): six timing numbers per spoken turn, two of them honestly bounded (PLAN-040)
```

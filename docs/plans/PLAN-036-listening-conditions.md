---
id: PLAN-036
title: Real listening conditions, honestly graded
branch: plan/m6-repair-layer
base: master
status: done
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/68
milestone: M6 · Repair layer
---

# PLAN-036: real listening conditions

## Context

Spec §8. A learner who understands one clean voice in a quiet room freezes at a
train station, and the gap is not vocabulary.

Five variables, each graded, at most two hardened at once. And one rule that is more
important than any of them: **a grade the speech engine cannot actually produce is
not shown, and never faked.** Verba's four TTS tiers differ enormously in what they
can do; pretending otherwise means a learner "practising fast speech" against audio
that is not fast, and then wondering why the real world still defeats them.

Lands on top of PLAN-035's commit (`1eb545a`).

## Repo conventions

- **No new dependencies.** WebAudio is in the platform; that is the whole toolbox.
- A capability is proven, not assumed. `seekable` already sets this precedent in
  `speech.ts` and this plan follows it.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/conditions.ts` | NEW | the five variables, grades, `supported`, `applyTo`, the walk |
| `src/lib/conditions.check.ts` | NEW | the cases below |
| `src/lib/speech.ts` | EDIT | `Tts.can`: what this tier can honestly do |
| `src/lib/settings.ts` | EDIT | `listeningGrades` — persisted, invisible |
| `src/lib/model.ts` | EDIT | one `SignalKind`: `listenWalkBack` |
| `src/lib/weakness.ts` | EDIT | its `CATEGORY` entry (the record is exhaustive) |
| `src/lib/signals.ts` | EDIT | the walk-back signal |
| `src/lib/useListening.ts` | EDIT | pick, apply, walk back, replay |
| `src/views/Listening.tsx` | EDIT | the grades that exist |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` row 20 |

## Specification

### The five variables

```ts
export const CONDITIONS = {
  pace:     ["teaching", "natural", "fast"],
  accent:   ["standard", "regional"],
  noise:    ["clean", "light", "loud"],
  channel:  ["clear", "phone"],
  speakers: ["one", "two", "overlapping"],
} as const;
```

Grade 0 of every variable is the current behaviour, so a tier that supports nothing
still produces exactly today's Listen.

### What is honest, per tier

`Tts` gains one field, declared by each tier rather than inferred:

```ts
  /** What this tier can actually do to its output. Absent capabilities are never offered. */
  can: {
    rate: boolean;
    voices: number;
    /** Whether the tier hands back audio we hold — the only kind we can filter. */
    filterable: boolean;
  };
```

The draft of this plan had only `rate` and `voices`, and then said noise and channel
are "ours to apply, in code, on the clip, and therefore honest on any byte tier" —
while `supported` never checked whether there *was* a byte tier. **That is the bug
this plan exists to prevent, written into the plan itself.** `webSpeech` has no
`clip()` at all (`seekable: false`, and `Tts.clip` is optional precisely because of
it): the browser speaks and we never see a sample. There is nothing to band-pass and
nothing to mix noise under. `filterable` is that fact, declared, and `supported`
reads it.

- **rate** — all four tiers honour it today: `webSpeech` and `bundledTts` directly,
  the byte tiers through `playbackRate` (PLAN-030, landed). The field still exists,
  because the next tier someone adds may not.
- **voices** — how many distinct voices this tier can produce for one locale. One
  voice means `speakers` stops at grade 0.
- **filterable** — true exactly where `clip()` exists.

Three of the five are ours to apply, on a clip we hold:

- **noise** — WebAudio: a generated noise buffer mixed under the clip at a known
  ratio. Generated, not an asset, so nothing is bundled. Needs `filterable`.
- **channel** — WebAudio: a band-pass at 300–3400 Hz, which is what a telephone line
  is. Not an imitation of phone quality; the actual bandwidth limit. Needs
  `filterable`.
- **pace** — `playbackRate` / `rate`. Needs `rate`.

Two are not, and the plan says so rather than approximating them:

- **accent** — a property of the voice model. Offered only where the tier exposes
  more than one voice for the pack's locale; otherwise the variable does not appear.
  There is no filter that turns one accent into another, and a plan that adds one
  has invented a capability.
- **speakers** — real only where `can.voices >= 2`: two voices means two synthesis
  calls with different voices, and `overlapping` means overlapping playback of the
  two clips. On a one-voice tier, both grades are absent.

`supported(tts, pack)` returns the grades that are genuinely available.
`Listening.tsx` renders that, so an unsupported grade is not disabled-with-a-tooltip
— it is not there. The `webSpeech` tier's degraded state (M5, PLAN-025) is where
most absences will show, and that is the honest outcome.

### The playback path is not to be destabilised

The clip is an `HTMLAudioElement` (`Clip.el`, from a blob URL) and `playClip` in
`speech.ts` resolves on `ended` / `error` / cancel. That contract is load-bearing:
a clip that never resolves once left `speaking.current` stuck true and killed a
whole session (PLAN-030). Routing the element through a WebAudio graph must leave
every one of those three paths resolving exactly as it does now. Do not restructure
`playClip`; wrap around it.

### At most two

`applyTo(clip, active)` refuses more than two non-zero variables — a type-level
`[] | [Active] | [Active, Active]` rather than a runtime check, so a third cannot be
passed at all. Keep a runtime guard beside it for JS callers, and assert both.

### Where the grades live

`settings.listeningGrades: Partial<Record<Variable, number>>`, persisted and
appearing in **no settings screen** — the same shape and the same justification as
`difficultyStep` (PLAN-031): it is a fact about the learner, and §8's walk-back and
hardening are the only controls. Without persistence, hardening means nothing: every
session would restart at grade 0 and no learner would ever meet a harder condition
twice.

### Walking back, not skipping

§8's most important sentence: on failure the variable is **walked back until it is
understood**, and the activity is not skipped, because the thing being learned is
asking for repair under pressure.

So a missed comprehension question in a hardened chapter drops the hardest active
variable by one grade and **replays the same chapter**, down to grade 0 if that is
what it takes. It never advances to the next chapter to escape, and it never
abandons the piece.

A replay is a replay: the chapter's `ChapterProgress` is reset — `answers` cleared
and `heard` back to false — so the questions are asked again against the new audio.
Leaving the old wrong answer standing would make the walk-back a relabelling of a
failure rather than a second attempt at it.

The two halves happen at different moments, and that separation is load-bearing.
The **grade** eases the instant the question is missed — that is the consequence
of the miss, not of a button. The **reset** waits for the learner to replay,
because PLAN-026's miss panel renders on `results[step] === false`: clearing the
results in the tick that recorded them deletes the answer, the reason and the
replay-that-part button before they are ever drawn, and drops the miss out of
`graded`, which is what the comprehension signals are built from — so the number
could only ever read 100%. One miss eases one grade: the replay that follows a
miss does not ease a second.

And a session with no active condition is today's Listen in every respect,
including what a miss does: nothing eases, so nothing is reset. Every learner
starts at grade 0, so this is the common path, not the edge case.

Hardening is the mirror: a chapter answered correctly at the current setting raises
one variable one grade, at most one per chapter, never announced (PLAN-031's rule,
same reasoning).

### The walk-back is not a miss, and needs its own kind

The walk-back is recorded — §8 wants the record of what defeated the learner — but
it must not move the comprehension number. It cannot ride on the `comprehension`
kind: `coachMetrics` computes comprehension as `!signalMiss(s)` over exactly that
kind, and `signalMiss` reads `correct === false`, so a walk-back written as a wrong
comprehension answer would score it as one.

So: one new `SignalKind`, `listenWalkBack`, carrying the variable and the grade it
walked back from. `weakness.ts`'s `CATEGORY` record is exhaustive over `SignalKind`
and needs an entry — the same bookkeeping PLAN-034's `rehearsal` marker needed, for
the same reason.

### Checks

`conditions.check.ts`:

1. `supported` returns no `speakers` grade above `one` for a `can.voices === 1`
   tier, and no `accent` grade above `standard` where the locale has one voice.
2. `supported` on a tier with `rate: false` omits every `pace` grade above
   `teaching`; on a tier with `filterable: false` it omits every `noise` and
   `channel` grade above grade 0. Assert the `webSpeech` tier's real declaration,
   not a fixture — a hand-built tier object proves only that the fixture was
   written correctly.
3. `applyTo` cannot be called with three variables: a `@ts-expect-error` for the
   type-level half and a thrown error for the runtime half.
4. **The graph, not the sound.** Node has no WebAudio — `AudioContext`,
   `OfflineAudioContext` and `AudioBuffer` are all absent — so a check cannot
   measure the output, and writing a second, plain-JS biquad to test against would
   be a second door that proves nothing about `BiquadFilterNode`. What is asserted
   instead is the graph `applyTo` *requests*, against a recording stub: for
   `channel: "phone"`, one band-pass in series with the source at 300–3400 Hz; for
   `noise`, a gain node at the grade's ratio with a generated buffer, and the
   source untouched. The numbers in the assertion are this plan's numbers. The
   sound itself is an acceptance criterion, checked by a person.
5. `applyTo` with any `noise` grade does not change the clip's duration, and
   `applyTo` with no active variables returns the source untouched — grade 0 is
   today's Listen, byte for byte.
6. A wrong answer walks back the hardest active variable by exactly one grade and
   returns the same chapter index.
7. Walking back from grade 1 reaches grade 0 and stops there; the activity is never
   marked skipped, and the piece is never abandoned. Drive it from the production
   path, ten failures deep.
8. A correct answer hardens at most one variable by one grade.
9. A replay clears that chapter's `answers` and its `heard` flag. Without this the
   walk-back is a relabelling, not a second attempt. Beside it: a miss leaves the
   result, the answer, `heard` and the `graded` row standing (the miss panel and
   the comprehension number both read them), and eases exactly one grade — the
   replay that follows does not ease a second. At grade 0 a miss changes nothing
   at all.
10. The walk-back signal is not a miss: `signalMiss` is false for it, and
    `coachMetrics`'s comprehension is byte-identical across ten of them. Assert the
    metric, not just the predicate.
11. Source scan: `Listening.tsx` renders only grades from `supported`, and no
    string in it names a variable the tier cannot apply. Probed with a seeded
    violation.
12. `listeningGrades` is in `defaultSettings`, survives a settings round-trip, and
    appears in no settings panel — the same three assertions `difficultyStep`
    carries.

**On the checks themselves.** Cases 2, 7 and 10 are the ones that pass vacuously if
written against fixtures instead of the production path. Each must fail when its own
rule is removed — verify by removing it and running, not by reading.

## Do not touch

- The chapter generation flow, and PLAN-025's timeline API.
- `playClip`'s settle contract in `speech.ts`. Wrap the element; do not restructure
  the resolve paths.
- The TTS tier list. This plan asks each tier what it can do; it does not add one,
  and it does not bundle an engine to make a grade possible.
- The transcript / assisted-signal behaviour from PLAN-026.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` row 20 asserted.
- On a one-voice tier, the speakers and accent grades are not on screen at all.
- On the `webSpeech` tier, noise and channel are not on screen either.
- A phone-quality chapter measurably loses its high end — listened to, by a person.
- Getting a hardened chapter wrong replays it easier, with its questions asked
  again, and never skips it.
- A grade earned in one session is still there in the next.

## Commit

```
feat(listen): graded listening conditions, and none the engine cannot honestly produce (PLAN-036)
```

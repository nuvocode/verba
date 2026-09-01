---
id: PLAN-036
title: Real listening conditions, honestly graded
branch: plan/m6-repair-layer
base: master
status: todo
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

Independent of the Talk chain. Lands here because its empty behaviour — a grade that
simply is not offered — is best written alongside PLAN-037's empty states.

## Repo conventions

- **No new dependencies.** WebAudio is in the platform; that is the whole toolbox.
- A capability is proven, not assumed. `seekable` already sets this precedent in
  `speech.ts` and this plan follows it.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/conditions.ts` | NEW | the five variables, grades, `supported`, `applyTo` |
| `src/lib/conditions.check.ts` | NEW | the cases below |
| `src/lib/speech.ts` | EDIT | `Tts.can`: what this tier can honestly do |
| `src/lib/useListening.ts` | EDIT | pick, apply, walk back |
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
  can: { rate: boolean; voices: number };
```

- `rate` — `webSpeech` and `bundledTts` honour it directly; the byte tiers honour it
  through `playbackRate` once PLAN-030 lands. So all four are `true` after M6, and
  the field still exists, because the next tier someone adds may not be.
- `voices` — how many distinct voices this tier can produce in one piece. One voice
  means `speakers` stops at grade 0.

Three of the five are ours to apply, in code, on the clip, and are therefore honest
on any byte tier:

- **noise** — WebAudio: a generated noise buffer mixed under the clip at a known
  ratio. Generated, not an asset, so nothing is bundled.
- **channel** — WebAudio: a band-pass around 300–3400 Hz, which is what a telephone
  line is. Not an imitation of phone quality; the actual bandwidth limit.
- **pace** — `playbackRate` / `rate`, as above.

Two are not, and the plan says so rather than approximating them:

- **accent** — a property of the voice model. Offered only where the tier exposes
  more than one voice for the pack's locale; otherwise the variable does not appear.
  There is no filter that turns one accent into another, and a plan that adds one has
  invented a capability.
- **speakers** — real only where `can.voices >= 2`: two voices means two synthesis
  calls with different voices, and `overlapping` means overlapping playback of the
  two clips. On a one-voice tier, both grades are absent.

`supported(tts, pack)` returns the grades that are genuinely available. `Listening.tsx`
renders that, so an unsupported grade is not disabled-with-a-tooltip — it is not
there. The `webSpeech` tier's degraded state (M5, PLAN-025) is where most absences
will show, and that is the honest outcome.

### At most two

`applyTo(clip, active)` refuses more than two non-zero variables — a type-level
`[Variable] | [Variable, Variable]` rather than a runtime check, so a third cannot be
passed at all.

### Walking back, not skipping

§8's most important sentence: on failure the variable is **walked back until it is
understood**, and the activity is not skipped, because the thing being learned is
asking for repair under pressure.

So a missed comprehension question in a hardened chapter drops the hardest active
variable by one grade and **replays the same chapter**, down to grade 0 if that is
what it takes. It never advances to the next chapter to escape, and it never
abandons the piece. A learner who walks all the way back to clean audio and then
understands has learned something true about what defeated them, and the walk-back
itself is recorded as a signal — not as a miss.

Hardening is the mirror: a chapter answered correctly at the current setting raises
one variable one grade, at most one per chapter, never announced (PLAN-031's rule,
same reasoning).

### Checks

`conditions.check.ts`:
1. `supported` returns no `speakers` grade above `one` for a `can.voices === 1` tier,
   and no `accent` grade above `standard` where the locale has one voice.
2. `supported` on a tier with `rate: false` omits every `pace` grade above
   `teaching`.
3. `applyTo` cannot be called with three variables — a type-level assertion plus a
   runtime guard for JS callers.
4. `applyTo` with `channel: "phone"` produces audio whose energy above 4 kHz is
   materially lower than the input's — measured with an `OfflineAudioContext`, so the
   filter is proven to have run rather than assumed.
5. `applyTo` with `noise: "loud"` raises the noise floor and does not change the
   clip's duration.
6. A wrong answer walks back the hardest variable by exactly one grade and returns
   the same chapter index.
7. Walking back from grade 1 reaches grade 0 and stops there; the activity is never
   marked skipped.
8. A correct answer hardens at most one variable by one grade.
9. The walk-back signal is not a miss: `signalMiss` is false for it and
   `coachMetrics` comprehension is unchanged by ten of them.
10. Source scan: `Listening.tsx` renders only grades from `supported`, and no string
    in it names a variable the tier cannot apply. Probed with a seeded violation.

## Do not touch

- The chapter generation flow, and PLAN-025's timeline API.
- The TTS tier list. This plan asks each tier what it can do; it does not add one,
  and it does not bundle an engine to make a grade possible.
- The transcript / assisted-signal behaviour from PLAN-026.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` row 20 asserted.
- On a one-voice tier, the speakers and accent grades are not on screen at all.
- A phone-quality chapter measurably loses its high end.
- Getting a hardened chapter wrong replays it easier, and never skips it.

## Commit

```
feat(listen): graded listening conditions, and none the engine cannot honestly produce (PLAN-036)
```

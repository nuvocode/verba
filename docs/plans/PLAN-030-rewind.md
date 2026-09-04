---
id: PLAN-030
title: The coach stops and owns it
branch: plan/m6-repair-layer
base: master
status: done
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/64
milestone: M6 · Repair layer
---

# PLAN-030: rewind behaviour

## Context

Spec §4. The most delicate interaction in the product. Everything before this plan
is arithmetic nobody sees; this is the moment a person is told, in effect, *I think
you missed that*, and the spec's warning is not decoration: in the wrong tone the
learner feels caught, feels stupid, and leaves.

So the design gives the blame away. The coach went too fast. Not the learner.

Four steps, in order, and the order is the design:

1. Stop and own it.
2. **The same sentence, slower.** Not simplified — the same words. It is the only
   way to find out whether speed alone was the problem, and simplifying first
   throws that information away permanently.
3. Only then break it up, isolate the key word, give it in the native language.
4. Hand over the pattern by using it, not by teaching it.

Then the conversation resumes from the same point. A rewind is not a lesson break.

Depends on PLAN-029. Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- No string in this plan may attribute the failure to the learner, in any language.
- Style and check conventions as in PLAN-015. Raw model output reaches no surface.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/rewind.ts` | NEW | the four steps as state, `SLOW_RATE`, prompt fragments |
| `src/lib/rewind.check.ts` | NEW | the cases below |
| `src/lib/speech.ts` | EDIT | byte tiers honour `rate` |
| `src/lib/prompts.ts` | EDIT | the rewind prompt and its parse |
| `src/lib/useTalk.ts` | EDIT | drive the steps; obey a learner-initiated request |
| `src/views/Talk.tsx` | EDIT | the calm marker |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` rows 7–9 |

## Specification

### Slower actually means slower

`SpeakOptions.rate` exists and two of the four TTS tiers ignore it: `webSpeech`
sets `u.rate` and `bundledTts` maps it to Kokoro's `speed`, while `elevenLabs` and
`openaiTts` drop it — the request they send has no rate parameter and adding one is
a per-vendor negotiation.

They do not need one. Both go through `byteTier`, and a byte tier plays an
`HTMLAudioElement`, which has `playbackRate`. `byteTier.speak` (and the clip it
hands out) sets `el.playbackRate = opts.rate ?? 1` before playing. One line, all
three byte tiers, no vendor API involved.

`SLOW_RATE = 0.75` — a step the ear registers as deliberate care rather than as a
malfunction. It is a named constant in `rewind.ts` and nothing hardcodes 0.75.

With no working TTS at all, step 2 still happens: the same sentence is shown again,
by itself, with nothing else on screen. §10's text-mode row applies here too — the
layer runs, the audio variables stand down.

### The four steps

```ts
export type RewindStep = "own" | "repeat" | "unpack" | "gift" | "resume";
```

- **own** — one short line from the coach, taking the blame for pace. Produced by
  the model (so it is in the target language and in the coach's voice), from a
  prompt that forbids any second-person attribution, and gated on our side: a
  produced line matching the banned-shape check below is replaced by the pack's
  fixed fallback line rather than shown.
- **repeat** — the coach's previous line, **byte for byte**, at `SLOW_RATE`. This
  step calls no model. Nothing is regenerated, because a regenerated sentence is
  not the same sentence, and the step's entire purpose is that it is.
- **unpack** — reached only if the learner misses it again. The model breaks the
  line into parts, isolates the one word carrying the meaning (the `keyWord` it
  already returns per PLAN-028), and gives that word in the learner's native
  language.
- **gift** — the coach models the repair pattern `nextTarget()` (PLAN-027) points
  at, by using it in its own voice: *"by the way, you can always tell me — 'could
  you say that again?'"* Never imperative, never a list. Writes a `repairMove`
  signal with `by: "coach"`, which is the only thing that ever moves a category to
  `recognises`.
  **At most twice per session for the same category, and at most one category per
  session** — §4.2. `rewind.ts` holds the count; a third attempt skips straight to
  `resume`.
- **resume** — the conversation continues from the coach's original line. The
  turn history is unchanged: `history.current` gains the rewind exchange, and the
  coach's next reply answers what the learner eventually said, not the rewind.

### What the learner sees

A rewind is marked in Talk as **a distinguishable pause** — §9.3's words. Concretely:
the rewind exchange renders as one grouped block with a quiet left rule and more
vertical space above and below than a normal turn, and no colour that is not already
in the theme's neutral ramp.

Forbidden, and each one is a check, not just a sentence here:

- no red, no warning colour, no icon that means "error";
- no score, badge, streak, count or number of any kind;
- no text that says or implies the learner did not understand.

The last one is enforced with a banned-substring scan over the pack's rewind strings
and the model-facing prompt in every locale the repo ships, on the second person +
comprehension-verb shapes (`you did not understand`, `you missed`, `anlamadın`, …).
The list lives in `rewind.ts` beside the constant it guards and grows as packs land.

### "No, I understood"

One control in the rewind block, at the same weight as everything else — not an
apology button. Pressing it:

- drops the mark from that turn (the turn's `verdict` becomes `clear`);
- sets PLAN-029's `handicap` to 1 for the session;
- returns to the conversation immediately, with no comment from the coach beyond
  carrying on.

### The other direction: obeying the learner

§12's ninth claim, and the one most likely to be forgotten because it is not part of
the rewind flow at all. When PLAN-027's channel reports a **learner** `SLOW` or
`REPEAT`, the coach must *actually comply*, not thank them for asking:

- `SLOW` → the coach's next reply is spoken at `SLOW_RATE`, and the system prompt
  is told to shorten sentences for that turn;
- `REPEAT` → the previous coach line is re-spoken byte for byte, before the new
  reply, exactly as step **repeat** does.

The reward for asking is that asking worked. There is no praise for it — §4.2, and
PLAN-032's praise economy would forbid it anyway.

### Checks

`rewind.check.ts`:
1. Step order is `own → repeat`, and `unpack` is unreachable without a second miss.
2. The `repeat` step's text is identical to the coach's stored previous line —
   assert equality against a line containing punctuation and a number, and assert
   no model call is made in that step.
3. `SLOW_RATE` is what `repeat` speaks at, and a fake byte tier records
   `playbackRate === SLOW_RATE`.
4. `gift` is capped: the third attempt at the same category in a session returns
   `resume` and writes no signal.
5. `gift` writes a `by: "coach"` observation, and that observation alone leaves the
   category at `recognises` (`inventoryFrom`, from PLAN-027).
6. The banned-shape scan fails on a seeded string that blames the learner, in each
   shipped locale — and the check itself is probed, so a scan that matches nothing
   cannot pass silently.
7. Source scan: `Talk.tsx`'s rewind block references no colour token outside the
   neutral ramp, and no digit is rendered inside it.
8. "No, I understood" clears the verdict and raises the handicap, and the next turn
   needs three signals to be judged a bluff.
9. A learner `SLOW` observation causes the next `speak` call to carry `SLOW_RATE`,
   and a learner `REPEAT` re-speaks the identical previous line.

## Do not touch

- The bluff decision. This plan consumes `intervene`; it does not re-judge.
- The correction flow. A rewind is not a correction and must not enter
  `r.corrections` or produce a `correction` signal.
- `confidence.ts` and `coachmetrics.ts`. A rewind moves no number.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` rows 7–9 asserted.
- Triggering a rewind by hand plays the identical sentence, slower, on all four TTS
  tiers, and shows a pause rather than a warning.
- Saying "could you slow down?" makes the coach slow down on the next line.
- Every visible string in a rewind can be read aloud to the learner without them
  hearing that they failed.

## Commit

```
feat(repair): a rewind that blames the coach and repeats the same sentence slower (PLAN-030)
```

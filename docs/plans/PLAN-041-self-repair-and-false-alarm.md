---
id: PLAN-041
title: The five kinds of self-repair, and the one that is the point
branch: plan/m7-fluency
base: PLAN-040
status: ready
executor: unassigned
created: 2026-09-04
issue: https://github.com/nuvocode/verba/issues/71
milestone: M7 · Fluency & monitor load
spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §2.2, §8
roadmap: docs/plans/M7-roadmap.md (D3)
---

# PLAN-041: self-repair, and `falseAlarmRepair`

## Context

Spec §2.2. The learner interrupts themselves and rebuilds a phrase **that was
already correct**. §2.2 calls it the core metric of the layer and says it is the
single most striking piece of data the learner will see.

It is also the first M7 measurement that cannot be computed from arithmetic. A
timing number is a division; "was that fragment already correct?" is a judgement
about language, and Verba has exactly one component that can make those.

So this plan is governed by the rule the repo already enforces in three places —
`verifyCorrections`, `verifyRepair`, `praiseGate`:

> **A model may classify what the learner did. It may never author it.**

Everything the model returns here is checked against the transcript before it
counts, and the one claim that cannot be checked against the transcript is checked
against the coach's own corrections instead.

Third plan on `plan/m7-fluency`, on top of PLAN-040.

## What is measurable, and what is not

§2.2 lists five categories. They are not equally observable, and pretending
otherwise is how this plan produces a confident wrong number.

| Type | §2.2 | Observable in a transcript? |
|---|---|---|
| `E` | a real error was fixed | Yes — the fragment differs and the coach corrected it |
| `A` | no error, a better phrasing was sought | Yes |
| `D` | the idea changed, rebuilt from scratch | Yes |
| `C` | cut mid-word, covert repair | **Rarely.** Most engines emit whole words |
| `falseAlarm` | the fixed phrase was already correct | Yes, as a *judgement* |

And above all of them sits D3: **an STT that strips disfluencies makes every one of
these unmeasurable, and the answer is absence, not zero.** A session whose
transcript carries no restart produces no `selfRepair` signals at all. It must
never produce a `falseAlarmRepair` count of 0 — that reads as "you did not doubt
yourself once", which is a claim, and a wrong one.

`C-repair` gets an entry in the taxonomy and no special machinery. When a
transcript happens to carry a truncated token it is classified; when it does not,
it is absent like everything else. Building a phoneme-level detector for it is
out of scope and out of §11.

## Repo conventions

- **No new dependencies.** No new files except the check additions.
- `fluency.ts` stays pure — no provider. The model call lives in `useTalk`, the
  prompt and parser in `prompts.ts`, the verification in `fluency.ts`.
- Monitor kind ⇒ **gated on `r.context`**, and the gate reaches further this time:
  with the measurement off, the model call is **not made at all**. §9's "off stops
  the measuring" means no signal *and* no request.
- The `selfRepair` payload carries no `correct` and no `grade` — `signalMiss`
  reads those regardless of kind, and `fluency.check.ts`'s source scan already
  fails the build if one appears.
- Style and check conventions as in PLAN-015. `npm run check` green.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/prompts.ts` | EDIT | beside `vocabPrompt` / `parseVocab` |
| `src/lib/prompts.check.ts` | EDIT | new section |
| `src/lib/fluency.ts` | EDIT | after `timingSignal` |
| `src/lib/fluency.check.ts` | EDIT | new sections 10–12 |
| `src/lib/useTalk.ts` | EDIT | `Reflection`, `reflect()` |
| `src/lib/signals.ts` | EDIT | `talkSignals` |
| `src/lib/invariants.check.ts` | EDIT | `FLUENCY_LEDGER` rows 2 and 11 |
| this file | EDIT | the `## Hand sample` section, filled in |

## Specification

### 1. The prompt — one call, spoken turns only

```ts
/**
 * Ask the model to find the learner's self-repairs in their own spoken turns.
 * Spoken only: a typed turn's restarts are deleted before they are sent, so a
 * transcript of typing carries no evidence and asking about it invents some.
 */
export function repairsPrompt(s: Settings, turns: string[], pack?: LanguagePack): string;

export interface SelfRepairReport {
  /** The abandoned fragment, copied verbatim from the transcript. */
  before: string;
  /** What the learner said instead, verbatim. */
  after: string;
  type: "E" | "A" | "D" | "C" | "falseAlarm";
}

export function parseRepairs(raw: string): SelfRepairReport[];
```

The prompt says, in the coach's own voice conventions:

- return only repairs **present in the text I gave you**, copied character for
  character — never a paraphrase, never a correction of your own;
- `falseAlarm` means: the abandoned fragment was *already correct* in the target
  language and the learner changed it anyway;
- an empty list is the expected answer for most turns. Say `[]` rather than
  finding something.

`parseRepairs` checks **shape only**, like `parseTurn`: a non-array, a missing
field, or a `type` outside the five is dropped. It makes no judgement about
truth — that is the next section's job, and keeping the two apart is what
PLAN-038's defect 2 taught.

### 2. `fluency.ts` — the verification, which is the whole plan

```ts
/**
 * The self-repairs we believe, out of what the model reported.
 *
 * Two gates, both local:
 *
 * 1. **It happened.** `before` and `after` must both appear in the transcript,
 *    `before` ahead of `after`, compared after the same folding `verifyCorrections`
 *    uses. A repair whose fragments are not in the text the learner produced was
 *    authored by the model, and it is dropped — not softened, dropped.
 *
 * 2. **It was a false alarm.** A `falseAlarm` claim is downgraded to `A` when the
 *    coach corrected that same fragment in the same session: the coach saying it
 *    was wrong and the reporter saying it was right cannot both stand, and the
 *    coach's correction is the one the learner already saw on screen. Matching is
 *    on the folded `original` of every `Correction`, exact — no substring, no
 *    paraphrase, the `praiseGate` rule.
 *
 * A downgrade rather than a drop, because the repair itself was observed; only
 * the claim about its needlessness failed. Dropping it would lose a real event.
 */
export function verifySelfRepairs(
  reported: SelfRepairReport[],
  transcript: string[],
  corrections: { original: string }[],
  locale: string,
): SelfRepairReport[];

/** One `selfRepair` signal. The single builder. */
export function selfRepairSignal(activityId: ActivityId, r: SelfRepairReport): SignalDraft;
```

Gate 2 is the load-bearing one and it is worth being explicit about what it can
and cannot do. It cannot prove a fragment was correct — nothing local can. It can
prove the model **contradicted itself within one session**, and that is the
failure mode that matters: the same session's coach flagged "I go to the doctor",
the reporter then calls the learner's rebuild of it a needless doubt, and the
learner is told they were right about something they were just corrected on. That
is the one wrong number this metric could produce that would destroy trust in the
whole layer, and it is cheap to close.

The signal payload:

```
label: "structure you doubted"   // §8's list is derived from these, and the label is what it groups on
type:  "E" | "A" | "D" | "C" | "falseAlarm"
before, after
unit:       "count"
definition: "a phrase you interrupted and rebuilt"
```

No `correct`, no `grade`, no `severity`.

### 3. `useTalk` — the call, and the switch with teeth

`Reflection` gains `repairs2`… **no.** `Reflection.repairs` is already taken by
PLAN-027's `RepairObservation[]` (comprehension repair — a different layer
entirely). Naming the new one `repairs2` or reusing `repairs` are both traps. It
is called:

```ts
  /**
   * Self-repairs the learner made inside their own spoken turns (§2.2). Not to be
   * confused with `repairs`, which is PLAN-027's comprehension repair — that layer
   * is about not understanding, this one is about not trusting what you know.
   * Empty when the measurement is off, when nothing was spoken, or when the
   * transcript carried no restart to find.
   */
  selfRepairs: SelfRepairReport[];
```

In `reflect()`, after the summary call and beside the vocab call:

```ts
// §2.2, and §9's switch with teeth: with the measurement off there is no signal
// *and no request* — a layer that still calls the model while claiming not to
// measure has not stopped measuring, it has stopped filing.
let selfRepairs: SelfRepairReport[] = [];
if (settings.monitorLoad && spokenTexts.length) {
  try {
    selfRepairs = verifySelfRepairs(
      parseRepairs(await getProvider(settings).chat([...], { json: true })),
      spokenTexts,
      corrections,
      locale,
    );
  } catch {
    // Offline or the provider is down. An unmeasured session measured nothing —
    // absence, not zero (D3). Nothing is shown, nothing is retried.
  }
}
```

`spokenTexts` is `voice.current.map(v => v.text)` — the mic's own transcripts, not
`produced`. A learner who dictated and then edited the box has a `ProducedTurn`
that no longer contains the restart; the mic's transcript is the only record of
what was actually said, and it is what §2.2 is about.

### 4. `signals.ts` — the drafts, behind the same gate

```ts
    // §2.2's self-repairs, one signal per verified repair. A monitor kind, so it
    // rides the same gate `sessionContext` and `timing` do.
    ...(r.context ? (r.selfRepairs ?? []).map((sr) => selfRepairSignal(activityId, sr)) : []),
```

### 5. §8 — Memory must not take these as errors

Three doors, all of which must stay shut. Assert each rather than trusting the
shape:

1. **Weaknesses.** `signalMiss(selfRepair signal)` is `false`, so `weakness.ts`
   can never collect one as evidence. Already true by payload shape (PLAN-039);
   now asserted directly on a real `selfRepairSignal` output rather than on the
   `sessionContext` one.
2. **Corrections.** `talkSignals` writes no `correction` draft from a
   `SelfRepairReport`. A `falseAlarm` is a phrase that was **right**; filing it as
   a correction is the exact corruption §8 names.
3. **The deck.** `Reflection.words` comes from `parseVocab` and never from this
   path. Asserted by construction: `selfRepairSignal` produces `kind:
   "selfRepair"`, and nothing in the vocab path reads that kind.

§8's "gereksiz yere şüphelendiğin yapılar" list needs **no new storage**: it is
the `selfRepair` signals filtered to `type === "falseAlarm"`, grouped by `label`.
Building the reader here would be a reader with no screen; PLAN-046 renders it.
Say so in a comment where a future reader will look for it.

### 6. `fluency.check.ts` — sections 10, 11, 12

```
// fluency ledger 2
// fluency ledger 11
```

**10 — the model may point, we check.**

1. A report whose `before` is not in the transcript is dropped.
2. A report whose `after` is not in the transcript is dropped.
3. A report whose `after` appears *before* `before` is dropped — the learner did
   not rebuild forwards, so the model has described something that did not happen.
4. Folding matches `verifyCorrections`: case and punctuation differences survive,
   a different word does not.
5. An empty report list yields an empty signal list. Not one signal with a zero.

**11 — `falseAlarm` cannot outrank a correction the learner already saw.**

1. A `falseAlarm` whose `before` matches a `Correction.original` in the same
   session comes back as `A`, not `falseAlarm`, and **not dropped**.
2. Matching is exact after folding — a `before` that merely *contains* a
   corrected phrase is left as `falseAlarm`. Substring matching here would silently
   erase real false alarms, and `praiseGate` already set the precedent that this
   class of gate is exact or nothing.
3. With no corrections at all, a `falseAlarm` stands.

**12 — absence, not zero, and §8's three doors (`fluency ledger 2`,
`fluency ledger 11`).**

1. `context: null` ⇒ no `selfRepair` draft, whatever `selfRepairs` holds.
2. An empty `selfRepairs` produces no draft — never a draft carrying `count: 0`.
3. `signalMiss(selfRepairSignal(...))` is `false` for all five types, including
   `E`, which is the one a reader would most plausibly think of as a mistake.
4. `talkSignals` given a reflection with `selfRepairs` and **no** `corrections`
   produces zero `correction` drafts.

### 7. `FLUENCY_LEDGER` rows 2 and 11

| id | claim | now |
|---|---|---|
| 2 | `falseAlarmRepair` detection works and was validated by hand-sampling | `fluency.check.ts`, `fluency ledger 2`, **plus the section below** |
| 11 | Memory does not take `falseAlarmRepair` records as errors | `fluency.check.ts`, `fluency ledger 11` |

## Hand sample

§10's row 2 says the detection was *validated by hand-sampling real cases*. No
check can assert that, so it is a task with a written result, and the ledger row is
not honest until this section is filled in.

**Protocol.** Run twenty real spoken turns through the flow with a cloud STT that
keeps disfluencies. For each reported repair, record: the transcript line, the
model's `type`, and whether a human agrees. Then fill in:

| | Count |
|---|---|
| Turns sampled | |
| Repairs reported | |
| Repairs dropped by gate 1 (not in transcript) | |
| `falseAlarm` downgraded by gate 2 | |
| Surviving `falseAlarm`, human agrees | |
| Surviving `falseAlarm`, human disagrees | |

**The bar:** if a human disagrees with more than a fifth of surviving
`falseAlarm`s, this metric does not reach a screen. §6.1 has the coach read this
number out loud to the learner as evidence about themselves, and a metric that is
wrong one time in four is worse than no metric. Record the outcome here either
way — a failed sample that is written down is how PLAN-046 knows not to render it.

### Result — 2026-09-28

**Setup.** Deepgram `nova-3` with `filler_words=true` and `smart_format=true`;
English, learner's L1 Turkish. Two sessions (62, 63), one learner, natural
conversation — no repairs were staged. The raw report came from the
`handSample.log` scaffolding; session 63 was then re-run offline through the
same `productionPrompt` → `parseProduction` → `verifySelfRepairs` path, against
two models, so the two could be compared on one transcript.

Session 60 is not in the sample. It was the six-turn session that found the
`closing` defect: "New scenario" was live during the wrap-up, a new session
reset `voice` under `end()`, and the self-repair pass never ran (fixed in
`9c80d3b`, `closing.check.ts`).

| | qwen3.5:4b (in app, first prompt) | deepseek-v4-pro (final prompt, temp 0) |
|---|---|---|
| Turns sampled | 17 | 16 (session 63) |
| Repairs reported | 3 | 5 |
| Repairs dropped by gate 1 | 1 | 2 |
| `falseAlarm` downgraded by gate 2 | 0 | 0 † |
| Surviving `falseAlarm`, human agrees | 0 | 0 |
| Surviving `falseAlarm`, human disagrees | 0 | 0 ‡ |

† The offline re-run passes no corrections, so gate 2 was not exercised there.
‡ Before the restart gate below, one `falseAlarm` survived — "we need" → "we need
and pick new one" — and a human disagrees: nothing was abandoned, and "we need"
had matched an *earlier* turn. 1 of 1 wrong.

**What the sample taught, and what changed because of it.**

- *At 0.7 the same transcript gave one repair on one run and six on the next,*
  the same repair typed D, C, D. The call now runs at temperature 0; three
  deepseek runs were then identical. (`prompts.check.ts`)
- *Repetition was filed as repair* ("she she", "it's it's"), *two distant places
  were fused into one*, and *the model wrote its own correction into `after`*.
  The prompt now says each of these in a line of its own, defines the five types
  with one example each — none taken from this transcript — and gives the order
  the type is decided in. (`prompts.check.ts`)
- *A restart passed gate 1.* An `after` that opens with the whole of `before`
  now fails it: nothing was abandoned. (`fluency.check.ts`, item 6)
- *qwen3.5:4b finds nothing* under the stricter prompt — three runs, three empty
  lists — where before it found repairs that were not there. Silence is the
  right failure, but it is still a failure: a 4B local model does not measure
  this layer.

**Type agreement** on the three deepseek repairs that survive: detection 2 of 3
right ("we are openly → we open", "it's a little → takes a little bit more");
type 0 of 3 clearly right — the first is an E typed D, the second is arguable,
the third ("my if my wife do it → it's it's better…") is still two places fused.

**Outcome: `falseAlarmRepair` does not reach a screen.** No surviving
`falseAlarm` from either model on these 17 turns, and the only one the pipeline
ever produced was wrong. The bar cannot be met on evidence that does not exist, and
the types it would be read out of are not yet reliable on either model.
`FALSE_ALARM_ON_SCREEN` stays `false`; PLAN-046's four dependents stay
unreachable, as written.

### Staged session — 2026-09-28

Session 66, six spoken turns, `gemma4:31b-cloud` in the app. The learner read five
scripted repairs, each swapping a correct phrase for an equivalent or a worse one
— the `falseAlarm` the natural sample could not produce. Re-run offline at
temperature 0 through the same prompt and gates; deepseek-v4-pro alongside.

| Scripted repair | gemma (app) | gemma (re-run) | deepseek ×2 | Human |
|---|---|---|---|---|
| she doesn't → she does not | dropped by gate 1 ¶ | — | — | falseAlarm |
| I'm going to, um → I will watch… | D | D | D, D | falseAlarm |
| I've lived here → I have lived here for five years | A | A | falseAlarm, A | falseAlarm |
| We went → We have gone … last week | falseAlarm | falseAlarm | falseAlarm ×2 | falseAlarm |
| He works → he is working at a bank | falseAlarm | falseAlarm | A, A | A or falseAlarm |

Both models also reported "she does not she does → she doesn't" as falseAlarm;
right, though `before` swallows the repetition.

¶ Gate 1 found each fragment at its *first* occurrence. "she does not" opens the
line as well as closing it, so `after` looked as if it came first and the real
repair was dropped. `saidInOrder` now looks for `after` from the end of `before`,
and only inside one line — a pair split across turns is no longer a self-repair,
which closes the hole the natural sample left open. (`fluency.check.ts`, items 4b
and 4c; each fails under the old rule.) With it, gemma's six reports on session
66 all survive, and the natural sessions lose nothing.

**Against the bar.** Surviving `falseAlarm`s a human disagrees with: 0 of 3 (gemma
in the app), 0 of 5 (gemma, re-run under the new gate), 0 of 2 and 0 of 3
(deepseek). On session 63's natural speech gemma reports no `falseAlarm` at all.
Precision clears the fifth. Recall does not: of five scripted false alarms two to
four are found, and a change of frame ("going to" → "will") is always read as D.

**Outcome.** The bar is met, on a staged sample of five. One more natural session
under the new gate was run before deciding.

### Natural session under the new gate — 2026-09-28

Session 67, six spoken turns, gemma in the app; re-run twice with gemma and once
with deepseek, temperature 0.

| Repair heard | gemma (app + 2 re-runs) | deepseek | Human |
|---|---|---|---|
| make something → cook something | A | A | A |
| My week, it's well → it was really good | — | falseAlarm | E — the rebuild is better |
| How about you → yours | — | — | E, missed by both |

gemma: no `falseAlarm`, none wrong. deepseek: one `falseAlarm`, wrong — with the
earlier "we need" restart, both `falseAlarm`s deepseek produced on natural speech
were wrong.

### Decision — 2026-09-28

`FALSE_ALARM_ON_SCREEN` stays `false`. gemma4:31b clears the bar — no surviving
`falseAlarm` a human disagrees with, across three natural sessions and a staged
one. deepseek-v4-pro does not: on natural speech it disagreed with a human every
time it said `falseAlarm`. The model is the learner's to choose, the constant is
not per model, and a wrong `falseAlarm` tells a learner their mistake was right —
worse than no metric, which is the bar's own reasoning.

The signal is still recorded; only the screen is shut, and PLAN-046's dependents
stay unreachable. Opening it is a later milestone's: a per-model gate, or a model
that clears the bar wherever it runs, and a new sample written here. The
`handSample.log` scaffolding is removed; `fluency.check.ts` pins the constant to
this decision.

## Do not touch

- `repair.ts`, `RepairObservation`, `verifyRepair`, the repair inventory. That is
  PLAN-027's comprehension layer. The two are twins by design and neighbours in
  the vocabulary, and merging them would lose the distinction the whole milestone
  rests on: *not understanding* against *not trusting what you know*.
- `verifyCorrections`. This plan borrows its folding, it does not change it.
- Anything a learner can see.

## Acceptance

- `npm run check` green.
- With the measurement on, a spoken session makes one extra model call and writes
  one `selfRepair` signal per verified repair.
- With the measurement off, **no request is made** — verified by the provider not
  being called, not by the absence of signals.
- A session whose transcript carries no restart writes no `selfRepair` signal and
  no zero.
- A `falseAlarm` on a phrase the coach corrected in the same session is stored as
  `A`.
- The `## Hand sample` section is filled in, with a verdict.
- `FLUENCY_LEDGER`: rows 2 and 11 asserted, seven pending.

## Commit

```
feat(fluency): the five kinds of self-repair, and the one that had no reason (PLAN-041)
```

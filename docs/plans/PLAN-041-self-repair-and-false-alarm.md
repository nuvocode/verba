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

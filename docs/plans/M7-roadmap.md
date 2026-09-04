---
id: M7-ROADMAP
title: M7 · Fluency & monitor load — the order the work lands in
branch: plan/m7-fluency
base: master
status: ready
milestone: M7 · Fluency & monitor load
spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md
issues: "#70 #71 #72 #73 #74 #75 #76"
---

# M7 roadmap

Not a plan. The map the eight M7 plans are cut from: what the repo already has,
what the spec asks for that the repo cannot yet measure, the order the plans have
to land in, and the five decisions that have to be made before PLAN-039 is written
in code.

---

## 1. What is already there

M6 built most of this layer's plumbing without naming it. Read this before writing
any M7 code — the fastest way to waste this milestone is to build a second copy of
something M6 already owns.

| The spec asks for | The repo already has | File |
|---|---|---|
| per-learner timing normalisation | `Baseline` (median + MAD, 30-day window, `BASELINE_MIN = 12`, `ready` flag) | `lib/breakdown.ts` |
| the coach's own speech stripped out of latency | `measuredLatency`, `turnTiming`, `speakUnknown` | `lib/breakdown.ts`, `lib/model.ts` |
| pause counting | `countPauses`, `speechRatio`, `SPEECH_FLOOR = 0.02` | `lib/breakdown.ts` |
| a place to put a measurement | `signals` table, `SignalKind`, `SignalDraft`, one write door (`useDay.complete`) | `lib/model.ts`, `lib/db.ts`, `lib/useDay.ts` |
| structural payload reads through one door | `signalLabel`, `signalMiss`, `turnStats`, `turnTiming`, `repairMoveInfo` | `lib/model.ts` |
| a self-repair record | `RepairObservation`, `repairSignal`, `verifyRepair` | `lib/repair.ts` |
| "do not interrupt me" | `SessionBudget.off`, `Settings.rewinds` | `lib/breakdown.ts`, `lib/settings.ts` |
| a minimum wait after silence | `waitMs`, `WAIT_FLOOR = 8s`, `Settings.patience` | `lib/patience.ts` |
| a target structure per activity | `PlannedActivity.goal` | `lib/model.ts` |
| written vs spoken production | `Reflection.produced` (all turns) + `Reflection.voice` (spoken only) | `lib/useTalk.ts` |
| the claims ledger machinery | `LEDGER` + `REPAIR_LEDGER`, `verifyAssertedIn`, `pending` rows | `lib/invariants.check.ts` |

**M7 adds a third ledger to that file — `FLUENCY_LEDGER`, spec 5 §10's thirteen
rows — and nothing else about the machinery changes.**

## 2. What the repo cannot measure yet, and why it matters

Four gaps. Three of them change what the spec's numbers are allowed to say, so
they are decisions (§4), not implementation details.

1. **No syllables.** `lib/text.ts` counts words and sentences. Nothing counts
   syllables, and `speechRate` / `articulationRate` / `meanLengthOfRun` are all
   defined in syllables.
2. **No word-level timestamps.** The mic returns a 20 Hz RMS envelope (`levels`,
   one frame per 50 ms — `speech.ts`) and a finished transcript. Nothing maps a
   pause to a position *inside* the transcript, which is exactly what
   `midClausePauseRatio` — the spec's most diagnostic single signal — is.
3. **Disfluencies may not survive the STT.** `falseAlarmRepair` needs the
   abandoned fragment ("I go— I went"). Several engines delete it as noise, and
   the Web Speech path returns `ms: 0, levels: []` — no envelope at all.
4. **Modality is not on the record.** A produced turn does not say whether it was
   spoken or typed, so the spec's first comparison (written ↔ spoken accuracy)
   cannot be computed from the signals table today.

## 3. Order

Each plan lands on `plan/m7-fluency` on top of the one before it. The order is
forced by data: a comparison cannot be computed before something produces both
sides of it.

| # | Plan | Issue | Spec | Why here |
|---|---|---|---|---|
| 1 | PLAN-039 — the context object, modality, and the off switch | #70, #76 | §2.4, §7.4, §9 | Nothing may be measured before there is a switch that stops the measuring, and nothing is comparable before the context rides with it |
| 2 | PLAN-040 — the timing signals | #70 | §2.1 | Needs 039's context; reuses M6's baseline |
| 3 | PLAN-041 — the repair taxonomy and `falseAlarmRepair` | #70, #71 | §2.2, §8 | The core metric. Needs one reflection-time model pass |
| 4 | PLAN-042 — the completion signals | #70 | §2.3 | Shares 041's model pass; `avoidanceScore` needs `PlannedActivity.goal` |
| 5 | PLAN-043 — fluency mode and its opposite | #73 | §4, §7.1 | Produces the `mode` half of the context; the seven binding rules |
| 6 | PLAN-044 — the exercises | #74 | §5 | Produces `planningTimeSec`, `taskRepetition`, `interlocutorPressure` — three of the four comparison axes |
| 7 | PLAN-045 — the Monitor Load profile | #72 | §3 | Cannot run before 043 and 044 exist to generate both sides of every comparison |
| 8 | PLAN-046 — Coach holds up the mirror | #75 | §6, §7.2, §7.3 | The only plan the learner reads. Closes `FLUENCY_LEDGER` |

Plans are written one at a time, each after the previous one has been reviewed and
merged. Writing all eight now would mean writing six of them against a repo that
does not exist yet — the M6 plans that drifted were the ones written early.

## 4. Five decisions

These change what the product says, not just how it is built. They are settled
before PLAN-039 is executed.

### D1 — What `speechRate` is counted in

No syllable counter exists and a correct one is per-language. Three options:

- **(a) Words, honestly labelled.** `speechRate` becomes words/min, the unit string
  says "words per minute", the definition says so on screen. Invariant 12 holds.
  Cheapest, and comparable against itself — which is all §3 ever does.
- (b) A vowel-group syllable estimator per pack, words for ja/zh where it is
  meaningless. Closer to the literature, wrong in different ways per language.
- (c) Ship both. Two numbers meaning nearly the same thing on one screen.

**Recommended: (a).** Every use in the spec is a learner-against-themselves
comparison (§3.1, §5.2). A unit that is consistent beats a unit that is canonical,
and (b) can replace it later without changing a single reader.

### D2 — How `midClausePauseRatio` is computed without timestamps

The pauses are known in time; the clause boundaries are known in text; the two
cannot be joined. A lower bound can be:

> pauses over 600 ms in the envelope, minus the clause boundaries the transcript
> has, floored at zero, over total pauses.

A learner who paused six times in a two-clause turn paused at least five times
mid-clause. It under-reports and never over-reports, which is the right direction
for a signal the coach will read aloud. It is also honest about being a bound.

**Recommended:** ship the bound, mark the ceiling with a `ponytail:` comment naming
word-level timestamps as the upgrade, and only claim it in the ledger once
§10's "clause boundary detection tested in the target language" has a check behind
it in at least two packs.

### D3 — What happens when the STT strips disfluencies

`falseAlarmRepair` is the layer's core metric and it is not always measurable.

**Recommended:** absent, never zero — the same rule `speakUnknown` already follows.
A session whose transcript carries no disfluency markers produces no repair signals
at all, and §3.2's sample gates then keep Coach quiet on its own. Never fabricate a
zero: a zero says "you did not doubt yourself", which is a claim, and a wrong one.

### D4 — Where the Coaching settings live

§7.4 asks for a `Coaching` tab. Today `Settings` has five panels and the
coaching-shaped rows (`coaching`, `patience`, `coach-style`, `rewinds`) are all
inside `learning`, which is now ten rows long.

**Recommended:** a sixth panel, `Coaching`, and the four existing rows move into it.
`difficultyStep` and `listeningGrades` stay unpinned and invisible, as they are.

### D5 — Audio retention

§9 says audio is not retained, retention is opt-in, and opt-in is off by default.
Today nothing retains audio: the envelope and the clip live in memory for the
length of one turn and are dropped.

**Recommended:** ship the promise and the delete action, do not build the opt-in.
Adding a switch that starts writing audio to disk buys the learner nothing this
milestone and costs a permanent data-risk surface. §9's other two bullets — signals
computed and kept on device, one action that deletes past monitor data — are built
in PLAN-039.

## 5. The traps this milestone can walk into

Written here because each is a way to ship all eight plans and still have failed.

- **A composite score.** §6.3 forbids it and §11 puts it out of scope. Four
  comparisons, four rows, no total. `coachMetrics` already has a metric called
  `fluency` that is not this — it is the unaided-turn share. It keeps its name and
  the new layer must never be merged into it.
- **Speaking before the sample is there.** §3.2: three sessions, two samples per
  condition, and below that Coach says *nothing* — not a hedge, nothing.
  `coachmetrics.ts`'s `null`-is-not-rendered rule is the precedent to copy.
- **`falseAlarmRepair` reaching Memory.** §8. Those phrases were correct. Filing
  them as errors corrupts the deck and the weakness list both.
- **A promise the session does not keep.** PLAN-037 learned this: a card that says
  "today we work on speaking without stopping" while the system prompt is
  unchanged is a fabrication in better clothes. §4's contract screen has to
  actually turn corrections off.
- **Adjectives.** §6.1: numbers, never adjectives; never another learner, never a
  level norm. §6.3's five prohibitions get a prompt-level check, like `bannedShape`.

## 6. Done

M7 is finished when spec §10's thirteen boxes are `FLUENCY_LEDGER` rows with a
real marker in a real `*.check.ts`, and `npm run check` is green.

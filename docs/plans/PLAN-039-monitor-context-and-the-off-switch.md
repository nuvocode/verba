---
id: PLAN-039
title: The context every measurement rides with, and the switch that stops it
branch: plan/m7-fluency
base: master
status: ready
executor: unassigned
created: 2026-09-04
issue: https://github.com/nuvocode/verba/issues/70
milestone: M7 · Fluency & monitor load
spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §2.4, §7.4, §9
roadmap: docs/plans/M7-roadmap.md
---

# PLAN-039: the context object, and the off switch

## Context

First plan of M7. It measures nothing.

Two spec rules make it first anyway. §2.4: *"Her ölçüm şu bağlamla birlikte
kaydedilir, yoksa karşılaştırılamaz."* Every M7 number is a comparison of the same
learner under two conditions, so a measurement whose conditions were not written
down is not merely less useful — it is unusable, and un-backfillable. And §9 plus
§7.4: the measurement has an off switch, and off means *the measuring stops*, not
the display. A layer that starts measuring one plan before it can be switched off
has broken its own promise for the length of that plan.

So this plan lays the two things everything else writes into:

1. **A session's conditions, as one signal.** The six fields of §2.4, written once
   per session rather than copied onto every turn, plus the one field that really
   is per-turn — whether the learner spoke it or typed it.
2. **The Coaching panel and the kill switch**, including the one action that
   deletes what has been measured so far.

It also opens `FLUENCY_LEDGER` — spec 5 §10's thirteen boxes — with every row
`pending` except the three this plan closes.

First plan on `plan/m7-fluency`, on top of `master`.

## Repo conventions

- **No new dependencies.**
- `src/lib/fluency.ts` is pure by the same contract `difficulty.ts` and
  `patience.ts` hold: no provider, no `./db.ts`, no React, no clock. It takes
  values and returns values, so `fluency.check.ts` can drive it in a bare Node
  process.
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  import **without** it.
- Structural payload fields are read through one door in `model.ts`
  (`signalLabel`, `signalMiss`, `turnStats`, `turnTiming`, `repairMoveInfo` are the
  precedent). This plan adds exactly one more and no caller reaches into
  `payload` itself.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
  Comments say *why*; a deliberate ceiling is marked `// ponytail:`.
- `npm run check` green at the end.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/fluency.ts` | NEW | — |
| `src/lib/fluency.check.ts` | NEW | — |
| `src/lib/model.ts` | EDIT | `SignalKind` union; beside `turnTiming` |
| `src/lib/signals.ts` | EDIT | `turnSignal`, `talkSignals` |
| `src/lib/useTalk.ts` | EDIT | `ProducedTurn`, the send path, `reflect` |
| `src/lib/settings.ts` | EDIT | `Settings`, `defaultSettings` |
| `src/lib/rules.ts` | EDIT | `AT` |
| `src/lib/settingsIndex.ts` | EDIT | `SETTINGS_INDEX` |
| `src/views/Settings.tsx` | EDIT | `NAV`, `MOVED` |
| `src/views/settings/Coaching.tsx` | NEW | — |
| `src/views/settings/Learning.tsx` | EDIT | the four rows that leave |
| `src/lib/db.ts` | EDIT | beside `saveSignals` |
| `src/lib/invariants.check.ts` | EDIT | after `REPAIR_LEDGER` |

## Specification

### 1. `src/lib/fluency.ts` — the context, and the closed set of monitor kinds

```ts
/**
 * The conditions one session ran under (§2.4). Written once per session, not
 * copied onto every turn: every field here is a property of the session, and a
 * per-turn copy is six fields that can disagree with each other.
 *
 * `modality` is deliberately absent — it is the one condition that varies inside
 * a session, so it rides the turn (`ProducedTurn.spoken`) instead.
 */
export interface MonitorContext {
  mode: "fluency" | "accuracy" | "free";
  planningTimeSec: number;          // 0 = no planning
  taskRepetition: 1 | 2 | 3;        // which pass over the same content
  interlocutorPressure: "none" | "paced" | "interrupting";
  topicFamiliarity: "prepared" | "novel";
}

/** What an ordinary conversation is: no mode, no planning, first pass, no pressure. */
export const FREE_CONTEXT: MonitorContext;

/** The six signal kinds this milestone writes. The kill switch deletes exactly these. */
export const MONITOR_KINDS: readonly SignalKind[];

/** The session-context signal, the single builder. */
export function sessionContextSignal(activityId: ActivityId, ctx: MonitorContext): SignalDraft;
```

`MONITOR_KINDS` is declared here in full even though five of the six kinds have no
writer until PLAN-040–042. That is the point: the kill switch has to be able to
delete a kind the moment the kind exists, and a list that grows plan by plan is a
list that is one plan behind at every moment. `fluency.check.ts` pins it closed.

### 2. `src/lib/model.ts` — six kinds and one door

Six rows join `SignalKind`, each with the plan that writes it:

```ts
  | "sessionContext"      // the conditions a session ran under (PLAN-039)
  | "timing"              // §2.1's six timing numbers for one spoken turn (PLAN-040)
  | "selfRepair"          // one self-repair, classified E / A / D / C / falseAlarm (PLAN-041)
  | "abandonedUtterance"  // a sentence started and never finished (PLAN-042)
  | "l1Fallback"          // a slip into the native language (PLAN-042)
  | "avoidance"           // the planned structure was not attempted (PLAN-042)
```

And one reader, beside `turnTiming`:

```ts
/**
 * The third structural payload door: the conditions a session ran under.
 * Returns null for anything that is not a well-formed `sessionContext` signal —
 * an unreadable context is *no* context, never a default one, because a default
 * would silently file an interrupted session as an unpressured one and §3.1's
 * fourth comparison would then compare a condition against itself.
 */
export function monitorContext(s: Signal): MonitorContext | null;
```

`signals.check.ts` already fails the build when a fourth door opens elsewhere;
this one is added to the set it knows about.

### 3. `ProducedTurn.spoken`, and the turn payload

`useTalk` knows which turns came from the mic — the send path is the only place
that turns a transcript into a `ProducedTurn`, and it already carries
`VoiceTurn`s alongside. Add one field:

```ts
  /**
   * The learner spoke this turn rather than typing it (§3.1's first comparison:
   * written accuracy against spoken accuracy). A fact about the turn, like
   * `words` — not a monitor measurement, so the kill switch does not remove it
   * and the same rule `axisUsed` follows applies: recorded, never scored.
   */
  spoken: boolean;
```

`turnSignal` (signals.ts) puts it on the payload of both `unpromptedTurn` and
`suggestionUsed`. Nothing reads it in this plan. `coachMetrics` must not begin
splitting its accuracy metric on it — §6.3 forbids a second accuracy number, and
PLAN-045 owns the comparison.

### 4. The session context is written once, at the single door

`talkSignals` gains one draft at the end, exactly where `axisUsed` and `rehearsal`
already sit:

```ts
    // The conditions this session ran under (§2.4). One per session, written
    // beside the turn signals at the same stamp so `recapsFrom` groups it into
    // the session it describes. Never written when the learner has the
    // measurement off — that gate is in `useTalk`, not here: this file is pure
    // and does not read Settings.
    ...(r.context ? [sessionContextSignal(activityId, r.context)] : []),
```

`Reflection.context` is `MonitorContext | null`. In this plan `useTalk` sets it to
`FREE_CONTEXT` for every session — there is no fluency mode, no planning timer and
no ladder yet, so every session genuinely *is* free, unplanned, first-pass and
unpressured. PLAN-043 and PLAN-044 are what start making it vary. Setting it to
`null` instead would be the wrong shortcut: it would mean this milestone's first
weeks of sessions carry no condition at all and can never be compared.

When `settings.monitorLoad` is false, `useTalk` passes `context: null` and no
`sessionContext` signal is written. **This is the whole kill switch on the write
side**: one condition, in one place, before the single door.

### 5. `Settings.monitorLoad`

```ts
  /**
   * Whether the fluency layer measures at all (§7.4, §9). On by default: the
   * signals are computed on this machine and stay on it, and a layer whose
   * whole claim is "we measure what slows you down" that ships measuring
   * nothing is not a conservative default, it is a broken one.
   *
   * Off stops the **measuring**, not the display — no `sessionContext` signal is
   * written, and every later plan gates its own writer on this same field.
   * Past data is removed by the action beside it, never by this switch alone:
   * a learner who turns measurement off for a week has not asked to lose the
   * month before it.
   */
  monitorLoad: boolean;
```

Default `true`.

### 6. The Coaching panel

`AT` gains `coaching: "#settings/coaching"`. `NAV` in `Settings.tsx` gains
`["coaching", "Coaching"]` between Learning and Speech. `MOVED`'s
`coaching: "learning"` row is **deleted** — it existed to redirect the 0.4 panel
into Learning, and the panel now exists again, so the redirect would send a link
to the wrong place.

Four rows move out of `learning` and into `coaching` in `SETTINGS_INDEX`, with
their `desc` unchanged: `coaching`, `patience`, `coach-style`, `rewinds`. Their
markup moves out of `Learning.tsx` and into the new `Coaching.tsx` unchanged —
this is a move, not a redesign, and a diff that also rewrites them is a diff that
cannot be reviewed.

Two rows are new:

| id | title | desc |
|---|---|---|
| `monitor-load` | Measure what slows you down | Time your pauses and self-corrections while you speak. Everything is worked out on this computer and stays here. Off stops the measuring, not just the showing. |
| `monitor-data` | Delete what has been measured | Remove every timing and self-correction record for this language. Your conversations, words and corrections are untouched. |

`monitor-data` is a destructive action and follows the house pattern the two
existing ones set (`delete-everything`, `forget-everything`): it says what would be
lost, with a count, before it does anything.

§7.4's other two rows — **default mode** and the **pressure ladder's top rung** —
are not built here. They have nothing to configure until PLAN-043 and PLAN-044
exist, and a settings row that changes no behaviour is worse than a missing one.

### 7. `db.deleteMonitorSignals`

```ts
/**
 * Delete every monitor measurement for a language (§9). Scoped to
 * `MONITOR_KINDS` and to one language, like every other table here — evidence
 * from one language may not argue about another, and that holds for deleting it
 * too. Returns how many rows went, so the confirm can say it.
 */
export async function deleteMonitorSignals(lang: string): Promise<number>;
```

Plus `countMonitorSignals(lang)`, which the confirm reads *before* asking. The
kind list is `MONITOR_KINDS`, imported — never a second copy of the strings.

### 8. `src/lib/fluency.check.ts`

```
// fluency ledger 12
// fluency ledger 13
```

1. `MONITOR_KINDS` is closed: every kind in it is a member of `SignalKind`, and
   every `SignalKind` whose comment names a PLAN-04x is in it. This is the check
   that keeps the kill switch a plan ahead rather than a plan behind — it fails
   the build when PLAN-041 adds a kind and forgets the list.
2. `sessionContextSignal` → `monitorContext` round-trips every field of a
   `MonitorContext`, and `monitorContext` returns `null` for: a signal of another
   kind, a payload that is not an object, a payload missing a field, and a payload
   whose `mode` is a string outside the union. **Not a default** — the assertion is
   on `null` specifically.
3. `FREE_CONTEXT` is `{ mode: "free", planningTimeSec: 0, taskRepetition: 1,
   interlocutorPressure: "none", topicFamiliarity: "novel" }` — pinned, because
   every session written before PLAN-043 is compared against it forever.
4. A `Reflection` with `context: null` produces no `sessionContext` draft, and one
   with a context produces exactly one.
5. `talkSignals` puts `spoken` on both turn kinds, and `spoken` is *absent* from
   `MONITOR_KINDS`' effect: a payload built by `turnSignal` still has `spoken`
   after the monitor kinds are filtered out.

### 9. `FLUENCY_LEDGER`

A third ledger in `invariants.check.ts`, sharing `RepairRow`'s shape and the same
`verifyAssertedIn` audit. Thirteen rows, one per box in spec §10, each `pending`
as `"#<issue> — PLAN-<nnn>"` until its plan lands:

| id | claim | this plan |
|---|---|---|
| 1 | §2's signals are computed from transcript + audio and stored with their context | pending #70 — PLAN-040 |
| 2 | `falseAlarmRepair` detection works and was validated by hand-sampling | pending #71 — PLAN-041 |
| 3 | Clause-boundary detection for `midClausePauseRatio` is tested in the target language | pending #70 — PLAN-040 |
| 4 | Fluency mode obeys all seven rules of §4.2; live error marking is off at code level | pending #73 — PLAN-043 |
| 5 | The contract screen is shown every session and cannot be skipped | pending #73 — PLAN-043 |
| 6 | Accuracy mode is separate and cannot run in the same session | pending #73 — PLAN-043 |
| 7 | 4/3/2 shows the three rounds side by side | pending #74 — PLAN-044 |
| 8 | The ladder's fourth rung is left with one key | pending #74 — PLAN-044 |
| 9 | Coach does not comment on thin data, and can say "no problem" outright | pending #72 — PLAN-045 |
| 10 | §6.3's prohibitions are enforced at prompt level and tested | pending #75 — PLAN-046 |
| 11 | Memory does not take `falseAlarmRepair` records as errors | pending #71 — PLAN-041 |
| 12 | Turning the measurement off really stops the measurement | **`fluency.check.ts`, marker `fluency ledger 12`** |
| 13 | Audio is not retained by default | **`fluency.check.ts`, marker `fluency ledger 13`** |

Row 12's assertion is the one that matters: given a `Reflection` whose `context` is
`null` — the shape `useTalk` produces with `monitorLoad` off — `talkSignals`
returns no draft whose kind is in `MONITOR_KINDS`. Row 13 asserts against the
source: `speech.ts` has no writer for the clip or the envelope, and no settings
field turns one on (see D5 in the roadmap).

## Do not touch

- `coachMetrics`. Its metric named `fluency` is the unaided-turn share and is not
  this layer. It keeps its name, its definition and its readers.
- `Baseline`, `measuredLatency`, `countPauses`, `speechRatio`. PLAN-040 uses them
  as they are; changing them here would move M6's rewind thresholds with no plan
  saying so.
- `difficultyStep`, `listeningGrades`. Still unpinned, still invisible.
- Anything under §3, §4, §5, §6. This plan measures nothing and shows nothing.

## Acceptance

- `npm run check` is green.
- Settings opens on a Coaching panel holding six rows; `#settings/coaching`
  routes to it, and the settings search finds all six.
- With `monitorLoad` on, a finished Talk session writes exactly one
  `sessionContext` signal, and both turn kinds carry `spoken`.
- With `monitorLoad` off, a finished Talk session writes no signal in
  `MONITOR_KINDS`, and everything else about the session is unchanged.
- "Delete what has been measured" states a count before it deletes, and after it
  runs, the conversation history, vocabulary and corrections are all still there.
- `FLUENCY_LEDGER` has thirteen rows; eleven are `pending` and name a real issue
  and plan; two point at markers that really exist in `fluency.check.ts`.

## Commit

One commit, on `plan/m7-fluency`:

```
feat(fluency): every measurement carries its conditions, and there is a switch (PLAN-039)
```

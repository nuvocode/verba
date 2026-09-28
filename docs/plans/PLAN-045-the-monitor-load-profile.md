---
id: PLAN-045
title: The Monitor Load profile — four differences, never one number
branch: plan/m7-fluency
base: PLAN-044
issue: "#72"
spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §3
ledger: FLUENCY_LEDGER row 9
status: done
---

# PLAN-045 — The Monitor Load profile

Every plan before this one produced a *measurement*. This one produces the first
**reading**, and §3.1 opens by saying why that is dangerous: a single number
carries no meaning on its own. The diagnosis is the difference between the same
learner's own two conditions — and PLAN-043 and PLAN-044 exist so that both sides
of all four differences can actually be produced.

The profile is derived and **never stored**. `weakness.ts` already carries the
rule and the reason: a stored reading drifts from the signals under it, and it
travels badly — `backup.ts` syncs localStorage wholesale but not SQLite, so a
stored reading reaches the second machine with no evidence beneath it. Recompute
it; it is a group-by over a few hundred rows.

## 0. The four things that will go wrong

**One: the composite score.** It is the easiest thing to build here and §3.1
forbids it by name, with a reason that is the whole layer's thesis: reducing the
profile to one score makes the learner feel *assessed*, which grows the very
problem being measured. A monitor-load layer that hands out a monitor-load score
has defeated itself. The type must be unable to hold one, and a source scan must
say so — a rule that lives only in a comment is a rule that lives until the next
person wants a number for the dashboard.

**Two: commenting on half the data.** §3.2 is unusually blunt: below the bar the
Coach says **nothing** — "yarım veriyle yorum yapmak yasaktır". The tempting
failure is not a wrong reading, it is a friendly one: *"Not enough sessions yet —
come back after three more."* That is a comment on the data. So is a progress bar
toward the bar, and so is a greyed-out table with dashes in it. Below the bar the
profile does not render at all: nothing appears, and nothing hints that something
would.

**Three: `falseAlarmRepair` deciding an outcome it may not print.** §3.3's first
outcome — *monitör baskın* — lists `falseAlarmRepair` among its three markers, and
PLAN-041's `## Hand sample` is still blank. PLAN-044 already met this and answered
it with `FALSE_ALARM_ON_SCREEN`. The same constant, the same gate: a verdict
standing on an unvalidated metric is *worse* than printing the metric, because the
learner cannot see what it stood on.

*Post-review:* the gate turned out to cover **two** outcomes, not one. Strip
`falseAlarmRepair` from §3.3's table and *monitör baskın* and *erişim yavaş*
collapse onto the same evidence — accuracy is fine, production moves between
conditions — because the marker that separates them (high vs low false alarms) is
the one we may not weigh. Both are shut behind the same constant, and one flip
opens both.

**Four: the fall-through reading.** Three signatures and an `else` is the shape
this file naturally wants, and the `else` is then the branch most learners land
in — a verdict reached by elimination rather than by evidence, printed above a
table that can flatly contradict it. §3.3 lists the four *typical* outcomes, not a
partition of every possible record. Every outcome is reached by its own signature
or not at all, and `null` is the common answer.

## 1. What the profile is

§3.1's table, as data. Four rows; each row is one question, two conditions, and
the difference between them.

```ts
// src/lib/profile.ts
/** One side of one comparison — a condition, its value, and what it stands on. */
export interface Side {
  label: string;        // the condition, as the learner reads it
  value: number | null; // null = this side was never measured
  sessions: number;     // distinct activityIds behind it (§3.2's "at least 2")
}

/** One of §3.1's four differences. Never summed with the others. */
export interface ProfileRow {
  id: "writtenVsSpoken" | "plannedVsUnplanned" | "firstVsThird" | "calmVsInterrupted";
  question: string;   // what the difference shows, in §3.1's words
  a: Side;
  b: Side;
  unit: string;       // invariant 12
  definition: string; // invariant 12
}
```

There is no `score`, no `total`, no `index`, no `composite` and no `overall` — not
because none was needed, but because §3.1 forbids one. Check 5 scans for the
words.

## 2. The four rows, and where each side comes from

| Row | Condition A | Condition B | The number | Read from |
|---|---|---|---|---|
| `writtenVsSpoken` | a typed session | a spoken session | corrections per 100 words | `correction` + `unpromptedTurn`/`suggestionUsed` (`spoken`, `words`) |
| `plannedVsUnplanned` | `planningTimeSec > 0` | `planningTimeSec === 0` | words per minute | `sessionContext` + `timing` |
| `firstVsThird` | `taskRepetition === 1` | `taskRepetition === 3` | words per minute | `sessionContext` + `timing` |
| `calmVsInterrupted` | `interlocutorPressure === "none"` | `"interrupting"` | words per minute | `sessionContext` + `timing` |

Rows 2–4 share one number — words per minute — because the three conditions all
act on the same thing: how fast the learner can get language out. One metric per
row keeps the table readable and the code one function. Row 1 is accuracy, in its
own unit, because §3.1's first comparison is about accuracy and nothing else.

### Row 1's honesty rule

Corrections are filed per *session*, not per turn: a correction cannot be
attributed to the turn that earned it. So a session that mixes speech and typing
cannot say which half its corrections belong to.

**A mixed session counts for neither side.** Only a session whose measured turns
are *all* spoken is a spoken sample, and only one whose turns are *all* typed is a
written sample. This is the same rule as everywhere else in the layer — absent,
never approximated — and it is the reason `spoken` was put on the turn signal in
PLAN-039 rather than inferred later.

`turnSpoken(s)` joins the existing payload doors in `model.ts`, beside
`turnStats` and `turnTiming`. A reader somewhere else is a reader nothing can
find.

### The window

`recentSignals(lang, n)` — **recent-first**, `ORDER BY observed_at DESC`. Three
sessions per condition can span weeks, so this is not Coach's seven-day window;
it is the learner's recent record with a generous cap. PLAN-044's `goalToName`
shipped with the ordering backwards *and a check that agreed with it*, so the
order is part of every function's contract here and check 6 feeds the real one.

## 3. The gates — §3.2, and ledger row 9

Three bars, all of them hard:

1. **At least three distinct sessions**, counted across the whole record.
2. **At least two sessions on each side** of a row. A row with one side thin is
   **absent** — not zero, not a dash, not "—". It is not in the array.
3. **Nothing at all below the bar.** No profile, no placeholder, no teaser, no
   count of how many sessions are left to go.

If no row survives, `monitorProfile` returns an empty array and the Coach screen
renders nothing on the subject.

§3.2's third bullet — *"kullanıcı isterse tamamen kapatılabilir; kapatıldığında
ölçüm de durur, sadece gösterim değil"* — **is already true and this plan adds no
setting for it.** `settings.monitorLoad` is PLAN-039's kill switch, ledger row 12
already asserts that turning it off stops the measurement rather than the display,
and with it off no `sessionContext` signal is written. **Every** row reads through
one — `measuredSessions` is the single place that says so — so the profile is
empty by construction. That last part is not free: corrections and turns are
ordinary signals the switch does not touch, so gating only rows 2–4 on the context
would leave row 1 standing and hand a learner who turned the measurement off a
written-vs-spoken comparison. Check 4 asserts it with a fixture that holds both
typed and spoken sessions, because an all-typed one cannot tell a working gate
from a broken one.

## 4. The reading — §3.3's four outcomes

```ts
// src/lib/profile.ts
export type Reading = "monitorDominant" | "slowAccess" | "knowledgeGap" | "noProblem";
export function profileReading(rows: ProfileRow[]): Reading | null;
```

| Outcome | Signature the spec names | What we can weigh |
|---|---|---|
| `monitorDominant` | written ≈ spoken accuracy, high `falseAlarmRepair`, high `midClausePauseRatio` | **shut** — see §0's third trap |
| `slowAccess` | accuracy fine, `initiationLatency` and pauses high, `falseAlarmRepair` low | **shut** — the same missing marker separates it from the row above |
| `knowledgeGap` | written accuracy is low too | row 1's own A side |
| `noProblem` | every difference is small | all four rows, at an accuracy that is not itself poor |

**The order is not the spec's order.** `knowledgeGap` is asked *first*, because
"written accuracy is low too" is a fact about one number rather than about a
difference — and a learner whose accuracy is poor but *consistently* poor has four
small differences. Asking `noProblem` first hands them *"we measured it, you're
genuinely fine"*, which is the worst sentence this layer can produce.

`null` is a legitimate answer and the common one: not every profile reads as one
of four things, and a reading forced onto data that does not support it is the
same failure as a reading on thin data.

**`noProblem` is the point of ledger row 9's second half.** *"Ölçtük, gerçekten
iyisin"* is one of this layer's legitimate outputs, and it is only sayable when
all four rows exist and all four differences are small — which is to say, when the
measurement was actually made. Check 3 asserts it: four small differences ⇒
`noProblem`; three rows and a missing fourth ⇒ `null`, never `noProblem`.

### The thresholds

"Small" and "large" are judgements, and every judgement in this layer has to be
somewhere a person can find it:

```ts
// ponytail: first guesses, tuned against nothing yet. They are named, in one
// place, with their units, so tuning them is one edit and the check that pins
// them fails loudly. PLAN-041's hand sample is the precedent for how they should
// eventually be set: against a real sample, by a human, once.
export const SMALL_ACCURACY_DIFF = 1.0; // corrections per 100 words
export const SMALL_RATE_DIFF = 10;      // words per minute
export const LOW_ACCURACY = 4.0;        // corrections per 100 words — §3.3's "written accuracy is low too"
```

This is the plan's one honest weakness and it is written down rather than hidden
in an `if`: the numbers are guesses. What is *not* a guess is that they are the
only three, that they carry units, and that changing one changes the reading in
exactly one place.

## 5. The screen

The profile goes on Coach, beside the panel that is already there. Four rows, each
one line: the question, the two conditions with their numbers, and the difference.
Every number carries its unit; the definition is reachable from the screen
(invariant 12).

- The reading, when there is one, is **one sentence** — and PLAN-046 owns how it
  is worded. This plan renders it plainly; §6's voice is the next plan's work.
- `monitorDominant`'s sentence names the marker it could not weigh. Not as a
  hedge about the conclusion — as a fact about the evidence.
- No row is drawn for an absent comparison, and no section is drawn for an empty
  profile. Not a heading, not an empty state.

`ponytail:` the profile recomputes on every Coach open, from the same signals
already loaded there. No cache, no memo — it is a group-by over a few hundred
rows, and the first time it is slow enough to notice is the first time it is worth
one.

## 6. Files

| File | Change |
|---|---|
| `src/lib/model.ts` | `turnSpoken(s)` — the fourth payload door, beside `turnStats` and `turnTiming` |
| `src/lib/profile.ts` | NEW — `Side`, `ProfileRow`, `Reading`, `monitorProfile`, `profileReading`, the three thresholds |
| `src/lib/profile.check.ts` | NEW — sections 1–6 |
| `src/views/Coach.tsx` | the four rows and the one sentence; nothing when the profile is empty |
| `src/lib/invariants.check.ts` | row 9 asserted |

`profile.ts` is its own file for the reason `weakness.ts` is: it is a *reading*
over signals, not a measurement, and the two are worth keeping apart. `fluency.ts`
is already 760 lines of measurement.

## 7. Checks — `profile.check.ts`, sections 1 to 6

**1 — the four rows.** Each row's two sides come from the conditions the table
names, with the number the table names. A hand-built signal set produces exactly
four rows; changing one condition moves exactly one row.

**2 — the gates.** Two sessions total ⇒ empty. Three sessions but one side of a
row with a single sample ⇒ that row is *absent from the array*, not present with a
null. Nothing renders below the bar: the Coach source has no branch that draws a
heading, a count or a placeholder for an unmet profile. *fluency ledger 9*

**3 — `noProblem` is sayable, and only when it is true.** Four rows, all four
differences under their threshold ⇒ `noProblem`. The same data with one row
missing ⇒ `null`. One difference over its threshold ⇒ not `noProblem`. Four small
differences *at a poor accuracy* ⇒ `knowledgeGap`, never "you're genuinely fine".
A record matching no signature ⇒ `null`, not whatever branch is last. And the two
shut readings are shut behind `FALSE_ALARM_ON_SCREEN`, with their sentences
already written, so opening them is one flip and not a rewrite. *fluency ledger 9*

**4 — the kill switch.** With `monitorLoad` off no `sessionContext` signal
exists, and **every** row reads through one — not only rows 2–4. Corrections and
turns are ordinary signals the switch does not touch, so a profile that gated only
the monitor kinds would still hand a learner who turned the measurement off a
written-vs-spoken comparison. The fixture therefore holds both typed and spoken
sessions: an all-typed one cannot tell a working gate from a broken one.
Asserted through `talkSignals` with `context: null`, the same door ledger rows 8
and 12 use.

*Post-review:* this is also the rule §2.4 already states — a measurement without
its context cannot be compared, and every row here is a comparison between
conditions. `measuredSessions` is the one place that knows it.

**5 — no composite.** `profile.ts` holds no `score`, `total`, `index`,
`composite` or `overall`, and `ProfileRow` has no numeric field beyond the two
sides. §3.1 forbids the reduction and this is what forbidding it looks like in
code.

**6 — the row-1 honesty rule and the window's order.** A mixed spoken/typed
session counts for neither side. And every function here is fed signals in
`recentSignals`' real order (recent-first) — the order the caller actually
passes, never a hand-picked one.

## 8. Ledger

Row 9 moves to `assertedIn`. Twelve of thirteen closed; row 10 belongs to
PLAN-046, which closes the ledger.

## Do not touch

- `FALSE_ALARM_ON_SCREEN`. Still `false`, still PLAN-041's to flip.
- PLAN-039's kill switch. This plan reads through it and adds no second switch.
- `sessionContext.current`'s two writers, PLAN-043's `showInline` and
  `closingItems`, and PLAN-044's clock. Nothing here writes; everything reads.
- PLAN-041's blank `## Hand sample`.

## Deliberately not built

- **A composite score.** §3.1, and §0's first trap.
- **A trend over time.** The profile is a comparison between conditions, not
  between weeks. Coach's panel already does weeks.
- **A fifth comparison.** §3.1 names four.
- **Coach's voice.** How the reading is said — and §6.3's prohibitions on saying
  it — is PLAN-046. This plan renders it plainly and leaves the wording alone.

---
id: PLAN-046
title: Coach holds up the mirror — the sentences, the praise, and §6.3's five prohibitions
branch: plan/m7-fluency
base: PLAN-045
issue: "#75"
spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §6, §7.2, §7.3
ledger: FLUENCY_LEDGER row 10 — closes the ledger
status: done
---

# PLAN-046 — Coach holds up the mirror

Seven plans built measurements and one reading. This one builds the **sentences**
— and it is the only plan in the milestone whose output the learner actually
reads word for word. §6.1 says what the layer is for in one line: the most
valuable thing the Coach produces here is not a correction, it is *the learner's
belief about themselves, held against the data.*

Which means the whole milestone can still be lost in this plan. A correct
measurement delivered in the wrong sentence does not merely fail to help — §0 of
the spec is explicit that being assessed is what grows the monitor, so the wrong
sentence makes the measured problem worse. §6.3 is five prohibitions and they are
the last ledger row for a reason.

## 0. The four things that will go wrong

**One: a prohibition that lives only in a prompt.** §6.3 forbids the Coach from
naming the learner's anxiety, from empty exhortation, from composite scores, from
therapy, and from turning distress into data. Four of the five are addressed to a
**model**, and a model is not bound by an instruction — it is asked. A check that
asserts the sentence is present in the prompt proves the request was made, not
that it was obeyed, and calling that "enforced" is precisely the kind of green
check this milestone has been catching all along.

So the claim is split, and each half is stated for what it is:

- What the model writes: the prohibitions are **requested**, in every prompt that
  produces prose about the learner, and the check proves no such prompt escapes
  the list. That is a real guarantee about *our* code and an honest one about the
  model's.
- What Verba itself writes: every sentence in this plan is **ours**, deterministic,
  in one file — and there §6.3 is *enforced*, by a source scan that fails the
  build on a judgement adjective or a therapy word. Guaranteed, not requested.

Row 10 is closed on both halves, and the plan says out loud which is which.

**Two: the output matcher that eats a good report.** The obvious next move is to
screen the model's reply and reject it when it breaks §6.3 — `parseWeeklyReport`
already returns `null` for unusable content and Coach already renders `Unusable`
with a Regenerate, so the wiring is free. It is still wrong. The report is written
in the learner's **native language**, which is any language the packs allow; a
phrase list can only cover the ones we happen to have words for, so the matcher
would be a screen that works in English and waves everything else through — while
in English costing the learner a perfectly good report on a false positive. A
detector that is silent where it matters and destructive where it does not is
worse than no detector. Not built; see *Deliberately not built*.

**Three: praise handed out for the wrong reason.** §6.2 is unusually exact about
what earns praise here — `falseAlarmRepair` **or** `midClausePauseRatio` falling
*while accuracy holds*. The failure mode is congratulating a learner whose pauses
dropped because they stopped trying: pauses down, accuracy down, and a cheerful
sentence on the screen. The condition is a conjunction and the check must be fed a
fixture where the second half fails.

**Four: the adjective.** §6.1's first rule is four words long — "Sayı verilir,
sıfat verilmez." It is the rule most likely to be broken by accident, because a
helpful sentence wants an adverb: *"your spoken accuracy is **only** slightly
worse"*, *"a **healthy** rate"*, *"**quite** a large gap"*. There is also a live
tension already in the codebase: `styleGuidance("warm")` asks for a "friendly,
supportive" voice, and warmth is the exact register in which "don't be so hard on
yourself" arrives. The word list scan (§8, check 3) is the countermeasure, and it
runs over our own strings where it can actually bite.

## 1. §6.3 — the five prohibitions, as one constant

One exported constant in `prompts.ts`, beside `FLUENCY_RULE4`, `REPETITION_RULE`
and `INTERRUPTING_RULE`, which is where every prompt-level rule in this milestone
already lives:

```ts
export const COACH_PROHIBITIONS = [
  "Never describe the learner in terms of anxiety, confidence, self-esteem, or perfectionism. You measure what they did, not who they are.",
  "Never offer encouragement with nothing in it — no \"relax\", no \"believe in yourself\", no \"don't be afraid of mistakes\".",
  "Never give a single combined score of any kind — no fluency score, no monitor score, no rating out of ten, no percentage standing for the whole.",
  "Never suggest breathing exercises, meditation, or any therapeutic technique. That is not what this is.",
  "If the learner says something is genuinely hard for them, answer as a person would and stop there. Do not turn it into a measurement, a number, or a plan.",
].join("\n");
```

Five lines, one per prohibition, in §6.3's order. It is a single string so that a
prompt folds it in with one entry, and so the check can assert each line
individually — a constant that lost a line while staying non-empty is the
regression this shape is built to catch.

The wording of the fifth line is the delicate one. §6.3's Turkish is "Coach sadece
insanca karşılık verir ve veriye geçmez": the instruction is not "be sympathetic",
it is **stop**. So the sentence names the stopping, not the sympathy.

## 2. Where it goes, and how nothing escapes

`prompts.ts` already carries a pinned registry — `SPOKEN_PROMPTS` and
`STRUCTURED_PROMPTS` — and `prompts.check.ts` already asserts that every exported
`…Prompt(` in `src/lib`, plus `buildSystem`, appears in exactly one of them. That
completeness assertion is the mechanism this plan needs, and it already exists;
do not build a second one.

Add a third, pinned **subset**:

```ts
/** The prompts that produce prose *about the learner* — §6.3's prohibitions ride
 *  on exactly these. Every entry of SPOKEN_PROMPTS is classified here, so a new
 *  spoken prompt cannot be added without a decision about §6.3. */
export const ABOUT_THE_LEARNER: Record<string, boolean> = { … };
```

`true` for the three that describe the learner to themselves:

| Prompt | Why |
|---|---|
| `prompts.ts:buildSystem` | the conversation — where distress is actually voiced, so prohibition 5 has nowhere else to live |
| `prompts.ts:summaryPrompt` | the reflection's prose, read at the end of every session |
| `coach.ts:weeklyReportPrompt` | §6.1's paragraph, the most exposed surface in the app |

`false` for the rest, each with its reason in one clause: `rewindOwnPrompt` and
`rewindUnpackPrompt` talk about a sentence, `drillPrompt` about an exercise,
`vocabPrompt` / `titlePrompt` / `productionPrompt` about language. A prompt that
never characterises the learner does not need the rule, and padding every prompt
with it would dilute it where it counts.

Because `SPOKEN_PROMPTS`' completeness is already asserted against the source, and
this record is asserted complete against `SPOKEN_PROMPTS`, a prompt added later
cannot reach the learner without someone deciding. That is the whole guarantee,
and it is a guarantee about our code, which is the only kind available here.

### The composite that never reaches the model

Prohibition 3 has a half that *is* enforceable regardless of language, and it is
upstream of the prose: **do not hand the model a composite in the first place.**
`weeklyReportPrompt` already bands the 0–100 metrics composite through
`scoreBand` rather than printing it. Pin that with a probe — a `WeekStats` with
`avgLevelScore: 87` whose prompt does not contain `87` — and pin the M7 side
beside it: nothing in `fluency.ts` or `profile.ts` produces a monitor number to
hand over. `profile.check.ts` already scans for that; this is its second reason
to exist.

## 3. §6.1 — the mirror, one sentence per row

§7.3 asks each profile row for a fourth element: *"tek cümlelik düz Türkçe
yorum"* — one plain sentence about **that** comparison. PLAN-045 shipped the rows
with a question, two numbers and a difference, and left this to us. It is §6.1's
mirror, one row at a time.

`rowComment(row: ProfileRow): string` in `profile.ts`. Rules, all four from §6.1:

1. **The sentence carries the difference as a number, with its unit.** Never
   "a large gap" on its own.
2. **No adjective of judgement.** The difference is stated and what it *means* is
   stated; how the learner should feel about it is not.
3. **The comparison is to themselves.** No band norm, no "typical learner", no
   "for a B1". This is already true of the data — every row is the same learner's
   two conditions — and the sentence must not quietly reintroduce an outside
   reference.
4. **A threshold crossing is named as a threshold**, not as a verdict: the
   sentence says the difference is under or over the small-difference line, and
   the line's value is on screen, because invariant 12 applies to it too.

Two forms per row — under the line and over it — chosen against
`SMALL_ACCURACY_DIFF` (row 1) and `SMALL_RATE_DIFF` (rows 2–4), the constants
PLAN-045 already pinned. Eight sentences, all in one file, all scanned.

### The pause sentence

§6.1's example paragraph has a third sentence the four rows cannot carry:
*"Duraklamalarının %70'i cümle ortasında… cümleyi kurarken kendini denetlediğin
anlamına geliyor."* It is the one piece of direct evidence about the monitor that
is **not** behind `FALSE_ALARM_ON_SCREEN`, and leaving it out would ship a mirror
section whose only monitor evidence is a comparison of speaking rates.

- New door in `model.ts` (payload reads live there and `signals.check.ts` fails
  the build on a reader anywhere else): `timingPauseRatio(s): number | null`,
  reading `midClausePauseRatio` off a `timing` signal, `null` for anything else
  and for a recording that held no pause at all.
- `pauseSentence(signals): string | null` in `profile.ts` — the mean ratio across
  the measured sessions, as a percentage, with what a mid-clause pause means, and
  `null` when nothing measured one. Absent, never zero, and never a 0 % that
  means "we did not look".
- It reads `measuredSessions` like everything else in the file, so the kill switch
  covers it for free. That is not incidental: a pause sentence that survived
  `monitorLoad: false` would be the exact leak PLAN-045's review found.

## 4. §6.2 — the praise rule

§6.2 defines earned praise exactly, and the definition is the layer's own thesis
turned into a condition: **`falseAlarmRepair` or `midClausePauseRatio` falling
while accuracy holds.** Nothing else in this milestone congratulates anybody.

`earnedPraise(signals): string | null` in `profile.ts`:

- Take `measuredSessions`, order them by `observedAt`, and split into an older
  and a newer half. Requires **at least four** measured sessions — two a side.
  Fewer than four returns `null`, silently, like every other thin-data path in
  this layer.
- Compare the mean `midClausePauseRatio` of the two halves, and the pooled
  corrections-per-100-words of the two halves (the same arithmetic
  `accuracySide` already uses; factor it if that is the shorter diff, leave it
  duplicated if it is not).
- Praise **only** when the pause ratio fell by at least `PAUSE_DROP` (a new pinned
  constant, 0.10 — ten percentage points) **and** accuracy did not worsen by more
  than `SMALL_ACCURACY_DIFF`. Both halves, or nothing.
- The sentence states both numbers and says what it means: they paused mid-clause
  less and their accuracy did not pay for it. No exclamation mark, no "great job",
  no adjective — the scan in §8 covers this sentence too.
- `falseAlarmRepair`'s half of §6.2 stays behind `FALSE_ALARM_ON_SCREEN` with the
  others. Written, unreachable, and commented as such — the same treatment
  `monitorDominant` and `slowAccess` got in PLAN-045.

**ponytail:** two halves of the record is not a trend line, and the comment says
so — `// ponytail: two halves, not a trend; a real slope needs the sessions we do
not have yet`. Four sessions split down the middle is the smallest thing that can
tell "falling" from "noisy", and it is the honest ceiling until the record is
long enough to fit anything better.

## 5. §7.2 — the session-end card

§7.2 pins three sections **in this order**. The reflection today has a stats row
and, in fluency mode, "the three things". Give it the shape the spec asks for.

**1 · What happened.** Duration, word count, and the longest uninterrupted moment
of speech. The third needs one new function in `fluency.ts`:

```ts
/** The longest unbroken run of speech in a session, in ms. Null when nothing
 *  measurable was spoken. */
export function longestRunMs(voice: VoiceTurn[]): number | null
```

built the way `roundTimingOf` is: slice with `fromFirstSpeech`, split on the same
0.25 s threshold, take the longest run in frames and scale it by the recording's
own `v.ms / v.levels.length`. A typed session has no voice and therefore no such
number — the line is **absent**, not zero.

"Duration" is the spoken time we can actually measure, and it is labelled as what
it is ("time speaking"), not as wall-clock session length we never recorded.

**2 · What changed.** Two signals against the previous session, with an arrow.
Pin the two: **speech rate** (words per minute) and **mid-clause pause ratio**
(per cent) — the two numbers this milestone is about.

Three traps, all of which have bitten before:

- **Both sides must be computed the same way.** The previous session's numbers
  come from stored `timing` signals through `timingRate` / `timingPauseRatio`, one
  per recording, meaned. So the current session's must be the mean of
  `timingOf(...)` across its recordings too — **not** `roundTimingOf`, which pools
  words over total time. A pooled rate against a mean of rates is two different
  measurements wearing one arrow.
- **`recentSignals` is recent-first.** The previous session is the first
  `activityId` in that array that is not the current one. This ordering has
  produced two defects in this milestone already; the code says it in a comment
  and the check feeds the real order.
- **The arrow is direction, not valence.** No colour, no "+", no warn tint — the
  metric grid on Coach tints a negative delta red, and this card must not. Faster
  is not automatically better and this layer of all layers may not imply it.

Either signal may be absent on either side; an absent one produces **no row**, not
a dash and not a zero. No previous session produces no section at all — a first
session has nothing to compare and says nothing about it.

**3 · Three notes.** `closingItems`, already built and already correct. It moves
under this heading and stops being a floating list.

**"See all corrections", closed by default.** §7.2's last line. In fluency mode
the categorised correction list is currently hidden outright; the spec asks for it
to be *reachable and closed*. A `<details>` element — the native disclosure
widget, keyboard-operable and screen-reader-labelled without a line of JavaScript
— wrapping the list Talk already renders in the ordinary reflection.

## 6. §7.3 — the profile section, finished

- Each row gains `rowComment(row)` as its fourth line, replacing nothing: the
  question, the two numbers, the difference, then the comment.
- `pauseSentence` and `earnedPraise`, when non-null, sit under the reading
  sentence. Both may be null and usually will be; nothing is rendered for a null,
  no heading and no placeholder.
- `readingSentence`'s four sentences are rewritten under §6.1's rules — PLAN-045
  wrote them plainly and left the wording to this plan (`profile.ts:302` says so).
  `noProblem`'s "We measured it — you're genuinely fine." is the one to watch:
  it is the only sentence in the layer that could be read as a verdict, and it
  should name what was measured rather than pronounce on the learner.
- **No chart.** §7.3 permits a graph of exactly one signal over time and forbids
  overlaying two. We are not building one, so there is nothing to overlay; the
  prohibition is recorded here and in *Deliberately not built* rather than
  enforced by a check on code that does not exist.

## 7. Files

| File | Change |
|---|---|
| `src/lib/prompts.ts` | `COACH_PROHIBITIONS`, `ABOUT_THE_LEARNER`, folded into `buildSystem` and `summaryPrompt` |
| `src/lib/coach.ts` | `COACH_PROHIBITIONS` folded into `weeklyReportPrompt` |
| `src/lib/model.ts` | `timingPauseRatio` — the sixth door |
| `src/lib/profile.ts` | `rowComment`, `pauseSentence`, `earnedPraise`, `PAUSE_DROP`, reworded `readingSentence` |
| `src/lib/fluency.ts` | `longestRunMs`, `sessionChange` |
| `src/views/Coach.tsx` | the row comment, the pause sentence, the praise line |
| `src/views/Talk.tsx` | §7.2's three sections and the `<details>` |
| `src/lib/prompts.check.ts` | §6.3 — **marker `fluency ledger 10`** |
| `src/lib/profile.check.ts` | the sentence scan, `rowComment`, `pauseSentence`, `earnedPraise` |
| `src/lib/fluency.check.ts` | `longestRunMs`, `sessionChange` |
| `src/lib/invariants.check.ts` | row 10 → asserted; the ledger closes |

**No new files.** `npm run check` stays at 54.

## 8. Checks

**`prompts.check.ts` — marker `fluency ledger 10`:**

1. `COACH_PROHIBITIONS` carries five lines, and each of §6.3's five bullets is
   findable in it by its own marker word. A constant that lost a line fails here.
2. Each of the three `ABOUT_THE_LEARNER` prompts contains the whole constant —
   built with real settings, not a stub, so a builder that drops it under some
   branch is caught.
3. `ABOUT_THE_LEARNER` is complete over `SPOKEN_PROMPTS`: every entry classified,
   no entry that is not in `SPOKEN_PROMPTS`. Probe: a fabricated extra name in
   `SPOKEN_PROMPTS` must fail the completeness assertion.
4. A `false` prompt does **not** carry the constant — the rule is targeted, and a
   check that passed either way would be no check.
5. `weeklyReportPrompt` with `avgLevelScore: 87` does not contain `87`.

**`profile.check.ts`, sections 7–9:**

6. **The word scan.** Every sentence this layer can emit — the eight
   `rowComment` forms, four `readingSentence` forms, `pauseSentence`,
   `earnedPraise` — is generated from fixtures and scanned against a pinned list
   of judgement adjectives and §6.3's therapy vocabulary (`relax`, `breathe`,
   `calm down`, `anxious`, `anxiety`, `confidence`, `perfectionist`, `don't
   worry`, `great`, `excellent`, `poor`, `bad`, `impressive`). The scan is over
   generated output, not source text, so a sentence assembled from parts is
   covered. Probe: the scanner must reject a planted string, or it is a scanner
   that scans nothing.
7. `rowComment` states the difference **with its unit** for all four rows, on both
   sides of the threshold — eight assertions, and the number must appear in the
   sentence.
8. `earnedPraise` returns a sentence when pauses fall and accuracy holds; and
   **`null`** on a fixture where pauses fall by the same amount and accuracy
   worsens past `SMALL_ACCURACY_DIFF`. The second is the assertion that matters.
   Plus `null` on three measured sessions (under the four-session bar), and `null`
   with `monitorLoad` off — the same kill-switch fixture PLAN-045's review added.
9. `pauseSentence` is `null` when no session carries a `midClausePauseRatio`, and
   carries the percentage and its definition when they do.

**`fluency.check.ts`:**

10. `longestRunMs` on a synthetic envelope with two runs returns the longer one,
    scaled by the recording's frame duration; `null` on a silent envelope and on
    an empty array.
11. `sessionChange` fed `recentSignals`' **real recent-first order** picks the
    most recent previous session, not the oldest. Probe: a three-session fixture
    where taking the last activityId instead of the first gives a different arrow.
12. A signal absent on one side yields no row for it; no previous session yields
    an empty array.

**`invariants.check.ts`:** row 10 flips to
`assertedIn: [{ file: "src/lib/prompts.check.ts", marker: "fluency ledger 10" }]`,
and the bill prints **13 asserted, 0 pending**.

## 9. Ledger

Row 10 — *"§6.3's prohibitions are enforced at prompt level and tested"* — closes,
and with it `FLUENCY_LEDGER`. The row's claim is met by §8's checks 1–5, with §0's
split stated in the code comment beside the constant: requested of the model,
enforced on ourselves.

Row 2 (`falseAlarmRepair` validated by hand-sampling) stays asserted only in the
sense PLAN-041 left it: `FALSE_ALARM_ON_SCREEN` is `false`, and three surfaces
wait on the hand sample. This plan adds a fourth — §6.2's other half. That is the
milestone's one open debt and it is not code.

## Do not touch

- `closingItems` and its ordering. §4.2 rule 6 is built and reviewed; this plan
  moves the rendered list under a heading and changes nothing about the selection.
- `FALSE_ALARM_ON_SCREEN`. It is PLAN-041's constant to flip, after the hand
  sample, and this plan adds a dependent rather than removing one.
- The metric grid on Coach and its coloured deltas. It is a pre-M7 surface with
  its own rules; §7.2's card is new and follows §7.3's, but the grid is not
  rewritten here.
- `SPOKEN_PROMPTS` / `STRUCTURED_PROMPTS` membership. The new record is a subset
  laid over them, not a re-classification.

## Deliberately not built

- **An output matcher for §6.3.** §0, point two: it works in one language and
  destroys good reports in that same language. If it is ever built it belongs
  behind the packs, with a per-language word list, and with `Unusable` as its
  only action — never a silent rewrite.
- **A chart in the monitor-load section.** §7.3 allows one signal over time. There
  is no signal here with enough sessions behind it to make a line worth drawing,
  and the prohibition on overlaying two is easier to keep by drawing none.
- **A distress detector.** Prohibition 5 is a conversation rule and stays one. A
  classifier deciding the learner is distressed, and a UI that changes because of
  it, is exactly the "being assessed" the layer is built to avoid.
- **A composite of anything.** Still true, still the layer's first rule.

## 10. Fixup decisions (post-review)

Four findings on `493e590`. The first three all had the same consequence — the
Monitor Load section could never render on real data — and the first of them was
a PLAN-045 defect this plan inherited and extended.

**1 · An `activityId` is not a session id.** `db.ts` stores it as "the ActivityId
within that day's plan" and `learn.ts` draws it from a fixed set, so every
conversation the learner has ever had is filed under `"talk"`. PLAN-045's
`measuredSessions` grouped by it and called each group a session; only `talk` and
`roleplay` can carry a `sessionContext` at all, so `monitorProfile`'s
three-session bar was **unreachable by construction** and the section never drew.
The check fixtures invented `a1`…`a4`, which the app never writes — a fixture
that agrees with the bug, the same failure this milestone has now produced four
times.

A session is now **a run of one activity's signals**, split wherever the gap to
the next exceeds `SESSION_GAP_MS` (one minute: a session's signals are written in
a single batch microseconds apart, and 4/3/2's rounds — the closest pair the
product can produce — are two minutes apart at the shortest). `measuredSessions`
moved to `fluency.ts`, which already owns `MonitorContext`, so `sessionChange`
can share it without a cycle; it returns sessions **oldest first**, stated in the
contract, because `recentSignals`' recent-first order has now caused three
defects.

**2 · `rowComment` called an accuracy difference "faster", and backwards.** Row 1
is counted in corrections per 100 words, where the higher number is the condition
that was corrected *more* — and the sentence read *"Spoken is faster than
Written"*, which is meaningless there and, worse, reads as the good end of the
difference, on the one row `profileReading` builds `knowledgeGap` and
`monitorDominant` on. The two units now get their own sentence. Neither the word
scan (§8 check 6 — "faster" is not a judgement adjective) nor the unit assertion
(check 7 — the unit and a digit were both present) could see it.

**3 · "What changed" read the record before writing to it.** The write
(`day.complete`) and the read (`recentSignals`) were two effects started in the
same tick; a single SELECT beats a batch of INSERTs, so the current session was
never in what came back and the section could not render. One effect now, the
read awaited after the write.

**4 · 4/3/2's rounds 2 and 3 wrote nothing.** The write was gated on
`!day.isDone(closes)`, and all three rounds close the same `talk` block — so
`taskRepetition` 2 and 3 never reached the record, and the profile's
first-vs-third row had no third side even once finding 1 was fixed. The gate is
now a per-reflection ref, which also stops StrictMode's double-invoked effect
filing the batch twice — something `!day.isDone` never did.

**Checks added, each proven against the pre-fix code.** `measuredSessions` over
six conversations on six days under one `activityId`; `monitorProfile` producing
all four rows on that same shape; three 4/3/2 rounds minutes apart staying three
sessions; `rowComment`'s row-1 sentence naming corrections and never speed, and
following the numbers when the sides swap; and four source assertions on
`Talk.tsx` for findings 3 and 4. Two probes that re-implemented the assertion
they claimed to test — in `prompts.check.ts` §3 and the old `sessionChange`
section — were replaced with probes that run the real predicate on a different
input.

**Not fixed, recorded here.** `tsconfig.json` excludes `src/**/*.check.ts`, so no
check file is ever type-checked and `noUnusedLocals` does not reach them; dead
code in a check lives silently (one such local was removed here). Changing it is
a repo-wide build decision and does not belong in this plan.

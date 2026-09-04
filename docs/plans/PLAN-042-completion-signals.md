---
id: PLAN-042
title: The sentence never finished, the slip home, and the sentence never attempted
branch: plan/m7-fluency
base: PLAN-041
status: ready
executor: unassigned
created: 2026-09-04
issue: https://github.com/nuvocode/verba/issues/70
milestone: M7 · Fluency & monitor load
spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §2.3
roadmap: docs/plans/M7-roadmap.md (D3)
---

# PLAN-042: the completion signals

## Context

Spec §2.3, the last third of §2. Three signals, and they are not the same kind of
thing:

- `abandonedUtterance` — a sentence started and never finished. **Observable.**
- `l1Fallback` — a slip into the native language. **Observable, and partly
  checkable for free** when the two languages are written in different scripts.
- `avoidanceScore` — the learner did not attempt the structure the plan aimed at.
  **The silent one.** §2.3: *"kullanıcı hata yapmaz, çünkü riskli cümleyi hiç
  kurmaz. Hata sayan sistemler bunu göremez; Verba görmelidir."*

The third is the reason this plan is interesting and the reason it is dangerous.
It is a claim about something that **did not happen**, and there is nothing in the
transcript to check it against. Every other verification in this milestone works by
finding the evidence in the learner's own words; a negative has no evidence. This
plan is mostly about not letting that one signal borrow the credibility the other
two earn.

Fourth plan on `plan/m7-fluency`, on top of PLAN-041. Last plan of §2 — after this
the milestone stops measuring and starts changing what a session does.

## One call, not four

PLAN-041 added a reflection-time model call for §2.2. Adding two more for §2.3
would mean three round trips at the end of every spoken session to fill in one
screen nobody has built yet.

`repairsPrompt` / `parseRepairs` become `productionPrompt` / `parseProduction`,
returning all of §2.2 and §2.3 from one call. It is a rename across three files
and it is worth it: the name `repairsPrompt` would be wrong the moment this plan
lands, and a wrong name in `prompts.ts` is how the next plan asks the wrong
question.

```ts
export interface ProductionReport {
  repairs: SelfRepairReport[];               // §2.2, unchanged
  abandoned: { fragment: string }[];         // §2.3
  l1: { span: string }[];                    // §2.3
  /** Null when the activity carried no goal — see the gate below. */
  avoidance: { goal: string; attempted: boolean; evidence: string } | null;
}
```

`parseProduction` checks shape only, as before. Every field is optional in the
model's JSON and absent parses to empty — a model that only answers half the
question has answered half the question, not zero for the rest.

## Repo conventions

- **No new dependencies.** No new files.
- Same three rules as PLAN-041: the model points and we check; a monitor kind is
  gated on `r.context`; with the measurement off there is no signal **and no
  request**.
- The presence gate is written **once**. PLAN-041's fold-and-find logic moves into
  a small shared helper in `fluency.ts` and all four verifications call it. A
  second copy is how the intra-line ordering bug would come back in one of them
  and not the others.
- No payload carries `correct` or `grade`.
- Style and check conventions as in PLAN-015. `npm run check` green.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/prompts.ts` | EDIT | `repairsPrompt` → `productionPrompt` |
| `src/lib/prompts.check.ts` | EDIT | the PLAN-041 section |
| `src/lib/fluency.ts` | EDIT | after `verifySelfRepairs` |
| `src/lib/fluency.check.ts` | EDIT | new sections 13–15 |
| `src/lib/useTalk.ts` | EDIT | `open()`, `Reflection`, the reflection call |
| `src/lib/signals.ts` | EDIT | `talkSignals` |
| `src/lib/langs.ts` | EDIT | `scriptOf` (below) |
| `src/lib/invariants.check.ts` | EDIT | nothing new — §2.3 rides row 1 |

## Specification

### 1. The shared presence gate

```ts
/**
 * A span the learner actually said, and where. The one door every §2.2/§2.3
 * verification goes through — fold, find, and (for a pair) check the order
 * *inside* the line as well as across lines, because one recording is one line
 * and a self-repair lives entirely inside it.
 */
export function saidAt(transcript: string[], span: string, locale: string): { line: number; at: number } | null;

/** True when `after` starts after `before` ends — same line, or any later line. */
export function saidInOrder(transcript: string[], before: string, after: string, locale: string): boolean;
```

`verifySelfRepairs` is refactored onto these two and its behaviour does not change
except for the intra-line ordering it should always have had.

### 2. `abandonedUtterance`

One signal per fragment the model reports, gated on `saidAt` — the fragment must
be in the learner's own transcript.

No second gate, and none is needed: "this sentence stops" is a claim about text
that is present, not about text that is missing. The fragment is stored so §7.2's
end-of-session card can show the learner the actual sentence rather than a count.

```
kind: "abandonedUtterance"
label: "sentence you left unfinished"
fragment
unit: "count"
definition: "a sentence you started and did not finish"
```

### 3. `l1Fallback`, and the free gate

```
kind: "l1Fallback"
label: "words from your own language"
span
unit: "count"
definition: "a moment you reached for your own language"
```

Two gates:

1. `saidAt` — the span is in the transcript.
2. **The script gate.** A reported L1 span whose characters are not in the native
   script is dropped. A Japanese learner whose native language is English cannot
   have "fallen back to English" in a span written in kana, and that is checkable
   for nothing.

   **The gate only runs when it has something to read** — corrected after review.
   The transcript is the *target* language's recognizer output, so it is written
   in the target's script. A span in the native script can only appear when that
   script is one the transcript can carry: in practice Latin, the romanization
   every recognizer falls back to. A learner whose native language is written in
   kana studying English produces a transcript that is Latin from end to end, and
   a gate reading "not kana, so not Japanese" deletes *every* real slip they make
   — for every learner whose native language is not written in Latin, which is
   most of the people this app is for. So the gate runs only when the native
   script is Latin and the target's is not; every other configuration is gate 1
   alone.

```ts
// src/lib/langs.ts
/**
 * The dominant script of a piece of text, as a Unicode script name — "Latin",
 * "Han", "Hiragana", "Cyrillic", "Arabic"… `null` when the text carries no
 * letters. Used by the L1 gate: when the two languages do not share a script, a
 * span in the wrong one was not a fallback.
 */
export function scriptOf(text: string): string | null;
```

`\p{Script=…}` regex classes, no table and no dependency. Two languages that
**share** a script get gate 1 only, and the comment says so plainly rather than
implying a check that is not running: for Spanish and English this signal rests on
the model, and §3.2's sample gates are what keep a single wrong one off a screen.

### 4. `avoidance` — the one that cannot be checked

One signal per **activity**, not per turn, and only when the activity carried a
goal.

`useTalk.open()` already receives `goal?: string` (it folds it into the system
prompt at the `Quietly give the learner practice with:` line). It is not kept
anywhere the reflection can read. Add a ref, set it in `open()`, cleared with the
rest of the session state in the two places `voice.current` is cleared.

The gates, in order:

1. **No goal, no signal.** Not a zero, not an "unknown" — no signal at all. An
   avoidance claim about a session that was never aiming at anything is a claim
   about nothing, and it is the most likely way this signal produces noise.
2. **`attempted: true` writes no signal.** The absence of avoidance is not a
   measurement of avoidance.
3. **A claimed attempt must be evidenced.** When the model says `attempted: true`
   its `evidence` must pass `saidAt`. An unevidenced *attempt* claim is treated as
   no information — the signal is dropped, in both directions. The model does not
   get to clear the learner on its own word any more than it gets to accuse them.

What remains — `attempted: false`, with a real goal — is written as a signal and
is **a model judgement with no local verification**, and the payload says so:

```
kind: "avoidance"
label: <the goal, verbatim>       // §8's grouping and PLAN-045's row both need the structure
goal
judged: true                      // the honest flag: no local check stands behind this
unit: "count"
definition: "a structure the plan aimed at that you did not attempt"
```

`judged: true` is not decoration. PLAN-045 must hold this signal to a higher
sample bar than the measured ones — §5.4 has the coach put the structure on the
table before a task off the back of it, and doing that off one model opinion is
how a learner gets told to practise something they have been using all week.
Write the requirement into the payload where the reader will find it, and repeat
it in PLAN-045's context when that plan is written.

Note the label is the goal itself, not a constant. `selfRepair`'s constant label
was right because nothing groups on it; this one is grouped on by §8 and by
PLAN-045's row, so the structure has to be the label. It can never become a
weakness regardless — `signalMiss` is false, the payload has no `correct`.

### 5. `signals.ts`

Three more draft groups behind the one gate:

```ts
    // §2.3's completion signals. Monitor kinds, so they ride the same gate
    // `sessionContext`, `timing` and `selfRepair` do.
    ...(r.context ? completionSignals(activityId, r.completion) : []),
```

### 6. `fluency.check.ts` — sections 13, 14, 15

**13 — the shared gate, and the bug it exists to prevent.**

1. `saidInOrder(["dün I go, I went to the doctor"], "I went to the doctor", "I go")`
   is **false** — the reversed report, entirely inside one line. This is the case
   PLAN-041's cross-line test did not reach, and it is the case real data is made
   of.
2. The same pair forwards is true.
3. `after` overlapping `before` is false — it must start after `before` ends.
4. `verifySelfRepairs` still passes every PLAN-041 assertion, unchanged.

**14 — abandoned and L1.**

1. A fragment not in the transcript is dropped.
2. A Japanese target with an English native language: a reported L1 span written
   in kana is dropped; one written in Latin survives.
3. A Spanish target with an English native language (shared script): gate 1 only,
   and a span in the transcript survives. Asserted so the *absence* of the script
   gate is deliberate and visible rather than an accident.
4. `scriptOf("")` and `scriptOf("123 …")` are `null`, and a null script never
   drops anything — an unmeasurable gate is open, not closed. A gate that fails
   shut would silently delete real fallbacks.

**15 — avoidance, every gate.**

1. No goal ⇒ no signal, whatever the model said.
2. `attempted: true` ⇒ no signal.
3. `attempted: true` with `evidence` not in the transcript ⇒ still no signal
   (dropped, not flipped to avoidance). The model clearing the learner on
   unverified evidence and the model accusing them are both refused — and since
   both answers are "file nothing", this is one line in `verifyAvoidance`, not a
   gate of its own. `verifyAvoidance` therefore takes no transcript: it is the one
   §2.3 signal with nothing to check against, and its signature says so.
4. `attempted: false` with a goal ⇒ exactly one signal, whose `label` is the goal
   and whose payload carries `judged: true`. **Read through `parseProduction`, not
   hand-built** — corrected after review: `attempted: false` has nothing to
   evidence, so the answer a model actually sends omits the field, and a parse
   that required `evidence` dropped the only branch that ever files a signal. The
   check that built the claim by hand could not see it.
5. `signalMiss` is false for it, and for `abandonedUtterance` and `l1Fallback`.

## Do not touch

- `verifySelfRepairs`'s two gates. They are refactored onto `saidInOrder` and
  their meaning does not change.
- `repair.ts`. Still PLAN-027's layer.
- The `l1Fallback` signal must not reach the vocabulary deck. A native-language
  word is not a lexical item the learner met, and `addVocab` never sees this kind.
- Anything a learner can see. This is the last plan of §2; nothing in §2 renders.

## Acceptance

- `npm run check` green.
- One model call per spoken session, not three.
- A session with no goal writes no `avoidance` signal.
- A Japanese session writes no `l1Fallback` for a kana span.
- With `monitorLoad` off: no request, no signals of any of the three kinds.
- `FLUENCY_LEDGER` unchanged — §2.3 rides row 1, which PLAN-040 already asserted.
  Row 1's marker now covers all three subsections of §2, which is what it claims.

## Commit

```
feat(fluency): what was left unfinished, what slipped home, and what was never tried (PLAN-042)
```

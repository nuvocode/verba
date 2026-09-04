# PLAN-034 review — rehearsal mode

Applied on top of `a08087d` (PLAN-033). Branch `plan/m6-repair-layer`.

## What landed

**New files**

- `src/lib/rehearsal.ts` — `RehearsalBrief`, `rehearsalScenario(brief)`,
  `rehearsalSystem(s, brief, sc)`, `parseRole(raw)`, `debriefPrompt(s, brief,
  transcript)`, `parseDebrief(raw, turnCount)`, `DEBRIEF_PHRASES_MAX = 5`.
- `src/lib/rehearsal.check.ts` — the 12 cases.

**The load-bearing points, as asked**

1. **In-role JSON shape.** `rehearsalSystem` asks for
   `{ reply, repair, missed, keyWord }` and nothing else. `parseRole` keeps
   exactly those four — the keeping is what makes PLAN-028's breakdown
   detection and PLAN-027's repair inventory real in a rehearsal — and drops
   `corrections`, `suggestions`, `goalsMet`, `praise` and `ease` a model sends
   anyway. The three observation fields are never rendered (Talk renders only
   `reply`) and never spoken (no praise clip, no suggestion rail).
2. **Closed in role:** the axis (`pickAxis` runs only behind `!inRole`; no
   `axisUsed`/`easeRequest` signal is ever written), the offer (gated at the
   wait itself — `fireOffer` reads a ref, not the state, so the timer that
   fires it sees the current mode; the wait still runs), praise (`praiseGate`
   is never reached in role), the opening detail (`openingDetail` is behind
   the mode; nothing stamped), and `styleGuidance` (absent from
   `rehearsalSystem`, present in `debriefPrompt`). Each is off at its own call
   site with the mode in the condition.
3. **Rewind split.** `REWIND_ORDER` is untouched. In role the queued rewind is
   driven with the cap set: own → repeat runs, then the drive rests at
   `repeat`; an advance in role is refused before `nextStep` is consulted.
   `unpack` and `gift` are out of role, and the gift moves to the debrief —
   case 5 asserts `nextStep("repeat", true)` is still `unpack` in a normal
   session, so the cap cannot be "fixed" by rewriting the order.
4. **Entry without forking the loop.** `rehearsalScenario(brief)` is synthetic
   (`id: "rehearsal"`, persona from `who`, setup from `about` + formality), no
   `formatVersion`, never written to the catalogue. `start(sc, mode, brief?,
   goal?)` takes the scenario **and** the mode; the loop, queue, timing and
   signals are unchanged. `endRole()` is the second phase: the coach steps
   out, and the debrief is its own block, derived — not a turn in history.
5. **The marker.** One `rehearsal` `SignalKind`, written once per rehearsal
   batch by `talkSignals` beside the turn signals at the same stamp;
   `recapsFrom` returns `null` for the batch that carries it. `end()` also
   skips `calibrate` outright in rehearsal. It is a SignalKind, not an
   ActivityKind — case 10 pins `ActivityKind` as unchanged and no plan builder
   emitting one.
6. **The two prompt lists.** `rehearsalSystem` does not end in `Prompt`, so
   `allPromptNames`' scan would miss it — it is hand-added to the scan (only
   when the walk actually covered `rehearsal.ts`, the same way `buildSystem`
   is) and classified into the **not-styled** list with the reason written
   beside it; `debriefPrompt` is found by the scan and sits in the styled
   list. `prompts.check` case 9 passes: both builders exist, both are in
   exactly one list.
7. **parseDebrief's two rules.** A `stuck` entry whose `turn` is not a
   non-negative integer below `turnCount` is dropped — one just past the end
   drops exactly like a negative one, and a valid one beside them is kept.
   `phrases` is capped at five; fewer pass through unchanged. The transcript
   the prompt numbers is the same list the parse counts against, so an index
   means something.

## Checks

12 cases in `rehearsal.check.ts`. Cases 3, 4, 5 and 9 were each verified the
hard way — the rule removed, the check run, the red observed, the rule
restored:

| Case | Rule removed | Failure |
|---|---|---|
| 3 | `parseRole`'s keeping half | `case 3: the repair is kept` |
| 4 | `start` reading the `rehearsal` state instead of the params | `case 4: buildSystem is not chosen for a rehearsal` |
| 4 | the offer gate in `fireOffer` | `case 4: in role, firing the wait speaks nothing` |
| 5 | the whole rehearsal branch in the queued rewind | `case 5: the rehearsal drive stops after repeat` |
| 9 | the marker rule in `recapsFrom` | `case 9: a rehearsal is not a session, so two in a row raise nothing` |

**Case 4 is behavioural, not a source scan.** A scan cannot see whether `start`
reads the `rehearsal` state — the state is null on the very first render, so
reading it would make the first call of a rehearsal behave like an ordinary
session. So case 4 renders the real `useTalk` hook (via `react-dom/server`
and a runtime loader that resolves the repo's extensionless imports and mocks
`providers`/`speech`/`db`), calls `start(sc, "rehearsal", brief)` as the first
call, and asserts the system prompt it actually chose is `rehearsalSystem`.
The offer is pinned the same way: with a ready baseline the wait would fire an
offer, and firing it in role must speak nothing. The loader and mocks live in
`rehearsal.loader.mjs` and `rehearsal.mock-*.mjs`.

A note on case 5: removing only `stopAfterRepeat`'s short-circuit (or only the
call-site flag) leaves the check green — the cap is one fact held at two
places, and the scan reads both. That is deliberate: the check pins the
branching block as a whole, so a partial removal that keeps half the cap is
not a rehearsal that works.

## Not touched

- `ActivityKind`, `buildDailyPlan`, Today's card list — the rehearsal is
  reached from Today's overflow line and ⌘K ("Rehearse a conversation you have
  to have"), never from the plan.
- The scenario catalogue — nothing stored, nothing imported.
- PLAN-032's wait machine and PLAN-033's memory write path — the mode switches
  call sites off; the machines themselves are byte-identical.
- No new dependency.

## Result

`npm run check`: 49 check files, 49 passed. `REPAIR_LEDGER` row 18 asserted
via `rehearsal ledger 18`; 18 repair rows asserted, 6 pending.

## Deviations worth naming

- The in-role offer is stood down at the wait itself, not on the rail: the
  rail is empty in role anyway, and the offer is what would speak over it. The
  gate reads a ref (`rehearsalRef`), not the state — the timer that fires the
  offer captured the closure from the render where the wait was scheduled, and
  for the very first rehearsal that render's state was still null. The wait
  still runs, which is the plan's intent ("the silence is the point"); a
  learner with a ready baseline still gets `waiting`'s clock, but nothing is
  *spoken* at them.
- The debrief phrases ride into Memory through the existing `addVocab` path
  with `capturedBy: "learner"` — the learner taps a chip, nothing is
  auto-saved. The chip's meaning falls back to the phrase itself when no
  `why` names it.
- `resume` does not carry a rehearsal (the brief is not persisted), so
  resuming a rehearsal session reopens it as an ordinary conversation of the
  same scenario id. This is deliberate: a half-finished rehearsal is restarted
  from the brief form, which still remembers nothing — the plan asks that the
  brief is *shown* at the top of the session, which it is, for the live
  session's life.
---
id: PLAN-034
title: Rehearsal — play the other side, then step out
branch: plan/m6-repair-layer
base: master
status: todo
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/67
milestone: M6 · Repair layer
---

# PLAN-034: rehearsal mode

## Context

Spec §7.1. The one feature in M6 the learner will ask for by name.

What holds an adult learner is not a streak. It is that tomorrow, at 10:00, they
have to explain a delay to a supplier in a language they are not confident in, and
tonight they can practise exactly that. Everything else in Verba is training;
rehearsal is the reason the training was worth it.

Two rules make it work, and both are about *not* being a lesson:

- **The difficulty axes are off.** PLAN-031 exists to manufacture breakdowns.
  Manufacturing one in a rehearsal is sabotaging a dress rehearsal for practice.
- **Role-play and feedback are separated.** The coach plays the other side straight,
  in role, without teaching — and then stops, steps out, and talks about it. A coach
  who corrects grammar mid-role-play is not the supplier, and the rehearsal stops
  being one.

Lands on top of PLAN-033's commit (`a08087d`).

## Repo conventions

- **No new dependencies.**
- Rehearsal reuses Talk's loop. A parallel conversation implementation is the wrong
  answer to every question this plan raises.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/rehearsal.ts` | NEW | `RehearsalBrief`, `rehearsalScenario`, `rehearsalSystem`, `parseRole`, `debriefPrompt`, `parseDebrief` |
| `src/lib/rehearsal.check.ts` | NEW | the cases below |
| `src/lib/useTalk.ts` | EDIT | the mode, and what it switches off |
| `src/lib/difficulty.ts` | EDIT | `recapsFrom` skips a rehearsal batch |
| `src/lib/model.ts` | EDIT | one `SignalKind`: `rehearsal` |
| `src/lib/prompts.ts` | EDIT | the two prompt lists gain the two new builders |
| `src/views/Talk.tsx` | EDIT | the brief, the phase change, the debrief |
| `src/lib/keys.ts` | EDIT | the rehearsal entry and the "end the role-play" key |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` row 18 |

## Specification

### The brief

Three short questions, one screen, all optional except the first:

```ts
export interface RehearsalBrief {
  who: string;      // "my landlord", "a customer at work"
  about: string;    // "the boiler that has not been fixed"
  formality: "casual" | "neutral" | "formal";
}
```

Free text, no list of scenarios to pick from — the whole premise is that the
conversation the learner needs is not in our catalogue. It is entered once and shown
at the top of the session, so a learner returning to a half-finished rehearsal knows
what they were preparing for.

### How it enters, without forking the loop

`start(sc: Scenario, goal?: string)` already takes a scenario, and a rehearsal is
one: `rehearsalScenario(brief)` builds it — `id: "rehearsal"`, the persona from
`who`, the setup from `about` and `formality`. It is synthetic, never saved to the
catalogue, and carries no `formatVersion` (that field marks a stored, importable
scenario; this is neither).

That gives Talk its identity, its persona and its voice for free. What the scenario
*cannot* carry is the prompt: the system prompt must be `rehearsalSystem`, not
`buildSystem`. So `start` takes the mode as well, and the mode is what switches
everything below. The loop, the queue, the timing, the signals stay as they are.

### Phase one: in role

`rehearsalSystem(brief, settings, pack)` is emphatically not the tutor prompt:

- the coach **is** the other party, and stays in role;
- no corrections, no suggestions, no goals;
- difficulty guidance is absent from the prompt entirely (not set to a low value —
  absent), and `useTalk` holds `axis === null` in rehearsal mode;
- the other party is realistic, which means they may be brisk or unhelpful, but they
  are never a test: no trick questions, no deliberate obscurity.

#### The in-role turn shape — what "no teaching" does and does not mean

The draft of this plan said the in-role JSON carries "`reply` and nothing else",
and also that breakdown detection and the repair inventory stay on. **Those two
cannot both be true.** Of PLAN-028's breakdown signals only `slowResponse` and
`shortening` are measured by Verba; the rest come from the model's `missed` list
and are verified against its `keyWord`. The whole repair inventory (PLAN-027) is
the model's `repair` field passed through `verifyRepair`. Drop those fields and
§7.1's last line — the rehearsal's signals feed the profile like any others —
becomes a rehearsal that observes almost nothing and repairs nothing.

The line is not "fewer fields", it is **teaching versus observation**. So the
in-role JSON drops `corrections`, `suggestions`, `goalsMet`, `praise` and `ease`,
and keeps:

```
{ "reply": "...", "repair": {...}, "missed": [...], "keyWord": "..." }
```

`repair`, `missed` and `keyWord` are never rendered and never spoken. They are
Verba watching, which is what the debrief is later made of. `parseRole` is the
parser for this shape; a model that sends `corrections` anyway has them ignored,
not shown.

#### What else must be off in role

Five plans landed after this one was drafted, and each of them puts the coach's
own voice into the conversation. In role there is no coach, so each is off:

- **The offer (PLAN-032).** "Want me to start you off?" is the coach teaching. It
  does not fire in role. The wait itself still runs — the silence is the point —
  and `waiting` still hides the suggestion rail, which in role is empty anyway.
- **Praise (PLAN-032).** It cites the learner's correction record; the other party
  has never seen one. Off in role, and it belongs in the debrief if anywhere.
- **The opening detail (PLAN-033).** A supplier does not know the learner moved
  house last month. `openingDetail` is not called in rehearsal, and no memory is
  stamped.
- **`styleGuidance` (PLAN-033).** `coachStyle` is how the *coach* speaks to the
  learner. Register in role comes from `brief.formality` and from who the other
  party is. `rehearsalSystem` must not carry `styleGuidance`; `debriefPrompt`
  must.
- **The axis (PLAN-031).** Off, and no `axisUsed` or `easeRequest` signal is
  written.

#### The rewind, split where the role breaks

Rewinds stay — but not whole. `REWIND_ORDER` is `own → repeat → unpack → gift →
resume`, and the role breaks partway down it:

- `own` and `repeat` are a person saying it again, more slowly. Any real supplier
  does that. **In role.**
- `unpack` explains the sentence and `gift` hands the learner a phrase to use on
  the coach ("by the way, you can always say…"). That is teaching, and `gift` is
  teaching *about talking to Verba*. **Out of role.**

So in rehearsal the rewind stops after `repeat`, and the gift moves to the
debrief, where a phrase the learner could have used is exactly what belongs.
`giftAllowed` / `giftStep` are already the knob; nothing new is needed.

### Phase two: out of role

One control, and one key, to end the role-play — the learner decides when it is
over. Then the coach steps out explicitly ("okay, out of role") and the debrief
arrives as its own block:

```
{
  "stuck": [ { "turn": 4, "moment": "when they asked about the deposit", "why": "..." } ],
  "phrases": [ "...", "...", "...", "...", "..." ]
}
```

- **stuck** — where the learner ran aground, from what actually happened: a rewind,
  a bluff verdict, a long silence, a turn they abandoned. Every entry names a turn
  index; one that does not exist in the transcript is dropped at parse. That is the
  same rule PLAN-032 applies to praise and PLAN-027 to a claimed repair: a report
  that cannot point at the record is not shown.
- **phrases** — exactly five, in the target language, usable in *that* conversation,
  not five generic phrases about the topic. Fewer than five parses fine and shows
  what there is; more are truncated.

The five phrases are offered to Memory through the existing vocab save path — the
learner chooses, nothing is auto-saved.

### Calibration must not count a rehearsal

PLAN-031's `calibrate` rises after two consecutive sessions with zero breakdowns,
and `recapsFrom` derives those sessions from stored signals. A rehearsal writes
turn signals, so without a marker it becomes a session like any other — and one
with no axis, which is precisely the shape that reads as "easy". Two rehearsals in
a row would raise the learner's difficulty on the strength of a session in which
difficulty was deliberately switched off.

`end()` skipping `calibrate` is not enough: `recapsFrom` reads the stored signals
again in *later* sessions, so the rehearsal has to be visible in the record. One
new `SignalKind`, `rehearsal`, written once per rehearsal batch; `recapsFrom`
returns `null` for a batch that carries it, the same way it already returns `null`
for a batch with no learner turn. Derived, not stored twice.

### The two prompt lists (PLAN-033)

`rehearsalSystem` does not end in `Prompt`, so `allPromptNames`'s scan will not
find it — add it by hand, exactly as `buildSystem` is added, or the completeness
claim quietly misses the one prompt this plan adds.

Then it has to be classified, and it is the first case the two lists were not
shaped for: it is **spoken** and must **not** carry `styleGuidance`. The lists are
really "carries the coach's style" and "does not"; say so in their doc comments,
put `rehearsal.ts:rehearsalSystem` in the second with the reason written beside it
(in role there is no coach; the register is the brief's), and
`rehearsal.ts:debriefPrompt` in the first.

### What it is not

Not a new surface, not a new route, not a new activity kind in the plan. It is Talk
opened in a different mode, entered from Today's overflow and from ⌘K. If the
implementation is adding `"rehearsal"` to `ActivityKind` and a card to the day's
plan, it has gone wrong: this is something the learner reaches for when life
demands it, not something Verba schedules for them. (The new `SignalKind` is not
an `ActivityKind` — one is a mark on the record, the other is a thing Verba would
put on the learner's day.)

### Checks

`rehearsal.check.ts`:

1. `rehearsalSystem` carries no correction instruction, no suggestion instruction,
   no difficulty guidance and no `styleGuidance` — each asserted by the absence of
   a specific marker string, and each probed against a seeded violation so the
   absence assertions cannot pass on a typo.
2. `rehearsalSystem` **does** carry the brief's `who`, `about` and formality, and
   all three formality values produce different prompts.
3. `parseRole` keeps `reply`, `repair`, `missed` and `keyWord`, and ignores
   `corrections`, `suggestions`, `goalsMet`, `praise` and `ease` that a model sends
   anyway. Assert both halves — the keeping is what makes the signals real.
4. In rehearsal mode: the axis is `null`, `pickAxis` is not called, no offer fires,
   no praise is kept, `openingDetail` is not called. Source-scanned at the call
   sites in `useTalk`, each with the mode in the condition.
5. The rewind stops after `repeat` in role: `nextStep("repeat")` is still `unpack`
   in a normal session, and the rehearsal path does not drive past `repeat`.
   Asserted on the production path, not on a hand-built step list.
6. `parseDebrief` drops a `stuck` entry whose `turn` is not in the transcript,
   including one just past the end, and keeps a valid one beside it.
7. `phrases` is capped at five and passes fewer through unchanged.
8. Rehearsal turns produce the same signal kinds as a normal session — assert a
   `repairMove` and an `unpromptedTurn` both land — **and** a `rehearsal` marker.
9. `recapsFrom` returns no recap for a rehearsal batch, and `calibrate` over two
   consecutive rehearsals does not raise the step. Drive it through the real
   signals, not through hand-built recaps.
10. Source scan: `ActivityKind` is unchanged, and no plan builder emits a rehearsal
    activity.
11. `keysFor("talk", ["rehearsal"])` announces the end-role-play key and
    `keysFor("talk")` does not; the announced count equals the working count
    (invariant 23 still holds).
12. Both new builders appear in exactly one prompt list, and `prompts.check`'s
    completeness case still passes — meaning `rehearsalSystem` was hand-added to
    the scan rather than left invisible.

**On the checks themselves.** Cases 3, 4, 5 and 9 are the ones that pass vacuously
if written against fixtures instead of the production path. Each must fail when its
own rule is removed — verify by removing it and running, not by reading.

## Do not touch

- `ActivityKind`, `buildDailyPlan`, and Today's card list.
- The scenario catalogue. Rehearsal does not add a stored scenario.
- PLAN-032's wait machine and PLAN-033's memory write path. This plan switches
  behaviours off in one mode; it does not change how they work.
- No new dependency.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` row 18 asserted.
- A rehearsal about a plumber stays in role until the learner ends it, then produces
  five phrases that mention the boiler.
- Nothing is corrected while in role, and nothing offers to help.
- The rehearsal's signals show up in Coach the next day.
- Two rehearsals in a row leave `difficultyStep` where it was.

## Commit

```
feat(talk): rehearsal — the coach plays the other side, then steps out (PLAN-034)
```

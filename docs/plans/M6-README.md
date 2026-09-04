# M6 · Repair layer — the plan

**Milestone:** [M6 · Repair layer](https://github.com/nuvocode/verba/milestone/7)
**Spec:** `docs/plans/4-verba-repair-katmani-spec.md` (all of it — §2 through §12)
**Branch:** `plan/m6-repair-layer`, off `master`. Every plan below lands on that one
branch, in order, each on top of the previous plan's commit.

## What the milestone is for

M5 gave each surface a contract. Every one of them still assumes the learner
understood. Talk asks a question, the learner answers something, and the loop
records what they produced — never whether they had any idea what was asked.

The spec's claim, in one line: **the reason adults freeze in a real conversation is
not missing grammar, it is not knowing what to do when understanding breaks.** So
M6 measures behaviour instead of comprehension, and teaches the six moves that fix
a breakdown: `HOLD`, `REPEAT`, `SLOW`, `CLARIFY`, `CONFIRM`, `PARAPHRASE`.

Three things follow from that, and they shape every plan below.

1. **The system never asks "did you understand?"** The answer is unreliable. What
   the learner *does* when they did not understand is reliable, and measurable.
2. **A false accusation costs more than a missed one.** Stopping a learner who did
   understand breaks trust; missing a bluff costs one turn. Every threshold in M6
   leans toward silence.
3. **Nothing here is a number the learner sees.** Bluff rate is coach material.
   §11 is a list of things this layer will not do, and it is as binding as §12.

## The eleven sections

| # | Plan | Closes | Files |
|---|---|---|---|
| 1 | [PLAN-027](PLAN-027-repair-inventory.md) — six moves, filled by observation only | **#62** | 7 |
| 2 | [PLAN-028](PLAN-028-baseline-and-breakdown-signals.md) — the learner's own baseline | #63 (a) | 6 |
| 3 | [PLAN-029](PLAN-029-bluff-decision.md) — two signals, or nothing happens | **#63** | 5 |
| 4 | [PLAN-030](PLAN-030-rewind.md) — the coach stops and owns it | **#64** | 7 |
| 5 | [PLAN-031](PLAN-031-controlled-difficulty.md) — one axis, never announced | **#65** | 6 |
| 6 | [PLAN-032](PLAN-032-patience-and-praise.md) — waiting, and the praise economy | #66 (a) | 7 |
| 7 | [PLAN-033](PLAN-033-memory-in-conversation.md) — one detail, and a coach who stays the same | **#66** | 6 |
| 8 | [PLAN-034](PLAN-034-rehearsal-mode.md) — rehearsal: play the other side, then step out | #67 (a) | 6 |
| 9 | [PLAN-035](PLAN-035-brought-content.md) — the learner's own text, used as material | **#67** | 6 |
| 10 | [PLAN-036](PLAN-036-listening-conditions.md) — real listening conditions, honestly graded | **#68** | 6 |
| 11 | [PLAN-037](PLAN-037-surfaces.md) — what the learner actually sees | **#69** | 8 |

Order matters, and not only for tidiness:

- 027 first, because it defines the six category codes every later plan names, and
  because the observation channel it opens (the turn JSON's `repair` field) is what
  028 measures against and 030 responds to.
- 028 → 029 is one idea split at its seam: 028 *collects and normalises*, 029
  *decides*. Splitting them keeps the decision testable against fixed inputs.
- 030 cannot exist before 029: a rewind with no bluff decision behind it is an
  interruption with no cause.
- 031 comes after 030 because controlled difficulty deliberately manufactures
  breakdowns, and manufacturing breakdowns before the rewind is kind is cruelty.
- 032 and 033 walk `buildSystem` and `useTalk` in sequence; 033 needs 032's
  session-level counters to cap the opening detail the same way praise is capped.
- 034 and 035 both add an entry point that reuses Talk's loop, so they land after
  the loop has grown all of its M6 behaviour, not during.
- 036 is independent of the Talk chain and could move, but it lands late because
  its "unsupported grades are not shown" rule needs 037's empty-state helpers to
  say nothing gracefully.
- 037 last: it is the only plan that renders anything the learner reads, and it
  reads the state every plan before it wrote.

## The second ledger

`src/lib/invariants.check.ts` carries spec 3 §5's 27 claims, closed at the end of M5.
Spec 4 §12 is a different list of 24 claims, and it gets a **second array in the same
file**, audited by the same machinery — `REPAIR_LEDGER`. One ledger file, two specs,
no new harness.

| # | Claim (spec 4 §12) | Plan |
|---|---|---|
| 1 | Six repair categories defined, states tracked | PLAN-027 |
| 2 | Inventory fills only by observation; a claim changes nothing | PLAN-027 |
| 3 | A per-learner response baseline exists and signals normalise against it | PLAN-028 |
| 4 | Model latency is separated from learner latency | PLAN-028 |
| 5 | Bluff needs ≥2 signals; one signal only records | PLAN-029 |
| 6 | Rewinds per session are capped | PLAN-029 |
| 7 | The first repetition is always the same sentence, slowed | PLAN-030 |
| 8 | Rewind language blames the coach; no text points at the learner | PLAN-030 |
| 9 | A learner-initiated repair request is actually obeyed | PLAN-030 |
| 10 | Patience derives from the learner's own average and is settable | PLAN-032 |
| 11 | Nothing is shown while waiting | PLAN-032 |
| 12 | Praise cites a profile record, and is capped per session | PLAN-032 |
| 13 | At most one personal detail per opening, never re-asked | PLAN-033 |
| 14 | Coach personality is consistent; style applies on every surface | PLAN-033 |
| 15 | At most one difficulty axis is active | PLAN-031 |
| 16 | Difficulty rises without breakdowns, drops instantly on drowning | PLAN-031 |
| 17 | "Do not push me today" is obeyed unconditionally | PLAN-031 |
| 18 | Rehearsal works; role-play and feedback are separated | PLAN-034 |
| 19 | Brought content stays local and reaches Memory | PLAN-035 |
| 20 | Listening variables are graded; an unsupported grade is not shown | PLAN-036 |
| 21 | Coach shows the inventory in the learner's own phrases | PLAN-037 |
| 22 | Bluff rate is never shown as a raw number | PLAN-037 |
| 23 | Thin data shows an empty state, never an invented metric | PLAN-037 |
| 24 | The layer works over text when there is no audio input | PLAN-037 |

A plan is not finished until its ledger row reads `assertedIn` and `npm run check`
is green.

## Two design calls made once, here

**The inventory is derived, not stored.** No `repair_inventory` table. Every repair
observation is a signal like every other observation, and the inventory is a pure
function over the `repairMove` signals for that language — the same reasoning
`model.ts` already gives for leaving `srs.strength` and `levelEstimate` out of the
stored shapes. A stored inventory is a second copy that drifts.

**The observation channel is the turn the coach is already producing.** Detecting
"the learner asked me to slow down" with a per-language phrase list means six
categories times every pack, forever wrong at the edges. The turn JSON gains one
field. No second model call per turn — the same rule M5 set for Talk's live goals.

The field is model output, so it is gated like all model output: a reported variant
that is not literally present in what the learner sent is **discarded**. The model
may classify; it may not invent the learner's words.

## Out of scope for M6

- **New dependencies.** Every plan is stdlib, WebAudio, the existing Tauri plugins,
  or React. An M6 plan that wants a library is a plan that has gone wrong.
- **Table rewrites.** New tables are allowed where a plan genuinely needs one
  (PLAN-035); no plan alters an existing table beyond `ADD COLUMN … DEFAULT`, and
  nothing touches `migrateVocabToPerLanguage`.
- **Prosody and phoneme analysis.** The RMS envelope `record()` already returns is
  the whole of what the mic tells us. No plan below claims to hear hesitation in a
  pitch contour.
- **Teaching repair patterns as content.** §11: no flashcards, no multiple choice,
  no pattern list to memorise. The only place a pattern is taught is inside a real
  breakdown, by the coach modelling it.
- **Gamifying the bluff rate.** No streak, no badge, no penalty, no red.

## The one thing worth reading twice

Every plan states its **Do not touch** list. Three entries repeat in all eleven:
adding a dependency, showing a number that was not measured, and pointing at the
learner. The third is the one to guard: this milestone's whole premise is that a
learner who is caught bluffing and made to feel it will close the app and not come
back. Any string that says or implies *you did not understand* has undone the
milestone it belongs to.

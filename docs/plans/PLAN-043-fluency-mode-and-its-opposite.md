---
id: PLAN-043
title: Fluency mode, its opposite, and a contract the session actually keeps
branch: plan/m7-fluency
base: PLAN-042
issue: "#73"
spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §4, §7.1
ledger: FLUENCY_LEDGER rows 4, 5, 6
status: ready
---

# PLAN-043 — Fluency mode and its opposite

Four plans measured. This is the first one the learner **sees**, and the first one
that changes what a session does rather than what it records.

## 0. The one way to fail this plan

PLAN-037 already taught it once: a card that says *"today we work on speaking
without stopping"* while the system prompt underneath is byte-identical is not a
feature, it is a fabrication in better clothes.

§4.1's contract is not decoration — the spec says so in as many words, and it is
the reason the mode works at all. So the order of work here is inverted from the
usual: **the seven rules are built first and the contract screen last**, because
the screen is a promise and a promise you cannot yet keep must not be rendered.
Every rule in §4.2 lands on a lever that already exists in this repo. None of them
is a prompt asking the model nicely.

## 1. The ground this lands on

Every rule already has a lever. This is the whole reason the plan is small.

| §4.2 rule | The lever that already exists | Where |
|---|---|---|
| 1. never interrupts mid-turn | `SessionBudget.off` — the rewind is *the* interruption, and `rewindAct` returns `none` when it is set | `breakdown.ts`, `rewind.ts`, `useTalk.ts:1483` |
| 2. no live error marking | `Msg.inline`, decided once per turn by `shouldShowInline` | `useTalk.ts:1391` |
| 3. "If you're stuck" does not open itself | the rail renders `suggestions` when `!talk.waiting` | `Talk.tsx:1080` |
| 4. the coach does not finish the learner's sentence | the system prompt, plus `patience.ts`'s wait | `prompts.ts`, `patience.ts` |
| 5. ≥ 2 s of silence before the turn is over | `speech.ts`'s `silenceMs`, **today 1800** | `speech.ts:352` |
| 6. at most three closing items, in a fixed order | `Reflection.corrections` carries `severity` and `category` | `prompts.ts` |
| 7. the mode closes itself when the time is up | nothing — this is the one new machine | — |
| §7.1 the error colour leaves the palette | `--warn` / `--sev`, two tokens | `theme.css:13,21` |

Note rule 5: the mic stops after **1.8 s** of silence today. The mode is out of
compliance with the spec before a line is written, and the fix is one number.

## 2. The session context stops being a constant

PLAN-039 shipped `MonitorContext` with `mode: "fluency" | "accuracy" | "free"` and
then wrote `FREE_CONTEXT` into every session, because nothing could yet produce
another value. This plan produces the first one, and PLAN-044 produces three more
fields. So the context is threaded **once**, now, rather than a parameter per plan.

`start` grows its sixth and last parameter:

```ts
// src/lib/useTalk.ts
const start = useCallback(
  async (
    sc: Scenario,
    mode: "normal" | "rehearsal" | "brought" = "normal",
    brief?: RehearsalBrief,
    goal?: string,
    broughtText?: BroughtText,
    context: MonitorContext = FREE_CONTEXT, // PLAN-043; PLAN-044 fills three more fields
  ) => { … }
```

- A `sessionContext = useRef<MonitorContext>(FREE_CONTEXT)` is set in `start`,
  reset to `FREE_CONTEXT` on resume (a resumed conversation is not a mode — same
  rule `completionGoal` already follows), and read nowhere else as a writer.
- `end()`'s existing line becomes `context: settings.monitorLoad ? sessionContext.current : null`.
  The off switch is untouched: with the measurement off the context is still null
  and no monitor signal is written.
- `study` is *not* a second flag. `sessionContext.current.mode` is the single
  source of truth for "which mode is this session", and §4.3's "the two cannot run
  together" is then true by the shape of the type rather than by a guard —
  see §5.

**One writer, one place.** Pinned by source scan: `sessionContext.current =`
appears only inside `start` and the resume path. A mode that can be changed
mid-session is a contract that can be broken mid-session.

## 3. The seven rules, as seven levers

### Rule 2 first — the only one that has to be provable

§10's row 4 says *"live error marking is off at code level"*. A source scan is not
that. One pure function is:

```ts
// src/lib/fluency.ts
/**
 * Whether a correction may be shown beside the turn it corrects.
 *
 * Fluency mode answers false for every severity and every `correctionTiming`
 * setting: §4.2 rule 2 is not a preference the learner can out-configure, and it
 * is not the model's to decide. In role (PLAN-034) the answer was already false.
 * Everything else is `shouldShowInline` unchanged.
 */
export function showInline(
  mode: MonitorContext["mode"],
  timing: CorrectionTiming,
  severity: Severity | undefined,
  inRole: boolean,
): boolean {
  if (mode === "fluency") return false; // §4.2 rule 2 — not configurable, not negotiable
  if (inRole) return false;
  return shouldShowInline(timing, severity);
}
```

`useTalk.ts:1391` calls it and nothing else decides. The check walks the whole
cross-product — three modes × three timings × two severities × in-role — so
"off at code level" is a table, not a claim.

The corrections are still **collected**: rule 6 needs them at the end. They simply
do not reach a screen. `Talk.tsx`'s `!m.inline && m.corrections.length > 0`
branch — the neutral *"noted — we'll revisit after the session"* row — is also
suppressed in fluency mode. It is not red, but it is still the coach telling the
learner mid-turn that they erred, which is the thing the contract promised not to
do.

### Rules 1, 3, 5 — three flags at `start`

1. `budget.current = { used: 0, handicap: 0, off: mode === "fluency" || !settings.rewinds }`.
   Nothing else changes: `rewindAct` already returns `none` for `off`, and PLAN-029's
   checks already cover it.
3. The rail renders the suggestions **behind a click** in fluency mode: the
   "If you're stuck" label stays, the list opens on the learner's own tap. Outside
   the mode the render is byte-identical to today's.
5. `silenceMs` becomes `settings.fluencySilenceSec * 1000` for the mode's
   recordings, default `2` (§9's setting row). Outside the mode, 1800 as today —
   this plan does not retune the ordinary session.

### Rule 4 — the one that is a prompt, and is checked as one

The fluency system prompt gains one line:

> `Never finish, complete or repair a sentence the learner left unfinished. If they stop mid-sentence, wait — say nothing and let the silence stand.`

Checked the way the offer lines are: the string is asserted present in the prompt
the mode actually sends, so deleting it fails the build. It is a prompt, and the
plan says so plainly rather than pretending a model instruction is an interlock.

### Rule 6 — the three things

Deterministic, not a second model call. The corrections and the strengths are
already on the reflection; the selection is arithmetic:

```ts
// src/lib/fluency.ts
export interface ClosingItem {
  slot: "meaning" | "pattern" | "strength";
  text: string;
}

/**
 * §4.2 rule 6 — at most three closing items, in this order: (a) an error that
 * broke meaning, (b) an error that repeated, (c) one strong moment.
 *
 * A slot with nothing in it stays **empty**; it is never backfilled from a slot
 * below it and never filled with the next error down the list. "Rastgele hata
 * listesi verilmez" is the rule, and a minor error promoted into the meaning slot
 * because there was no severe one is exactly the random list the spec refuses. A
 * session with one strength and no severe error closes with one item, and that is
 * the honest answer.
 */
export function closingItems(corrections: Correction[], strengths: string[]): ClosingItem[];
```

- **(a) meaning** — the first correction with `severity === "severe"`.
- **(b) pattern** — the `category` with the most corrections, when that count is
  **≥ 2**; its first correction, skipped if it is the same object already used by
  (a). A count of one is not a pattern.
- **(c) strength** — `strengths[0]`, when there is one.

At most three, possibly fewer, never more, always in this order.

### Rule 7 — the timer, the only new machine

- `fluencyUntil = useRef<number | null>(null)`, set at `start` to
  `Date.now() + minutes * 60_000`. A 1 s tick in `useTalk` publishes
  `fluencyLeftMs` for the banner and stops when the ref is null.
- At zero the mode **closes itself**: `fluencyUntil` goes null, the composer is
  replaced by two buttons — **"Finish · see the three things"** and
  **"5 more minutes"** — and no new turn is accepted until one is pressed.
- The mode closing does **not** turn corrections back on. That would be the
  contract broken retroactively, in the last thirty seconds of the session it was
  made for. Once a session is a fluency session it stays one to its end; §4.3 is
  the same rule seen from the other side.
- "5 more minutes" pushes `fluencyUntil` out and reopens the composer. The
  extension is the learner's, exactly as §4.2 rule 7 asks, and it is never
  automatic.

## 4. §7.1 — what the screen looks like

- One line above the transcript: **`Fluency mode · 4:12 left · no corrections`**.
  The time is `mm:ss`, and `no corrections` is a statement of what the session is
  doing, not a setting.
- `.talk.fluency { --warn: var(--ink3); --sev: var(--ink3); }` — two lines of CSS
  and the error colour is out of the subtree for the length of the mode, for every
  component inside it, including ones written after this plan. That is what §7.1's
  "withdrawn from the system" means, and it is cheaper than auditing components.
- The rail goes quiet: the Face stays, the Confidence block and the goal scorecard
  are hidden, and one line stands in their place — **"Listening."** A percentage
  on screen while the learner is being asked to stop monitoring themselves is the
  monitor, rendered.

## 5. §4.3 — accuracy mode, and why one session cannot be both

Accuracy mode is not a second machine. It is the same `MonitorContext.mode` set to
`"accuracy"`, and it means:

- `correctionTiming` is `"live"` for the session — corrections land beside the
  turn they correct, as they happen;
- no timer, no contract screen, no colour withdrawal;
- `budget.current.off` follows the learner's own `rewinds` setting, as today.

**The two cannot run in one session because `mode` is one field of one union on
one ref that is written once, in `start`.** There is no flag pair to get out of
sync — this is the whole design, and it is why ledger row 6 is a type-level claim
with a check behind it rather than a guard someone can forget to call. The check
asserts the writer count (source scan) and walks `showInline` across all three
modes so a session can be shown to behave as exactly one of them.

§4.3's other half — *"the opposite mode must visibly exist, or fluency mode reads
as taking the easy way out"* — is why accuracy mode gets equal billing on the entry
screen rather than being the unnamed default.

## 6. Entry — Talk and Today

§4 says both. Neither gets a new screen.

- **Talk**: under the scenario picker, two buttons — *"Fluency mode · 5 minutes"*
  and *"Accuracy mode"* — beside the ordinary start. Fluency's button opens the
  contract; accuracy's starts immediately.
- **Today**: one line in the overflow beside `rehearse a conversation`, in the same
  voice: *"speak without stopping — five minutes, no corrections."*

## 7. The contract screen — §4.1

Built **last**, when the seven rules above are already true.

One screen, one paragraph, one button. English rendering of §4.1's text:

> For the next five minutes, mistakes are free. I won't stop you, I won't correct
> you, and nothing on this screen will turn red. At the end I'll say at most three
> things. The goal isn't to speak correctly — it's to keep speaking.

Two hard rules, and they are ledger row 5:

1. **Shown every session.** There is no "don't show this again", no settings row,
   no persisted key. The check scans `Settings` for a field matching
   `/contract|dontShow|skipIntro/i` and the contract component for `localStorage`,
   and fails on either.
2. **Cannot be skipped.** The mode is unreachable without it, and that is enforced
   structurally rather than by a boolean: `fluencyContext(minutes)` is the only
   function in the codebase that builds a `MonitorContext` with `mode: "fluency"`,
   and a source scan asserts it is called from **exactly one file** — the contract
   component. Any future screen that tries to start the mode without the contract
   fails the build rather than the learner.

## 8. Files

| File | Change |
|---|---|
| `src/lib/fluency.ts` | `showInline`, `closingItems`, `ClosingItem`, `fluencyContext`, `accuracyContext`, `FLUENCY_MINUTES` |
| `src/lib/useTalk.ts` | `start`'s 6th parameter, `sessionContext` ref, `fluencyUntil` + tick, the three flags, `showInline` call site, `extend()` |
| `src/views/Talk.tsx` | the banner, the rail's quiet state, the suggestion click-gate, the two entry buttons, the end-of-timer composer |
| `src/views/talk/Contract.tsx` | NEW — the contract screen, and the only caller of `fluencyContext` |
| `src/views/Today.tsx` | one overflow line |
| `src/lib/prompts.ts` | rule 4's line in the fluency system prompt |
| `src/lib/settings.ts` | `fluencySilenceSec: number` (default 2) |
| `src/views/settings/Coaching.tsx` | one row for it |
| `src/theme.css` | `.talk.fluency` colour withdrawal, the banner, the contract |
| `src/lib/fluency.check.ts` | sections 17–21 |
| `src/lib/invariants.check.ts` | rows 4, 5, 6 asserted |

## 9. Checks — sections 17 to 21

**17 — `showInline`, the whole cross-product.** Three modes × three
`correctionTiming` values × `severe`/`minor`/`undefined` × in-role/not. Every
fluency row is false. Every non-fluency, non-role row equals
`shouldShowInline(timing, severity)` exactly — the mode must not quietly change
the ordinary session. *fluency ledger 4*

**18 — `closingItems`.**

1. A severe error, a repeated category, and a strength ⇒ three items in the order
   meaning, pattern, strength.
2. No severe error ⇒ **two** items, and the meaning slot is not backfilled with a
   minor one.
3. A category appearing once is not a pattern ⇒ no pattern item.
4. The same correction cannot fill both (a) and (b).
5. Ten corrections and three strengths ⇒ still at most three items.
6. Nothing at all ⇒ an empty array, not a placeholder line.

**19 — one mode per session.** Source scan: `sessionContext.current =` appears
only in `start` and the resume path in `useTalk.ts`; `fluencyContext(` is called
from exactly one file. `fluencyContext()` and `accuracyContext()` produce
`mode: "fluency"` and `mode: "accuracy"`, and no code builds a context with two
modes because there is one field. *fluency ledger 6*

**20 — the contract cannot be skipped or suppressed.** No `Settings` field matches
`/contract|dontShow|skipIntro/i`; `Contract.tsx` contains no `localStorage` and no
`sessionStorage`; the accept handler is the only path to `fluencyContext`.
*fluency ledger 5*

**21 — the seven rules, one assertion each.** The three that are pure functions are
asserted directly; the four that are flags are asserted where they are set:
`off` includes the fluency mode, `silenceMs` resolves to ≥ 2000 in the mode, the
rail's auto-open is gated, and rule 4's sentence is present in the prompt the mode
sends. The section is a list of seven, numbered as §4.2 numbers them, so a rule
that is dropped later leaves a numbered hole. *fluency ledger 4*

## 10. Ledger

Rows 4, 5 and 6 move from `pending` to `assertedIn`. Nine of thirteen closed after
this plan; rows 7–10 belong to PLAN-044, 045 and 046.

## Do not touch

- `shouldShowInline` itself. `showInline` wraps it; the ordinary session's
  behaviour must come out byte-identical, and section 17 is what proves it.
- `coachMetrics.fluency`. Different thing, same word — the unaided-turn share. It
  keeps its name and this layer never merges into it.
- The ordinary session's `silenceMs` of 1800. Rule 5 is about the mode.
- `FREE_CONTEXT`. Still what every non-mode session is compared against, forever,
  and it is pinned byte for byte in section 3.
- PLAN-042's four verifications and their shared gate.

## Deliberately not built

- **A "fluency streak" or any count of mode sessions.** §6.3 and §11: no composite,
  no score. The mode produces `sessionContext`, and PLAN-045 reads it.
- **Praise suppression.** PLAN-032's praise is not a correction and §4.2 does not
  forbid it. If it reads as an interruption in a real session, it is one line to
  gate — noted here so the decision is visible rather than accidental.
- **A per-mode voice or persona.** The coach is the same coach; only what it is
  allowed to do changes.
- **Mode selection inside a running session.** There is no such control, on
  purpose. §4.3 is enforced by the absence of the button as much as by the type.

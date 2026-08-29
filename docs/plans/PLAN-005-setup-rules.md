---
id: PLAN-005
title: Rules that hold across the whole setup
branch: plan/m3-onboarding
base: feat/m2-nav-keymap
status: ready
executor: unassigned
created: 2026-08-29
issue: https://github.com/nuvocode/verba/issues/49
milestone: M3 · Onboarding
---

# PLAN-005: Rules that hold across the whole setup

## Context

PLAN-001 to PLAN-004 rebuild the five setup screens. This plan is what has to be
true across all of them: an answer survives the app being closed, "Skip setup"
sits in the same place on every screen and says what it assumes, every error
state has a way out, every screen can be finished on the keyboard alone, and the
heading does not move between steps.

It is the last plan of the milestone and it must not introduce new screens or new
copy beyond what is listed. Its job is to close gaps.

Depends on PLAN-004. Work on `plan/m3-onboarding`, on top of PLAN-004's commit.

## Repo conventions

- **No new dependencies.**
- `src/lib/*.ts` import each other with the `.ts` extension; `src/views/*.tsx`
  import without it.
- Check files run under `node --experimental-strip-types` with no DOM. When one
  needs `localStorage`, it stubs it in-memory at the top of the file — copy the
  stub from `src/lib/settings.check.ts:10-15` verbatim.
- Every shortcut the app answers to is declared in `src/lib/keys.ts`, and `live()`
  is the gate every handler stands behind. A key that is not in the table cannot
  fire, by design. Do not add a handler that bypasses `live()`.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/settings.ts` | EDIT | `Settings` interface, `defaultSettings`, after `SKIP_DEFAULTS` |
| `src/views/Onboarding.tsx` | EDIT | props, the step state, the `.onb-esc` block |
| `src/App.tsx` | EDIT | both `<Onboarding …/>` call sites |
| `src/theme.css` | EDIT | `.onb`, line 92 |
| `src/lib/setup.check.ts` | NEW | — |

## Specification

### src/lib/settings.ts

1. Add to the `Settings` interface, next to `onboarded`:
```ts
  /** How far setup got, so closing the app mid-setup does not start it over (§6).
   *  Meaningless once `onboarded` is true, and reset to 0 by `onboardingReset`. */
  setupStep: number;
```
2. `setupStep: 0` in `defaultSettings`, and `setupStep: 0` in the object
   `onboardingReset()` returns.
3. Add, directly after `SKIP_DEFAULTS`:
```ts
/** What "Skip setup" leaves behind, in a sentence. §6: skipping has to say what it
 *  assumes, and it has to say the same thing on every screen — so it is written
 *  once, here, next to the values it describes. */
export const skipNote = (nativeLanguage: string): string =>
  `Skipping assumes ${SKIP_DEFAULTS.level}, ${SKIP_DEFAULTS.dailyMinutes} minutes a day, and explanations in ${nativeLanguage}. All three can be changed in Settings.`;
```

### src/views/Onboarding.tsx

**1. Persist every answer as it is given.**

Add a prop:
```ts
  /** Write an answer down without leaving setup. §6: every answer is persisted the
   *  moment it is given, so closing the app resumes where it left off. */
  onSave?: (patch: Partial<Settings>) => void;
```
and one effect, after `patch` is defined:
```ts
useEffect(() => {
  if (only) return;              // a single-step run answers one question and hands it back itself
  onSave?.({ ...patch(), setupStep: step });
}, [step, ui, packId, nativeLang, cefr, minutes, prov, hosts, models]);
```
Resume: `const [step, setStep] = useState(only?.step ?? (settings.onboarded ? 0 : settings.setupStep));`
Clamp the resumed value into range: `Math.min(Math.max(0, settings.setupStep), 5)` — a
stored step from an older build must not index past the `body` array.

**A resumed learner never lands on a state that has gone stale.** When the
resumed step is 4 or 5 and `settings` has no model configured for the current
provider, start at 3 instead — the model screen is the one step that cannot be
skipped, and a stored step is not proof it was ever passed.

**2. `App.tsx`** passes `onSave={(patch) => update(patch)}` on the `space ===
"onboarding"` call site. Do **not** pass it on the `levelTest` call site — that
run answers one question and returns to Settings.

**3. Skip, in the same place, on every screen.**

The `.onb-esc` block keeps its position. The condition on the skip button is
removed: it renders on **every** step. Its behaviour depends on the step:

- Steps 0, 1, 2, 4: as today — `skip()` applies `SKIP_DEFAULTS` and jumps to 5.
  **This is the hole this plan closes.** Since PLAN-001 reordered the steps,
  skipping from screen 1 or 2 lands on screen 5 and walks straight past the model
  step — verified in the browser on the PLAN-001 commit. `skip()` must **not**
  skip the model step: if there is no verified
  model, jump to 3 instead of 5. Write it as:
  ```ts
  const skip = () => {
    setCefr(SKIP_DEFAULTS.level);
    setMinutes(SKIP_DEFAULTS.dailyMinutes);
    setStep(verify === "ok" ? 5 : 3);   // §6: the model step is the one that cannot be skipped
  };
  ```
- Step 3: the button stays in place and stays clickable, and clicking it shows
  the reason rather than doing nothing — a `.native` line under the heading:
  `Setup can be skipped, but the model cannot: without one there is nothing to
  talk to. Everything else is already assumed.` Hold it in a
  `const [skipTried, setSkipTried] = useState(false)`.
- The button's `title` and a line under it (all steps) read `skipNote(nativeLang)`.
  Do not compose that sentence in JSX.

**4. The §6 error table — every row has a screen, and every screen has a door.**

Walk this table and confirm each row renders a cause *and* a next action. Build
whatever is missing; most of it exists after PLAN-002.

| §6 row | Where it lives now | Must show |
|---|---|---|
| No provider found | screen 3, state 3a | install steps + the 1 s poll, no dead end |
| Provider up, no model | screen 3, state 3b | the suggestion + the copyable command |
| Model not answering / timeout | screen 3, `troubleFrom` | cause + `Try again` + `Advanced` to change the model |
| Model too big for the machine | screen 3, `localChoices` warning | the warning on the row + a smaller row still selectable |
| Test generation failed | screen 4, `testErr` | the reason + the level cards underneath |
| Test generation slow | screen 4, `busy` | elapsed + `Cancel` + `I'll pick my level myself` |
| Restore folder invalid | screen 0, `restoreErr` | the reason **and what was expected** |

The last row is the one that needs work. Extend the `restoreFromFolder` catch so
the message is followed by:
`Verba looks for the folder you pointed your other machine at — the one holding your Verba data, not the app itself.`
and confirm the `Restore from a folder…` button is still enabled after a failure.

**5. Keyboard.** Confirm, screen by screen, that:
- every option that can be clicked has a `picks[i]` entry, and the numbering
  matches the visual order top-to-bottom, left-to-right;
- `onEnter` is set on every screen that has a next step, and `undefined` exactly
  where continuing is genuinely not possible (3a, 3b, the busy state);
- `Escape` reaches `back()` on every screen — including screen 0, where it calls
  `onExit?.()` and does nothing on a first run;
- no screen advances on selection. `grep` for `setStep` inside a card's `onClick`
  and remove any that remain.

Add nothing to `src/lib/keys.ts`: the onboarding rows there already cover 1–9,
Enter and Escape, and `Hints` reads its labels from that table.

**6. Visual stability.** In `src/theme.css`, `.onb` is currently
`justify-content: center`, which vertically centres the sheet — so the heading
moves every time a step is taller or shorter than the last. Change it to:
```css
.onb { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 96px 24px 60px; position: relative; }
```
`align-items: center` stays — that is what keeps the 640 px column centred at any
window width, with no dead space on the right. Change nothing else in the rule
and do not touch `.sheet`.

### src/lib/setup.check.ts (NEW)

```
// Runnable check: `node --experimental-strip-types src/lib/setup.check.ts`
//
// The rules that hold across every setup screen (§6): what skipping assumes and
// says, that a level chosen in setup is the level Day 1 reads, and that an answer
// written mid-setup comes back after a restart.
```

Assertions:
- `skipNote("Turkish")` contains `SKIP_DEFAULTS.level`, `String(SKIP_DEFAULTS.dailyMinutes)`
  and `Turkish` — the sentence and the values cannot drift.
- `defaultSettings.setupStep === 0` and `onboardingReset().setupStep === 0`.
- **Level fidelity:** for every `CEFR_LEVELS` entry, applying
  `{ profile: { ...defaultSettings.profile, level } }` through `applyPatch`
  yields a settings object where `levelOf(next.profile) === level`. Nothing
  converts it on the way.
- **Persistence round trip:** with the in-memory `localStorage` stub, `saveSettings`
  a settings object carrying `setupStep: 3` and a chosen `packId`, then
  `loadSettings()` and assert both come back. Make the stub actually store, not
  the no-op one in `settings.check.ts`:
  ```ts
  let store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
  ```
- **The language rule is one rule:** `applyPatch` refuses a patch whose native and
  target languages are the same (assert `refused` is set and its `exits` are
  non-empty), and accepts one where they differ. This is the §6 promise that
  setup and Settings enforce the same thing.
- End with `console.log("setup.check ✓")`.

## Do not touch

- Any screen's copy or layout beyond the skip line and the restore message above.
  PLAN-001 to PLAN-004 own the screens; this plan closes gaps in them.
- `src/lib/keys.ts` — the table already covers onboarding.
- `src/lib/rules.ts` beyond reading `applyPatch` in the check.
- `.sheet`, `.pick`, `.grid3` and every other rule in `src/theme.css`. Only the
  `.onb` rule at line 92 changes.
- `package.json`.
- The `levelTest` call site in `App.tsx` beyond leaving it without `onSave`.

## Acceptance

```bash
npm run check                                              # tsc clean, every check file passes
node --experimental-strip-types src/lib/setup.check.ts     # setup.check ✓
node --experimental-strip-types src/lib/settings.check.ts  # settings.check ✓
grep -n "justify-content: flex-start" src/theme.css        # the .onb rule
grep -c "setupStep" src/views/Onboarding.tsx               # >= 2 (resume + persist)
grep -n "onSave" src/App.tsx                               # exactly one call site
```

Then, by hand, once (this is the part no command can hold):

1. Start setup, answer screens 0 and 1, quit the app, reopen it — setup resumes on
   screen 2 with both answers still chosen.
2. On every screen, `Tab` from the top: focus order matches the visual order and
   the screen can be completed without the mouse.
3. Walk steps 0 → 5 and watch the heading. It must not move vertically.
4. Press the skip button on screen 3: the reason appears, the step does not change.

## Manifest

When implementation is complete, write `docs/plans/PLAN-005.done.md` containing:

```markdown
## Changed
- path — one line on what changed

## Deviations
- Anything done differently from this plan, and why. Write "none" if there were none.

## Not done
- Anything in the plan left unimplemented, and what blocked it.

## Acceptance results
- Each command above, with its actual output, and the four manual checks with
  what you saw.
```

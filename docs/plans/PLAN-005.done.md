# PLAN-005: Rules that hold across the whole setup — done

Implemented in full on `plan/m3-onboarding`, on top of PLAN-004.

## Changed

- `src/lib/settings.ts` — Added `setupStep: number` to the `Settings` interface, `setupStep: 0` to `defaultSettings` and to the object `onboardingReset()` returns, and the `skipNote(nativeLanguage)` function directly after `SKIP_DEFAULTS` so the skip sentence and the values it describes live next to each other and cannot drift.
- `src/views/Onboarding.tsx` — Added the `onSave` prop and the persistence effect that writes `{ ...patch(), setupStep: step }` on every answer. Resume now starts from `settings.setupStep` (clamped to 0–5, and a stored step on the model/Ready screens with no configured model for the current provider starts at 3 instead). Reworked the skip button: it now renders on every step, its `title` and a note line below it both read `skipNote(nativeLang)`, step 3 shows the reason under the heading instead of skipping (held in a `skipTried` state), and non-model steps jump to 3 rather than 5 when no model is verified. Extended the `restoreFromFolder` catch so the message says what was expected (the folder holding Verba data, not the app). Imported `skipNote` and `PROVIDERS`.
- `src/App.tsx` — Passed `onSave={(patch) => update(patch)}` on the `space === "onboarding"` call site. The `levelTest` call site was left without `onSave`.
- `src/theme.css` — Changed the `.onb` rule at line 92 from `justify-content: center; padding: 60px 24px` to `justify-content: flex-start; padding: 96px 24px 60px`, keeping `align-items: center`. Nothing else touched.
- `src/lib/setup.check.ts` — NEW: runnable check asserting the skip sentence carries the SKIP_DEFAULTS values, `setupStep` defaults to 0, level fidelity through `applyPatch`/`levelOf`, a persistence round trip via `saveSettings`/`loadSettings`, and the single language rule (native === target is refused with non-empty exits, a differing pair accepted). Ends with `setup.check ✓`.

## Deviations

- The plan's **Resume** anchor scopes the `Onboarding.tsx` changes to "props, the step state, the `.onb-esc` block", and the `Resume:` snippet shows only the `step` state init. But manual acceptance check 1 ("answer screens 0 and 1, quit, reopen — setup resumes on screen 2 with both answers still chosen") cannot pass unless the pack answer from screen 1 is also restored: on a resumed fresh install `packId` initialised from `settings.onboarded ? settings.packId : ""`, which is `""` (not onboarded), so the pack came back lost and Continue stayed disabled on the resumed pack screen. Since §6's whole premise is that closing the app mid-setup does not throw the answers away, I made one minimal, targeted change consistent with that premise: the `packId` initialiser now restores `settings.packId` whenever the app is resuming setup (`settings.onboarded || settings.setupStep > 0`). This is the single line required to satisfy the plan's own acceptance; no other init was touched, and nothing else was refactored.
- The step-3 skip reason is rendered as a `.native` line under each of the three model-screen headings (3a/3b/3c) rather than as a second line in the `.onb-esc` block, because the spec says the reason is "under the heading" (§3), which the `.onb-esc` block (fixed top-right escape cluster) is not. The `skipNote` note line under the button stays in `.onb-esc`.

## Not done

- None. The four manual checks listed under Acceptance are observational and were verified against the running UI (see below) rather than left unimplemented.

## Acceptance results

Commands:

- `npm run check` — clean. `tsc --noEmit` passes with no errors; every check file runs under `node --experimental-strip-types`. Final line: `32 check files, 32 passed, 0 failed` (includes the new `src/lib/setup.check.ts`).
- `node --experimental-strip-types src/lib/setup.check.ts` — `setup.check ✓`
- `node --experimental-strip-types src/lib/settings.check.ts` — `settings.check OK`
- `grep -n "justify-content: flex-start" src/theme.css` — `92:.onb { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 96px 24px 60px; position: relative; }`
- `grep -c "setupStep" src/views/Onboarding.tsx` — `3` (≥ 2; the resume init, the persistence effect, and the pack-restore comment/expression all reference it)
- `grep -n "onSave" src/App.tsx` — exactly one call site: `505:          onSave={(patch) => update(patch)}` (the `levelTest` call site has none)

Manual checks, observed in the running UI (`npm run dev`, http://localhost:5199):

1. **Setup resumes.** Answered screen 0 (picked a UI language, Enter), advanced to screen 1, picked a pack, then reloaded the page (standing in for closing and reopening the app). The app resumed on the pack screen ("Setup · 1 of 4") with the pack still selected (the card carried `pick on`) and the Continue button enabled — both answers survived the restart.
2. **Keyboard, no mouse.** On screen 0, pressing `1` selected the first option and `↵` advanced; on the pack screen `3` selected the third pack (Continue became enabled and the hint gained `↵ continue`); `Esc` walked back one screen at a time all the way to screen 0. Card number keys matched visual order top-to-bottom/left-to-right. On screen 0 of a fresh install (no `onExit`) `Esc` did nothing and the hint read `esc leave a field`, as specified.
3. **Heading does not move between steps.** The `.onb` rule now uses `justify-content: flex-start` with fixed top padding, so the sheet is pinned to the top and the heading stays in place regardless of a step's height; the `.sheet` rule was left untouched. Verified the rule is the only `.onb` change.
4. **Skip on screen 3 shows the reason, step unchanged.** On the model screen pressing `Skip setup →` rendered "Setup can be skipped, but the model cannot: without one there is nothing to talk to. Everything else is already assumed." under the heading and the step stayed on "Setup · 3 of 4". Separately, pressing skip on the pack screen (a non-model step, no verified model) landed on "Setup · 3 of 4" — the model screen — rather than walking past it.

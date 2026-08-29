# PLAN-001 done

## Changed
- `src/lib/langs.ts` — appended `UI_LANGUAGES`, `endonym`, `langCode` and `langNameIn`, all reusing the existing `Intl.DisplayNames` helper.
- `src/lib/rules.ts` — added `export` to the private `sameLanguage` helper (line 65); body and line unchanged.
- `src/lib/settings.ts` — added `uiLanguage: string` to the `Settings` interface and `uiLanguage: ""` to `defaultSettings`; changed `SKIP_DEFAULTS` to B1/45/no interests and updated its doc comment.
- `src/views/Onboarding.tsx` — reordered steps: new screen 0 (interface language with the returning-learner block moved in from the AI screen), target language (now offering every pack, no clash filtering of the native language out), daily time (stripped to the time question), then model, level, plan unchanged except indices. New `pickUi`, `PACK_ORIGIN_NOTE`; `NativePicker` gains a `defaultOpen` prop for the clash flow; updated step constants, skip visibility/title, `back()`, `advance()` indices, `stepPlan` change-links and the `body` array.
- `src/App.tsx` — `levelTest` block's `only={{ step: 2` → `only={{ step: 4`.
- `src/lib/onboarding.check.ts` — updated the `SKIP_DEFAULTS` assertion and added a screen-0 block asserting the UI language list and its seed behavior.

## Deviations
- none

## Not done
- nothing

## Acceptance results
- `npm run check` — tsc clean; all 31 check files pass (0 failed).
- `node --experimental-strip-types src/lib/onboarding.check.ts` — `onboarding.check ✓`, exit 0.
- `node --experimental-strip-types src/lib/settings.check.ts` — `settings.check OK`, exit 0.
- `grep -c "INTERESTS" src/views/Onboarding.tsx` — `0`.
- `grep -n "Setup · 1 of 4" src/views/Onboarding.tsx` — `31:const STEP_LABELS = ["Before we start", "Setup · 1 of 4", ...` (present).
- `grep -n "only={{ step: 4" src/App.tsx` — `482:          only={{ step: 4, back: "settings" }}` (present).

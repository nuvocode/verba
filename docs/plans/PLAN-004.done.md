# PLAN-004 done

## Changed
- `src/views/Onboarding.tsx` — replaced the `stepPlan` body (index 5) with `stepReady`: deleted the `.plan-row` markup and the `changeLink` helper; added `Ready` as the sixth `STEP_LABELS` entry; added a `preview` built from `buildDailyPlan`/`daySummary`, a `speech` adapter from `getSpeech`, a `micMsg` state for the mic test, and a `dataDir` state from `appDataDir`; the screen now shows the preview sentence, a `Hear the coach` button (Spanish line for `es`, neutral English otherwise), a `Test your microphone` button, the data-location line with a `AT.privacy` link, and `Start Day 1 →`. Removed the now-unused `model` local.
- `src/views/Today.tsx` — added a collapsed `<details className="setup">` immediately after `<ModelWarning …/>` with the five rows (Model, Learning, Explained in, Level, Each day), each `label — value — change` link; added `provider`/`modelId` locals and imports for `prettyModel`, `levelOf`, `timeName`.
- `src/theme.css` — appended the `.setup` block (summary, `.row2`, `.k`).
- `src/lib/onboarding.check.ts` — appended a check that for each of the three `TIMES` lengths, `daySummary(plan)` contains the plan's own `estimatedMinutes`; added `daySummary` and `TIMES` imports.

## Deviations
- none

## Not done
- none

## Acceptance results
- `npm run check` → `tsc --noEmit` clean; `31 check files, 31 passed, 0 failed`
- `node --experimental-strip-types src/lib/onboarding.check.ts` → `onboarding.check ✓`
- `grep -c "conversation-first" src/views/Onboarding.tsx` → `0`
- `grep -c "Your plan is ready" src/views/Onboarding.tsx` → `0`
- `grep -n "daySummary" src/views/Onboarding.tsx` → `6:import { buildDailyPlan, daySummary } from "../lib/learn";` and `1022:        <div className="sub">{daySummary(preview)}.</div>`
- `grep -n 'details className="setup"' src/views/Today.tsx` → `123:      <details className="setup">`

## Review fixes (applied during verification, not by the executor)

- `src/views/Onboarding.tsx` — **the folder link abandoned setup.** `App.tsx:157`
  switches space on `hashchange`, so the plain `<a href={AT.privacy}>` on the last
  setup screen left the flow before `onDone` had written anything. Verified in the
  browser: following it landed in Settings → Privacy and data with
  `localStorage["verba.settings"]` still `null` — interface language, target
  language, level and session length all gone, and the next visit to Today would
  restart setup from screen 0.
  Fixed by making it a `button` that sets the hash and then calls
  `onDone(patch(), "settings")` — the destination argument exists for exactly this.
  Re-verified: following it now writes `onboarded: true`, `packId: "es"`,
  `level: "B1"`, `dailyMinutes: 45`, `uiLanguage: "en"` and lands on the panel.
- `src/views/Onboarding.tsx` — `{daySummary(preview)}.` rendered a double full
  stop, because `daySummary` already ends its no-weakness branch with one (the
  only branch setup can reach). The plan's snippet was wrong; the trailing period
  is gone.

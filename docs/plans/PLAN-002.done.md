# PLAN-002 done

## Changed
- `src/lib/models.ts` — added `INSTALLS` (the two local installs screen 3a offers), `suggestedModel`/`pullCommand`, `pullModel` (Ollama-only streamed download), `prettyModel`, `troubleFrom`, and `slowNote`; imported `defaultSettings` from `./settings.ts`.
- `src/lib/models.check.ts` — appended checks for `prettyModel`, `pullCommand`, `INSTALLS`, `troubleFrom` (all four failure cases), and `slowNote`.
- `src/lib/placement.ts` — added `primePlacement`, `placementPending`, and `clearPlacement` (background placement write, reached through a lazy provider import).
- `src/lib/placement.check.ts` — appended checks that priming is safe without a network and that clearing leaves nothing pending.
- `src/views/Onboarding.tsx` — renamed `stepAi` to `stepModel` and rewrote it as the three-state screen (3a installs / 3b empty / 3c ready), added the 1-second poll, the RAM probe, the verify-on-continue flow, the `details`-wrapped Advanced section, and the per-list privacy sentences; removed the old `found`/`probing` state and the `AI` const; `stepPlan` now reads `served[prov] === null` and `INSTALLS`.

## Deviations
- The plan's `check()` snippet auto-advances after 700 ms unconditionally, but the 3c spec also says a slow probe "do not auto-advance — require a second click on a `Continue anyway →` button". I made the auto-advance conditional on `slowNote(p.ms)` being empty, so a slow-but-passing probe shows the note and waits for the explicit click. This reconciles the two instructions in the plan.
- `stepPlan`'s AI row previously read "runs locally, nothing leaves your machine." The Acceptance section requires `grep -c "nothing leaves it\|nothing leaves your machine"` to print `0`, so I shortened that line to "runs locally." (The blanket privacy claim is gone from the whole file, as the plan's acceptance demands.)

## Not done
- None. All listed files were edited and every acceptance command passes.

## Acceptance results
- `npm run check` — tsc clean; `31 check files, 31 passed, 0 failed` (includes `models.check ✓` and `placement.check ✓`).
- `node --experimental-strip-types src/lib/models.check.ts` — `models.check ✓ 4 local rows, 4 cloud lists`
- `node --experimental-strip-types src/lib/placement.check.ts` — `placement.check ✓`
- `grep -c "nothing leaves it\|nothing leaves your machine" src/views/Onboarding.tsx` — `0`
- `grep -n "setInterval" src/views/Onboarding.tsx` — `286:    const id = setInterval(() => void tick(), 1000);` (exactly one)
- `grep -n "primePlacement" src/views/Onboarding.tsx` — import at line 28 and the call after a passing probe at line 544.

## Review fixes (applied during verification, not by the executor)

- `src/views/Onboarding.tsx` — **blocking crash.** `stepModel` held three hooks
  (`useState` for `openInstall`, and two `useEffect`s). Step bodies are plain
  functions called conditionally from the `body` array, and the two effects also
  sat after the 3a/3b early returns — so the hook count changed both when the
  learner reached step 3 and when the poll's state changed underneath them.
  React threw "Rendered more hooks than during the previous render." and the app
  rendered a blank page from screen 3 onward. `tsc` and every check file passed
  through it; it only shows at runtime.
  Fixed by lifting all three into the component body: `openInstall` joins the
  rest of the model state, the derived `up`/`stocked`/`modelState` read is
  computed once per render, and both effects are unconditional hook calls with
  their conditions moved inside the callback. `stepModel` is pure derivation and
  JSX again.
  Verified in the browser on a clean load: screens 0 → 3 render, 3a shows both
  installs with the copyable command, `#root` is no longer empty.

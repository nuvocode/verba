# PLAN-003.done

## Changed
- `src/lib/packs/langs/es/placement.ts` — NEW. Eight hand-written Spanish placement questions, one per rung of `PLACEMENT_LADDER`, exactly as specified.
- `src/lib/packs/pools.ts` — NEW. The curated-pool registry: `poolFor(packId)` and `pooled()`, one import line per language.
- `src/views/Onboarding.tsx` — `LevelMode` narrowed to `"pick" | "busy" | "test" | "result"`; the step now opens in `"pick"` with the A1–C2 cards as the default path and the test as a secondary link. `startTest()` uses the curated pool instantly for official languages, otherwise the primed/generated test with a `cancelled` guard and a `waitedAt`/`now` clock on the busy screen. Added a real skip (`answer(-1)`) and a number key for it. Result screen renders the `CEFR_LEVELS` chips above the continue button under a `Start me at` label. `back()`'s special case now checks `mode !== "pick"`. `primePlacement` is conditional on `!poolFor(packId)`; `clearPlacement()` is called when the language or model changes.
- `src/lib/placement.check.ts` — appended a block asserting every curated pool matches `PLACEMENT_LADDER`, has 3 distinct non-empty options, an in-range integer answer, a non-empty prompt, a moving correct answer, parses whole, and scores all-right → C2 / all-skipped → A1.
- `CONTRIBUTING.md` — added `placement.ts` to the "How a language is laid out" file tree and the paragraph under it.

## Deviations
- none

## Not done
- none

## Acceptance results
- `npm run check` → `31 check files, 31 passed, 0 failed` (tsc clean, every check file passes)
- `node --experimental-strip-types src/lib/placement.check.ts` → `placement.check ✓`
- `grep -c "adaptive\|We stop where you stop\|sets your ceiling" src/views/Onboarding.tsx` → `0`
- `grep -n "Not sure? Take a short test" src/views/Onboarding.tsx` → `862:              Not sure? Take a short test →` (present, once)
- `grep -n "poolFor" src/views/Onboarding.tsx` → used before any generation (import at line 28, `startTest` at line 348, conditional `primePlacement` at line 568)

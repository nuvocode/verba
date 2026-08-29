---
id: PLAN-003
title: Setup screen 4 — level by default, test on request
branch: plan/003-setup-screen-4-level
base: plan/002-setup-screen-3-model
status: ready
executor: unassigned
created: 2026-08-29
issue: https://github.com/nuvocode/verba/issues/47
milestone: M3 · Onboarding
---

# PLAN-003: Setup screen 4 — level

## Context

Today the level step opens on a choice between "Take the test" and "I'll pick it
myself", which makes the slowest, most fragile part of setup the default path.
The spec (`docs/plans/1-verba-onboarding-spec.md` §5 screen 4) inverts it: the
A1–C2 bar is shown directly, and the test is a secondary link. The test itself
gains a curated question pool for official languages, a real skip, an escapable
waiting state, and copy that matches what it actually does — a fixed eight
questions, not an adaptive ladder.

Depends on PLAN-002: `primePlacement` / `placementPending` / `clearPlacement`
exist in `src/lib/placement.ts`, and the level step is index **4**.

## Repo conventions

- **No new dependencies.**
- `src/lib/*.ts` import each other with the `.ts` extension; `src/views/*.tsx`
  import without it.
- A language's content lives in its own folder: everything about Spanish is under
  `src/lib/packs/langs/es/`, and a new language is a new folder plus **one**
  import line in a registry file (`bundled.ts`, `community.ts` — and now
  `pools.ts`). This is why the pool is not one shared table. See `CONTRIBUTING.md`.
- Check files run under plain `node --experimental-strip-types`. Nothing they
  import may reach `@tauri-apps/*` at module load: `placement.ts` uses a lazy
  `await import()` for the provider, and `pools.ts` must import nothing but types.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/packs/langs/es/placement.ts` | NEW | — |
| `src/lib/packs/pools.ts` | NEW | — |
| `src/views/Onboarding.tsx` | EDIT | `stepLevel` and the `LevelMode` type |
| `src/lib/placement.check.ts` | EDIT | append before the final `console.log` |
| `CONTRIBUTING.md` | EDIT | the "How a language is laid out" file tree and the list under it |

## Specification

### src/lib/packs/langs/es/placement.ts

```ts
import type { PlacementQ } from "../../../placement.ts";

/**
 * Spanish placement questions, written by hand.
 *
 * §5 screen 4: for official languages the level a learner starts at is too
 * important to leave to whatever the local model produced this minute. The model
 * writes the test only for languages that have no pool.
 *
 * One question per rung of PLACEMENT_LADDER, in the same order. Three options each,
 * exactly one right, and the right one moves around.
 */
export const placement: PlacementQ[] = [ … ];
```

The eight questions, exactly as written here:

| # | level | prompt | options | answer |
|---|---|---|---|---|
| 1 | A1 | `— ¿Cómo ___ llamas? — Me llamo Ana.` | `se`, `te`, `me` | 1 |
| 2 | A1 | `Yo ___ estudiante.` | `soy`, `es`, `eres` | 0 |
| 3 | A2 | `Ayer ___ al cine con mi hermana.` | `voy`, `iré`, `fui` | 2 |
| 4 | B1 | `Si tuviera más tiempo, ___ más.` | `viajaré`, `viajaría`, `viajaba` | 1 |
| 5 | B1 | `Me molesta que la gente no ___ puntual.` | `es`, `será`, `sea` | 2 |
| 6 | B2 | `Por más que ___, no conseguirá convencerme.` | `insista`, `insiste`, `insistirá` | 0 |
| 7 | C1 | `El proyecto se vino abajo ___ la falta de fondos.` | `a fin de`, `a raíz de`, `a costa de` | 1 |
| 8 | C2 | `No por mucho madrugar ___ más temprano.` | `amaneciera`, `amanecerá`, `amanece` | 2 |

Do not add, reorder or reword them. Do not translate the prompts.

### src/lib/packs/pools.ts

```ts
import type { PlacementQ } from "../placement.ts";
import { placement as es } from "./langs/es/placement.ts";

// The curated placement pools, one import line per language — the same shape as
// bundled.ts and community.ts, for the same reason: a language is a folder, and
// registering it is one line, not a scattered edit.
//
// A language with no entry here is not broken; its test is written by the model
// instead (lib/placement.ts). Adding a pool is how a language stops depending on
// whatever the local model produced this minute.
const POOLS: Record<string, PlacementQ[]> = { es };

/** The curated test for a pack, or null when that language has none yet. */
export function poolFor(packId: string): PlacementQ[] | null {
  const pool = POOLS[packId.trim()];
  return pool?.length ? pool : null;
}

/** Which languages have a curated pool — the check reads this. */
export const pooled = (): string[] => Object.keys(POOLS);
```

### src/views/Onboarding.tsx

`stepLevel` is rewritten. `LevelMode` becomes
`"pick" | "busy" | "test" | "result"` — the old `"intro"` and `"manual"` merge
into `"pick"`, which is now the mode the step opens in
(`const [mode, setMode] = useState<LevelMode>("pick")`).

**`mode === "pick"` — the default path.**
- `<h1>Where are you starting from?</h1>`
- `.sub`: `Your conversations keep calibrating this, so a rough answer is fine — and you can change it any time in Settings.`
- The six `LEVELS` rows as `.pick` cards (title · code, then the sentence), keys
  1–6 via `picks[i]`. Selecting a card sets `cefr` and **does not advance**.
- A `Continue →` `.btn` and `onEnter = () => advance(5, cefr)`.
- Under the button, the test as a secondary `.link` button, not a card:
  `Not sure? Take a short test →`, calling `startTest()`.
- `testErr`, when set, renders above the level cards in an `.err` block. A failed
  test always lands back here — that is the fallback §6 asks for.

**`startTest()` is rewritten:**
```ts
const startTest = useCallback(async () => {
  setTestErr("");
  const pool = poolFor(packId);
  if (pool) { setQuiz(pool); setQi(0); setAnswers([]); return setMode("test"); }   // official languages: instant
  const primed = placementPending();
  setMode("busy");
  setWaitedAt(Date.now());
  try {
    const qs = (await (primed ?? (primePlacement(draft(), getPack(packId)), placementPending()!)));
    if (!qs) throw new Error("The model didn't return a usable test.");
    setQuiz(qs); setQi(0); setAnswers([]); setMode("test");
  } catch (e: any) {
    clearPlacement();
    setTestErr(`${String(e?.message ?? e)} — pick your level below instead.`);
    setMode("pick");
  }
}, [packId, prov, host]);
```
Add `const [waitedAt, setWaitedAt] = useState(0)` for the busy screen's clock.
A `cancelled` ref guards the resolution: if the learner left `"busy"` before the
promise settled, do not call `setMode("test")`.

**`mode === "busy"` — never a waiting screen without a door.**
- `<h1>Writing your test…</h1>`
- `.sub`: `${prettyModel(models[prov])} is writing eight questions in ${lang}. This is the slowest part of setup — usually well under a minute.`
- A live elapsed line, `${Math.round((now - waitedAt) / 1000)}s so far`, driven by
  a 1 s interval that is cleared when the mode leaves `"busy"`.
- Two buttons: `Cancel` and `I'll pick my level myself` — both set
  `mode = "pick"`; `Cancel` also calls `clearPlacement()`.
- `onEnter` is `undefined`. Esc already goes back (see `back()`).

**`mode === "test"` — a fixed eight, said plainly.**
- Keep the `.meter` progress bar and the question layout.
- The line under the question becomes:
  `Question ${qi + 1} of ${quiz.length} · Skip if you do not know it. You can change your level any time.`
  Delete the "guessing is fine — a wrong answer just sets your ceiling" sentence;
  it contradicts itself and the behaviour.
- Add a real skip: a `.link` button `Skip this one →` calling `answer(-1)`.
  `-1` is never a valid option index, so `scorePlacement` already counts it wrong
  — do not change `scorePlacement`.
- `picks[i]` stays on the options; add `picks[q.options.length] = () => answer(-1)`
  so the skip has a number key too.

**`mode === "result"` — a suggestion, not a lock.**
- `<h1>You're around {cefr}.</h1>`, and the score line as it is today, but the
  second sentence becomes:
  `That is where Day 1 will start. Change it here if it feels wrong — the coach keeps adjusting either way.`
- Keep the `CEFR_LEVELS` chip row. Give the currently-selected chip the same
  visual weight as the continue button by rendering the chips **above** it with a
  label `Start me at` — accepting and changing must not be one prominent button
  and one faint row.
- `onEnter = () => advance(5, cefr)`.

**Elsewhere:**
- `back()`'s special case becomes `if (step === 4 && mode !== "pick") return setMode("pick");`.
- In `stepModel` (PLAN-002), the priming call becomes conditional — a language
  with a curated pool must not spend tokens writing a test nobody will read:
  ```ts
  if (!poolFor(packId)) primePlacement(draft(), getPack(packId));
  ```
- When the learner changes the target language or the model after priming, the
  pending test is stale: call `clearPlacement()` in the `setPackId` handler on
  screen 1 and in the model-selection handler on screen 3.
- Imports to add: `poolFor` from `../lib/packs/pools`, and
  `placementPending`, `primePlacement`, `clearPlacement` from `../lib/placement`.

### src/lib/placement.check.ts

Append a block over the curated pools:
- `poolFor("es")` is non-null; `poolFor("kl")` is null; `poolFor("")` is null.
- For **every** language in `pooled()`: the pool's `level` sequence equals
  `PLACEMENT_LADDER` exactly; every question has exactly 3 options, all distinct
  and non-empty; `answer` is an integer in range; the prompt is non-empty.
- The correct answer is not always in the same position:
  `new Set(pool.map((q) => q.answer)).size >= 2`.
- A pool survives the same gate a generated test does:
  `parsePlacement(JSON.stringify({ questions: pool }))?.length === pool.length`.
- `scorePlacement(pool, pool.map((q) => q.answer)) === "C2"` (all right → the top)
  and `scorePlacement(pool, pool.map(() => -1)) === "A1"` (all skipped → the floor).

### CONTRIBUTING.md

In "How a language is laid out", add `placement.ts` to the file tree as an
optional file, and one paragraph under the tree:

> `placement.ts` — optional. Eight hand-written multiple-choice questions, one per
> rung of `PLACEMENT_LADDER`, that place a new learner. Without it the app asks the
> local model to write a test instead, which works but varies with the model. Add
> the file, add one import line to `src/lib/packs/pools.ts`, and the language stops
> depending on that. `placement.check.ts` holds every pool to the same shape.

## Do not touch

- `scorePlacement`, `parsePlacement`, `PLACEMENT_LADDER`, `placementPrompt` — the
  pool is written to fit them, not the other way round.
- Screens 0–3 and the final screen, except the three small call-site changes
  listed above (the conditional `primePlacement` and the two `clearPlacement`s).
- `src/views/Settings.tsx` — Settings reaches the test through
  `only={{ step: 4 }}` in `App.tsx` and needs no change.
- Any other language folder. Only `es/` gets a pool in this plan; the rest are
  follow-up issues.
- `package.json`.

## Acceptance

```bash
npm run check                                                # tsc clean, every check file passes
node --experimental-strip-types src/lib/placement.check.ts   # placement.check ✓
grep -c "adaptive\|We stop where you stop\|sets your ceiling" src/views/Onboarding.tsx   # 0
grep -n "Not sure? Take a short test" src/views/Onboarding.tsx                            # present, once
grep -n "poolFor" src/views/Onboarding.tsx                                                # used before any generation
```

The `grep -c` must print `0` — the copy no longer claims a behaviour the test
does not have.

## Manifest

When implementation is complete, write `docs/plans/PLAN-003.done.md` containing:

```markdown
## Changed
- path — one line on what changed

## Deviations
- Anything done differently from this plan, and why. Write "none" if there were none.

## Not done
- Anything in the plan left unimplemented, and what blocked it.

## Acceptance results
- Each command above, with its actual output.
```

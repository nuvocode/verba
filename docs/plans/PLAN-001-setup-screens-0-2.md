---
id: PLAN-001
title: Setup screens 0-2 — interface language, target language, daily time
branch: plan/m3-onboarding
base: feat/m2-nav-keymap
status: ready
executor: unassigned
created: 2026-08-29
issue: https://github.com/nuvocode/verba/issues/45
milestone: M3 · Onboarding
---

# PLAN-001: Setup screens 0-2

## Context

`src/views/Onboarding.tsx` asks its questions in the wrong order: the model
(the most fragile, most technical step) is first, and the language the learner
actually came for is second. The spec (`docs/plans/1-verba-onboarding-spec.md`
§4) puts the cheap decisions first — interface language, target language, daily
time — and the model third. This plan reorders the flow and rewrites the three
cheap screens. The model screen, the level screen and the final screen are
rewritten in PLAN-002, PLAN-003 and PLAN-004; here they only change index.

Nothing about the app's text is translated in this plan. Screen 0 records the
choice and seeds the native language; the interface stays in English. That is
deliberate and must not be expanded.

This plan branches off `feat/m2-nav-keymap` because `Onboarding.tsx` depends on
the `live()` keymap gate added there. If that branch has already merged into
`master`, branch off `master` instead.

## Repo conventions

The worker's harness will not load these — they are not optional.

- **No new dependencies.** `package.json` is not edited in this plan.
- Modules under `src/lib/` import each other **with the `.ts` extension**
  (`import { x } from "./langs.ts"`). Files under `src/views/` import without it
  (`from "../lib/settings"`). Follow whichever file you are editing.
- Style: 2-space indent, double quotes, semicolons, ~120 columns. There is no
  formatter — match the surrounding code by hand.
- Comments in this repo explain **why**, in full sentences, in English. Do not
  add "// set the state" noise. Do not remove existing comments unless the code
  they describe is gone.
- Tests are `*.check.ts` files under `src/`: plain `node:assert`, no framework,
  run standalone. `npm run check` runs `tsc --noEmit` plus every one of them.
- Verify with `npm run check`. Do not run `npm run tauri dev`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/langs.ts` | EDIT | append after `detectNativeLang` |
| `src/lib/rules.ts` | EDIT | `sameLanguage`, line 65 — export it |
| `src/lib/settings.ts` | EDIT | `Settings` interface, `defaultSettings`, `SKIP_DEFAULTS` |
| `src/views/Onboarding.tsx` | EDIT | whole step layout — see Specification |
| `src/App.tsx` | EDIT | the `levelTest` block, ~line 480 |
| `src/lib/onboarding.check.ts` | EDIT | the SKIP_DEFAULTS assertion block |

## Specification

### src/lib/langs.ts

Append three exports. Keep the existing `names()` helper and reuse it — do not
duplicate the `Intl.DisplayNames` guard.

```ts
/** The interface languages offered on screen 0. Short on purpose: a language on
 *  this list is one Verba intends to be readable in, not every locale Intl knows. */
export const UI_LANGUAGES = ["en", "tr", "es", "fr", "de", "pt", "it", "id", "ja"] as const;

/** A language's name in its own language ("tr" → "Türkçe"). Falls back to the code. */
export function endonym(code: string): string;

/** The reverse of `langName`: "Turkish" → "tr". "" when no code maps to that name. */
export function langCode(name: string): string;

/** A language's name as another language writes it — langNameIn("es", "tr") → "İspanyolca".
 *  Falls back to `langName(code)` when the locale is unknown to Intl. */
export function langNameIn(code: string, locale: string): string;
```

Implementation notes:
- `endonym` = `new Intl.DisplayNames([code], { type: "language" }).of(code)`,
  wrapped in try/catch, falling back to the code itself.
- `langCode` searches `CODES` for the first entry whose `langName` matches the
  argument case-insensitively after trimming.
- `langNameIn` = `new Intl.DisplayNames([locale], { type: "language" }).of(code)`,
  try/catch → `langName(code)`.
- Every one of these must be safe under plain `node` with no DOM: they are
  imported by check files.

### src/lib/settings.ts

1. Add one field to the `Settings` interface, next to `theme`:

```ts
  /** The language the interface is asked for on screen 0, as a BCP-47 code.
   *  "" until the learner has answered — the interface itself is not translated
   *  yet, so this is the record of the choice and the seed for the native
   *  language, nothing more. */
  uiLanguage: string;
```

2. Add `uiLanguage: ""` to `defaultSettings`.

3. Change `SKIP_DEFAULTS` to match §6 of the spec ("sistem dili, orta süre, B1"):

```ts
/** What "Skip setup" leaves behind (§6): the middle session length, B1, and the
 *  system language, which `defaultSettings.profile.nativeLanguage` already is. */
export const SKIP_DEFAULTS = { level: "B1" as CEFRLevel, dailyMinutes: 45, interests: [] as string[] };
```

Update the doc comment above it — it currently describes the A2/20 values.

### src/views/Onboarding.tsx

The step order becomes:

| index | screen | eyebrow |
|---|---|---|
| 0 | interface language | `Before we start` |
| 1 | target language | `Setup · 1 of 4` |
| 2 | daily time | `Setup · 2 of 4` |
| 3 | model | `Setup · 3 of 4` |
| 4 | level | `Setup · 4 of 4` |
| 5 | the existing plan screen, unchanged | `Your plan` |

Concrete edits:

1. `STEP_LABELS` becomes
   `["Before we start", "Setup · 1 of 4", "Setup · 2 of 4", "Setup · 3 of 4", "Setup · 4 of 4", "Your plan"]`.

2. `const body = [stepUi, stepLanguage, stepRhythm, stepAi, stepLevel, stepPlan][step]();`
   — `stepAi`, `stepLevel` and `stepPlan` keep their current bodies except for the
   index fixes below. Only their position changes.

3. **New `stepUi()` — screen 0.**
   - `picks[i]` for each of `UI_LANGUAGES` (9 entries, so keys 1–9 all land).
   - `onEnter = () => setStep(1)` — always available; one option is always selected.
   - Preselection: initialise state as
     ```ts
     const [ui, setUi] = useState(
       settings.uiLanguage || pickUi(typeof navigator === "undefined" ? "" : navigator.language),
     );
     ```
     with a module-level pure helper above the component:
     ```ts
     /** The offered interface language that matches the OS locale, or English. */
     function pickUi(locale: string): string {
       const base = (locale.split("-")[0] || "").toLowerCase();
       return (UI_LANGUAGES as readonly string[]).includes(base) ? base : "en";
     }
     ```
   - Selecting a language also seeds the native language:
     `setUi(code); setNativeLang(langName(code));` — the seed is unconditional
     here; screen 1's picker is where it gets overridden.
   - Markup: `<h1>Which language should Verba speak to you in?</h1>`, a `.sub`
     line reading `You can change this later in Settings. It is also the language
     your corrections will be written in.`, then a `.grid3` of `.pick` buttons —
     `.big` is `endonym(code)`, `.small` is `langName(code)`, `.tag` is the
     number `i + 1`. `.pick.on` when `ui === code`.
   - Below the grid, a `Continue →` `.btn` calling `setStep(1)`.
   - **Move the returning-learner block here, above the `<h1>`.** It is the whole
     of the `{!settings.onboarded && (<div className="native">…Restore from a
     folder…</div>)}` block currently at the bottom of `stepAi` — including
     `restoring`, `restoreErr` and the `restoreFromFolder` call. Cut it from
     `stepAi` entirely; keep the state and the `restoreFromFolder` function where
     they are defined.

4. **`stepLanguage()` — screen 1.** Rewrite:
   - **Do not filter the native language out of the list.** Every pack is
     offered. Delete the `offered` filter and use `packs` directly.
   - Selecting a card sets `packId` only. **It must not call `setStep`** — no
     screen advances on selection (§6). `onEnter = packId ? () => setStep(2) : undefined`,
     plus a visible `Continue →` `.btn`, disabled with a reason line when
     `!packId` (`Pick a language to continue`), in the same shape as the existing
     disabled-button treatment in `stepAi`.
   - Card content: `.big` is `p.nativeName`, `.small` is
     `langNameIn(p.id, langCode(nativeLang) || "en")` — the language's name as the
     learner's own language writes it. The origin `.tag` keeps `originLabel(origin)`
     and gains a `title` attribute carrying the explanation:
     - official/community: `Official packs are written and maintained by the
       Verba team, with grammar and pronunciation notes. Community packs are
       written by volunteers and may cover less.`
     - imported: leave the existing label; the same sentence with `A pack you
       pasted in yourself. Nobody has reviewed it.`
     One `PACK_ORIGIN_NOTE: Record<PackOrigin, string>` const at module level;
     import the type from `../lib/packs`.
   - **The clash question.** `applyPatch` in `src/lib/rules.ts` *refuses* a
     settings patch whose native and target languages are the same (§6: the rule
     is the same in setup and in Settings). So the clash is a question with two
     answers, and both of them end with the two languages different — there is no
     "yes, both English" branch, because that patch would be rejected at the end
     of setup and the learner would never learn why.
     - Export the existing private helper from `src/lib/rules.ts`:
       `export const sameLanguage = (a: string, b: string) => …` — same body, same
       line, just exported. Setup must not carry a second copy of this comparison.
     - When `sameLanguage(pack.name, nativeLang)` for the selected pack, render an
       inline block under the grid **instead of** the continue button:
       ```
       You already speak {nativeLang} — so which is it?
       [ I'm learning {nativeLang}. Change my native language ]
       [ Pick a different language to learn ]
       ```
       Button 1 opens the `NativePicker` (pass a `defaultOpen` prop, or lift its
       `open` state — a one-line prop is fine) with `exclude={pack.name}`, so the
       language they are learning is not on offer as a native language.
       Button 2 clears `packId` and returns to the grid.
     - While the clash stands, `onEnter` is `undefined` and there is no continue
       button. It cannot stand once either button has been answered.

   - The native row underneath keeps `NativePicker` with `exclude={lang}` and
     changes `prefix` to `Explanations and corrections will be written in `.

5. **`stepRhythm()` — screen 2.** Strip it to the time question:
   - Delete the `INTERESTS` module const, the `interests` state, the "Mostly for"
     eyebrow and the whole chip row. §5.2: that question moves into the first
     conversation and is out of scope here.
   - Remove `interests` from the object `patch()` returns. `profile` already
     spreads `...settings.profile`, so the stored value survives untouched.
   - Remove `setInterests` from `skip()`.
   - Button label becomes `Continue →`, action `setStep(3)`.
   - `onEnter = () => setStep(3)`.

6. **Index fixes in the screens this plan does not rewrite:**
   - `stepAi`: the two `setStep(1)` calls (the button and `onEnter`) become `setStep(4)`.
   - `stepLevel`: `advance(3, l)` → `advance(5, l)`, `advance(3)` → `advance(5)` (three call sites).
   - `back()`: `if (step === 2 && mode !== "intro")` → `if (step === 4 && mode !== "intro")`.
   - `skip()`: `setStep(4)` → `setStep(5)`; it now sets only level and minutes.
   - `stepPlan`: `changeLink(0)` (the AI row) → `changeLink(3)`, `changeLink(1)`
     (language) → `changeLink(1)` unchanged, `changeLink(2)` (level) →
     `changeLink(4)`, `changeLink(3)` (rhythm) → `changeLink(2)`.
   - The skip button's visibility condition `(step === 2 || step === 3)` becomes
     `(step === 1 || step === 2 || step === 4)` — never on 0, never on 3. The
     `title` attribute becomes `Level: B1 · 45 minutes a day · your system language`.

7. `patch()` gains `uiLanguage: ui`.

### src/App.tsx

In the `levelTest` block, `only={{ step: 2, back: "settings" }}` becomes
`only={{ step: 4, back: "settings" }}`. Nothing else in this file changes.

### src/lib/onboarding.check.ts

- Update the `SKIP_DEFAULTS` assertion to the new values and its comment.
- Append a new block:
  ```ts
  // ---- screen 0: the interface language list, and the seed it gives ----
  ```
  asserting: every entry of `UI_LANGUAGES` produces a non-empty `endonym`;
  `endonym("tr")` is not equal to `endonym("en")` (Intl is really answering);
  `langCode("Turkish") === "tr"`; `langCode("Klingon") === ""`;
  `langName(langCode("Spanish")) === "Spanish"` (the round trip holds);
  `langNameIn("es", "tr")` is a non-empty string.

## Do not touch

- `src/lib/models.ts`, `src/lib/placement.ts`, `src/views/Today.tsx`,
  `src/views/Settings.tsx` — later plans own these.
- The body of `stepAi`, `stepLevel` and `stepPlan` beyond the index fixes listed
  in §6 above. They are rewritten in PLAN-002/003/004 and a rewrite here is work
  that will be thrown away.
- `package.json` — no new dependencies, no new scripts.
- `src/lib/keys.ts` — the onboarding keymap is already correct.
- `applyPatch`, `languageClash` and the rest of `src/lib/rules.ts` beyond adding
  `export` to `sameLanguage`. The refusal stays exactly as strict as it is.
- `src/theme.css` — reuse the existing `.onb`, `.sheet`, `.pick`, `.grid3`,
  `.native`, `.btn` classes. If a screen needs a style that does not exist, use
  an inline `style` prop the way the surrounding code does.
- Any translation of interface text. Screen 0 records a choice; it does not
  change what any other screen says.

## Acceptance

```bash
npm run check                                                  # tsc clean, every check file passes
node --experimental-strip-types src/lib/onboarding.check.ts     # onboarding.check ✓
node --experimental-strip-types src/lib/settings.check.ts       # settings.check ✓
grep -c "INTERESTS" src/views/Onboarding.tsx                    # 0
grep -n "Setup · 1 of 4" src/views/Onboarding.tsx               # present
grep -n "only={{ step: 4" src/App.tsx                           # present
```

`grep` returning 0 matches exits 1 — for the `INTERESTS` line, expect the literal
output `0`, not a successful exit.

## Manifest

When implementation is complete, write `docs/plans/PLAN-001.done.md` containing:

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

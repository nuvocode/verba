---
id: PLAN-004
title: Setup screen 5 — no summary screen, straight into Day 1
branch: plan/m3-onboarding
base: feat/m2-nav-keymap
status: ready
executor: unassigned
created: 2026-08-29
issue: https://github.com/nuvocode/verba/issues/48
milestone: M3 · Onboarding
---

# PLAN-004: Setup screen 5 — into Day 1

## Context

Setup currently ends on a "Your plan is ready" screen that restates five answers
and then starts the day. The spec (`docs/plans/1-verba-onboarding-spec.md` §5
screen 5) removes that screen: the last thing a learner sees before Day 1 is a
one-sentence preview of the session they are about to do, and the summary of
their answers moves into Day 1 as a folded, editable block. Microphone
permission and the sound test are asked here rather than in the middle of setup,
and where the data lives is stated once.

**The daily reminder is deliberately out of scope.** There is no notification
infrastructure in the app, and storing a reminder time that nothing ever fires
would be a promise the product does not keep. It is a separate issue.

Depends on PLAN-003. The screen being replaced is `stepPlan`, index **5**. Work
on `plan/m3-onboarding`, on top of PLAN-003's commit.

## Repo conventions

- **No new dependencies.** In particular: no notification plugin.
- `src/lib/*.ts` import each other with the `.ts` extension; `src/views/*.tsx`
  import without it.
- Settings sections are reached by hash through the `AT` map in `src/lib/rules.ts`
  (`AT.learning`, `AT.advanced`, `AT.privacy`) — never a hardcoded `#settings/...`.
- Every claim on Today is produced by a pure function in `src/lib/`, not composed
  in JSX. Reuse `daySummary` rather than writing a second sentence that says
  roughly the same thing.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/views/Onboarding.tsx` | EDIT | `stepPlan` — replaced by `stepReady` |
| `src/views/Today.tsx` | EDIT | after `<ModelWarning …/>` in the returned tree |
| `src/theme.css` | EDIT | append at the end of the file |
| `src/lib/onboarding.check.ts` | EDIT | append before the final `console.log` |

## Specification

### src/views/Onboarding.tsx — `stepPlan` becomes `stepReady`

Delete the whole `stepPlan` body, the `.plan-row` markup and the `changeLink`
helper with it. The `body` array's last entry becomes `stepReady`.

**The preview.** Build the real plan, do not describe it in prose:
```ts
import { buildDailyPlan, daySummary } from "../lib/learn";
import { todayKey } from "../lib/useDay";

const preview = useMemo(
  () => buildDailyPlan(draft(), { date: todayKey(), dayIndex: 1, dueVocab: 0 }),
  [packId, cefr, minutes, nativeLang],
);
```
Screen content, in order:

1. Eyebrow `Ready` (add it as the sixth entry of `STEP_LABELS`).
2. `<h1>Day 1 starts now.</h1>`
3. The preview sentence, `.sub`: `` `${daySummary(preview)}.` `` — this is the
   one place the session's length is promised, and it is measured from the plan
   rather than typed, so the promise and the plan cannot drift.
4. **Speech, only if this build can speak.**
   ```ts
   const speech = useMemo(() => getSpeech(draft(), () => {}), [/* settings-shaped deps */]);
   ```
   - When `speech.canSpeak`: a `Hear the coach` button calling
     `void speech.speak("…", { locale })` with a short sentence in the target
     language taken from `pack?.nativeName`-appropriate copy — use the literal
     `"Hola. Empezamos cuando quieras."` only for `es`; for every other language
     speak the neutral English line `"This is the voice Verba will use."`. Keep
     it to one `if`, no table.
   - When `speech.canListen`: a `Test your microphone` button that calls
     `mic(settings.micDeviceId)`, immediately stops every track
     (`stream.getTracks().forEach((t) => t.stop())`), and reports
     `Microphone works.` on success or `micTrouble(err)` on failure. This is the
     first and only time setup asks for the permission.
   - When neither is true, render nothing here — and **no screen in setup may use
     the phrase "conversation-first"**. Removing `stepPlan` removes the only
     occurrence; do not reintroduce it.
5. **Where the data lives**, one line, `.native`:
   `Everything you do stays in ${dataDir} on this machine.` where
   ```ts
   const [dataDir, setDataDir] = useState("");
   useEffect(() => { void appDataDir().then(setDataDir).catch(() => setDataDir("")); }, []);
   ```
   (`import { appDataDir } from "@tauri-apps/api/path"` — already a dependency,
   used by `src/views/DataPanel.tsx`). When the promise fails, fall back to
   `on this machine` and drop the path from the sentence. Follow it with
   `<a href={AT.privacy}>Keep a copy in a folder you choose</a>` — the folder is
   changed in the panel that already does that properly, not in a second copy of
   it here.
6. `Start Day 1 →` `.btn` calling `onDone(patch())`, and `onEnter` the same.

### src/views/Today.tsx — the folded summary

Add a collapsed `<details className="setup">` immediately after
`<ModelWarning settings={settings} />`, before the greeting block.

```tsx
<details className="setup">
  <summary>Your setup</summary>
  …rows…
</details>
```

Five rows, each `label — value — a link that changes it`:

| label | value | link |
|---|---|---|
| `Model` | `` `${provider?.name} · ${prettyModel(modelId)}` `` | `AT.advanced` |
| `Learning` | `settings.profile.targetLanguage` | `AT.learning` |
| `Explained in` | `settings.profile.nativeLanguage` | `AT.learning` |
| `Level` | `levelOf(settings.profile)` | `AT.learning` |
| `Each day` | `` `${settings.dailyMinutes} minutes · ${timeName(settings.dailyMinutes)}` `` | `AT.learning` |

- `provider` comes from `PROVIDERS.find((p) => p.id === settings.provider)`;
  `modelId` from `String(settings[provider.model] ?? "")`. Both already imported
  or trivially importable from `../lib/models`.
- `levelOf` is in `src/lib/model.ts` — use it, never `settings.profile.level`
  directly, for the same reason every other surface does.
- `timeName` is in `src/lib/choices.ts`.
- Each link is a plain `<a href={…}>` styled like the existing links in
  `ModelWarning` (`color: var(--accent-ink)`).

`<details>` is closed by default and is the whole of the folding — no state, no
library. It sits in Today's single centred column rather than in a real sidebar:
Today has no second column, and adding one is a layout change this milestone does
not ask for.

### src/theme.css

Append:
```css
/* Today's folded setup summary — the "your plan is ready" screen, demoted to a
   line you can open when you want it (§5, screen 5). */
.setup { margin: 0 0 30px; max-width: 640px; font-size: 13px; color: var(--ink2); }
.setup summary { cursor: pointer; font-family: var(--mono); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--ink3); }
.setup summary:hover { color: var(--ink); }
.setup .row2 { display: flex; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--line2); }
.setup .row2 .k { font-family: var(--mono); font-size: 11px; color: var(--ink3); width: 96px; flex: none; padding-top: 2px; }
```

### src/lib/onboarding.check.ts

Append: for each of the three `TIMES` lengths, `buildDailyPlan` at that
`dailyMinutes` produces a plan whose `daySummary` string contains the plan's own
`estimatedMinutes` — the preview sentence and the plan are the same number, which
is the §6 rule that a promised duration is a measured one.

## Do not touch

- `src/views/DataPanel.tsx` and anything under `src/views/settings/` — the folder,
  the export and the sync already live there.
- `src/lib/vault.ts`, `src/lib/backup.ts` — read `appDataDir()` for the sentence;
  do not attach, push or pull from setup.
- `src/lib/speech.ts` — `mic`, `micTrouble` and `getSpeech` are used as they are.
  No new speech tier, no new setting.
- `src/lib/learn.ts` — `buildDailyPlan` and `daySummary` are reused, not changed.
- Any notification, reminder or scheduling code. Out of scope by decision.
- Screens 0–4.
- `package.json`.

## Acceptance

```bash
npm run check                                                  # tsc clean, every check file passes
node --experimental-strip-types src/lib/onboarding.check.ts    # onboarding.check ✓
grep -c "conversation-first" src/views/Onboarding.tsx          # 0
grep -c "Your plan is ready" src/views/Onboarding.tsx          # 0
grep -n "daySummary" src/views/Onboarding.tsx                  # the preview sentence
grep -n "details className=\"setup\"" src/views/Today.tsx      # the folded summary
```

Both `grep -c` lines must print `0`.

## Manifest

When implementation is complete, write `docs/plans/PLAN-004.done.md` containing:

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

---
id: PLAN-015
title: One formatter, and nothing raw reaches the learner
branch: plan/m5-surface-contracts
base: master
status: done
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/61
milestone: M5 · Surface contracts
---

# PLAN-015: one formatter, and nothing raw reaches the learner

## Context

Two of #61's bullets are not about states at all. They are about what the app is
allowed to put on screen.

**Raw output.** Every hook catches the same way: `setError(String(e?.message ?? e))`
(`useTalk.ts`, `useRead.ts`, `useListening.ts`), and every view renders that string
into `<div className="err">`. So a 429 body, a `SyntaxError: Unexpected token < in
JSON`, or the first 200 characters of whatever a 3B model hallucinated instead of
JSON all land in front of a learner who wanted a story. Invariant 22 says none of
them may.

**Formats.** Dates are printed in four different ways today:
`new Date(open.started_at).toLocaleString()` in Talk's replay header,
`.toLocaleDateString()` in its history list, a bare `Date` elsewhere. §3.3 asks for
one format across the app, recent dates relative and older ones absolute.

Both are one-file problems, and every plan after this one depends on the answer, so
they come first.

First plan on `plan/m5-surface-contracts`, on top of `master`.

## Repo conventions

- **No new dependencies.** `Intl.RelativeTimeFormat` and `Intl.DateTimeFormat` are
  in the webview and in Node; a date library is not needed and is not allowed.
- `src/lib/fmt.ts` must not import `./db.ts` or anything Tauri — it has to run in a
  check process. It takes values and a locale and returns strings.
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  import **without** it.
- Checks: `*.check.ts`, `node --experimental-strip-types`, no DOM, no DB.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/fmt.ts` | NEW | — |
| `src/lib/fmt.check.ts` | NEW | — |
| `src/lib/useTalk.ts` `useRead.ts` `useListening.ts` | EDIT | every `catch` that calls `setError` |
| `src/views/*.tsx` | EDIT | every `toLocale*` call, every `.err` render |
| `src/lib/invariants.check.ts` | EDIT | LEDGER row 22 |

## Specification

### src/lib/fmt.ts

Three exports. Nothing else belongs in this file.

```ts
/** The learner's locale — the one the interface is in, never `targetLanguage`. */
export function uiLocale(): string;

/**
 * A moment, in the learner's locale. Under 7 days: relative ("2 days ago",
 * "yesterday"). Older: absolute, one format, no time unless `withTime`.
 */
export function when(at: number, now = Date.now(), locale = uiLocale(), withTime = false): string;

/**
 * What a caught error is allowed to say. Maps a thrown value onto one of a fixed
 * set of learner-facing sentences by *shape*, never by content:
 *   - offline / fetch failure  → "You're offline, or the model isn't reachable."
 *   - HTTP 4xx with a key      → "That key was refused. Check it in Settings → …"
 *   - HTTP 5xx / timeout       → "The model didn't answer. Try again."
 *   - JSON / parse / empty     → "The reply came back unusable. Try again."
 *   - anything else            → "Something went wrong. Try again."
 * The original is returned separately for the log, never for the screen.
 */
export function humanError(e: unknown): { say: string; log: string };
```

`humanError` returns an object on purpose: the second field is what `console.warn`
gets, so a developer keeps the detail the learner is spared. A caller that spreads
`log` into JSX is the bug this plan exists to prevent — the check below catches it.

### The hooks

Every `catch` becomes:

```ts
} catch (e) {
  const { say, log } = humanError(e);
  console.warn("[read] generate failed:", log);
  setError(say);
}
```

No hook keeps the raw string in state any more. Where a hook currently derives
behaviour from the message text, that derivation moves in front of `humanError`.

### The views

- Every `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` on a
  learner-facing surface is replaced by `when(...)`. `Talk`'s history rows, its
  replay header, `Memory`'s due dates, `Coach`'s week label.
- `.err` blocks keep rendering `hook.error`, which is now already a sentence.

### src/lib/fmt.check.ts

```
// invariant 22
```

1. `when` is relative under 7 days and absolute at 8, in both `en` and `tr`.
2. `when` of "now" says something; it never returns `"Invalid Date"` or `"NaN"`.
3. `humanError` over a table of ~10 realistic throwables (a `TypeError: Failed to
   fetch`, `new Error("ElevenLabs 401: {\"detail\":…}")`, `new Error("Ollama 500")`,
   a `SyntaxError`, a raw JSON string, `undefined`) returns a `say` that:
   - contains no digit run of 3+ (no status codes),
   - contains no `{`, `}`, `<`, `>` or `\n`,
   - is under 120 characters,
   - is one of the fixed sentences (assert membership in the exported set).
4. **The static gate.** Read every file under `src/views/` and `src/lib/use*.ts`.
   Fail if any of them contains `String(e` , `e.message`, `err.message`,
   `.stack`, or `JSON.stringify(e`. This is the invariant, mechanised: the only
   way an error string reaches a view is through `humanError`.
5. Read every `.tsx` under `src/views/`. Fail on `toLocaleDateString`,
   `toLocaleString`, `toLocaleTimeString` — the formatter is the one door.

### src/lib/invariants.check.ts

Row 22 becomes:

```ts
{ id: 22, claim: "…", assertedIn: [{ file: "src/lib/fmt.check.ts", marker: "invariant 22" }] },
```

## Do not touch

- `src/lib/db.ts` — no schema change, no migration.
- The provider layer. `humanError` classifies what providers throw; it does not
  change what they throw.
- Onboarding's date handling is out of scope only where it prints no date; if it
  prints one, it uses `when` like everything else.
- No new dependency.

## Acceptance

- `npm run check` green.
- `invariants: 17 asserted, …` — row 22 no longer pending.
- Grepping `src/views` for `toLocale` returns nothing.
- Pulling the network and pressing "Generate a story" shows one calm sentence and a
  retry, and the console holds the real cause.

## Commit

```
feat(shell): one date format, and no raw model output on any surface (PLAN-015)
```

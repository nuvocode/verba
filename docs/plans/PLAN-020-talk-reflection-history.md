---
id: PLAN-020
title: Talk — the reflection earns its page, and history folds
branch: plan/m5-surface-contracts
base: master
status: done
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/57
milestone: M5 · Surface contracts
---

# PLAN-020: reflection and history

## Context

The reflection has most of its parts and one live bug; the history has one screen
and none of its structure.

**The bug.** `src/lib/prompts.ts`:

```ts
summary: typeof obj.summary === "string" ? obj.summary : raw.trim(),
```

When the summary call comes back as anything but the expected JSON, the *whole raw
model reply* becomes the summary — written to `sessions.summary`, printed in the
reflection, printed again in the history list, and read back months later. That is
invariant 22 stored in a database. §2.2 is explicit: a failed summary writes a
minimal record with a title and a date, and nothing else.

**The missing parts.** Corrections are listed but not categorised. There is no goal
scorecard — PLAN-017 built the state for one and nothing renders it. Captured words
flow to Memory as *facts*, not as candidates the learner approves. The summary's
voice is whatever the model felt like; §2.2 wants second person, in one voice,
across all history.

**The history.** `Talk.tsx` renders `past` as a flat list of every session ever,
newest first, each row a date. No date grouping, no folding of the seven times
someone practised the interview, and "Practise this again" restarts from zero —
there is no resume.

Depends on PLAN-019. Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- Dates come from `when()` (PLAN-015). No `toLocale*` in this diff.
- Any new column is `ALTER TABLE … ADD COLUMN … DEFAULT`, in `migrate()`, wrapped
  in the existing `.catch(() => {})` idiom. No table is rewritten.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/prompts.ts` | EDIT | `parseSummary`, `summaryPrompt`, `Correction` |
| `src/lib/prompts.check.ts` | EDIT (or NEW) | parse cases |
| `src/lib/db.ts` | EDIT | `migrate()`, `listSessions`, new `sessionGroups` |
| `src/lib/useTalk.ts` | EDIT | `end()`, the summary path, resume |
| `src/views/Talk.tsx` | EDIT | reflection body, history list |

## Specification

### A failed summary writes nothing

```ts
/** `null` when the model did not return a usable summary. There is no fallback text. */
export function parseSummary(raw: string): SessionSummary | null;
```

- Returns `null` unless `obj.summary` is a string of ≥ 20 characters that is not
  itself JSON-looking (no leading `{` or `[`).
- `useTalk.end()` on `null`: `sessions.summary` stays `NULL`, and the reflection
  renders `Unusable` (PLAN-016) — "The write-up didn't come back. Everything else
  from this session is saved." with a regenerate action.
- The history row for a summary-less session already reads "no summary — ended
  early"; keep that copy, it is honest.

### Corrections are categorised

`Correction` gains `category`, from a closed set, decided by the coach in the turn
reply it already returns:

```ts
export type CorrectionCategory = "grammar" | "vocabulary" | "wordOrder" | "register" | "pronunciation";
```

The reflection groups by category with a count per group. An unknown or missing
category maps to `"grammar"` on parse — a wrong bucket is recoverable; an invented
bucket per session is not (the categories must be stable enough for Coach to trend
them).

This set is **Talk's** schema. PLAN-023 defines Read's, and the two never share a
type — that is invariant 19.

### The goal scorecard

PLAN-017's `goalState` is rendered as a scorecard: each goal, its final state, and
one line of total ("3 of 4 met"). A missed goal is stated, not scolded — same copy
gate as PLAN-019.

### Captured words are candidates

Today `r.words` are already written to the deck and the chips offer a `×` to remove
them. Invert it: words land as **candidates**, the chips are unselected by default
for anything the level gate (M4, `vocab.ts`) would question, and one action —
"Keep these N" — commits. Nothing enters the deck without a press.

`db.ts` gains `vocab.status TEXT NOT NULL DEFAULT 'kept'` via `ADD COLUMN`, with
`'candidate'` written by this path. `deck.ts`'s queries filter to `'kept'`; an
existing row defaults to `'kept'` so no deck changes under anyone.

### One voice

`summaryPrompt` states the voice as a constraint, not a suggestion: second person
singular, past tense, one paragraph, no praise that is not tied to something in the
transcript, never the learner's name. Add the same line to the prompt used for
*every* historical summary so old and new records read alike.

### History groups and folds

```ts
export interface SessionGroup {
  scenarioId: string;
  title: string;         // "Lead Engineer Interview"
  count: number;         // 3
  lastAt: number;
  sessions: SessionRow[]; // newest first
}

/** Grouped by day (via when()), and within a day folded by scenario. */
export async function sessionGroups(): Promise<{ day: string; groups: SessionGroup[] }[]>;
```

- A group with `count > 1` renders as one row, "Lead Engineer Interview · 3
  sessions", expanding to the individual runs.
- Every row offers **Restart** (a fresh session on that scenario) and **Resume**
  (loads the stored messages back into `useTalk` and continues). Resume is the new
  capability: `sessionMessages` already returns the transcript; `useTalk` gains
  `resume(sessionId)` that rehydrates `msgs`, `produced` and the persona and keeps
  writing to the same `sessions` row.

### Checks

`prompts.check.ts`:
- `parseSummary` returns `null` for: a bare prose reply, a JSON object with no
  `summary`, a `summary` of 5 characters, and a `summary` that starts with `{`;
- returns the object for a well-formed reply;
- **no path returns `raw`** — assert by scanning the function's source for `raw` on
  the return side.

`db`-independent group folding gets a pure helper (`foldSessions(rows)`) in
`db.ts`'s companion or `fmt.ts`, checked directly: 3 interview runs on one day fold
to one group of 3; runs on different days do not fold across days.

## Do not touch

- `messages` and `sessions` table shapes beyond `ADD COLUMN`.
- The M4 `migrateVocabToPerLanguage` migration.
- Coach's metrics.
- No new dependency.

## Acceptance

- `npm run check` green.
- Forcing a bad summary reply leaves `sessions.summary` NULL and shows the
  regenerate state — no JSON on screen, none in the DB.
- Three interview sessions in one day appear as one folded row that expands.
- Resume continues a past conversation with its persona and its transcript intact.

## Commit

```
feat(talk): a reflection that reports, and a history that folds and resumes (PLAN-020)
```

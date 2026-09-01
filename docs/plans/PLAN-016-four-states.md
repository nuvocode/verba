---
id: PLAN-016
title: Four states on every generating surface, and one place per fact
branch: plan/m5-surface-contracts
base: master
status: done
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/61
milestone: M5 · Surface contracts
---

# PLAN-016: four states, one place per fact

## Context

§3.2 asks every content-generating surface for four states, and the app has roughly
two and a half of them:

- **Loading** exists but is mostly a mood. `Listening` says "Writing you a story…"
  and does name the chapter; `Read` and `Talk` show a spinner-ish line with no idea
  what is being made or how long it takes.
- **Empty** exists on Listen, is thin on Read, and on Talk is the scenario picker
  (which is fine — it just has to say so).
- **Error** exists everywhere and, after PLAN-015, says something civil. It does not
  always offer a retry.
- **Broken content** exists nowhere. A passage that comes back as three tautologies
  is shown. That state is the whole reason PLAN-022 and PLAN-023 can be built at
  all: gates need somewhere to put what they reject.

Two neighbouring invariants land in the same sweep because they are the same kind of
claim about the shell:

- **25** — the same information twice. `Read`'s coach note is rendered in the margin
  rail *and* in the focus bar for the focused sentence (`Passage.tsx` lines ~127 and
  ~150). Both are on screen at once when a sentence is focused.
- **23, 24** — the keymap. `src/lib/keys.ts` already makes "announced" and "working"
  the same list by construction, and `Esc` is already handled per surface. Neither
  claim is *asserted* anywhere, so the ledger cannot see it. This plan writes the
  two assertions and makes the second one true where it is not.

Depends on PLAN-015 (states render `humanError`'s sentence). Work on top of its commit.

## Repo conventions

- **No new dependencies.**
- `src/lib/surfaces.ts` is data, not JSX: a registry the check reads. It must not
  import React.
- `src/views/States.tsx` holds the four components and nothing else.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/surfaces.ts` | NEW | — |
| `src/lib/surfaces.check.ts` | NEW | — |
| `src/views/States.tsx` | NEW | — |
| `src/views/Read.tsx` | EDIT | the early returns |
| `src/views/Listening.tsx` | EDIT | the two `.empty` blocks |
| `src/views/Talk.tsx` | EDIT | picker + reflection early returns |
| `src/views/read/Passage.tsx` | EDIT | the focus bar's note |
| `src/lib/keys.check.ts` | EDIT | two new markers |
| `src/lib/invariants.check.ts` | EDIT | LEDGER rows 23, 24, 25, 27 |

## Specification

### src/views/States.tsx

Four components, one shape each. Every one of them takes what it needs to be
specific — a generic component that says "Loading…" fails the spec it implements.

```tsx
/** What is being made, and roughly how long. Never a bare spinner. */
export function Generating({ what, eta, step }: { what: string; eta: string; step?: string })

/** Why there is nothing here, and the one thing that changes it. */
export function Nothing({ why, action }: { why: string; action?: { label: string; onClick(): void } })

/** What happened (one sentence from humanError), what to try, and a retry. */
export function Failed({ say, retry }: { say: string; retry?: { label: string; onClick(): void } })

/**
 * Generated content that failed a quality gate. The learner never sees what was
 * rejected — they see that it was, and the way out.
 */
export function Unusable({ what, fallback, regenerate }: {
  what: string;
  fallback?: { label: string; onClick(): void };
  regenerate: { label: string; onClick(): void };
})
```

`eta` is a string the caller composes from what it knows ("about 20 seconds on this
model"), not a live countdown. A countdown that is wrong is worse than a range.

### src/lib/surfaces.ts

The registry, in the shape of `states.check.ts`'s table — the pattern this repo
already uses for "a claim nobody implemented must be distinguishable from one nobody
wrote down".

```ts
export type StateName = "loading" | "empty" | "error" | "unusable";

export interface SurfaceRow {
  id: "today" | "talk" | "read" | "listen" | "memory" | "coach";
  /** Does this surface generate content? A surface that does not owes no states. */
  generates: boolean;
  /** Which file renders each state, and the marker comment in it. */
  states: Record<StateName, { file: string; marker: string } | { pending: string }>;
}
```

Every generating surface's four entries must be `{file, marker}` by the end of M5.
Where a state cannot be built until a later plan, the row reads
`{ pending: "PLAN-022" }` — and `surfaces.check.ts` fails if a `pending` names a
plan that is not in `docs/plans/`. That way the registry is a to-do list that
cannot rot.

At **this** plan's commit the allowed pendings are exactly: Read `unusable`
(PLAN-022), Listen `unusable` (PLAN-026). Everything else is wired now.

### The surfaces

Each view's early returns become the four components, with real copy:

- **Read** — `Generating` names the passage length and the level and says roughly
  how long; `Nothing` says the plan has no reading block today and offers "a passage
  outside the plan"; `Failed` retries the same request, not a new one.
- **Listen** — `Generating` already knows `status` ("Writing chapter 2 of 3…"); pass
  it as `step`, and give `what`/`eta` from the chapter count.
- **Talk** — the scenario picker *is* the empty state; it renders `Nothing`'s copy
  above the grid rather than pretending it is a landing page. Reflection's
  "Looking back…" becomes `Generating`.
- **Today**, **Memory**, **Coach** — already have their states from M4; they get the
  components so the copy is consistent, and their registry rows point at them.

### Invariant 25 — one place per fact

In `Passage.tsx`, a note is either in the margin or in the focus bar, never both.
The rule: **the margin rail is the home of every note; focusing a sentence
highlights its note there and the focus bar does not repeat it.** The focus bar
keeps what the margin does not have — the sentence counter and the translation.

Assert it in `surfaces.check.ts` as a source scan: `Passage.tsx` contains exactly
one JSX expression rendering `note`/`notes`.

### Invariants 23 and 24 — the keymap

In `keys.check.ts`, add:

```
// invariant 23
// invariant 24
```

- **23**: for every surface, `keysFor(surface, has)` announces exactly the shortcuts
  that `live(surface, …)` will fire — the count of labels equals the count of
  non-`nav` handlers, for every combination of `has` flags the surface declares.
- **24**: `Esc` appears in `KEYS` on every surface in `SURFACES`, and its `does`
  string is the same on all of them. If a surface's `Esc` currently means something
  narrower ("close the sheet"), that is still "one level up" — but the table must
  say so with one shared verb phrase, so fix the entry rather than the assertion.

### src/lib/invariants.check.ts

Rows 23, 24 → `src/lib/keys.check.ts`. Rows 25, 27 → `src/lib/surfaces.check.ts`.

## Do not touch

- `src/lib/keys.ts`'s structure. The one-table design is what makes 23 true; this
  plan asserts it, it does not redesign it.
- The `.err` CSS class or `theme.css` beyond what the four components need.
- `src/lib/db.ts`.
- No new dependency.

## Acceptance

- `npm run check` green; ledger rows 23, 24, 25, 27 asserted.
- `surfaces.check` prints the registry with two known pendings, both naming real plans.
- Focusing a sentence in Read highlights one note, in one place.

## Commit

```
feat(shell): four states on every generating surface (PLAN-016)
```

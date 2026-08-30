---
id: PLAN-008
title: Memory — due today, soon, learned
branch: plan/m4-signal-coach-loop
base: master
status: ready
executor: unassigned
created: 2026-08-30
issue: https://github.com/nuvocode/verba/issues/53
milestone: M4 · Signal → Coach loop
---

# PLAN-008: due today, soon, learned

## Context

`src/views/Memory.tsx` splits the deck into "Due for resurfacing", "Settled" and
"Needs a look", and its call to action reads `Resurface {due.length} due` — the
whole backlog. §2.5 asks for three groups (**due today / soon / learned**), a
call to action driven by the daily cap ("20 reviews today"), the backlog stated
separately and calmly, filters by type / source surface / level / strength, and
strength bars that visibly differ across the deck (invariant 15).

PLAN-006 put the cap and the two-field strength in `lib/srs.ts`; PLAN-007 put the
type, the origin, the source surface and the level band on the row. This plan is
the first one that shows any of it.

Depends on PLAN-007. Work on `plan/m4-signal-coach-loop`, on top of PLAN-007's commit.

## Repo conventions

- **No new dependencies.** No date library, no table component, no chart library.
- **Nothing on a screen composes a sentence.** Every claim the learner reads is a
  pure function in `src/lib/`, so a check can hold it. This is why the grouping,
  the counts and the call-to-action copy go in `src/lib/deck.ts` and not in JSX.
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  import **without** it.
- `src/lib/deck.ts` must not import `./db.ts` — `db.ts` loads a Tauri plugin and
  cannot run in a check process. Define the row shape structurally instead.
- Checks are `*.check.ts` under `node --experimental-strip-types`, no DOM, no
  database, `node:assert`, ending in `console.log("<name>.check OK")`.
- Styling: this repo has no CSS framework. New classes go in `src/theme.css`,
  named like the ones already there (`.wrow`, `.mem-head`, `.sec`, `.bar`).
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/deck.ts` | NEW | — |
| `src/lib/deck.check.ts` | NEW | — |
| `src/views/Memory.tsx` | EDIT | the `now`/`junk`/`good`/`due`/`settled` block, `start`, the `mem-head` CTA, the `groups` array and the row renderer |
| `src/lib/useDay.ts` | EDIT | every `vocabCounts(...)` call; the `due` state; the `Day` interface |
| `src/lib/learn.ts` | EDIT | the `memory` activity inside `buildDailyPlan` |
| `src/theme.css` | EDIT | append at the end of the file |
| `src/lib/invariants.check.ts` | EDIT | LEDGER row 15 |

## Specification

### src/lib/deck.ts (NEW)

```ts
// What the deck looks like to the learner (§2.5): three groups, one capped ask,
// one calm sentence about the backlog, and four filters. Pure — Memory renders
// what this file decides, and deck.check.ts holds it to the spec without a
// database in the room.
import { strength, DAILY_REVIEW_CAP } from "./srs.ts";

/** The row shape this file needs. `db.VocabRow` satisfies it structurally. */
export interface DeckCard {
  id: number;
  term: string;
  translation: string;
  example: string;
  ease: number;
  interval: number;
  due: number;
  reps: number;
  lapses: number;
  type: string;
  captured_by: string;
  source_surface: string;
  level_band: string | null;
}

/** A card parked this long is not being learned any more; it is known. */
export const LEARNED_INTERVAL_DAYS = 21;

export type DeckGroup = "due" | "soon" | "learned";

/**
 * Which of the three groups a card is in. "Soon" is everything scheduled that has
 * not settled yet — the group a learner checks to see what is coming, which is why
 * it is not merged into "learned".
 */
export function groupOf(card: DeckCard, now: number): DeckGroup {
  if (card.due <= now) return "due";
  return card.interval >= LEARNED_INTERVAL_DAYS ? "learned" : "soon";
}

export function groupDeck(cards: DeckCard[], now: number): Record<DeckGroup, DeckCard[]> {
  const out: Record<DeckGroup, DeckCard[]> = { due: [], soon: [], learned: [] };
  for (const c of cards) out[groupOf(c, now)].push(c);
  out.due.sort((a, b) => a.due - b.due);
  return out;
}

/**
 * What the learner is asked for today, and what is merely true.
 *
 * The ask is capped; the backlog is not the ask. "112 due" is the number that
 * makes a learner close the app, so it never appears on a button — it appears in
 * a sentence that says the queue will come to them a day at a time.
 */
export function reviewAsk(dueCount: number, cap = DAILY_REVIEW_CAP): number {
  return Math.min(dueCount, cap);
}

/** The button. Always the capped number, always with its unit. */
export function reviewCall(dueCount: number, cap = DAILY_REVIEW_CAP): string {
  const ask = reviewAsk(dueCount, cap);
  return `${ask} ${ask === 1 ? "review" : "reviews"} today`;
}

/**
 * The backlog, said once and calmly. `null` when there is no backlog beyond
 * today's ask — a reassurance nobody needed is just another number on the screen.
 */
export function backlogNote(dueCount: number, cap = DAILY_REVIEW_CAP): string | null {
  const over = dueCount - reviewAsk(dueCount, cap);
  if (over <= 0) return null;
  return `${over} more are waiting behind today's ${cap}. They come back to you a day at a time — there is nothing to catch up on.`;
}

export interface DeckFilter {
  type?: string; // §1.4 VocabItem.type
  surface?: string; // where it was met: talk | read | listen
  band?: string; // CEFR band of the item
  fragile?: boolean; // strength < FRAGILE
}

/** Under this, the bar draws in the warning colour and "fragile" selects it. */
export const FRAGILE = 0.4;

export function filterDeck(cards: DeckCard[], f: DeckFilter): DeckCard[] {
  return cards.filter(
    (c) =>
      (!f.type || c.type === f.type) &&
      (!f.surface || c.source_surface === f.surface) &&
      (!f.band || c.level_band === f.band) &&
      (!f.fragile || strength(c) < FRAGILE),
  );
}

/** The values actually present in this deck — a filter chip for a value nobody has is furniture. */
export function facets(cards: DeckCard[]): { types: string[]; surfaces: string[]; bands: string[] } {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return {
    types: uniq(cards.map((c) => c.type)),
    surfaces: uniq(cards.map((c) => c.source_surface)),
    bands: uniq(cards.map((c) => c.level_band)),
  };
}

/** How a card's type reads on screen. camelCase is a schema, not a label. */
export function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    word: "word",
    phrase: "phrase",
    phrasalVerb: "phrasal verb",
    idiom: "idiom",
    collocation: "collocation",
    pronunciation: "pronunciation",
  };
  return labels[type] ?? "word";
}

/** Where a card came from, and who kept it — one line, or null when nothing is known. */
export function originLine(card: DeckCard): string | null {
  const who = card.captured_by === "coach" ? "kept for you" : "you kept this";
  return card.source_surface ? `${who} in ${card.source_surface}` : who;
}
```

### src/lib/deck.check.ts (NEW)

Assert, with `node:assert` and a small hand-built deck (no DB):

1. `groupOf` puts an overdue card in `due`, a 3-day card in `soon`, a 30-day card
   in `learned`; a card due exactly `now` is `due`.
2. **invariant 15:** build a deck of cards at intervals 0, 1, 5, 21 and eases 1.3
   and 2.5, and assert `new Set(deck.map(strength)).size >= 4` — bars that are all
   the same length mean the value is not wired to the schedule. Mark the assertion
   `// invariant 15`.
3. `reviewCall(112)` === `"20 reviews today"`, `reviewCall(1)` === `"1 review today"`,
   `reviewCall(0)` === `"0 reviews today"`.
4. `backlogNote(112)` is a string containing `"92"`; `backlogNote(20)` and
   `backlogNote(3)` are `null`.
5. `filterDeck` narrows on each of the four keys independently and on two at once;
   an empty filter returns everything.
6. `facets` lists only values present, sorted, with no `null` band leaking in.
7. `typeLabel("phrasalVerb")` === `"phrasal verb"`; an unknown type falls back to
   `"word"` rather than throwing.

End with `console.log("deck.check OK")`.

### src/views/Memory.tsx

Keep: review mode in full, the junk group and `dropAllJunk`, `drop`, the key
handling, `Hints`, the signal emission through `day.complete`. Change only the
collection view and what starts a review.

1. Replace the `due` / `settled` derivation with `groupDeck`:

```ts
  const junk = words.filter((w) => suspect(w) !== null);
  const good = words.filter((w) => suspect(w) === null);
  const shown = filterDeck(good, filter);
  const { due, soon, learned } = groupDeck(shown, now);
```

2. Add one piece of state for the filters and nothing more:

```ts
  const [filter, setFilter] = useState<DeckFilter>({});
```

3. `start()` queues **the capped ask**, oldest first, and ignores the filter — a
   filtered view is a way of looking at the deck, not a way of choosing what is
   due:

```ts
  const start = useCallback(() => {
    const q = groupDeck(words.filter((w) => suspect(w) === null), Date.now()).due.slice(0, DAILY_REVIEW_CAP);
    if (!q.length) return;
    ...unchanged...
  }, [words]);
```

4. The call to action in `mem-head` uses `reviewCall`, and the backlog sits under
   the intro paragraph as its own line, not on the button:

```tsx
        {due.length > 0 && (
          <button className="btn sm" onClick={start} style={{ whiteSpace: "nowrap" }}>
            {reviewCall(due.length)} <span className="kbd">R</span>
          </button>
        )}
```

```tsx
      {backlogNote(due.length) && <div className="backlog">{backlogNote(due.length)}</div>}
```

5. The groups become the spec's three, plus the existing junk group last:

```ts
  const groups = [
    { label: `Due today · ${reviewAsk(due.length)} of ${due.length}`, words: due.slice(0, DAILY_REVIEW_CAP), junk: false },
    { label: `Coming back soon · ${soon.length}`, words: soon, junk: false },
    { label: `Learned · ${learned.length}`, words: learned, junk: false },
    { label: `Needs a look · ${junk.length}`, words: junk, junk: true },
  ].filter((g) => g.words.length);
```

6. Filter chips, rendered from `facets(good)` above the groups. One row of
   buttons; a chip toggles its key on and off; a chip is only rendered when the
   facet has more than one value. Reuse the existing `.chip` class, adding `on`
   when selected. Include a `fragile` chip labelled `Fragile` whose title reads
   `Strength under 40%`.

7. Each row gains its type label and its origin line, from `typeLabel` and
   `originLine`. Put them in one `.wmeta` element after `.ctx`; a pronunciation
   card is not to look like an idiom (§2.5). The `.bar` element keeps its
   position — it is what holds the `×` in the same column all the way down —
   and its `weak` class now comes from `FRAGILE`:

```tsx
                <div className="bar">
                  {!g.junk && <div className={str < FRAGILE ? "weak" : ""} style={{ width: `${Math.round(str * 100)}%` }} />}
                </div>
```

8. The empty state stays as it is. Add one empty state for a filter that matches
   nothing: `No cards match that. Clear the filters to see the whole deck.` with
   a button that sets `{}`.

### src/lib/useDay.ts

`vocabCounts` now returns `{ total, due, today }`. Three edits:

1. Both `vocabCounts(...)` call sites destructure `today` and `due`:
   `const { today, due: backlog } = await vocabCounts(...)`.
2. `buildDailyPlan` is given the **capped** number: `dueVocab: today`. The plan
   must not promise an hour of reviews the app is not going to ask for.
3. `Day` gains `backlog: number` next to `due`, `due` holds `today`, and both are
   returned. Update the doc comment on `due` to say it is the capped ask.

### src/lib/learn.ts

The `memory` activity's rationale reads the capped number, and says the backlog
is handled:

```ts
        rationale: `${ctx.dueVocab} cards come back today — reviewing them after you have used the words is when they stick.`,
```

Leave `estimatedMinutes: Math.max(2, Math.ceil(ctx.dueVocab / 4))` and its comment
unchanged: with `dueVocab` now capped at 20, that comment's "forty cards are forty
cards" claim is about the cards being asked for, and the arithmetic still holds.

### src/theme.css

Append three rules, following the file's existing single-line style:

```css
.backlog { font-size: 13px; color: var(--ink3); margin: -8px 0 26px; max-width: 640px; line-height: 1.6; }
.wmeta { font-size: 11.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink3); }
.deck-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 26px; }
```

### src/lib/invariants.check.ts

```ts
  {
    id: 15,
    claim: "`strength` çubuklarının uzunlukları deck içinde çeşitlilik gösterir.",
    assertedIn: [{ file: "src/lib/deck.check.ts", marker: "invariant 15" }],
  },
```

## Do not touch

- `src/lib/db.ts` — this plan reads what PLAN-006 and PLAN-007 already wrote. No
  schema change, no new query.
- Review mode inside `Memory.tsx`: the card, the reveal, the grades, the key
  handler, `dropCard`, and the `day.complete("memory", …)` signal emission. The
  only line that changes there is `start()`.
- `suspect` / `worthLearning` and the junk group's copy.
- `src/lib/srs.ts` — `strength` is already correct after PLAN-006.
- `package.json`, `package-lock.json`, `src-tauri/**`.

## Acceptance

```bash
npm run check                                             # 0 failed
node --experimental-strip-types src/lib/deck.check.ts     # ends "deck.check OK"
grep -c "deck" src/views/Memory.tsx                       # >= 1 — the view imports the lib
grep -n "due.length} due" src/views/Memory.tsx            # no hits — the raw backlog is off the button
grep -n "Due today\|Coming back soon\|Learned" src/views/Memory.tsx   # three hits
grep -n "dueVocab: today" src/lib/useDay.ts               # one hit
npm run build                                             # succeeds
```

Then, in the running app (`npm run dev`), with a deck of at least three cards:
open Memory and confirm the three group headings render, the button reads
"N reviews today", and the strength bars in one group are not all the same width.

## Manifest

When implementation is complete, write `docs/plans/PLAN-008.done.md` with
`## Changed`, `## Deviations`, `## Not done`, `## Acceptance results`.

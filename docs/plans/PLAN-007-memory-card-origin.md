---
id: PLAN-007
title: Memory — what a card carries, and who put it there
branch: plan/m4-signal-coach-loop
base: master
status: ready
executor: unassigned
created: 2026-08-30
issue: https://github.com/nuvocode/verba/issues/53
milestone: M4 · Signal → Coach loop
---

# PLAN-007: what a card carries, and who put it there

## Context

`VocabItem` in `src/lib/model.ts` (§1.4) says a card carries a `type`, a
`sourceRef`, a `capturedBy` and a `levelBand`. The `vocab` table carries none of
them, so the deck cannot be filtered by type or source, a pronunciation note gets
the same visual treatment as an idiom, and — the invariant that matters —
nothing can stop the tutor auto-adding an A1 word to a B2 learner's deck
(invariant 16).

This plan puts those four fields on the row and puts one gate in front of the
one path that writes without being asked. It changes no screen; PLAN-008 renders
what this plan records.

Depends on PLAN-006. Work on `plan/m4-signal-coach-loop`, on top of PLAN-006's commit.

## Repo conventions

- **No new dependencies.**
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  and `src/lib/use*.ts` import views/libs **without** it (follow each file's
  existing imports — do not "fix" them).
- Checks are `*.check.ts`, run under `node --experimental-strip-types`, no DOM, no
  database, `node:assert`, ending in `console.log("<name>.check OK")`.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/vocab.ts` | EDIT | append after `suspect` |
| `src/lib/db.ts` | EDIT | the `vocab` CREATE TABLE; the ALTER block; `VocabRow`; `addVocab` |
| `src/lib/prompts.ts` | EDIT | `vocabPrompt`, `parseVocab` |
| `src/lib/useTalk.ts` | EDIT | the `addVocab` loop inside `end()` (~line 328) |
| `src/lib/useRead.ts` | EDIT | the `addVocab` call in the tap-to-save path (~line 191) |
| `src/lib/vocab.check.ts` | EDIT | append before the final `console.log` |
| `src/lib/invariants.check.ts` | EDIT | LEDGER row 16 |

## Specification

### src/lib/vocab.ts

Append, after `suspect`:

```ts
/**
 * How far below the learner an item has to sit before the tutor stops adding it
 * on their behalf (§2.5, invariant 16). Two bands: one band down is revision,
 * two is a word they are not going to thank anyone for.
 */
export const AUTO_ADD_BAND_GAP = 2;

/**
 * Should this item be kept out of the deck when nobody asked for it?
 *
 * Only ever consulted for `capturedBy: "coach"`. A learner who taps a word has
 * asked for it, and no gate outranks that. An item with no band is not evidence
 * of anything, so it passes — a missing measurement must not read as a low one.
 */
export function tooEasyToAutoAdd(itemBand: string | null | undefined, learnerLevel: string): boolean {
  const bands = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const item = bands.indexOf(String(itemBand ?? ""));
  const learner = bands.indexOf(learnerLevel);
  if (item === -1 || learner === -1) return false;
  return learner - item >= AUTO_ADD_BAND_GAP;
}
```

`vocab.ts` must stay free of imports — it is the one pure gate file, and
`vocab.check.ts` runs it with nothing loaded. The CEFR list is repeated here
rather than imported for that reason; add a `// ponytail:` comment saying so.

### src/lib/db.ts

1. Four columns on the `vocab` CREATE TABLE, after the `lapses` line PLAN-006 added:

```sql
      type TEXT NOT NULL DEFAULT 'word',       -- §1.4 VocabItem.type
      captured_by TEXT NOT NULL DEFAULT 'learner',
      source_surface TEXT NOT NULL DEFAULT '', -- §1.4 sourceRef.surface
      level_band TEXT,                         -- CEFR band of the item; NULL = never measured
```

2. Four matching migrations, directly under PLAN-006's `lapses` ALTER:

```ts
  // §1.4: a card knows what kind of thing it is, where it was met, who kept it and
  // roughly how hard it is. Rows written before this keep the defaults — "a word,
  // kept by the learner, from nowhere in particular" — which is what they were.
  await db.execute("ALTER TABLE vocab ADD COLUMN type TEXT NOT NULL DEFAULT 'word'").catch(() => {});
  await db.execute("ALTER TABLE vocab ADD COLUMN captured_by TEXT NOT NULL DEFAULT 'learner'").catch(() => {});
  await db.execute("ALTER TABLE vocab ADD COLUMN source_surface TEXT NOT NULL DEFAULT ''").catch(() => {});
  await db.execute("ALTER TABLE vocab ADD COLUMN level_band TEXT").catch(() => {});
```

3. `VocabRow` gains, after `lapses`:

```ts
  type: string;
  captured_by: string;
  source_surface: string;
  level_band: string | null;
```

4. `addVocab` takes where the card came from. New signature — every caller is
   updated in this plan, so there is no default and no optional origin:

```ts
export async function addVocab(
  lang: string,
  item: { term: string; translation: string; example: string; type?: string; levelBand?: string | null },
  origin: { capturedBy: "learner" | "coach"; surface: string; learnerLevel: string },
): Promise<boolean> {
```

Body, in order:

```ts
  if (!worthLearning(item).ok) return false;
  // invariant 16: the tutor does not put words two bands below the learner in
  // their deck. They may still add one themselves — that is what asking is.
  if (origin.capturedBy === "coach" && tooEasyToAutoAdd(item.levelBand, origin.learnerLevel)) return false;
```

then the existing `INSERT OR IGNORE`, widened to the new columns:

```sql
    `INSERT OR IGNORE INTO vocab (lang, term, translation, example, ease, interval, due, reps, lapses,
                                  type, captured_by, source_surface, level_band, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`
```

with `newCard.lapses`, `item.type ?? "word"`, `origin.capturedBy`,
`origin.surface`, `item.levelBand ?? null` in the matching positions. Keep the
`INSERT OR IGNORE` and its comment: an existing card keeps its review history.

Import `tooEasyToAutoAdd` from `./vocab.ts` next to the existing `worthLearning`
import.

### src/lib/prompts.ts

1. In `vocabPrompt`, replace the JSON-shape line with one that asks for the two
   new fields, and add one line of guidance after it:

```ts
    `Answer with ONLY a JSON object: { "items": [ { "term": "the ${s.profile.targetLanguage} word/phrase in its dictionary form", "translation": "its meaning in ${s.profile.nativeLanguage}", "example": "a short example sentence in ${s.profile.targetLanguage} that uses the term", "type": "word | phrase | phrasalVerb | idiom | collocation | pronunciation", "level": "the CEFR band of the item itself: A1, A2, B1, B2, C1 or C2" } ] }.`,
    `"level" is the difficulty of the item, not of the learner. Judge it honestly — a word far below their level will be left out rather than studied.`,
```

Leave every other line of the prompt, including the two the `lang.check.ts`
assertions match on ("Never leave it empty", "Never pick a proper name, a number,
a time"), byte-for-byte unchanged.

2. `parseVocab` returns the two new fields:

```ts
const VOCAB_TYPES = ["word", "phrase", "phrasalVerb", "idiom", "collocation", "pronunciation"];
const BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function parseVocab(raw: string): {
  term: string;
  translation: string;
  example: string;
  type: string;
  levelBand: string | null;
}[] {
```

Keep the existing extraction and the existing `worthLearning` filter exactly as
they are; map each surviving item through:

```ts
      type: VOCAB_TYPES.includes(String(it.type)) ? String(it.type) : "word",
      levelBand: BANDS.includes(String(it.level)) ? String(it.level) : null,
```

An unrecognised type is a word and an unrecognised band is "not measured" —
neither may throw, and neither may reject the card.

### src/lib/useTalk.ts

In `end()`, the loop over `parseVocab(vocabRaw)`. The tutor proposed these, so
they are coach-captured:

```ts
        const added = await addVocab(settings.profile.targetLanguage, it, {
          capturedBy: "coach",
          surface: "talk",
          learnerLevel: levelOf(settings.profile),
        }).catch(() => false);
```

`levelOf` is already imported in this file if it uses `levelOf(settings.profile)`
elsewhere; if not, add `import { levelOf } from "./model";` following the file's
existing import style. Everything else in `end()` — the `words.push`, the summary,
the memory write, the metrics write — stays exactly as it is.

### src/lib/useRead.ts

The tap-to-save path. The learner asked for this one:

```ts
    await addVocab(
      settings.profile.targetLanguage,
      { term: p.lemma, translation: p.gloss, example: p.sentence },
      { capturedBy: "learner", surface: "read", learnerLevel: levelOf(settings.profile) },
    ).catch(() => {});
```

Add the `levelOf` import if the file does not already have it. Do not add a level
band here: nothing measured this word's difficulty, and `null` says so.

### src/lib/vocab.check.ts

Append before the final `console.log`:

```ts
// invariant 16: the tutor does not stock a B2 deck with A1 words. The learner still can.
assert.equal(tooEasyToAutoAdd("A1", "B2"), true, "two bands down is not worth auto-adding");
assert.equal(tooEasyToAutoAdd("A2", "B2"), true, "exactly two bands down is the boundary, and it is closed");
assert.equal(tooEasyToAutoAdd("B1", "B2"), false, "one band down is revision, not noise");
assert.equal(tooEasyToAutoAdd("C1", "B2"), false, "above the learner is never too easy");
assert.equal(tooEasyToAutoAdd(null, "B2"), false, "an unmeasured item is not a low one");
assert.equal(tooEasyToAutoAdd("A1", "nonsense"), false, "an unreadable learner level gates nothing");
assert.equal(AUTO_ADD_BAND_GAP, 2, "the gap the copy and the gate both stand on");
```

Extend the file's import from `./vocab.ts` accordingly.

### src/lib/invariants.check.ts

Row 16 only:

```ts
  {
    id: 16,
    claim: "Öğrencinin seviyesinin iki bant altındaki öğeler otomatik eklenmez.",
    assertedIn: [{ file: "src/lib/vocab.check.ts", marker: "invariant 16" }],
  },
```

## Do not touch

- `migrateVocabToPerLanguage`, and any `DROP`/`RENAME`/backfill over `vocab`.
  Additive `ADD COLUMN … DEFAULT` is the only schema change permitted.
- `worthLearning` and `suspect` — the capture gate's rules do not change here.
  Widening or narrowing them is a different decision than this plan makes.
- `REVIEWABLE` in `db.ts`.
- Every prompt line in `vocabPrompt` other than the JSON-shape line and the one
  new line named above. `src/lib/lang.check.ts` matches two of them literally.
- `src/views/**` — no screen reads the new columns until PLAN-008.
- `package.json`, `package-lock.json`, `src-tauri/**`.

## Acceptance

```bash
npm run check                                            # 0 failed
node --experimental-strip-types src/lib/vocab.check.ts   # ends with the file's OK line
node --experimental-strip-types src/lib/lang.check.ts    # still green — the prompt assertions must survive
grep -c "ADD COLUMN" src/lib/db.ts                       # 10
grep -rn "addVocab(" src/lib src/views | grep -v "db.ts" # exactly 2 call sites, both passing an origin object
grep -n "capturedBy" src/lib/useTalk.ts src/lib/useRead.ts  # one "coach", one "learner"
```

## Manifest

When implementation is complete, write `docs/plans/PLAN-007.done.md` with the
sections `## Changed`, `## Deviations`, `## Not done`, `## Acceptance results`
(each command above with its real output pasted).

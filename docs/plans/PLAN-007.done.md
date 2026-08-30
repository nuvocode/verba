# PLAN-007 — done

## Changed

- `src/lib/vocab.ts` — appended `AUTO_ADD_BAND_GAP` and `tooEasyToAutoAdd` after
  `suspect`. The file stays import-free; a `// ponytail:` comment explains why the
  CEFR list is repeated here.
- `src/lib/db.ts` — four columns on the `vocab` CREATE TABLE (`type`,
  `captured_by`, `source_surface`, `level_band`); four additive
  `ALTER TABLE … ADD COLUMN … DEFAULT` migrations under PLAN-006's `lapses`;
  `VocabRow` widened; `addVocab` takes an `origin` object and gates coach writes
  through `tooEasyToAutoAdd` (invariant 16). Imported `tooEasyToAutoAdd` next to
  `worthLearning`.
- `src/lib/prompts.ts` — `vocabPrompt` JSON-shape line asks for `type` and `level`,
  plus one guidance line; `parseVocab` returns `type` and `levelBand`, mapping an
  unrecognised type to `"word"` and an unrecognised band to `null`. All other prompt
  lines byte-for-byte unchanged.
- `src/lib/useTalk.ts` — the wrap-up `addVocab` loop passes a coach origin
  (`capturedBy: "coach"`, `surface: "talk"`, `learnerLevel: levelOf(...)`); added
  the `levelOf` import.
- `src/lib/useRead.ts` — the tap-to-save `addVocab` passes a learner origin
  (`capturedBy: "learner"`, `surface: "read"`, `learnerLevel: levelOf(...)`); no
  level band set (nothing measured it).
- `src/lib/vocab.check.ts` — appended the invariant 16 assertions and extended the
  import.
- `src/lib/invariants.check.ts` — LEDGER row 16 now `assertedIn` `vocab.check.ts`
  with marker `invariant 16`.

## Deviations

None. The plan was applied as written.

## Not done

- No screen reads the new columns — that is PLAN-008.
- `migrateVocabToPerLanguage`, `worthLearning`, `suspect`, `REVIEWABLE`,
  `src/views/**`, `package.json`, `package-lock.json`, `src-tauri/**` untouched.

## Acceptance results

```bash
npm run check
# ✓ version 0.4.0 in all three files
# ✓ manifest self-check
# ✓ src/lib/backup.check.ts … src/lib/weakness.check.ts
# 32 check files, 32 passed, 0 failed

node --experimental-strip-types src/lib/vocab.check.ts
# vocab.check.ts — all assertions passed

node --experimental-strip-types src/lib/lang.check.ts
# lang.check ✓

grep -c "ADD COLUMN" src/lib/db.ts
# 10

grep -rn "addVocab(" src/lib src/views | grep -v "db.ts"
# src/lib/useTalk.ts:330:        const added = await addVocab(settings.profile.targetLanguage, it, {
# src/lib/useRead.ts:191:    await addVocab(

grep -n "capturedBy" src/lib/useTalk.ts src/lib/useRead.ts
# src/lib/useTalk.ts:331:          capturedBy: "coach",
# src/lib/useRead.ts:194:      { capturedBy: "learner", surface: "read", learnerLevel: levelOf(settings.profile) },
```

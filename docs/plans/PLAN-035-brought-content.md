---
id: PLAN-035
title: The learner's own text, used as material
branch: plan/m6-repair-layer
base: master
status: todo
executor: unassigned
created: 2026-09-01
issue: https://github.com/nuvocode/verba/issues/67
milestone: M6 · Repair layer
---

# PLAN-035: brought content

## Context

Spec §7.2. The other half of "material from your own life".

The learner has an email from a client, an article they want to read, a transcript
of a call. Today Verba has no way to accept any of it: Read generates its own
passage, Listen generates its own chapter, and the learner's actual reading is
somewhere else, being pasted into a translator.

The two rules that make this Verba rather than a translator:

- **It stays local.** The text is the learner's, often someone else's business, and
  frequently a private thing. It is processed on the machine by default and is
  stored no further than the machine.
- **It is conversation material, not a translation job.** The coach reads it, talks
  about it, asks the learner to say what it means in their own words. Answering
  "what does this say?" with a translated paragraph teaches nothing and is a
  service Verba is not.

Depends on PLAN-034 only for order. Work on top of its commit.

## Repo conventions

- **No new dependencies.** No file-format library: plain text and paste. A PDF
  parser is a different plan and probably a different product.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/brought.ts` | NEW | `BroughtText`, `ingest`, `discussionSystem`, limits |
| `src/lib/brought.check.ts` | NEW | the cases below |
| `src/lib/db.ts` | EDIT | `brought_texts` table |
| `src/views/Read.tsx` | EDIT | the entry point and the discussion mode |
| `src/lib/useRead.ts` | EDIT | a passage that came from the learner |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` row 19 |

## Specification

### Getting it in

Two ways, both boring: paste into a text area, or open a `.txt` / `.md` file through
the dialog plugin Verba already ships. No fetch-by-URL — that is a network request
on the learner's behalf, about content we have not seen, and §7.2's first rule is
that this stays local.

```ts
export interface BroughtText {
  id: number;
  lang: string;
  title: string;     // the learner's own, or the first line
  body: string;
  createdAt: number;
}
export const BROUGHT_MAX_CHARS = 8000;
```

Longer than `BROUGHT_MAX_CHARS` and the learner is asked to choose a part — Read
already deals in passages, and a 40-page document is not one. The limit is stated
before they paste, not after.

### Where it lives

A new table, because none of the existing ones fit and forcing it into
`reading_sessions` would mean generated and brought text sharing a shape they do not
share:

```sql
CREATE TABLE IF NOT EXISTS brought_texts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lang TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

Scoped to a language like every other table. Deletable from the same place it is
listed — one row, one delete, no soft-delete. It joins the backup path
(`backup.ts`) like the rest, and the DataPanel lists it, because a learner must be
able to see everything of theirs Verba is holding.

**Local by default** is a real constraint, not a label: with a cloud provider
selected, sending a brought text to it is a network egress of the learner's private
document, so the entry point states plainly which provider will read it and refuses
silently sending it anywhere the learner did not choose. With `settings.offline`, or
a local provider, no confirmation is needed. With a cloud provider, the learner
confirms once per text, and the confirmation names the provider.

### What the coach does with it

`discussionSystem(text, settings, pack)` — the coach has read it, and:

- **asks before it explains.** The opening move is a question about the text, not a
  summary of it;
- **asks for the learner's own words.** "Tell me what this part is asking for" is
  the shape of the session;
- **translates a word when asked, not a paragraph.** A request for the whole thing
  in the native language gets one honest sentence of gist and a question back;
- **stays in the target language** except for single-word glosses.

Unknown words the learner asks about go to Memory through the existing vocab save
path with `source_surface` naming this text, so §7.2's last clause holds: the words
come back in later plans, from the learner's own material, which is the strongest
version of spaced repetition Verba has.

The whole M6 layer applies here — breakdown signals, the inventory, rewinds. A
learner reading their own difficult email is precisely where repair matters.

### Checks

`brought.check.ts`:
1. `ingest` rejects a text over `BROUGHT_MAX_CHARS` with a message naming the limit,
   and accepts one at exactly the limit.
2. `ingest` derives a title from the first line when the learner gives none, and
   never produces an empty title.
3. Round-trip through the table preserves the body byte for byte, including
   newlines and non-ASCII.
4. `discussionSystem` contains the ask-before-explaining rule and the
   no-bulk-translation rule; a seeded prompt missing either fails.
5. Words saved from a brought text carry a `source_surface` that identifies it.
6. Source scan: no code path sends a `brought_texts` body to a network provider
   without the confirmation flag set. Probed with a seeded violation.
7. `brought_texts` appears in the backup export and in the DataPanel's list.

## Do not touch

- The generated-passage flow in `useRead.ts`. Brought text is a second source, not a
  replacement, and the quality gates on generated passages are not applied to the
  learner's own writing — it is not ours to grade.
- `migrateVocabToPerLanguage`.
- No new dependency, and no new file format.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` row 19 asserted.
- Pasting a work email produces a conversation about it, in the target language,
  that starts with a question.
- Asking for a full translation gets a gist and a question, not a translation.
- The text is listed, exportable and deletable from the data screen.
- With a cloud provider selected, the learner is told who will read it before it is
  sent.

## Commit

```
feat(read): bring your own text, kept local and talked about (PLAN-035)
```

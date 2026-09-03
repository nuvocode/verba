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

Lands on top of PLAN-034's commit (`3cc2896`).

## Repo conventions

- **No new dependencies.** No file-format library: plain text and paste. A PDF
  parser is a different plan and probably a different product.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/brought.ts` | NEW | `BroughtText`, `ingest`, `broughtScenario`, `discussionSystem`, limits |
| `src/lib/brought.check.ts` | NEW | the cases below |
| `src/lib/db.ts` | EDIT | `brought_texts` table, and its reads/writes |
| `src/lib/backup.ts` | EDIT | `TABLES` and the `Summary` counts |
| `src/lib/backup.check.ts` | EDIT | the completeness case below |
| `src/lib/useTalk.ts` | EDIT | the discussion mode |
| `src/views/Read.tsx` | EDIT | the entry point: paste, open, list, delete |
| `src/views/DataPanel.tsx` | EDIT | brought texts in the count |
| `src/lib/prompts.ts` | EDIT | the prompt lists gain `discussionSystem` |
| `src/lib/invariants.check.ts` | EDIT | `REPAIR_LEDGER` row 19 |

## Specification

### Where the discussion actually happens

The draft of this plan put the discussion in `Read.tsx` / `useRead.ts`, and in the
same breath said *"the whole M6 layer applies here — breakdown signals, the
inventory, rewinds"*. **Those two cannot both be true.** Breakdown detection, the
repair inventory, the rewind, the wait and the praise gate all live in `useTalk`;
`useRead` has none of them and would need a second copy of every one.

PLAN-034 already settled the shape for this: a synthetic scenario, a mode, and the
mode's own system prompt, with the loop untouched. Brought text is the second
instance of exactly that pattern.

So the plan splits along the seam it actually has:

- **Read** owns getting the text in, listing it, and deleting it. That is where a
  learner looks for their own reading material.
- **Talk** owns the discussion. `broughtScenario(text)` builds the synthetic
  scenario, `start(sc, "brought", …)` opens it, and `discussionSystem` is the
  system prompt. Every M6 behaviour then applies for free, because it is a Talk
  session — which is what §7.2's last paragraph is asking for.

### Getting it in

Two ways, both boring: paste into a text area, or open a `.txt` / `.md` file
through `@tauri-apps/plugin-dialog`, which the app already ships. No fetch-by-URL —
that is a network request on the learner's behalf, about content we have not seen,
and §7.2's first rule is that this stays local.

```ts
export interface BroughtText {
  id: number;
  lang: string;
  title: string;     // the learner's own, or the first line
  body: string;
  createdAt: number;
  /** The provider the learner approved for this text, or "" — see below. */
  sentTo: string;
}
export const BROUGHT_MAX_CHARS = 8000;
```

Longer than `BROUGHT_MAX_CHARS` and the learner is asked to choose a part — Read
already deals in passages, and a 40-page document is not one. The limit is stated
before they paste, not after.

### Where it lives

A new table, because none of the existing ones fit and forcing it into
`reading_sessions` would mean generated and brought text sharing a shape they do
not share:

```sql
CREATE TABLE IF NOT EXISTS brought_texts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lang TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_to TEXT NOT NULL DEFAULT ''
);
```

Scoped to a language like every other table. Deletable from the same place it is
listed — one row, one delete, no soft-delete.

`backup.ts` has one list, `TABLES`, and it drives export, import **and** the wipe;
`brought_texts` joins it, and `Summary` / `counts` gain a line so the DataPanel
counts what the learner would be giving up. A learner must be able to see
everything of theirs Verba is holding.

### Local by default, and what that costs

**Local by default** is a real constraint, not a label: with a cloud provider
selected, opening a discussion sends the learner's private document to that
provider. So the discussion cannot start until the learner has been told who will
read it.

- `settings.offline`, or `isLocalProvider(settings.provider)` — no confirmation.
  Nothing leaves the machine.
- Otherwise the learner confirms once per text, and the confirmation **names the
  provider**. The approval is recorded in `sent_to`, so it survives a restart and
  so that changing provider asks again — an approval for Ollama is not an approval
  for Anthropic.

This is a runtime rule about a value, and a source scan cannot see it. PLAN-034
learned that the expensive way: `if (!rehearsal)` was in the source and always
false at runtime. So this one is pinned from behaviour — see case 6.

### What the coach does with it

`discussionSystem(settings, text, scenario, pack)` — the coach has read it, and:

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

#### The prompt lists (PLAN-033)

`discussionSystem` does not end in `Prompt`, so `allPromptNames`'s scan will not
find it — hand-add it, as `buildSystem` and `rehearsalSystem` already are, or the
completeness claim quietly misses the prompt this plan adds.

It goes in the **spoken** list and carries `styleGuidance`. This is the opposite
call from `rehearsalSystem` and for the opposite reason: in a rehearsal there is no
coach, only the other party; here the coach is the coach, reading the learner's
email with them.

#### The difficulty axis stays on

Worth stating, because the rehearsal precedent points the other way. A rehearsal
switches the axis off because manufacturing a breakdown in a dress rehearsal is
sabotage. Here the argument is weaker than it looks: the axis governs *the coach's
own replies*, not the text, and the learner's difficult email is not made easier by
the coach also being careful. PLAN-031's in-session drowning drop is the safety
valve, and it already fires on exactly the learner this would hurt.

Leaving it on also avoids inventing a second calibration-exclusion path beside
PLAN-034's `rehearsal` marker. If it turns out wrong in use, the fix is one marker
and one line in `recapsFrom` — cheap later, and speculative now.

### Checks

`brought.check.ts`:

1. `ingest` rejects a text over `BROUGHT_MAX_CHARS` with a message naming the
   limit, and accepts one at exactly the limit.
2. `ingest` derives a title from the first line when the learner gives none, never
   produces an empty title, and does not put the whole first paragraph in it.
3. Round-trip through `ingest` preserves the body byte for byte, including
   newlines, tabs and non-ASCII. The learner's text is not ours to normalise.
4. `discussionSystem` carries the ask-before-explaining rule and the
   no-bulk-translation rule, and carries `styleGuidance`. Each absence probed
   against a seeded violation.
5. `broughtScenario` embeds the text's title but **not** its body in the scenario
   — the body rides the system prompt once, not twice, and a scenario is written
   to no store here.
6. **Behavioural:** with a cloud provider and no recorded approval, opening the
   discussion sends nothing — drive the real hook the way `rehearsal.check.ts`
   case 4 does (its loader and mocks already exist; reuse them, do not build a
   second harness) and assert the mock provider recorded **zero** calls. With
   `settings.offline`, or with `sent_to` matching the current provider, exactly
   one call is recorded and its system prompt contains the body.
7. Words saved from a brought text carry a `source_surface` that identifies it.
8. `brought_texts` is in `TABLES`, so it exports, imports and wipes; and the
   DataPanel's count includes it.
9. `discussionSystem` is in exactly one prompt list and `prompts.check`'s
   completeness case still passes — meaning it was hand-added to the scan.

`backup.check.ts`:

10. **Completeness:** every `CREATE TABLE IF NOT EXISTS` in `db.ts` appears in
    `TABLES`. There is no such check today — the eleven tables happen to all be
    listed, and nothing would notice the twelfth. A table added later and left out
    of the backup is data the learner cannot export, cannot restore and cannot
    delete, which is the one class of bug this app must not ship. Probe it with a
    fabricated table name so the scan cannot pass vacuously.

**On the checks themselves.** Case 6 is the one that matters and the one that will
be written wrong: a source scan for `isLocalProvider` proves nothing. Drive it, and
verify by removing the guard and watching it go red.

## Do not touch

- The generated-passage flow in `useRead.ts`. Brought text is a second source, not
  a replacement, and the quality gates on generated passages are not applied to the
  learner's own writing — it is not ours to grade.
- `migrateVocabToPerLanguage`.
- PLAN-034's rehearsal mode. This adds a second mode beside it; it does not change
  the first.
- No new dependency, and no new file format.

## Acceptance

- `npm run check` green; `REPAIR_LEDGER` row 19 asserted.
- Pasting a work email produces a conversation about it, in the target language,
  that starts with a question.
- Asking for a full translation gets a gist and a question, not a translation.
- The text is listed, exportable and deletable from the data screen.
- With a cloud provider selected, nothing is sent until the learner has been told
  who will read it, and switching provider asks again.

## Commit

```
feat(read): bring your own text, kept local and talked about (PLAN-035)
```

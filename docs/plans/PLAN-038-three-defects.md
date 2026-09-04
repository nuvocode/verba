---
id: PLAN-038
title: Three defects the learner sees
branch: fix/038-three-defects
base: master
status: ready
executor: unassigned
created: 2026-09-04
milestone: post-M6 · defects
---

# PLAN-038: three defects

## Context

Three reports from the app, all on surfaces the learner reads. None of them is a new
feature; each is a small, located defect with a root cause already identified in the
code. Do these three and nothing else.

1. **Read → comprehension check is unusable.** The multiple-choice options render as
   empty pills, so nothing can be selected, so "Check answer" is permanently disabled —
   and the disabled button itself fills the screen as a grey block.
2. **Talk → the wrap-up repeats corrections.** "Worth revisiting" shows the same
   `original → fixed` pair two or more times (screenshot: *I went to doctor →
   I went to the doctor*, twice, with the same note).
3. **Today → the day number is one behind.** A learner on their second day reads
   "Day 1"; a first day reads "Day 0".

## Repo conventions

- **No new dependencies.** No new files except the one check file named below.
- `npm run check` (tsc + `scripts/check.mjs`) must be green at the end.
- A model may classify what the learner did; it may never author it. The gates that
  already enforce this are `verifyRepair` (repair.ts) and `praiseGate` (patience.ts) —
  defect 2's fix is the same shape and belongs beside them, not inside `parseTurn`,
  which only ever checks shape.
- Keep the house comment voice: say *why*, mark a deliberate ceiling with
  `// ponytail:`.

---

## Defect 1 — the reading check

### Root cause

Two independent bugs in the same screen.

**1a. The options are read through the wrong type.**
`src/views/QuestionCard.tsx:34`:

```ts
const opts = q.options as ListenOption[] | undefined;
```

Listening passes `ListenOption[]` (`{ text, why }`). Reading passes the shared
`Question` from `lib/questions.ts`, whose `options` is **`string[]`**
(`src/lib/questions.ts:19`, built by `parseQuestions`). The cast is a lie for the
reading caller: `opt.text` is `undefined`, so every chip renders empty and
`onChange(undefined)` never sets an answer — which is why "Check answer" stays
disabled and the learner is stuck.

**1b. The button is a stretched grid item.**
`.listen` is `display: grid; grid-template-rows: auto minmax(0,auto) minmax(0,1fr)`
(`src/theme.css:534`). `ReadingCheck` puts `.listen-head` in row 1, `.listen-qs` in
row 2, and then the bare `<button className="btn">` becomes the row-3 item — so the
button stretches to fill `1fr`. That is the grey block. `Listening.tsx` does not have
this problem because everything below the head lives inside one `.listen-work` div.

### The fix

**`src/lib/questions.ts`** — add one exported helper next to the model (a `.tsx` file
cannot be imported by a `.check.ts`, so the normalisation lives here where it can be
tested):

```ts
/**
 * The options as a card renders them. Reading's shared questions carry plain
 * strings; listening's carry `{ text, why }`. One shape out, so the card reads
 * `.text` for both and neither caller has to know about the other.
 */
export function optionList(options?: (string | { text: string })[]): { text: string }[] {
  return (options ?? []).map((o) => (typeof o === "string" ? { text: o } : o));
}
```

**`src/views/QuestionCard.tsx`** — replace the cast with the helper:

```ts
const opts = optionList(q.options as (string | ListenOption)[] | undefined);
```

Nothing else in the component changes; it already only reads `opt.text`.
(`Listening.tsx` keeps reading `q.options` directly for `why` — leave it alone.)

**`src/views/read/ReadingCheck.tsx`** — wrap everything *after* `.listen-qs` in a
single `<div className="listen-work">`, the way `Listening.tsx` does: the
`!stepChecked` fragment, the "Next question" branch, the `.listen-after` branch, and
the skip-check block all go inside that one div. `.listen-head` and `.listen-qs` stay
as they are. Add the short comment saying why the wrapper exists (row 3 is `1fr`; a
bare button placed there stretches to fill the screen).

### Acceptance

- Finish a reading passage; the check's mcq options show their text and are clickable.
- Picking an option enables "Check answer"; grading works through all questions to
  "Back to today".
- No full-width grey block anywhere on the screen, in light and dark.
- A cloze question still renders its input and still scores.

### Check

Extend **`src/lib/questions.check.ts`** (do not create a new file):

```ts
// The card reads one option shape; reading's strings and listening's objects both
// have to arrive as `{ text }` — a plain string read as `{text}` renders an empty chip.
assert(optionList(["Ana", "Luis"])[0].text === "Ana", "plain string options carry their text");
assert(optionList([{ text: "Ana", why: "x" } as any])[0].text === "Ana", "object options pass through");
assert(optionList(undefined).length === 0, "no options is an empty list, never a throw");
```

---

## Defect 2 — repeated corrections in the wrap-up

### Root cause

`src/lib/useTalk.ts:1594` builds the wrap-up list as
`msgs.flatMap((m) => m.corrections)`, and each turn's corrections come straight from
`parseTurn`. The turn prompt (`src/lib/prompts.ts`, the `Rules:` block around line 100)
scopes `repair`, `missed`, `goalsMet` and `keyWord` to the learner's **LAST** message —
but says nothing of the sort about `corrections`. The model sees the whole history and
re-corrects a sentence from three turns ago, so the same pair is attached again to a
message that never contained it, and the wrap-up prints it twice.

This is not only cosmetic: the duplicates inflate the "corrections" stat, the
`computeMetrics` correction count, and `talkSignals`' correction signals — which are
the evidence Coach counts to three before naming a weakness.

### The fix — two parts, prompt and gate

**Part A — say it in the prompt.** `src/lib/prompts.ts`, in the same `Rules:` list,
directly after the existing `- Only add a correction for a real ... mistake.` line:

```
- Correct ONLY the learner's LAST message. Never re-correct wording from an earlier turn — it was already shown, and repeating it wastes the wrap-up.
```

**Part B — enforce it in code**, because a rule in a prompt is a request. Add to
`src/lib/prompts.ts`, immediately after `parseTurn` (which ends at line 338), the gate
the `missed` field already models inside `parseTurn` ("a label reported twice must not
satisfy the two-signal condition"):

```ts
/**
 * The gate that turns reported corrections into believed ones — the same bargain as
 * `verifyRepair` (repair.ts): the model may say what was wrong with the learner's
 * words, but it may never correct words the learner did not just write. `parseTurn`
 * only checks shape; it cannot see the message. A correction whose `original` is not
 * literally in this turn's message — after case, punctuation and whitespace folding —
 * is a re-correction of an earlier turn, and is dropped. Repeats within one turn are
 * dropped too: one mistake is one correction.
 */
export function verifyCorrections(reported: Correction[], msg: string, locale: string): Correction[] {
  // The same folding as `repairNorm` (repair.ts) and `norm` (questions.ts).
  const fold = (s: string) => s.toLocaleLowerCase(locale).replace(/\p{P}/gu, "").replace(/\s+/g, " ").trim();
  const said = fold(msg);
  const seen = new Set<string>();
  const kept: Correction[] = [];
  for (const c of reported) {
    const original = fold(c.original);
    if (!original || !said.includes(original)) continue; // never written this turn → not a correction of it
    const key = `${original}→${fold(c.fixed)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(c);
  }
  return kept;
}
```

**Wire it in `src/lib/useTalk.ts`, in `send`**, beside the existing `verifyRepair`
call (line 1350) but *before* the corrections are used. Today the turn's corrections
are read three times — for `worst` (~line 1286), for `setMsgs` (~line 1297) and
nowhere else. Compute the kept list once, right after `parseTurn`:

```ts
// PLAN-038: the corrections that survive the gate. A model that re-corrects an
// earlier turn is dropped here, so the rail, the wrap-up, the metrics and the
// signals all count one mistake once.
const corrections = rehearsal
  ? []
  : verifyCorrections((turn as { corrections?: Correction[] }).corrections ?? [], msg, pack?.speech.locale ?? "en");
```

and use `corrections` in both places (`worst` becomes
`corrections.find((c) => c.severity === "severe") ?? corrections[0]`, and the message
gets `corrections`). `correctionRecords.current` is the *past* record loaded at
session start — do not touch it.

### Acceptance

- A session where the model re-corrects an earlier sentence shows that pair once in
  "Worth revisiting", and the "corrections" stat counts it once.
- A learner who genuinely makes the same mistake again in a later message is still
  corrected again — that message contains the words, so the gate keeps it.
- Rehearsal mode still shows no corrections at all.

### Check

New file **`src/lib/corrections.check.ts`** (imports `verifyCorrections` from
`./prompts.ts`; runner picks it up automatically):

- a correction whose `original` is in the message survives;
- the same pair reported twice in one turn survives once;
- a correction quoting a sentence from an earlier turn (not in `msg`) is dropped;
- case and punctuation do not decide it (`"I went to doctor."` vs `i went to doctor`);
- an empty `original` is dropped;
- assert the prompt rule is actually in the turn prompt (the `LAST message` line), the
  way `reading.check.ts` asserts prompt text.

---

## Defect 3 — the day number is one behind

### Root cause

`src/lib/db.ts:802`:

```ts
const rows = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM daily_sessions WHERE lang = $1", [lang]);
return rows[0]?.n ?? 1;
```

It counts the rows that exist. `useDay` calls it on the **fresh** path
(`src/lib/useDay.ts:190`), *before* `saveDailySession` writes today's row — so today
is never in the count. First day: `0`. Second day: `1`. The `?? 1` never fires:
`COUNT(*)` returns `0`, not null.

### The fix

Count the days *before* today and add today:

```ts
export async function dayNumber(lang: string, date: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM daily_sessions WHERE lang = $1 AND date < $2",
    [lang, date],
  );
  // Today's row is not written until the plan is saved, and on a rebuild it already
  // is — counting strictly-earlier days makes both paths give the same number.
  return (rows[0]?.n ?? 0) + 1;
}
```

Update the doc comment above it (it currently explains the count, and the count is now
"the days before this one, plus this one"). Pass the date at the one call site:
`dayNumber(settings.profile.targetLanguage, date)` — `date` is already in scope in that
effect.

`progressByLang` counts finished days and is correct as it stands; leave it.

### Acceptance

- A fresh install shows `Day 1` on the first day.
- With one earlier `daily_sessions` row in the target language, Today shows `Day 2`.
- "another topic" (a rebuild on the same day, which runs the fresh path with today's
  row already on disk) does **not** bump the number.
- Switching target language shows that language's own count, not the other's.

### Check

There is no `db.check.ts` and this needs a real SQL store, so **no check file** — the
query is one line and the acceptance is observable in the app. Verify it there, not by
reading the code back.

---

## Verification (all three)

1. `npm run check` — green, including the new/extended check files.
2. Run the real app (the `verify` skill) and confirm defects 1 and 3 on screen: a
   reading check with selectable options and no grey block, and a correct `Day N` in
   Today's eyebrow. A green check has hidden a broken claim on this repo before —
   defects 1 and 3 are not done until they have been *seen*.
3. Defect 2 is deterministic only in its check; if a live session happens to produce a
   repeat, confirm it appears once.

## Out of scope

- `.listen-conditions` sits in an implicit grid row in `Listening.tsx` (the 3-row
  template predates PLAN-036). It renders fine. Leave it.
- The three near-identical string-folding helpers (`norm`, `repairNorm`, and the new
  `fold`). Merging them into `text.ts` is a separate cleanup, not this branch.
- Any change to how corrections are grouped, scored, or shown inline.

## Commit

One commit per defect, in this order, on `fix/038-three-defects`:

- `fix(read): the check's options are readable and the button is not a wall (PLAN-038)`
- `fix(talk): a correction the learner did not just write is not a correction (PLAN-038)`
- `fix(today): day one is Day 1 (PLAN-038)`

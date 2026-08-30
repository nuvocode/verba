---
id: PLAN-014
title: Weakness → tomorrow's activity, as a data link
branch: plan/m4-signal-coach-loop
base: master
status: ready
executor: unassigned
created: 2026-08-30
issue: https://github.com/nuvocode/verba/issues/52
milestone: M4 · Signal → Coach loop
---

# PLAN-014: weakness → tomorrow's activity

## Context

Most of this epic is built. `weaknessesFrom` declares a weakness only at three
pieces of evidence, `addressed()` hides any weakness the plan has no slot for,
`Weakness.addressedBy` names real `PlannedActivity` ids, and `weakness.check.ts`
already asserts invariant 6 end to end — including that the drill reaches the
activity as its `goal`.

Two of the epic's done-whens are not met:

**Every card says the same thing.** `Coach.tsx` renders each weakness as
`{n} slips so far. Tomorrow's plan drills it in {activities}.` — one template,
three cards, so a learner reads the same sentence three times with a different
noun in it. §2.6 asks for *what was observed → the evidence → what tomorrow does
about it*, per card, with no repetition between cards.

**Tomorrow's rationale does not refer back.** Only the `talk` activity's
rationale mentions the drill ("Yesterday {drill} gave you trouble"). Read and
Listen carry the goal in their prompt but their rationale says nothing about why
they are drilling it, so the promise Coach made yesterday is invisible on Today.

This is the last plan of M4 and it closes the loop.

Depends on PLAN-013. Work on `plan/m4-signal-coach-loop`, on top of PLAN-013's commit.

## Repo conventions

- **No new dependencies.**
- Weaknesses are **derived, never stored** (`src/lib/weakness.ts` header). Do not
  add a table, a settings field or a cache for them.
- Nothing on a screen composes a sentence: the card copy is a pure function in
  `src/lib/weakness.ts`, checked in `weakness.check.ts`.
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  import **without** it.
- Checks: `*.check.ts`, `node --experimental-strip-types`, no DOM, no DB.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/weakness.ts` | EDIT | append after `addressed` |
| `src/lib/learn.ts` | EDIT | the `read` and `listen` activities inside `buildDailyPlan` |
| `src/views/Coach.tsx` | EDIT | the weakness cards block |
| `src/lib/weakness.check.ts` | EDIT | append before the final `console.log` |

## Specification

### src/lib/weakness.ts

One function, and it is the card:

```ts
/**
 * A weakness card, in the three parts §2.6 asks for: what was observed, what the
 * evidence is, and what tomorrow does about it.
 *
 * Each part is a function of *this* weakness — its category, its trend, its own
 * count of signals and its own activities. Two cards on one screen therefore
 * cannot read the same, which is the failure this replaces: one template rendered
 * three times says nothing about any of the three.
 */
export interface WeaknessCard {
  observed: string;  // what is going wrong, in the learner's terms
  evidence: string;  // how many signals, over what
  plan: string;      // which activity tomorrow, named
}

export function weaknessCard(w: Weakness, activityTitles: Record<string, string>): WeaknessCard
```

**`observed`** — one sentence chosen by `category`, with `trend` folded in. Six
categories × four trends is a table nobody can keep honest, so: one sentence per
category, and the trend appended as a clause only when it is `worsening` or
`improving`:

| category | observed |
|---|---|
| `grammar` | `` `You are being corrected on ${label}.` `` |
| `lexis` | `` `${label} is not landing yet — you meet it and it does not stay.` `` |
| `pronunciation` | `` `${label} is coming out differently from the way it is said.` `` |
| `fluency` | `` `${label} is where your turns slow down.` `` |
| `pragmatics` | `` `${label} is right in form but reads wrong in the situation.` `` |

Trend clause: `worsening` → `" It has been happening more lately."`;
`improving` → `" It is happening less than it was."`; `flat` and `new` → nothing.

**`evidence`** — `` `${n} ${n === 1 ? "slip" : "slips"} on record` `` for
`severity`/`evidence.length`, plus `", the first of them today"` when `trend` is
`"new"`. Never a percentage: the evidence is a count of signals and it is
countable back to rows.

**`plan`** — names the activities by title, not by id:
`` `Tomorrow's ${list} ${titles.length === 1 ? "is built" : "are built"} around it.` ``
where `list` is the serial list of `activityTitles[id]`, falling back to the id
when a title is missing. Reuse the serial-list helper rather than writing a second
one — `list()` in `learn.ts` is not exported, so either export it and import it
here, or move it to a place both can reach. Do not copy it.

### src/lib/learn.ts

Read and Listen say why they are drilling what they are drilling, when they are:

```ts
    planActivity({
      id: "read",
      kind: "read",
      title: "Reading",
      rationale: readGoal
        ? `The passage works ${readGoal} back in — you keep slipping on it, and reading it in someone else's sentences is the gentlest way to meet it again.`
        : `The passage reuses the words you just used about ${theme}, so you meet them again in someone else's sentences.`,
      estimatedMinutes: 5,
      dependsOn: "talk",
      goal: readGoal,
    }),
```

```ts
      planActivity({
        id: "listen",
        kind: "listen",
        title: "Listening",
        rationale: listenGoal
          ? `Listening closes the day on input, and this one is picked to put ${listenGoal} in your ear rather than in your mouth.`
          : "Listening closes the day on input, so the last thing you do is understand rather than produce.",
        estimatedMinutes: 6,
        goal: listenGoal,
      }),
```

Leave `talk`'s rationale as it is — it already refers back.

`planActivity` throws on an empty rationale (invariant 5), and both branches above
are non-empty for every input, including an empty-string goal. Do not weaken that
guard.

### src/views/Coach.tsx

Replace the weakness card body. The heading, the `addressed(day.weaknesses)` gate
and the empty state stay exactly as they are:

```tsx
          {addressed(day.weaknesses).map((w) => {
            const card = weaknessCard(w, titles);
            return (
              <div className="weak" key={w.id}>
                <h3>{w.label}</h3>
                <p>{card.observed}</p>
                <p className="ev">{card.evidence}</p>
                <p>{card.plan}</p>
              </div>
            );
          })}
```

with, above the block:

```ts
  // Titles come from tomorrow's plan through the day, so a card names the activity
  // the learner will actually see rather than an id from the model.
  const titles = Object.fromEntries((day.plan?.activities ?? []).map((a) => [a.id, a.title]));
```

Add a `.weak .ev` rule to `src/theme.css` in the file's existing single-line
style: small, `var(--ink3)`, letter-spaced — the evidence is a footnote, not a
headline.

### src/lib/weakness.check.ts

Append before the final `console.log`:

1. **No two cards read alike.** Build four weaknesses across four different
   categories with different trends and severities, render each through
   `weaknessCard`, and assert the set of `observed` strings has the same size as
   the list — and the same for `evidence` + `plan` joined. Mark it
   `// invariant 6 — one card, one argument`.
2. Every part of every card is non-empty, and none of them contains `undefined`,
   `NaN`, or a raw activity id when a title was supplied.
3. `evidence` says "3 slips" for three signals and "1 slip" for one, and mentions
   today only when `trend === "new"`.
4. A weakness whose `addressedBy` names an id with no title falls back to the id
   rather than rendering `undefined`.
5. **The round trip.** For a plan built from the declared weaknesses, every
   `addressedBy` id resolves to an activity whose `rationale` contains that
   weakness's label. This is the epic's last done-when — Coach promises it, Today
   says it back — and it is the assertion to write first.

## Do not touch

- `weaknessesFrom`, `trendOf`, `CATEGORY`, `MIN_WEAKNESS_EVIDENCE`, `addressed`,
  `DRILL_SLOTS`, `drillGoals`. The derivation is correct; only the copy over it
  changes.
- The existing invariant 6 assertions in `weakness.check.ts` — extend the file,
  do not rewrite it.
- `Coach.tsx`'s metrics, headline, wins, momentum chart and CEFR rail
  (PLAN-010 and PLAN-011).
- `talk`'s rationale in `buildDailyPlan`.
- `package.json`, `package-lock.json`, `src-tauri/**`.

## Acceptance

```bash
npm run check                                                # 0 failed
node --experimental-strip-types src/lib/weakness.check.ts    # ends "weakness.check OK"
node --experimental-strip-types src/lib/learn.check.ts       # still green — rationales stay non-empty
grep -n "slips so far" src/views/Coach.tsx                   # no hits
grep -c "weaknessCard" src/views/Coach.tsx src/lib/weakness.ts   # >= 1 each
npm run build                                                # succeeds
```

Then, in the running app, on a profile with at least three recorded slips of the
same kind: open Coach and confirm each weakness card argues its own case, then
open Today and confirm the named activity's rationale mentions that weakness.

## Manifest

When implementation is complete, write `docs/plans/PLAN-014.done.md` with
`## Changed`, `## Deviations`, `## Not done`, `## Acceptance results`.

This is the last plan of M4. In the manifest, also list which of issues #50–#54
you believe are now fully satisfied and which done-when boxes, if any, you could
not tick.

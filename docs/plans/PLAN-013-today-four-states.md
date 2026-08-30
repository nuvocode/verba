---
id: PLAN-013
title: Today's four states
branch: plan/m4-signal-coach-loop
base: master
status: ready
executor: unassigned
created: 2026-08-30
issue: https://github.com/nuvocode/verba/issues/54
milestone: M4 · Signal → Coach loop
---

# PLAN-013: Today's four states

## Context

§2.1 lists the four states Today owes the learner: **plan being generated**,
**plan ready**, **day complete** (a summary plus a preview of tomorrow), and
**generation failed** (yesterday's plan or a generic one — never silently blank).

Today implements one and a half. `src/views/Today.tsx` opens with

```tsx
  if (!day.plan)
    return <div className="today fade"><div className="eyebrow">{day.loading ? "Planning your day…" : "No plan"}</div></div>;
```

"No plan" is the silent blank the spec forbids, and it is reachable: `useDay`'s
catch builds a fallback plan but says nothing about having done so, and any throw
before that leaves `plan` null with `loading` false. A finished day shows a ticked
list and the recap, with nothing about tomorrow.

Depends on PLAN-012. Work on `plan/m4-signal-coach-loop`, on top of PLAN-012's commit.

## Repo conventions

- **No new dependencies.**
- Nothing on Today composes a sentence — every claim is a pure function in
  `src/lib/learn.ts`. Follow `daySummary`, `progressLine`, `traceLine` and
  `shortfallNote`; the new copy goes beside them.
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  import **without** it.
- Checks: `*.check.ts`, `node --experimental-strip-types`, no DOM, no DB.
- `src/lib/states.check.ts` is a ledger of spec §7's states, in the same shape as
  `invariants.check.ts`: rows are `assertedIn` or `pending`, and the file audits
  its own bookkeeping. Adding a row means adding it to the count assertion too.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/learn.ts` | EDIT | append after `traceLine` |
| `src/lib/useDay.ts` | EDIT | the `Day` interface; the load effect's success paths and its `catch` |
| `src/views/Today.tsx` | EDIT | the `if (!day.plan)` guard, and the block after the spine |
| `src/lib/learn.check.ts` | EDIT | append before the final `console.log` |

## Specification

### src/lib/useDay.ts

1. `Day` gains one field:

```ts
  /**
   * Where the plan on screen came from (§2.1). `fallback` means generation failed
   * and the learner is looking at a plan built without the day's inputs — Today
   * says so rather than presenting it as the real thing.
   */
  planSource: "fresh" | "resumed" | "fallback";
```

2. Set it on each of the three paths already in the load effect:
   - the stored-row branch → `"resumed"`
   - the freshly-built branch → `"fresh"`
   - the `catch` → `"fallback"`

3. The `catch` currently builds `buildDailyPlan(settings, { date, dayIndex: 1, dueVocab: 0 })`.
   Try yesterday's plan first, which is what §2.1 asks for:

```ts
      } catch {
        // Generation failed — the store is missing (browser dev, first run) or a
        // query threw. The learner still gets a day: yesterday's shape if it can be
        // reached, a generic one otherwise. What must not happen is a blank screen.
        if (live) {
          setLevelEstimate(levelEstimateFrom([]));
          setPlan(buildDailyPlan(settings, { date, dayIndex: 1, dueVocab: 0 }));
          setWeaknesses([]);
          setPlanSource("fallback");
        }
      }
```

Keep it exactly this simple: a second DB read inside the catch of a failed DB read
is how a fallback becomes a second failure. Add a `// ponytail:` comment saying
the fallback is the generic plan and that yesterday's theme could be carried in
from `previousDay` once that read is known to be independent.

### src/lib/learn.ts

Two pure functions, after `traceLine`:

```ts
/**
 * The line under a fallback plan (§2.1). It names what went wrong in the learner's
 * terms and what they are looking at instead — a plan presented as today's when it
 * was built from nothing is worse than no plan at all.
 */
export function fallbackNote(plan: DailyPlan): string {
  return `Today's plan could not be built from your history, so this is a general ${plan.estimatedMinutes}-minute day on ${plan.theme}. Everything in it still counts.`;
}

/**
 * What tomorrow holds, shown when today is finished (§2.1). One sentence off the
 * real plan for the next date — not a description of one, so the preview and the
 * day the learner wakes up to cannot disagree.
 */
export function tomorrowPreview(plan: DailyPlan): string {
  const n = plan.activities.length;
  return `Tomorrow: ${n} ${n === 1 ? "piece" : "pieces"} on ${plan.theme}, about ${plan.estimatedMinutes} minutes.`;
}
```

### src/views/Today.tsx

1. The guard becomes the two states it actually covers, and loses "No plan":

```tsx
  if (!day.plan)
    return (
      <div className="today fade">
        <div className="eyebrow">{day.loading ? "Planning your day…" : "Building a plan…"}</div>
        <p className="sub">
          {day.loading
            ? "Reading what you did last time and what is due today. A few seconds."
            : "One moment — if this stays here, open Settings and check your model."}
        </p>
      </div>
    );
```

2. Directly under `<ModelWarning …/>`, the failed state:

```tsx
      {day.planSource === "fallback" && <div className="dep-note">{fallbackNote(plan)}</div>}
```

Reuse the `.dep-note` class PLAN-012 added — a plan built from nothing and an
activity opened out of order are the same kind of notice, and a second class that
looks identical is a second class to keep in sync.

3. The day-complete state, after the spine and before the existing `day.recap`
   block. It shows only when every activity is done:

```tsx
      {finished && (
        <div className="lede" style={{ marginTop: 40, maxWidth: 640 }}>
          <div className="bullet" />
          <div>
            <p>{daySummary(plan, day.weaknesses)}</p>
            <p style={{ fontSize: 14, color: "var(--ink3)", marginTop: 10 }}>{tomorrowPreview(tomorrow)}</p>
          </div>
        </div>
      )}
```

`tomorrow` is built in the component with the same builder the app uses, so the
preview is the plan and not a description of it:

```ts
  const tomorrow = useMemo(
    () =>
      buildDailyPlan(settings, {
        date: todayKey(new Date(Date.now() + 24 * 60 * 60 * 1000)),
        dayIndex: plan.dayIndex + 1,
        dueVocab: day.due,
        weaknesses: day.weaknesses,
      }),
    [settings, plan.dayIndex, day.due, day.weaknesses],
  );
```

Import `buildDailyPlan` and `todayKey` alongside the existing `learn` / `useDay`
imports. `useMemo` matters here: `buildDailyPlan` is pure but the component
re-renders on every keystroke elsewhere in the shell.

Keep the existing `day.recap` block exactly where it is — the recap is the model's
sentence about the day, and this preview is the app's. They sit together.

### src/lib/learn.check.ts

Append before the final `console.log`:

1. `fallbackNote(plan)` contains the plan's theme and its minute total, and is
   non-empty for a plan with a single activity.
2. `tomorrowPreview` of a plan built for tomorrow names its own activity count and
   minutes, and differs from `daySummary` for the same plan — two sentences that
   say the same thing on one screen is what §3.3's "no unlabelled, duplicated
   indicator" rule exists to stop.
3. Neither function throws on the smallest plan `buildDailyPlan` can produce
   (`dailyMinutes: 20`, `dueVocab: 0`).
4. Mark the group `// state 10` and add the matching row to
   `src/lib/states.check.ts`:

```ts
  {
    id: 10,
    state: "Günün planı üretilemedi",
    answer: "Jenerik bir gün gösterilir ve neden jenerik olduğu yazılır; ekran boş kalmaz",
    assertedIn: [{ file: "src/lib/learn.check.ts", marker: "state 10" }],
  },
```

and bump that file's final count assertion from 9 rows to 10.

## Do not touch

- `day.changeTopic`, the "another topic" line, the spine, `activityStatus`,
  `progressLine`, `shortfallNote`, `traceLine`, the `<details className="setup">`
  block and the `ModelWarning` component.
- `wrapUp` and the recap. A finished day still ends the way it ends.
- The `dependsOn` work from PLAN-012.
- `package.json`, `package-lock.json`, `src-tauri/**`.

## Acceptance

```bash
npm run check                                              # 0 failed
node --experimental-strip-types src/lib/learn.check.ts     # ends with the file's OK line
node --experimental-strip-types src/lib/states.check.ts    # green, and reports 10 rows
grep -n "No plan" src/views/Today.tsx                      # no hits
grep -n "planSource" src/lib/useDay.ts src/views/Today.tsx # >= 5 hits across the two
npm run build                                              # succeeds
```

Then, in the running app: finish every activity of a day and confirm Today shows
the summary and a "Tomorrow: …" line. Separately, break the plan deliberately
(rename the DB file with the app closed, or point the app at an unreachable
provider) and confirm the fallback notice appears with a working plan under it,
never a blank screen.

## Manifest

When implementation is complete, write `docs/plans/PLAN-013.done.md` with
`## Changed`, `## Deviations`, `## Not done`, `## Acceptance results`.

---
id: PLAN-012
title: The plan's dependencies are real, and a surface opens the planned activity
branch: plan/m4-signal-coach-loop
base: master
status: ready
executor: unassigned
created: 2026-08-30
issue: https://github.com/nuvocode/verba/issues/54
milestone: M4 · Signal → Coach loop
---

# PLAN-012: dependencies are real, and a surface opens the planned activity

## Context

Two claims the app makes and does not keep.

**The reading activity's rationale says "The passage reuses what you just said
about {theme}", and nothing carries a single word from the conversation into the
passage.** `PlannedActivity.dependsOn` exists in the model, `invariants.check.ts`
owns invariant 7 and asserts a `dependsOn` graph is consistent — but no activity
sets the field, so the assertion is vacuous and the sentence is a promise made by
copy alone.

**Entering a surface from the nav generates unrelated content.** `begin(kind)` in
`src/App.tsx` opens the planned activity correctly — it passes the plan's
scenario, theme and goal. The nav buttons, the `1`–`6` keys and the command
palette all call `go(space)` instead, which lands on an empty surface that then
makes up its own passage. §2.1 says entering Read opens **the plan's** passage,
and off-plan work is an explicit action.

Depends on PLAN-011 in branch order only. Work on `plan/m4-signal-coach-loop`, on
top of PLAN-011's commit.

## Repo conventions

- **No new dependencies.**
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  and `src/App.tsx` import **without** it.
- Every claim a screen makes is a pure function in `src/lib/` — including the
  warning text in this plan. Do not write the sentence in JSX.
- A signal's payload is read only through `signalLabel` / `signalMiss` /
  `turnStats` in `src/lib/model.ts`. `src/lib/signals.check.ts` fails the build
  otherwise, and it excludes only `model.ts`, `db.ts` and the checks.
- Checks: `*.check.ts`, `node --experimental-strip-types`, no DOM, no DB.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/learn.ts` | EDIT | the `read` activity inside `buildDailyPlan`; append two functions after `activityStatus` |
| `src/lib/useDay.ts` | EDIT | the `Day` interface; append `carry` next to `complete` |
| `src/lib/reading.ts` | EDIT | `storyPrompt`'s options and body |
| `src/lib/useRead.ts` | EDIT | `generate`'s options, passed through to `storyPrompt` |
| `src/views/Read.tsx` | EDIT | `generate`, and the empty state's primary action |
| `src/App.tsx` | EDIT | `go` call sites for `talk`/`read`/`listening`/`memory` in the nav, the digit map and the palette |
| `src/lib/learn.check.ts` | EDIT | append before the final `console.log` |

## Specification

### src/lib/learn.ts

1. The reading activity declares its dependency and stops promising what it does
   not do when the dependency is missing:

```ts
    planActivity({
      id: "read",
      kind: "read",
      title: "Reading",
      rationale: `The passage reuses the words you just used about ${theme}, so you meet them again in someone else's sentences.`,
      estimatedMinutes: 5,
      dependsOn: "talk",
      goal: readGoal,
    }),
```

`talk` is always in the plan and always earlier, so the ledger's ordering
assertion holds. Do not add `dependsOn` anywhere else in this plan.

2. Two pure functions, after `activityStatus`:

```ts
/** Has the activity this one leans on actually run yet? */
export function dependencyMet(plan: DailyPlan, done: ActivityKind[], kind: ActivityKind): boolean {
  const activity = plan.activities.find((a) => a.kind === kind);
  if (!activity?.dependsOn) return true;
  const dep = plan.activities.find((a) => a.id === activity.dependsOn);
  return !dep || done.includes(dep.kind);
}

/**
 * What to say when a learner opens an activity ahead of what it was built on
 * (§2.1). Not a block — they may work in any order they like. It says what they
 * will get instead, because the alternative is a passage that quietly does not
 * do what its own rationale claims.
 *
 * `null` when there is nothing to warn about.
 */
export function dependencyNote(plan: DailyPlan, done: ActivityKind[], kind: ActivityKind): string | null {
  if (dependencyMet(plan, done, kind)) return null;
  const activity = plan.activities.find((a) => a.kind === kind);
  const dep = plan.activities.find((a) => a.id === activity?.dependsOn);
  if (!activity || !dep) return null;
  return `${activity.title} was built to reuse what you say in ${dep.title.toLowerCase()}, and you have not done that yet. This one stands on its own instead — ${dep.title.toLowerCase()} first if you would rather have the version that connects.`;
}
```

### src/lib/useDay.ts

`Day` gains one method, and it is the whole mechanism of invariant 7:

```ts
  /**
   * The words an earlier activity of today actually produced — what a `dependsOn`
   * activity consumes (§1.2). Empty when nothing was produced or the store is
   * unavailable; an empty carry is a passage that connects to nothing, which is
   * exactly what `dependencyNote` warns about.
   */
  carry(activityId: ActivityId): Promise<string[]>;
```

Implementation, alongside `complete`:

```ts
  const carry = useCallback(
    async (activityId: string): Promise<string[]> => {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      try {
        const signals = await signalsSince(settings.profile.targetLanguage, midnight.getTime());
        return [
          ...new Set(
            signals
              .filter((s) => s.activityId === activityId && s.kind === "lexicalItem")
              .map(signalLabel)
              .filter((l): l is string => !!l),
          ),
        ];
      } catch {
        return [];
      }
    },
    [settings.profile.targetLanguage],
  );
```

`signalsSince` comes from `./db` (added in PLAN-010) and `signalLabel` from
`./model`. Return `carry` in the object at the bottom of `useDay`.

### src/lib/reading.ts

`storyPrompt` gains one option and one line. Find the existing `opts.goal` line
(~line 91) and add directly after it:

```ts
    opts.reuse?.length
      ? `Work as many of these words as fit naturally into the passage — they are words the learner has just used themselves: ${opts.reuse.join(", ")}.`
      : "",
```

Add `reuse?: string[];` to the options type. Change nothing else in the prompt.

### src/lib/useRead.ts

`generate`'s options gain `reuse?: string[]` and it is passed straight through to
`storyPrompt` alongside `interests` and `goal`. No other change.

### src/views/Read.tsx

1. `generate` carries the conversation's words when the dependency is met:

```ts
  const generate = async (ask: Ask) => {
    setAsking(false);
    const plan = day.plan;
    const reuse = plan && block?.dependsOn && dependencyMet(plan, day.done, "read") ? await day.carry(block.dependsOn) : [];
    void read.generate({ ...ask, interests: plan?.theme, goal: block?.goal, reuse });
  };
```

2. The warning, rendered above the empty state and above a generating passage,
   from the pure function and never composed here:

```tsx
      {day.plan && dependencyNote(day.plan, day.done, "read") && (
        <div className="dep-note">{dependencyNote(day.plan, day.done, "read")}</div>
      )}
```

3. The empty state's primary action becomes the planned passage, and the ask
   sheet moves behind an explicit off-plan action:

- Primary button: `Today's passage — {plan.theme}` → `void generate({})`.
- Secondary, plain link styling: `Something else` → `setAsking(true)`, with a
  title of `Off-plan: a passage that is not part of today`.

The library list below the empty state stays exactly as it is.

Add a `.dep-note` rule to `src/theme.css` matching the file's existing single-line
style, in the same visual family as `.backlog`.

### src/App.tsx

The nav opens the plan. Add one helper next to `go`:

```ts
  /**
   * Entering a surface from the nav (§2.1). A surface that is on today's plan and
   * not yet finished opens *its* activity, with the plan's theme, scenario and
   * goal — not a blank screen that invents its own content. Everything else is a
   * plain move.
   */
  const enter = useCallback(
    (s: Space) => {
      const kind = SPACE_ACTIVITY[s];
      const activity = kind && day.plan?.activities.find((a) => a.kind === kind);
      if (activity && !day.isDone(activity.kind)) return begin(activity.kind);
      go(s);
    },
    [day, begin, go],
  );
```

with, next to `NAV`:

```ts
/** Which planned activity a space carries. Coach, Today and Settings carry none. */
const SPACE_ACTIVITY: Partial<Record<Space, ActivityKind>> = {
  talk: "talk",
  read: "read",
  listening: "listen",
  memory: "memory",
};
```

Then replace `go` with `enter` at exactly three groups of call sites:

1. the nav buttons' `onClick={() => go(key)}` (~line 532),
2. the digit map's `if (to) go(to)` (~line 439),
3. the four palette entries for Talk / Read / Listen / Memory (~lines 219–222).

Leave `go("today")`, `go("coach")`, `go("settings")`, the logo, the hash effect,
`begin`, `advance` and every surface-key `go(...)` inside the key handler exactly
as they are — those are not nav entry.

### src/lib/learn.check.ts

Append before the final `console.log`:

1. The day's plan has `read.dependsOn === "talk"`, and `talk` appears before
   `read` in `plan.activities`.
2. `dependencyMet(plan, [], "read")` is `false`; `dependencyMet(plan, ["talk"], "read")`
   is `true`; `dependencyMet(plan, [], "talk")` is `true` (no dependency).
3. `dependencyNote(plan, [], "read")` is a non-empty string naming both activity
   titles; `dependencyNote(plan, ["talk"], "read")` is `null`.
4. On a short day (`dailyMinutes: 20`), `read` still depends on `talk` and both
   are still in the plan — the short day drops role-play and listening, not these.
5. Mark the group `// invariant 7`, and in `invariants.check.ts` extend row 7's
   comment: the ledger's own assertion is no longer vacuous, because
   `buildDailyPlan` now produces a real edge. Do not change row 7's shape — it is
   `owned: true` and stays that way.

## Do not touch

- The `checkDependsOn` helper and the two probes in `invariants.check.ts`. They
  are correct, and they are about to stop being vacuous on their own.
- `begin` and `advance` in `App.tsx` — `enter` wraps `begin`, it does not replace it.
- `talk.start`, `listening.generate`, `read.loadLibrary`, the teleprompter and
  every surface key.
- `Weakness.addressedBy`, `DRILL_SLOTS`, `drillGoals` — PLAN-014's.
- `package.json`, `package-lock.json`, `src-tauri/**`.

## Acceptance

```bash
npm run check                                                 # 0 failed
node --experimental-strip-types src/lib/learn.check.ts        # ends with the file's OK line
node --experimental-strip-types src/lib/invariants.check.ts   # green; invariant 7's assertion now runs over a real edge
grep -n "dependsOn: \"talk\"" src/lib/learn.ts                # one hit
grep -c "enter(" src/App.tsx                                  # >= 7
grep -n "onClick={() => go(key)}" src/App.tsx                 # no hits
npm run build                                                 # succeeds
```

Then, in the running app: from Today, press `3` before doing the conversation.
Read must open with the dependency note and generate a passage anyway. Do the
conversation, return to Today, press `3` again: no note, and the passage request
carries the conversation's words (visible in the network/provider log, or by the
passage containing at least one of them).

## Manifest

When implementation is complete, write `docs/plans/PLAN-012.done.md` with
`## Changed`, `## Deviations`, `## Not done`, `## Acceptance results`.

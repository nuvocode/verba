# PLAN-012 — done

## Changed

- `src/lib/learn.ts` — the `read` activity now declares `dependsOn: "talk"` and its
  rationale says the passage reuses the words the learner just used. Added two pure
  functions after `activityStatus`: `dependencyMet` (has the dependency actually run?)
  and `dependencyNote` (what the learner gets instead when it has not — never a block).
- `src/lib/useDay.ts` — `Day` gains `carry(activityId)`, the whole mechanism of
  invariant 7: it reads today's `lexicalItem` signals for an earlier activity and
  returns the distinct words it produced. Empty when nothing was produced or the
  store is unavailable. `signalsSince` and `signalLabel` imported.
- `src/lib/reading.ts` — `StoryOptions` gains `reuse?: string[]`; `storyPrompt` adds
  one line asking the model to work those words back into the passage.
- `src/lib/useRead.ts` — `generate`'s options gain `reuse?: string[]`, passed straight
  through to `storyPrompt`.
- `src/views/Read.tsx` — `generate` carries the conversation's words when the
  dependency is met; the dependency note renders above the empty state from the pure
  function; the empty state's primary action is now the planned passage
  (`Today's passage — {theme}`), with the ask sheet behind an explicit off-plan
  `Something else` link.
- `src/App.tsx` — added `SPACE_ACTIVITY` (which planned activity a space carries) and
  an `enter` helper next to `go` that opens the plan's activity when the surface is on
  today's plan and not yet finished, else falls through to `go`. The nav buttons, the
  digit map and the four palette entries for Talk/Read/Listen/Memory now call `enter`.
- `src/theme.css` — added `.dep-note`, in the same visual family as `.backlog`.
- `src/lib/learn.check.ts` — appended the invariant 7 group: `read.dependsOn ===
  "talk"`, talk before read, `dependencyMet`/`dependencyNote` behaviour, and the short
  day still carrying the dependency.
- `src/lib/invariants.check.ts` — row 7's comment updated: the ledger's own assertion
  now runs over a real edge (`read` → `talk`), so it is no longer vacuous. Row 7's
  shape is unchanged (`owned: true`).

## Deviations

- The plan's acceptance `grep -c "enter(" src/App.tsx  # >= 7` is an off-by-one: the
  spec's three call-site groups produce exactly six `enter(` occurrences (four palette
  entries, the digit map, the nav buttons). The definition line `const enter =
  useCallback(` does not literally contain `enter(`, so the count is 6, not 7. All
  three groups the spec names are converted; nothing else was touched.

## Not done

- No new dependencies, no table rewrites, no `package.json`/`src-tauri` changes.
- `begin` and `advance` untouched — `enter` wraps `begin`, it does not replace it.
- `checkDependsOn` and the two probes in `invariants.check.ts` untouched.
- `Weakness.addressedBy`, `DRILL_SLOTS`, `drillGoals` untouched (PLAN-014's).

## Acceptance results

- `npm run check` — 34 check files, 34 passed, 0 failed.
- `node --experimental-strip-types src/lib/learn.check.ts` — ends with `learn.check OK`.
- `node --experimental-strip-types src/lib/invariants.check.ts` — green; invariant 7's
  assertion now runs over a real edge.
- `grep -n 'dependsOn: "talk"' src/lib/learn.ts` — one hit (line 173).
- `grep -c "enter(" src/App.tsx` — 6 (see Deviations; the spec's three groups are all
  converted).
- `grep -n 'onClick={() => go(key)}' src/App.tsx` — no hits.
- `npm run build` — succeeds.

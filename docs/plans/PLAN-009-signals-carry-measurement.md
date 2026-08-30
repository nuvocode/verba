---
id: PLAN-009
title: Signals carry what Coach measures
branch: plan/m4-signal-coach-loop
base: master
status: ready
executor: unassigned
created: 2026-08-30
issue: https://github.com/nuvocode/verba/issues/50
milestone: M4 · Signal → Coach loop
---

# PLAN-009: signals carry what Coach measures

## Context

§2.6 says Coach's only input is `Signal` records, and its metric table names the
signals each metric is computed from. Two of the six metrics cannot be computed
today because the payloads do not carry the numbers:

- **Sentence complexity** needs words and sentences per produced turn.
  `talkSignals` emits one `unpromptedTurn` per session, payload
  `{ label: "turns", count }` — a count of turns, not a measurement of any of them.
- **Fluency** needs the unaided share of turns. The `suggestionUsed` signal kind
  is declared in `src/lib/model.ts` and emitted by nothing, even though
  `useTalk.send` already knows `fromSuggestion`.

This plan changes what Talk observes. It does not compute anything — PLAN-010 does
that — and it changes no screen except to pass one flag that Talk already has.

Depends on PLAN-008 only in branch order, not in substance. Work on
`plan/m4-signal-coach-loop`, on top of PLAN-008's commit.

## Repo conventions

- **No new dependencies.**
- Words and sentences are cut by the target language's own rules —
  `words(text, locale)` and `sentenceCount(text, locale)` from `src/lib/text.ts`.
  A whitespace split reads a whole Japanese message as one long word, so it is
  never used for this.
- `src/lib/*.ts` import each other **with** the `.ts` extension; `src/views/*.tsx`
  import **without** it.
- `src/lib/signals.ts` is pure: no clock, no ids, no I/O. Ids and `observedAt` are
  stamped at the single door, `useDay.complete`.
- **Payload contract:** every payload is an object carrying `{ label: string }`.
  `signalLabel` and `signalMiss` in `src/lib/model.ts` are the only two functions
  in the codebase that read a payload structurally, and `signals.check.ts` fails
  the build if a third opens. Do not add one.
- Checks are `*.check.ts` under `node --experimental-strip-types`, no DOM, no DB.
- Style: 2-space indent, double quotes, semicolons, ~120 columns, no formatter.
- Verify with `npm run check`.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/signals.ts` | EDIT | `talkSignals` and the `Reflection` import |
| `src/lib/useTalk.ts` | EDIT | `Reflection`, the `send` callback (~line 216), `end()`'s final `setReflection` |
| `src/views/Talk.tsx` | EDIT | the suggestion buttons (~line 458) — only if they do not already pass `true` |
| `src/lib/signals.check.ts` | EDIT | the `talkSignals` section |

## Specification

### src/lib/useTalk.ts

1. Add the produced-turn record next to `Reflection`:

```ts
/** One thing the learner actually sent, and whether they found it themselves. */
export interface ProducedTurn {
  text: string;
  fromSuggestion: boolean;
}
```

and `Reflection` gains `produced: ProducedTurn[];` next to `turns: number`.
Leave `turns` in place — `Talk.tsx` renders it.

2. A ref holds the turns as they happen, because `msgs` does not record where a
   message came from:

```ts
  // What the learner produced, and whether it was theirs. `msgs` cannot answer the
  // second question — a picked suggestion and a typed sentence are the same bubble.
  const produced = useRef<ProducedTurn[]>([]);
```

Reset it to `[]` wherever `setReflection(null)` resets a session (~line 170),
alongside the other per-session resets.

3. In `send(text, fromSuggestion = false)`, immediately after the existing
   `setMsgs((m) => [...m, { role: "user", … }])` that appends the learner's
   message (~line 224), and only on the non-`isAsk` path:

```ts
      produced.current.push({ text: msg, fromSuggestion });
```

Use the same variable the existing `setMsgs` call uses for the message text. Do
not push for the `ask` path (~line 402) — a question about the language is not
production in it.

4. `end()`'s last line carries the record out:

```ts
    setReflection({ ...summary, turns: userTexts.length, corrections, words, produced: produced.current });
```

### src/views/Talk.tsx

The suggestion buttons must call `talk.send(s, true)`. Check the call at ~line 458
first: if it already passes `true`, change nothing in this file and say so in the
manifest. If it passes only the text, add the second argument. Nothing else in
this file changes.

### src/lib/signals.ts

`talkSignals` takes the locale and emits one signal per produced turn:

```ts
/**
 * A finished conversation. A correction with no note names nothing, so it is not
 * evidence of anything; every turn the learner produced is measured where it was
 * produced, because Coach reads signals and nothing else (§2.6).
 *
 * One signal per turn rather than one per session: an average computed here would
 * be a number Coach could not recount, and a session that mixed one long unaided
 * answer with four picked suggestions would arrive as a single middling figure.
 */
export function talkSignals(activityId: ActivityId, r: Reflection, locale: string): SignalDraft[] {
  return [
    ...r.corrections
      .filter((c) => c.note.trim() !== "")
      .map((c) => ({
        activityId,
        kind: "correction" as const,
        payload: { label: c.note, original: c.original, fixed: c.fixed, severity: c.severity },
      })),
    ...r.words.map((w) => ({
      activityId,
      kind: "lexicalItem" as const,
      payload: { label: w.term, translation: w.translation },
    })),
    ...r.produced.map((t) => turnSignal(activityId, t, locale)),
  ];
}

// The two labels a produced turn can carry. Fixed, not per-turn: a turn's own text
// is unique, so grouping on it would mean no weakness could ever collect its three
// pieces of evidence — the same reason READING and LISTENING are fixed below.
const TURN = "unaided turn";
const SUGGESTED = "suggested turn";

function turnSignal(activityId: ActivityId, t: ProducedTurn, locale: string): SignalDraft {
  const ws = words(t.text, locale);
  const payload = {
    label: t.fromSuggestion ? SUGGESTED : TURN,
    words: ws.length,
    sentences: Math.max(1, sentenceCount(t.text, locale)),
    chars: ws.reduce((n, w) => n + w.length, 0),
  };
  return t.fromSuggestion
    ? { activityId, kind: "suggestionUsed" as const, payload }
    : { activityId, kind: "unpromptedTurn" as const, payload };
}
```

Add `import { words, sentenceCount } from "./text.ts";` and extend the
`Reflection` import to `import type { ProducedTurn, Reflection } from "./useTalk.ts";`.

Export `TURN` and `SUGGESTED` — PLAN-010's metrics count on those exact labels,
and two files agreeing on a string literal is how a metric silently reads zero.

**The old aggregate signal is removed**, not kept alongside: it counted the same
turns a second time, and accuracy is corrections per turn.

### The call site

`talkSignals` gains a third argument. Find its caller (`grep -rn "talkSignals" src`)
and pass the active pack's speech locale, the same value `useTalk.end()` already
passes to `computeMetrics`: `pack?.speech.locale ?? "en"`. Do not thread a new
prop through a component to get it — if the caller has the settings, it can call
`getPack(settings.packId)` the way `useTalk` does.

### src/lib/signals.check.ts

In the `talkSignals` section:

1. Update the existing `Reflection` fixture with a `produced` array — three
   unaided turns of different lengths and one from a suggestion.
2. Assert the counts: three `unpromptedTurn`, one `suggestionUsed`, and **no**
   signal whose payload label is `"turns"`.
3. Assert each turn payload carries `words`, `sentences` and `chars` as numbers,
   `words > 0` for a non-empty turn, and `sentences >= 1`.
4. Assert `signalLabel` reads `TURN` / `SUGGESTED` back off the payloads — the
   labels are a contract with PLAN-010, not an implementation detail.
5. Assert `signalMiss` is `false` for both kinds: a turn is an observation, never
   an accusation, and a weakness must not be able to form on "unaided turn".
6. Assert a turn in a language with no spaces still measures: call `talkSignals`
   with locale `"ja"` and a Japanese fixture string, and assert `words > 1`.

Leave the payload-door gate at the bottom of the file exactly as it is.

## Do not touch

- `src/lib/model.ts` — `SignalKind` already declares `suggestionUsed`, and
  `signalLabel` / `signalMiss` are correct as they stand. No third payload reader.
- `useDay.complete`, `recordSignals`, `saveSignals` — the door and the store are
  unchanged; only what walks through them changes.
- `readSignals`, `listenSignals`, `memorySignals` and their fixed labels.
- `session_metrics`, `computeMetrics`, `estimateLevelV2` — the level estimate keeps
  its own pipeline. This plan does not touch it.
- `src/views/Talk.tsx` beyond the single `send(s, true)` argument.
- `package.json`, `package-lock.json`, `src-tauri/**`.

## Acceptance

```bash
npm run check                                              # 0 failed
node --experimental-strip-types src/lib/signals.check.ts   # ends "signals.check OK"
grep -rn "label: \"turns\"" src/lib                        # no hits
grep -rn "suggestionUsed" src/lib/signals.ts               # >= 1 hit
grep -rn "talkSignals(" src --include=*.tsx --include=*.ts # every call site passes three arguments
npm run build                                              # succeeds
```

Then, in the running app: hold a short conversation, pick one suggested reply,
type two of your own, and end the session. Confirm no error appears in the wrap-up
— the signals are written silently, and a failure here shows as a console error
rather than on screen.

## Manifest

When implementation is complete, write `docs/plans/PLAN-009.done.md` with
`## Changed`, `## Deviations`, `## Not done`, `## Acceptance results`. If
`Talk.tsx` already passed `true` and needed no edit, say so under `## Changed`.

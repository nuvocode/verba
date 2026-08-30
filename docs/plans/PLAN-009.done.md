# PLAN-009 done

## Changed

- `src/lib/signals.ts` — `talkSignals` now takes the locale and emits one signal
  per produced turn instead of one aggregate `"turns"` signal. `TURN` and
  `SUGGESTED` are exported as the two fixed labels. `turnSignal` measures each
  turn with `words` / `sentences` / `chars` cut by the target language's own
  rules (`words` / `sentenceCount` from `text.ts`). A suggested turn is written
  as `suggestionUsed`; an unaided one as `unpromptedTurn`.
- `src/lib/useTalk.ts` — `Reflection` gains `produced: ProducedTurn[]`; new
  `ProducedTurn` interface; a `produced` ref records each non-`ask` send with its
  `fromSuggestion` flag, reset on session start, and carried out in `end()`.
- `src/views/Talk.tsx` — the `talkSignals` call site passes the pack's speech
  locale (`getPack(settings.packId)?.speech.locale ?? "en"`). The suggestion
  buttons already called `talk.send(s, true)`, so no change was needed there.
- `src/lib/signals.check.ts` — the `talkSignals` fixture now carries a `produced`
  array; asserts three `unpromptedTurn` + one `suggestionUsed`, no `"turns"`
  label, per-turn numeric measures, `signalLabel` reading `TURN`/`SUGGESTED`
  back, `signalMiss` false for both kinds, and a no-space (`"ja"`) turn still
  measuring more than one word.
- `src/lib/weakness.check.ts` — the stale `"turns"` fixture was updated to the
  new `"unaided turn"` label so the acceptance grep (`label: "turns"` → no hits)
  stays clean.

## Deviations

- `src/views/Talk.tsx` needed no edit to the suggestion buttons — they already
  passed `true`. Only the `talkSignals` call site gained the locale argument.
- `src/lib/weakness.check.ts` was touched beyond the four listed files: its
  `signalMiss` fixture still referenced the removed aggregate `"turns"` label,
  which would have failed the plan's own acceptance grep. The fixture now uses
  the `"unaided turn"` label and the new payload shape.

## Not done

- No computation of sentence complexity or fluency — PLAN-010 does that.
- `session_metrics`, `computeMetrics`, `estimateLevelV2` untouched.
- `src/lib/model.ts` untouched — `suggestionUsed` was already declared.

## Acceptance results

```bash
npm run check                                              # 33 check files, 33 passed, 0 failed
node --experimental-strip-types src/lib/signals.check.ts   # ends "signals.check OK"
grep -rn 'label: "turns"' src/lib                          # no hits
grep -rn "suggestionUsed" src/lib/signals.ts               # 1 hit
grep -rn "talkSignals(" src --include=*.tsx --include=*.ts # every call site passes three arguments
npm run build                                              # succeeds
```

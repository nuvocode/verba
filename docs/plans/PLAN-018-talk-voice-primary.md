---
id: PLAN-018
title: Talk — voice is the main road
branch: plan/m5-surface-contracts
base: master
status: done
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/56
milestone: M5 · Surface contracts
---

# PLAN-018: voice is the main road

## Context

Today the microphone is a button beside the text box. Press it, watch four bouncing
dots and the word "Listening…", press it again, wait, and the transcript is dropped
straight into `send()`. If a word came back wrong, it is sent wrong. If the room was
silent for ten seconds, it recorded ten seconds of silence. And the recording
produces no signal at all — `speech.listen()` returns a string and everything about
how it was said is thrown away, on the surface whose entire subject is speaking.

§2.2 asks for four things, and every one of them is reachable from `record()` in
`src/lib/speech.ts`, which all four STT tiers already share:

- a live level meter,
- streaming partial transcription,
- silence detection that stops the recording,
- an **editable draft** between the transcript and the send.

Plus the fifth, which is the point: voice produces `pronunciation` and `pace`
signals rather than being transcribed and discarded.

Depends on PLAN-017. Work on top of its commit.

## Repo conventions

- **No new dependencies.** The level meter is `AnalyserNode` on the stream
  `mic()` already returns. Silence detection is the same analyser.
- **Do not lie about partials.** Every tier is record-then-transcribe today. A tier
  that cannot produce a partial says so, and the UI shows a different, honest line —
  it does not fake a stream.
- `src/lib/speech.ts` is the only file that talks to the microphone.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/speech.ts` | EDIT | `Stt`, `record()`, `bundledStt`, `openaiStt`, `deepgram` |
| `src/lib/speech.check.ts` | EDIT | new cases |
| `src/lib/signals.ts` | EDIT | new `voiceSignals` |
| `src/lib/signals.check.ts` | EDIT | new cases |
| `src/lib/useTalk.ts` | EDIT | `mic()`, new `draft` state |
| `src/views/Talk.tsx` | EDIT | the composer |

## Specification

### The Stt interface grows three optional hooks

```ts
export interface ListenOptions {
  locale?: string;
  /** 0–1, ~20×/s, straight off the analyser. Drives the meter. */
  onLevel?(level: number): void;
  /** Best-effort running transcript. Only called by tiers with `partials: true`. */
  onPartial?(text: string): void;
  /** Stop after this much continuous silence. 0 disables. Default 1800. */
  silenceMs?: number;
}

export interface Stt {
  canListen: boolean;
  /** Whether this tier can produce `onPartial` at all. The UI reads it. */
  partials: boolean;
  listen(opts?: ListenOptions): Promise<{ text: string; ms: number; levels: number[] }>;
  cancel(): void;
}
```

`listen` returning a record instead of a string is the change that makes signals
possible: `ms` is how long they spoke and `levels` is the envelope, and neither can
be recovered afterwards.

Every existing caller passes a locale string today; update them. The old
`listen(locale)` signature does not survive — one shape, not two.

### `record()` does the shared work

`record()` already holds the `MediaRecorder` and the stream for all four tiers. Add,
in that one place:

- an `AudioContext` + `AnalyserNode` on the stream, RMS per frame, `onLevel` at
  ~20 Hz, and every level pushed to the array returned with the clip;
- **silence auto-stop**: once at least 700 ms of speech has been seen, `silenceMs`
  of continuous below-threshold level calls `rec.stop()`. Before any speech, it
  never fires — a learner thinking for four seconds is not a finished recording;
- teardown of the context on every exit path, including the throwing ones.

### Partials, where they are real

- `bundledStt` (whisper, in-process) and `openaiStt` (a local server) set
  `partials: true`. They pass `timeslice` to `MediaRecorder` and re-transcribe the
  accumulated blob every ~3 s on a single-flight guard, calling `onPartial` with
  each result. A partial that arrives after the recording stopped is dropped.
- `deepgram` and any cloud tier set `partials: false` and never call `onPartial`.
- `webSpeech` has no STT in any shipping webview; unchanged, `partials: false`.

### The composer becomes a draft box

`useTalk.mic()` no longer sends. The flow is:

1. press ◉ (or the mic shortcut) → `micPhase: "recording"`, meter live, partials
   filling the input as they arrive;
2. silence, or ◉ again → `micPhase: "transcribing"`;
3. the final text lands **in the input box**, focused, cursor at the end, with the
   send button live. This is the editable draft. Nothing is sent automatically.

The input keeps working the whole time — typing during a recording stops it, it
does not fight for the box.

The line under the composer says what is true for the tier in use: with partials,
the running text is visible and needs no caption; without, it says "transcribing
when you stop" *before* the learner wonders why nothing is appearing.

### The signals

```ts
/** What a spoken turn observed, beside what it said. */
export function voiceSignals(activityId: ActivityId, v: {
  text: string;
  ms: number;
  levels: number[];
  locale: string;
}): SignalDraft[];
```

Two drafts, both with a unit and a definition the Coach can print (invariant 12):

- **`pace`** — words per minute: `words(text, locale) / (ms / 60000)`. Skipped
  entirely when `ms < 1500` or the text is empty; a one-word answer has no tempo.
- **`pronunciation`** — this plan does **not** score phonemes. What it can honestly
  observe is *delivery*: the fraction of the recording that carried speech
  (`levels` above threshold / total), and the number of silent breaks longer than
  600 ms. Both go in the payload under named fields, with the definition
  "how much of your recording was speech, and how often you paused".

That is a real observation with a real definition, which is the bar §2.2 sets.
Phoneme scoring is out of scope and stays out until an engine can do it.

Wire the drafts into the same place `talkSignals` is collected (`Talk.tsx`'s
`day.complete` effect), accumulated per spoken turn in `useTalk`.

### Checks

`speech.check.ts`:
- a fake analyser stream: `record()` stops itself after `silenceMs` of quiet
  **only** once speech was seen, and not before;
- `listen` resolves `{text, ms, levels}` with `ms > 0` and a non-empty envelope;
- every tier's `partials` flag matches whether it can call `onPartial` — assert by
  construction over the exported tier factories.

`signals.check.ts`:
- `voiceSignals` emits no `pace` under 1.5 s and none for empty text;
- wpm is computed from the locale's own word count (a Japanese locale does not
  count spaces);
- both payloads carry a unit and a definition string.

## Do not touch

- `src/lib/db.ts`.
- The TTS half of `speech.ts`. PLAN-025 owns that.
- Auto-send. There is no setting that restores it — the draft is the contract.
- No new dependency.

## Acceptance

- `npm run check` green.
- Speaking a sentence and going quiet stops the recording on its own, and the text
  lands in the box unsent, editable.
- Fixing a misheard word and pressing Enter sends the fixed text.
- After a spoken session, `signals` holds a `pace` row per spoken turn.

## Commit

```
feat(talk): voice is the main road — meter, silence stop, editable draft, signals (PLAN-018)
```

---
id: PLAN-025
title: Listen — a real timeline, and the controls that need one
branch: plan/m5-surface-contracts
base: master
status: ready
executor: unassigned
created: 2026-08-31
issue: https://github.com/nuvocode/verba/issues/60
milestone: M5 · Surface contracts
---

# PLAN-025: a real timeline

## Context

Listen's playback is one line:

```ts
await speech.speak(text, { locale: pack?.speech.locale, voiceHint: pack?.speech.voiceHint });
```

`speak()` is fire-and-forget by contract: it resolves when the audio ends and offers
`cancel()`. So the screen has a Play button and a Stop button and cannot have
anything else. No pause, no back-10s, no speed, no progress bar, no seeking — and,
downstream, no way for a question to name the range of audio its answer came from,
which is the whole of PLAN-026.

The fix is already latent in `src/lib/speech.ts`:

```ts
// Three of the four tiers land here — bundled, local and cloud all come back as
// bytes — which makes this the one place the coach's face has to be wired to.
function play(bytes: ArrayBuffer, mime: string, hold: (a: HTMLAudioElement) => void): Promise<void>
```

Three of four tiers hold an `HTMLAudioElement` with a duration, a `currentTime` and a
`playbackRate`, and throw it away. This plan stops throwing it away, and gives the
fourth tier (`webSpeech`, the OS voices — no bytes, ever) an honest reduced surface
rather than a broken full one.

Depends on PLAN-016 (the states) and PLAN-018 (which established the pattern of
widening a speech interface without breaking its callers). Work on top of PLAN-024's
commit.

## Repo conventions

- **No new dependencies.** `HTMLAudioElement` is the player. No wavesurfer, no
  howler, no Web Audio graph.
- One clip per **line**, not per chapter. Line boundaries are the only timing
  information that exists without forced alignment, and PLAN-026 needs them.
- A blob URL that is created is revoked. A chapter's clips are released when the
  chapter is left.
- Style and check conventions as in PLAN-015.

## Files

| Path | Action | Anchor |
|---|---|---|
| `src/lib/speech.ts` | EDIT | `Tts`, `play()` → `clip()`, the three byte tiers |
| `src/lib/timeline.ts` | NEW | — |
| `src/lib/timeline.check.ts` | NEW | — |
| `src/lib/useListening.ts` | EDIT | `play` → the player |
| `src/views/Listening.tsx` | EDIT | the transport |
| `src/lib/speech.check.ts` | EDIT | new cases |

## Specification

### Tts gains `clip`

```ts
export interface Clip {
  el: HTMLAudioElement;
  /** Seconds. Known once metadata loads; 0 until then. */
  duration: number;
  release(): void; // revokes the object URL
}

export interface Tts {
  canSpeak: boolean;
  /** Whether this tier can hand back a seekable clip. `false` → play/pause only. */
  seekable: boolean;
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  /** Bytes → a clip the caller owns. Rejects on a tier with `seekable: false`. */
  clip?(text: string, opts?: SpeakOptions): Promise<Clip>;
  cancel(): void;
}
```

`play()` is refactored into `clip()`; `speak()` becomes `clip()` plus an awaited
`ended`. The three byte tiers (`elevenLabs`, `openaiTts`, `bundledTts`) get
`seekable: true` and share one implementation. `webSpeech` keeps `speak` only,
`seekable: false`, no `clip`.

`voice.attach(a)` — the coach's face wiring — moves with the element and still runs
exactly once per clip.

### src/lib/timeline.ts

Pure arithmetic over durations. No audio, no React.

```ts
export interface Span { line: number; from: number; to: number } // seconds, cumulative

/** Line durations → cumulative spans. The chapter's timeline. */
export function spans(durations: number[]): Span[];

/** Which line a position falls in. -1 before the start, last line past the end. */
export function lineAt(spans: Span[], t: number): number;

/** Clamp a seek, and answer where the player should resume from. */
export function seek(spans: Span[], t: number): { line: number; offset: number };

/** t − 10, floored at 0, and the line/offset it lands in. §2.4's back-10s. */
export function back10(spans: Span[], t: number): { line: number; offset: number };
```

### The player in useListening

State: `position` (seconds into the chapter), `duration`, `rate`, `playing`,
`lineIdx`.

- **Preparation.** On entering a chapter, synthesise every line to a clip, in order,
  reporting progress through `Generating`'s `step` ("Preparing chapter 2 — line 4 of
  11"). Durations become the chapter's `spans`.
- **Playback.** Play line *n*, on `ended` advance to *n+1* at offset 0. `position` is
  `spans[n].from + el.currentTime`, sampled on `timeupdate`.
- **Pause/resume** — `el.pause()` / `el.play()`, position preserved.
- **Seek** — `seek(spans, t)`: pause the current element, set the target line's
  `currentTime` to `offset`, play. Dragging the progress bar seeks on release, not
  on every pixel.
- **Back 10s** — `back10`, same path.
- **Speed** — 0.75 / 1 / 1.25 written to every clip's `playbackRate`, and to new
  clips as they are made. The label says `0.75×`, with a unit (§3.3).
- **`heard`** stays as it is — set when the last line ends naturally — but a learner
  who seeks past the end has not heard it, so `heard` requires reaching the final
  line's `ended`, not a position past `duration`.

**Non-seekable tier.** With `seekable: false` the transport shows Play/Pause and
nothing else, plus one labelled line: "This voice can't be scrubbed. Switch to a
downloaded voice in Settings → Speech for the full controls." The progress bar is
absent, not disabled — a control that cannot work is not shown (§3.3's "etiketsiz
gösterge bulunmaz" and PLAN-016's rule about facts with no home).

### Chapter progress and resume

- `Chapter 2 of 3` is already rendered; make it the *primary* progress element, in
  one place, with the position bar under it.
- Chapter and position are written to `listening_sessions` (an `ADD COLUMN` for
  `chapter_idx INTEGER NOT NULL DEFAULT 0`), so re-entering Listen resumes at the
  chapter that was in progress rather than at chapter 1. Position within a chapter
  is not persisted — a chapter is short, and resuming mid-sentence is worse than
  restarting the chapter.

### Checks

`timeline.check.ts`:
- `spans([3, 4, 3])` → `[{0,3},{3,7},{7,10}]`;
- `lineAt` at a boundary belongs to the later line, and `-1` before 0;
- `back10` from 4 s → line 0 offset 0, never negative;
- `seek` past the end clamps to the last line's end, not past it;
- an empty chapter (`[]`) returns `[]` and every function survives it.

`speech.check.ts`:
- every tier's `seekable` flag matches whether it exposes `clip`;
- `speak()` still resolves on a tier where `clip` rejects.

## Do not touch

- The STT half (PLAN-018's work).
- `voice.ts` — the face wiring keeps its contract.
- Audio caching to disk. The existing ponytail note stands: a replay re-synthesises
  on the bundled tier. If that hurts, it is a later plan with a measurement behind it.
- No new dependency.

## Acceptance

- `npm run check` green.
- Play, pause, back-10s, 0.75×/1×/1.25× and dragging the bar all work on a
  downloaded voice, and the position bar tracks.
- On the OS-voice tier the transport shows play/pause and says why.
- Leaving Listen at chapter 2 and returning lands on chapter 2.

## Commit

```
feat(listen): a real timeline — clips, seeking, speed and back-10s (PLAN-025)
```

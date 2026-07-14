# What's inside Verba

The detail behind the [README](../README.md) — what is built, and why it is built
that way.

## Conversation core

- Tauri v2 desktop shell, React + TypeScript frontend.
- SQLite local-first data (conversation history + vocabulary/SRS) via `tauri-plugin-sql`.
- Provider adapters — **Ollama** (offline), **OpenAI**, **Anthropic**, **Gemini**,
  **OpenRouter**, **LM Studio** (local) — all routed through `tauri-plugin-http`,
  so there are no browser CORS limits.
- Chat loop with inline corrections, suggested replies, and an end-of-session summary.
- Vocabulary capture → SM-2 lite SRS review deck.

## Language packs

**Format v1** (`src/lib/packs/`) is a versioned, validated schema: metadata,
writing system, pronunciation, grammar guidance, prompt hints, speech locale, and
the bundled voices a language actually has. The active pack feeds the tutor's
system prompt *and* tells the speech tier which voices to offer.

**One folder per language** (`src/lib/packs/langs/<id>/`): a `pack.ts` literal plus
as many markdown documents as the language deserves — pronunciation, grammar,
register. They are shown to the learner in Settings, and when a doc says
`prompt: true`, read by the tutor on every turn. Adding a language is a folder and
one import line — see [CONTRIBUTING.md](../CONTRIBUTING.md).

**Registry** (`src/lib/packs/registry.ts`): packs are tagged **Official**,
**Community** (both reviewed), or **Unverified** (imported by you). A
compatibility gate checks format version and schema before any pack loads.

## Reading & scenarios

- **Reading** (`src/views/Read.tsx`): a dual-page reader (target | native) with
  synced sentence highlighting and tap-a-word explanations. *Story mode* generates
  adaptive stories from your interests, grammar focus and a length; *flow reading*
  keeps generating level-appropriate text as you go.
- **Scenario system v2** (`src/lib/scenarios.ts`): structured, versioned scenarios
  with goals and a soft level range; bundled and importable.

## Learning engine

- **Daily plan** (`src/lib/learn.ts`, the **Today** tab): themed conversation →
  reading → role-play → due-vocab review → wrap-up recap. The plan is deterministic
  given your level, weak areas and what's due, so one theme threads the whole day.
  Progress persists per date and the day ends with an AI recap.
- **Level estimation**: a self-reported CEFR level, plus an AI estimate read off
  your own messages (`src/lib/level.ts`), plus a *measured* composite
  (`src/lib/metrics.ts`) — vocabulary coverage, error rate and sentence complexity
  folded into a 0–100 CEFR score after each conversation.
- **Coaching** (`src/lib/coach.ts`): a weekly progress report over the last 7 days,
  and on-demand weak-area drills.

## Speech

Voice and dictation are resolved **independently**, each walking the same ladder and
stopping at the first rung that can serve:

**bundled → local server → cloud key → OS voice**

Offline mode disables only the cloud rung — bundled models and localhost are not the
network. Either half can be pinned to one tier in Settings.

The bundled tier (`src/lib/bundled.ts`, `src-tauri/src/speech.rs`) runs Piper/Kokoro
and Whisper **in-process** via sherpa-onnx. That was a choice: sherpa-onnx ships no
TTS server binary, so a sidecar would have meant building and shipping our own child
process — spawn/kill, crash-restart, a JSON-RPC protocol, a port — to save the ~0.6s
of model loading that caching the model in memory saves anyway. The cost is honest: a
crash inside onnxruntime takes the app with it, where a separate process would have
contained it.

The statically-linked engine adds **25 MB** to the app binary (19 MB → 44 MB on macOS
arm64). Models are not bundled — they are downloaded on request, verified by sha256,
and unpacked atomically, so a corrupt download installs nothing.

Whisper is given the active pack's language (`tr-TR` → `language=tr`), so a beginner's
accent is not auto-detected as English. The same is true of the local-server tier.

## Verify the pure logic

```bash
node --experimental-strip-types src/lib/srs.check.ts      # SRS scheduling
node --experimental-strip-types src/lib/phase2.check.ts   # pack/scenario validators + reading/level parsers
node --experimental-strip-types src/lib/phase3.check.ts   # daily plan engine + metrics + coaching + registry
node --experimental-strip-types src/lib/lang.check.ts     # segmentation, punctuation, pack guidance reaching every prompt
node --experimental-strip-types src/lib/speech.check.ts   # the speech ladder, and every tier degrading to the OS voice
```

The bundled engine has its own tests, which really download a model, really speak
Turkish, and really transcribe it back (~230 MB, once):

```bash
cd src-tauri && cargo test --release -- --nocapture
```

## Why MIT

Verba is [MIT](../LICENSE), chosen over AGPL deliberately: the whole point is that
anyone can bundle a language, fork the app, or ship it inside their own tool with the
least possible friction — the growth of **community packs** matters more than
defending against closed forks. The app is local-first and needs no server, so there
is no hosted-service moat to protect. A hosted version (managed sync, a shared pack
registry) is a plausible future *optional convenience*, not a gate.

## Not yet

Pronunciation analysis, shadowing, mobile apps, and domain packs
(technical/medical/business English).

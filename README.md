# ❄️ Verba

Local-first, provider-agnostic language-learning desktop app. Hold a full AI
conversation — including **offline via Ollama** — with inline grammar
corrections and automatic vocabulary capture, read AI-generated graded stories,
and drive it all by voice.

![Today — the daily session plan](./docs/screenshots/today.png)

A session is a plan, not a menu: one theme threads conversation, reading,
role-play and the words that are due today.

![Talk — conversation with the coach](./docs/screenshots/talk.png)

The coach speaks first and keeps the turn moving; suggestions are there for the
moment you stall, not to answer for you.

![Settings → Speech — the bundled tier](./docs/screenshots/speech.png)

Voice and dictation are picked independently, and the panel always names the tier
that is actually serving — here a 21 MB Piper voice running inside the app, with
no key and nothing on the network.

## Phase 1 — Conversation MVP

- Tauri v2 desktop shell, React + TypeScript frontend
- SQLite local-first data (conversation history + vocabulary/SRS) via `tauri-plugin-sql`
- Provider adapters: **Ollama** (offline), **OpenAI**, **Anthropic** — all routed
  through `tauri-plugin-http` so there are no browser CORS limits
- Conversation core: chat loop, inline corrections, suggested replies, end-of-session summary
- Vocabulary capture → SM-2 lite SRS review deck
- Settings: provider / model / API keys / language pair / level

## Phase 2 — Reading, Scenarios & Language Packs

- **Language pack format v1** (`src/lib/packs/`): a versioned, validated schema
  (metadata, writing system, pronunciation, grammar guidance, prompt hints,
  speech locale, recommended bundled voices). Official packs — English, Spanish,
  French, German, Japanese, Turkish — plus community Italian and Portuguese, plus
  paste-in import. The active pack feeds the tutor's system prompt, and tells the
  bundled speech tier which voices its language actually has.
- **Scenario system v2** (`src/lib/scenarios.ts`): structured, versioned
  scenarios with goals and a soft level range; bundled + importable.
- **Reading** (`src/views/Reading.tsx`): dual-page reader (target | native) with
  synced sentence highlighting and tap-a-word explanations.
  - **Story mode** — adaptive stories from interests, grammar focus, and length.
  - **Flow reading** — *Continue* keeps generating level-appropriate text.
- **Offline speech** (`src/lib/speech.ts`): a `SpeechAdapter` seam, with voice and
  dictation resolved independently: **bundled → local server → cloud key → OS**.
  The bundled tier (`src/lib/bundled.ts`, `src-tauri/src/speech.rs`) runs
  Piper/Kokoro and Whisper in-process via sherpa-onnx, on models downloaded on
  demand — see [Bundled speech](#bundled-speech-no-setup). The speak → transcribe
  → respond → speak loop is wired into Conversation (🎤).
- **Level estimation v1** (`src/lib/level.ts`): self-reported CEFR plus a soft AI
  estimate read off the learner's own messages after a session, shown in Settings.

## Phase 3 — Learning Engine & Community

- **Learning engine** (`src/lib/learn.ts`, **🗓️ Today** tab): a personalised
  daily session — themed conversation → reading → role-play → due-vocab review →
  wrap-up recap. The plan is deterministic given your level, weak areas, and
  what's due, so one theme threads the whole day; progress persists per date and
  the day finishes with an AI recap.
- **Level estimation v2** (`src/lib/metrics.ts`): a *measured* signal beside the
  v1 AI estimate — vocabulary coverage (type/token ratio + deck size), error rate
  (corrections per message), and sentence complexity fold into a 0–100 CEFR
  composite, computed from your own messages after each conversation.
- **Community pack registry** (`src/lib/packs/registry.ts`): packs are tagged
  **Official**, **Community** (both reviewed), or **Unverified** (imported by
  you). A compatibility gate checks format version + schema before any pack
  loads. The first merged community pack — **Italian** — ships in
  `src/lib/packs/community.ts` (plus Portuguese).
- **One folder per language** (`src/lib/packs/langs/<id>/`): a `pack.ts` literal
  plus as many markdown documents as the language deserves — pronunciation,
  grammar, register — shown to the learner in Settings, and, when a doc says
  `prompt: true`, read by the tutor on every turn. Adding a language is a folder
  and one import line; see [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Governance** ([CONTRIBUTING.md](./CONTRIBUTING.md)): pack quality criteria and
  the official-vs-community review flow.
- **More providers**: **Gemini**, **OpenRouter**, and **LM Studio** (local) for
  chat; **ElevenLabs** (cloud TTS) and **Deepgram** (cloud STT) as speech engines
  behind the existing `SpeechAdapter` seam — selectable in Settings. Speech also
  runs entirely on your own machine — see [Local speech](#local-speech).
- **Advanced coaching** (`src/lib/coach.ts`, on the Today tab): a weekly progress
  report over the last 7 days of activity, and on-demand weak-area drills.

### License & sustainability

Verba is **MIT** (see [LICENSE](./LICENSE)). We chose MIT over AGPL
deliberately: the whole point is that anyone can bundle a language, fork the
app, or ship it inside their own tool with the least possible friction — the
growth of **community packs** matters more than defending against closed forks.
The app is local-first and needs no server, so there is no hosted-service moat to
protect. A **hosted version** (managed sync, shared community-pack registry) is a
plausible future *optional convenience*, not a gate: the desktop app stays fully
functional offline and self-hosted, and any hosted piece would be an add-on
service rather than a reason to relicense.

## Run

Prerequisites: Node, Rust, and (for offline) [Ollama](https://ollama.com) running.

```bash
npm install
npm run tauri dev      # develop
npm run tauri build    # package the app
```

Pick a **language pack** and provider in **Settings**. `Test connection`
lists your installed Ollama models.

## Install a build

[**Latest release**](https://github.com/nuvocode/verba/releases/latest) — macOS
(Apple Silicon and Intel `.dmg`), Windows (`.exe` / `.msi`), Linux (`.AppImage`,
`.deb`, `.rpm`).

Nothing is **signed or notarised** — Verba has no Apple Developer certificate and
no Windows code-signing certificate, and we would rather ship the build than gate
it behind either. Both operating systems will therefore tell you it is dangerous:

- **macOS** reports *"Verba is damaged and can't be opened"*, which is a lie, but a
  load-bearing one — it means the same thing whether the app is merely unsigned or
  genuinely tampered with. Having read the source you are about to run:
  ```bash
  xattr -dr com.apple.quarantine /Applications/Verba.app
  ```
- **Windows** SmartScreen shows *"Windows protected your PC"* → *More info* → *Run
  anyway*.

Building it yourself (`npm run tauri build`) sidesteps both, and is the honest
option if the above makes you uncomfortable.

## Bundled speech (no setup)

The OS voices are free and offline but flat, and no webview ships a usable speech
recogniser — so dictation used to mean a cloud key or a Docker container. It no
longer does. **Settings → Speech → Bundled models** downloads a voice and a
transcriber that run inside the app: no server, no key, and nothing on the
network once they are on disk.

| | Model | Size | Speed |
|---|---|---|---|
| Voice | **Piper** — one voice per language | ~21 MB | ~7× faster than real time |
| Voice | **Kokoro** — 53 voices, six languages | 349 MB | ~2× faster than real time |
| Dictation | **Whisper** base / small | 208 MB / 639 MB | faster than real time |

Piper is what a pack recommends by default: it is a fiftieth of the download and
several times quicker, and for a conversation turn that matters more than the
last few percent of naturalness. Kokoro is there when you want the nicer voice
and will wait for it. Downloads are verified by sha256 and unpacked atomically —
a corrupt download installs nothing.

Not every engine speaks every language, and the packs know it: Kokoro has **no
German and no Turkish voice at all**, so those packs recommend Piper and Settings
badges it. Kokoro is still selectable — it will speak Turkish with a confident
foreign accent, which is your call to make, not ours.

Whisper is given the active pack's language (`tr-TR` → `language=tr`), so a
beginner's accent is not auto-detected as English.

It runs **in-process**, not as a sidecar: sherpa-onnx ships no TTS server binary,
so a sidecar would have meant building and shipping our own child process — with
spawn/kill, crash-restart, a JSON-RPC protocol and a port — to save the ~0.6s of
model loading that caching the model in memory saves anyway. The cost of that
choice is honest: a crash inside onnxruntime takes the app with it, where a
separate process would have contained it.

**Bundle size:** the statically-linked engine adds **25 MB** to the app binary
(19 MB → 44 MB on macOS arm64). Models are *not* bundled — they are downloaded on
request, and only the ones you ask for.

**Platform honesty:** CI builds macOS (both architectures), Windows and Linux, so
all four are packaged from the same source. But the bundled engine has only ever
*run* on macOS arm64 — the Rust binding fetches a prebuilt static library per
target and a green build proves it linked, not that it speaks. If you are the
first to run it on Windows or Linux and the voice does not come out, that is a
bug worth reporting, not you doing it wrong.

## Local speech (bring your own server)

Prefer to run your own speech server — or already have one? That tier is
untouched. Two containers, no accounts, nothing leaves the machine:

```bash
# Voice (TTS) — Kokoro-FastAPI, serves http://localhost:8880/v1
docker run --rm -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest

# Dictation (STT) — speaches / faster-whisper, serves http://localhost:8000/v1
docker run --rm -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cpu
```

Then **Settings → Speech → Local speech server**. The defaults already match the
URLs above (`kokoro` / `af_heart`, `Systran/faster-whisper-small`), and Settings
tells you whether each server is answering.

**Any OpenAI-compatible server works** — this talks plain `POST /audio/speech`
and `POST /audio/transcriptions`, so LocalAI, vLLM, or your own box on the LAN
are all just a different URL. Point it at `api.openai.com` with a key and it is
OpenAI's speech API.

Two things worth knowing:

- A local server **overrides** the ElevenLabs/Deepgram keys for whichever half
  has a URL, and **survives offline mode** — localhost is not the network. Leave
  a URL blank to keep that half on the cloud key or the OS voice.
- If the server dies mid-conversation, that turn **falls back to your system
  voice** and says so once. A speech box going down is a bad minute, not a dead
  session. (It is retried on the next turn — a server that comes back is picked
  straight back up.)

The transcriber is given the active pack's language (`es-ES` → `language=es`), so
a beginner's accented Spanish is not auto-detected as English.

## Which speech engine speaks?

The two halves — voice and dictation — are chosen **independently**, each walking
the same ladder and stopping at the first rung that can serve:

**bundled → local server → cloud key → OS voice**

Offline mode disables only the cloud rung; bundled models and localhost are not
the network. Any half can be pinned to one tier in Settings if you have several
installed and an opinion about which one speaks.

## Verify the pure logic

```bash
node --experimental-strip-types src/lib/srs.check.ts      # SRS scheduling
node --experimental-strip-types src/lib/phase2.check.ts   # pack/scenario validators + reading/level parsers
node --experimental-strip-types src/lib/phase3.check.ts   # daily plan engine + metrics v2 + coaching + registry
node --experimental-strip-types src/lib/lang.check.ts     # segmentation, punctuation, and pack guidance reaching every prompt
node --experimental-strip-types src/lib/speech.check.ts   # TTS/STT halves are picked independently; bundled → local → cloud → OS, and every tier degrades to the OS voice
```

The bundled engine has its own tests, which really download a model, really speak
Turkish, and really transcribe it back (~230 MB, once):

```bash
cd src-tauri && cargo test --release -- --nocapture
```

## Not yet (later phases)

Pronunciation analysis, shadowing, mobile apps, and domain packs
(technical/medical/business English).

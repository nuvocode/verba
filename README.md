# ❄️ Verba

Local-first, provider-agnostic language-learning desktop app. Hold a full AI
conversation — including **offline via Ollama** — with inline grammar
corrections and automatic vocabulary capture, read AI-generated graded stories,
and drive it all by voice.

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
  speech locale). Three bundled packs — Spanish, French, German — plus paste-in
  import for community packs. The active pack feeds the tutor's system prompt.
- **Scenario system v2** (`src/lib/scenarios.ts`): structured, versioned
  scenarios with goals and a soft level range; bundled + importable.
- **Reading** (`src/views/Reading.tsx`): dual-page reader (target | native) with
  synced sentence highlighting and tap-a-word explanations.
  - **Story mode** — adaptive stories from interests, grammar focus, and length.
  - **Flow reading** — *Continue* keeps generating level-appropriate text.
- **Offline speech** (`src/lib/speech.ts`): a `SpeechAdapter` seam. The default
  uses the webview's native SpeechSynthesis (TTS) + SpeechRecognition (STT) —
  offline TTS on macOS, capability-gated STT. The speak → transcribe → respond →
  speak loop is wired into Conversation (🎤). Whisper/Piper sidecar adapters are
  the documented next step.
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
- **Governance** ([CONTRIBUTING.md](./CONTRIBUTING.md)): pack quality criteria and
  the official-vs-community review flow.
- **More providers**: **Gemini**, **OpenRouter**, and **LM Studio** (local) for
  chat; **ElevenLabs** (cloud TTS) and **Deepgram** (cloud STT) as speech engines
  behind the existing `SpeechAdapter` seam — selectable in Settings.
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

## Verify the pure logic

```bash
node --experimental-strip-types src/lib/srs.check.ts      # SRS scheduling
node --experimental-strip-types src/lib/phase2.check.ts   # pack/scenario validators + reading/level parsers
node --experimental-strip-types src/lib/phase3.check.ts   # daily plan engine + metrics v2 + coaching + registry
```

## Not yet (later phases)

Whisper/Piper offline-speech sidecars, pronunciation analysis, shadowing, mobile
apps, and domain packs (technical/medical/business English).

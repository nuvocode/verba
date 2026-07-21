import { detectNativeLang } from "./langs.ts";
import { markDirty } from "./vault.ts";
import { migrateSpeech, type Tier } from "./speech.ts";
import { DEFAULT_WPM } from "./prompter.ts";

/** What the documented Docker one-liners listen on — the placeholder, and the value
 *  "Local server" seeds itself with when it has nothing yet. */
export const LOCAL_TTS_URL = "http://localhost:8880/v1";
export const LOCAL_STT_URL = "http://localhost:8000/v1";

export type ProviderId = "ollama" | "openai" | "anthropic" | "gemini" | "openrouter" | "lmstudio";
/** When a correction is shown inline: as it happens, only when severe, or only at reflection. */
export type CorrectionTiming = "adaptive" | "live" | "delayed";
/**
 * The two ways to work a passage. `passage` is close reading — focus a sentence, tap a
 * word, read the coach's note. `prompter` is the same text moving up the screen at a
 * pace you set, to be read out loud. Same passage, two exercises.
 */
export type ReadView = "passage" | "prompter";

/** Providers that run on the learner's own machine — the only ones allowed in offline mode. */
export const LOCAL_PROVIDERS: ProviderId[] = ["ollama", "lmstudio"];
export const isLocalProvider = (p: ProviderId) => LOCAL_PROVIDERS.includes(p);

export interface Settings {
  provider: ProviderId;
  ollamaModel: string;
  ollamaHost: string;
  openaiModel: string;
  openaiKey: string;
  anthropicModel: string;
  anthropicKey: string;
  geminiModel: string;
  geminiKey: string;
  openrouterModel: string;
  openrouterKey: string;
  lmstudioModel: string;
  lmstudioHost: string;
  nativeLang: string; // learner's first language — explanations are given in it
  targetLang: string; // language being practised
  cefr: string; // self-reported level (A1–C2), "" until the first conversation places them
  packId: string; // active language pack (see lib/packs) — "" for none
  speak: boolean; // read AI replies / reading text aloud (TTS)
  // The two halves of speech are picked independently: a key means "use it",
  // empty means the OS voices (TTS) or no dictation at all (STT — no webview
  // ships a recogniser). Offline mode pins both to the OS regardless.
  elevenLabsKey: string; // TTS
  deepgramKey: string; // STT
  // The local tier: any OpenAI-compatible speech server the learner runs (Kokoro
  // for voice, speaches for dictation). It outranks the cloud keys for whichever
  // half has a URL, and survives offline mode — localhost is not the network. The
  // URL is the whole on/off: blank means the tier isn't there.
  localTtsUrl: string; // "" → this half falls back to the cloud key / OS voices
  localTtsModel: string;
  localTtsVoice: string; // server-specific name, so the learner types it
  localSttUrl: string; // "" → likewise
  localSttModel: string;
  // The bundled tier: models the app downloads and runs itself (lib/bundled.ts).
  // These hold a *catalog id*, written only once a download has verified — the
  // model files themselves live under appDataDir, never in here.
  bundledTtsModel: string; // "" → no bundled voice; the tier is skipped
  bundledTtsVoice: number; // sherpa speaker id inside that model (Kokoro has many)
  bundledSttModel: string; // "" → likewise
  // Where each half gets its speech — the "source" the Speech panel asks for.
  // "auto" walks bundled → local → cloud → OS, which is what almost everyone wants;
  // anything else pins that half, and the panel then shows only that source's config.
  ttsTier: Tier;
  sttTier: Tier;
  onboarded: boolean; // false → the welcome flow runs instead of the app
  dailyMinutes: number; // how long a session should be, from onboarding
  goals: string[]; // why they're learning — steers scenarios and reading topics; may be empty
  theme: "light" | "dark";
  correctionTiming: CorrectionTiming;
  offline: boolean; // hard-forces local providers; cloud options are disabled
  showHints: boolean; // keyboard hint lines under each screen
  // Which way the reading screen was left. It lives here, not in useRead, because the
  // whole point is that it outlives the passage — and the session.
  readView: ReadView;
  prompterWpm: number; // the pace they last read out loud at (lib/prompter clamps it)
}

/** The level to write prompts against. "" (skipped) reads as A2 until the first conversation places them. */
export const level = (s: Settings) => s.cefr || "A2";

/** What "Skip setup" from step 2 onward leaves behind: level unset, a short session, no interests. */
export const SKIP_DEFAULTS = { cefr: "", dailyMinutes: 20, goals: [] as string[] };

/**
 * Replaying onboarding starts the setup over: language, level, rhythm and interests are
 * cleared so nothing is silently pre-answered. Provider config, saved vocabulary and
 * history survive — the confirm dialog says so before anything is written.
 */
export const onboardingReset = (): Partial<Settings> => ({
  onboarded: false,
  packId: defaultSettings.packId,
  targetLang: defaultSettings.targetLang,
  cefr: defaultSettings.cefr,
  dailyMinutes: defaultSettings.dailyMinutes,
  goals: [],
});

const KEY = "verba.settings";

export const defaultSettings: Settings = {
  provider: "ollama",
  ollamaModel: "gemma4:e2b-mlx",
  ollamaHost: "http://localhost:11434",
  openaiModel: "gpt-4o-mini",
  openaiKey: "",
  anthropicModel: "claude-sonnet-5",
  anthropicKey: "",
  geminiModel: "gemini-2.5-flash",
  geminiKey: "",
  openrouterModel: "openai/gpt-4o-mini",
  openrouterKey: "",
  lmstudioModel: "local-model",
  lmstudioHost: "http://localhost:1234/v1",
  nativeLang: detectNativeLang(),
  targetLang: "Spanish",
  cefr: "B1",
  packId: "es",
  speak: true,
  elevenLabsKey: "",
  deepgramKey: "",
  // Blank until the learner picks "Local server" as a source, which fills in the URL
  // the documented Docker one-liner listens on — so picking it is the whole setup.
  // Nothing is contacted until then.
  localTtsUrl: "",
  localTtsModel: "kokoro",
  localTtsVoice: "af_heart",
  localSttUrl: "",
  localSttModel: "Systran/faster-whisper-small",
  // Nothing bundled until the learner downloads something — models are hundreds
  // of megabytes and never arrive without a click.
  bundledTtsModel: "",
  bundledTtsVoice: 0,
  bundledSttModel: "",
  ttsTier: "auto",
  sttTier: "auto",
  onboarded: false,
  dailyMinutes: 45,
  goals: [],
  theme: "light",
  correctionTiming: "adaptive",
  offline: true,
  showHints: true,
  // Close reading is the default and stays the default — the teleprompter is a second
  // exercise you opt into, not a new front door.
  readView: "passage",
  prompterWpm: DEFAULT_WPM,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...migrateSpeech(JSON.parse(raw)) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
  // Settings are half of what a second machine needs to not be reconfigured, so
  // a sync folder has to hear about them exactly as loudly as it hears about a
  // finished conversation. This is the one door they are written through.
  markDirty();
}

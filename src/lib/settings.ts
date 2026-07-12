import { detectNativeLang } from "./langs.ts";

export type ProviderId = "ollama" | "openai" | "anthropic" | "gemini" | "openrouter" | "lmstudio";
export type SpeechEngine = "web" | "elevenlabs" | "deepgram";
/** When a correction is shown inline: as it happens, only when severe, or only at reflection. */
export type CorrectionTiming = "adaptive" | "live" | "delayed";

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
  speechEngine: SpeechEngine; // TTS/STT backend — web (offline) or a cloud API
  elevenLabsKey: string;
  deepgramKey: string;
  onboarded: boolean; // false → the welcome flow runs instead of the app
  dailyMinutes: number; // how long a session should be, from onboarding
  goals: string[]; // why they're learning — steers scenarios and reading topics; may be empty
  theme: "light" | "dark";
  correctionTiming: CorrectionTiming;
  offline: boolean; // hard-forces local providers; cloud options are disabled
  showHints: boolean; // keyboard hint lines under each screen
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
  speechEngine: "web",
  elevenLabsKey: "",
  deepgramKey: "",
  onboarded: false,
  dailyMinutes: 45,
  goals: [],
  theme: "light",
  correctionTiming: "adaptive",
  offline: true,
  showHints: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

import { detectNativeLang } from "./langs.ts";
import { markDirty } from "./vault.ts";
import { migrateSpeech, type Tier } from "./speech.ts";
import { DEFAULT_WPM } from "./prompter.ts";
import { CEFR_LEVELS, type CEFRLevel, type LearnerProfile } from "./model.ts";

/** What the documented Docker one-liners listen on — the placeholder, and the value
 *  "Local server" seeds itself with when it has nothing yet. */
export const LOCAL_TTS_URL = "http://localhost:8880/v1";
export const LOCAL_STT_URL = "http://localhost:8000/v1";

/** The language a fresh install starts on — a product default, not display text (#14). */
export const DEFAULT_TARGET_LANGUAGE = "Spanish";

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
  /**
   * Let a reasoning model think before it answers.
   *
   * Off by default. Thinking is charged entirely to the pause before the coach
   * starts speaking — the learner watches an empty screen for the whole of it —
   * and a two-sentence reply at A2 is not the kind of problem it pays for. The
   * models that don't reason ignore this either way.
   */
  thinking: boolean;
  /**
   * The learner's one shared record — language, level, interests, the coach's
   * level estimate, streak. The single door every surface reads the level
   * through is `levelOf(profile)` (lib/model.ts).
   */
  profile: LearnerProfile;
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
  theme: "light" | "dark";
  correctionTiming: CorrectionTiming;
  offline: boolean; // hard-forces local providers; cloud options are disabled
  showHints: boolean; // keyboard hint lines under each screen
  // Which way the reading screen was left. It lives here, not in useRead, because the
  // whole point is that it outlives the passage — and the session.
  readView: ReadView;
  prompterWpm: number; // the pace they last read out loud at (lib/prompter clamps it)
}

/** What "Skip setup" from step 2 onward leaves behind: the A2 fallback (the old
 *  "unset level" now reads as A2 directly), a short session, no interests. */
export const SKIP_DEFAULTS = { level: "A2" as CEFRLevel, dailyMinutes: 20, interests: [] as string[] };

/**
 * Replaying onboarding starts the setup over: language, level, rhythm and interests are
 * cleared so nothing is silently pre-answered. Provider config, saved vocabulary and
 * history survive — the confirm dialog says so before anything is written.
 */
export const onboardingReset = (): Partial<Settings> => ({
  onboarded: false,
  packId: defaultSettings.packId,
  profile: { ...defaultSettings.profile, interests: [] },
  dailyMinutes: defaultSettings.dailyMinutes,
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
  thinking: false,
  // One shared record — see the field's doc on the interface. createdAt/timezone
  // stay 0/"" here: migrateProfile stamps them on first write, so defaultSettings
  // stays clock-free (a plan can be built without ever asking the clock).
  profile: {
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
    nativeLanguage: detectNativeLang(),
    level: "B1",
    interests: [],
    goals: [],
    weaknesses: [],
    levelEstimate: { value: 0, label: "A1", confidence: "low", sampleSize: 0 },
    createdAt: 0,
    streak: 0,
    timezone: "",
  },
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
  theme: "light",
  correctionTiming: "adaptive",
  offline: true,
  showHints: true,
  // Close reading is the default and stays the default — the teleprompter is a second
  // exercise you opt into, not a new front door.
  readView: "passage",
  prompterWpm: DEFAULT_WPM,
};

const isCefrLevel = (v: unknown): v is CEFRLevel =>
  typeof v === "string" && (CEFR_LEVELS as readonly string[]).includes(v);

/**
 * v2 nested the learner's four flat fields into one `profile`. One-way, and the
 * one place the old "unset level" fallback survives: a missing or unrecognised
 * `cefr` reads as "A2", exactly as the deleted `level()` helper did. `goals` were
 * really interests (the chips that steer themes), so they land in `interests` and
 * `goals` starts empty. `levelEstimate` is never back-filled here — it is the
 * coach's observation, and migration has not observed anything. `createdAt` and
 * `timezone` are stamped here (the clock lives at the write, not in the defaults).
 */
export function migrateProfile<T extends Record<string, unknown>>(raw: T): T {
  if ("profile" in raw) return raw; // already nested — idempotent
  const { cefr, targetLang, nativeLang, goals, ...rest } = raw as T & {
    cefr?: unknown;
    targetLang?: unknown;
    nativeLang?: unknown;
    goals?: unknown;
  };
  const level: CEFRLevel = isCefrLevel(cefr) ? cefr : "A2";
  return {
    ...rest,
    profile: {
      targetLanguage: typeof targetLang === "string" ? targetLang : DEFAULT_TARGET_LANGUAGE,
      nativeLanguage: typeof nativeLang === "string" ? nativeLang : detectNativeLang(),
      level,
      levelEstimate: { value: 0, label: "A1", confidence: "low", sampleSize: 0 },
      interests: Array.isArray(goals) ? goals.filter((g): g is string => typeof g === "string") : [],
      goals: [],
      weaknesses: [],
      createdAt: Date.now(),
      streak: 0,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  } as unknown as T;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...migrateProfile(migrateSpeech(JSON.parse(raw))) };
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

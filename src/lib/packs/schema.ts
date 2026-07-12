// Language pack format v1 — the versioned contract that lets a language be
// bundled with the app OR community-authored and loaded at runtime. Every pack
// (bundled or imported) goes through validatePack() at the trust boundary.

export const PACK_FORMAT_VERSION = 1;

export interface SpeechConfig {
  /** BCP-47 locale for browser SpeechSynthesis / SpeechRecognition, e.g. "es-ES". */
  locale: string;
  /** Preferred TTS voice-name substring, used if the user has it installed. */
  voiceHint?: string;
}

export interface LanguagePack {
  formatVersion: number;
  id: string; // stable slug, e.g. "es"
  name: string; // English name, e.g. "Spanish"
  nativeName: string; // endonym, e.g. "Español"
  emoji: string; // flag / marker
  direction: "ltr" | "rtl"; // drives reader layout
  writingSystem: string; // "Latin", "Arabic", "Han", …
  pronunciation: string[]; // short notes surfaced to the learner + fed to prompts
  grammar: string[]; // grammar guidance the tutor prompt must respect
  promptHint: string; // extra instruction appended to the system prompt
  speech: SpeechConfig;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  pack?: LanguagePack;
}

// ponytail: hand-rolled validator — a few lines beat pulling in Zod, and it
// gives community authors precise messages. Upgrade to Zod + a YAML loader if
// packs grow deep nested schemas or ship as .yaml.
export function validatePack(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const o = raw as any;
  const str = (k: string) => {
    if (typeof o?.[k] !== "string" || !o[k].trim()) errors.push(`"${k}" must be a non-empty string`);
  };
  const strArr = (k: string) => {
    if (!Array.isArray(o?.[k]) || o[k].some((x: any) => typeof x !== "string"))
      errors.push(`"${k}" must be an array of strings`);
  };
  if (o?.formatVersion !== PACK_FORMAT_VERSION) errors.push(`"formatVersion" must be ${PACK_FORMAT_VERSION}`);
  ["id", "name", "nativeName", "emoji", "writingSystem", "promptHint"].forEach(str);
  ["pronunciation", "grammar"].forEach(strArr);
  if (o?.direction !== "ltr" && o?.direction !== "rtl") errors.push(`"direction" must be "ltr" or "rtl"`);
  if (typeof o?.speech?.locale !== "string" || !o.speech.locale.trim())
    errors.push(`"speech.locale" must be a non-empty BCP-47 string (e.g. "es-ES")`);
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], pack: o as LanguagePack };
}

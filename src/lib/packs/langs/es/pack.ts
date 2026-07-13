import { PACK_FORMAT_VERSION, type LanguagePack } from "../../schema.ts";

export const pack: LanguagePack = {
  formatVersion: PACK_FORMAT_VERSION,
  id: "es",
  name: "Spanish",
  nativeName: "Español",
  emoji: "🇪🇸",
  direction: "ltr",
  writingSystem: "Latin",
  pronunciation: [
    "Every letter is pronounced; spelling is highly phonetic.",
    "'ñ' is /ɲ/ (like the 'ny' in canyon); 'll' and 'y' are similar.",
    "Stress falls on the marked accented vowel, e.g. está, música.",
  ],
  grammar: [
    "Two genders (el/la); adjectives agree in gender and number.",
    "Distinguish ser (permanent) from estar (state/location).",
    "Verbs conjugate for person; subject pronouns are usually dropped.",
  ],
  promptHint:
    "Use tú for a friendly register unless the scenario calls for usted. Prefer everyday peninsular or neutral Latin-American vocabulary.",
  speech: { locale: "es-ES", voiceHint: "Spanish", recommendedVoices: ["piper-es", "kokoro"] },
};

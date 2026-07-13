import { PACK_FORMAT_VERSION, type LanguagePack } from "../../schema.ts";

export const pack: LanguagePack = {
  formatVersion: PACK_FORMAT_VERSION,
  id: "it",
  name: "Italian",
  nativeName: "Italiano",
  emoji: "🇮🇹",
  direction: "ltr",
  writingSystem: "Latin",
  pronunciation: [
    "Spelling is phonetic; double consonants are held longer (nonno vs nono).",
    "'c'/'g' are soft before e/i (ciao, gelato), hard before a/o/u.",
    "'gli' is /ʎ/ (like 'lli' in million); 'gn' is /ɲ/ (like Spanish ñ).",
  ],
  grammar: [
    "Two genders (il/la); adjectives agree in gender and number.",
    "Subject pronouns are usually dropped; the verb ending carries the person.",
    "Passato prossimo uses essere or avere as the auxiliary — choose carefully.",
  ],
  promptHint:
    "Use tu for friendly registers and Lei for formal ones (hotel, interview). Prefer standard central-Italian vocabulary.",
  speech: { locale: "it-IT", voiceHint: "Italian" },
};

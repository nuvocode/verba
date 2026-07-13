import { PACK_FORMAT_VERSION, type LanguagePack } from "../../schema.ts";

export const pack: LanguagePack = {
  formatVersion: PACK_FORMAT_VERSION,
  id: "fr",
  name: "French",
  nativeName: "Français",
  emoji: "🇫🇷",
  direction: "ltr",
  writingSystem: "Latin",
  pronunciation: [
    "Final consonants are often silent (petit → /pəti/).",
    "Nasal vowels: on, an, in, un have no English equivalent.",
    "Liaison links a final consonant to a following vowel (les_amis).",
  ],
  grammar: [
    "Two genders (le/la); adjectives agree and often follow the noun.",
    "Negation wraps the verb: ne … pas.",
    "Use tu (informal) vs vous (formal/plural) appropriately.",
  ],
  promptHint:
    "Default to tu for casual scenarios and vous for formal ones (hotel, interview). Keep contractions natural (j'ai, c'est).",
  speech: { locale: "fr-FR", voiceHint: "French" },
};

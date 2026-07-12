import { PACK_FORMAT_VERSION, type LanguagePack } from "./schema.ts";

// Three bundled language packs. Same shape a community author would ship, so
// these double as reference examples. Add more by dropping another literal here
// or importing a pack JSON in Settings.
export const BUNDLED_PACKS: LanguagePack[] = [
  {
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
    speech: { locale: "es-ES", voiceHint: "Spanish" },
  },
  {
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
  },
  {
    formatVersion: PACK_FORMAT_VERSION,
    id: "de",
    name: "German",
    nativeName: "Deutsch",
    emoji: "🇩🇪",
    direction: "ltr",
    writingSystem: "Latin",
    pronunciation: [
      "Nouns are always capitalised.",
      "'ch' has two sounds: soft (ich) and hard (Bach); 'ß' is a sharp s.",
      "Vowels with umlaut (ä, ö, ü) change the sound distinctly.",
    ],
    grammar: [
      "Three genders (der/die/das) and four cases (Nom/Akk/Dat/Gen).",
      "The finite verb sits in second position in main clauses.",
      "Separable-prefix verbs split (aufstehen → ich stehe … auf).",
    ],
    promptHint:
      "Use du for casual scenarios, Sie for formal ones. Keep sentences short at lower levels; introduce cases gradually.",
    speech: { locale: "de-DE", voiceHint: "German" },
  },
];

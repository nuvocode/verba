import { PACK_FORMAT_VERSION, type LanguagePack } from "./schema.ts";

// Three bundled language packs. Same shape a community author would ship, so
// these double as reference examples. Add more by dropping another literal here
// or importing a pack JSON in Settings.
export const BUNDLED_PACKS: LanguagePack[] = [
  {
    formatVersion: PACK_FORMAT_VERSION,
    id: "en",
    name: "English",
    nativeName: "English",
    emoji: "🇬🇧",
    direction: "ltr",
    writingSystem: "Latin",
    pronunciation: [
      "Spelling is not phonetic — the same letters take many sounds (through, tough, though).",
      "Stress carries meaning: REcord (noun) vs reCORD (verb).",
      "Unstressed vowels collapse to a schwa /ə/ (banana, about).",
    ],
    grammar: [
      "Word order is fixed: subject–verb–object. There is no gender on nouns.",
      "Articles (a/an/the) are obligatory and a common source of error.",
      "Phrasal verbs (get up, put off, run into) carry much of everyday meaning.",
    ],
    promptHint:
      "Use a neutral, friendly register. Prefer common contractions (I'm, don't, it's) and everyday phrasal verbs over formal Latinate synonyms.",
    speech: { locale: "en-US", voiceHint: "English" },
  },
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
  {
    formatVersion: PACK_FORMAT_VERSION,
    id: "ja",
    name: "Japanese",
    nativeName: "日本語",
    emoji: "🇯🇵",
    direction: "ltr",
    writingSystem: "Kana + Kanji",
    pronunciation: [
      "Pitch accent, not stress, distinguishes words (hashi: bridge vs chopsticks).",
      "Every mora takes the same length; long vowels (おばあさん) count double.",
      "The 'r' sounds are a single tap, between English r and l.",
    ],
    grammar: [
      "Word order is subject–object–verb; the verb always comes last.",
      "Particles mark role: は (topic), が (subject), を (object), に/で (place).",
      "Politeness is grammatical — choose です/ます or plain form and stay consistent.",
    ],
    // The reader used to split target text on spaces, so this hint asked for
    // spaced-out kana — Japanese that no Japanese person writes. lib/text now
    // segments properly, so the pack can ask for the real language again.
    promptHint:
      "Default to です/ます form. Write natural Japanese with no spaces between words. At A1–A2 keep kanji to the common ones and gloss each in parentheses on first use (学生(がくせい)); from B1 use kanji normally.",
    speech: { locale: "ja-JP", voiceHint: "Japanese" },
  },
];

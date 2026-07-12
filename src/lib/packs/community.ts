import { PACK_FORMAT_VERSION, type LanguagePack } from "./schema.ts";

// Community-contributed packs that have passed review (see CONTRIBUTING.md) and
// been merged into the repo. They ship with the app but are tagged origin
// "community" by the registry so the UI can still surface who authored them.
// The first external contribution — Italian — lives here; adding another is a
// pull request that drops a literal in this array.
export const COMMUNITY_PACKS: LanguagePack[] = [
  {
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
  },
  {
    formatVersion: PACK_FORMAT_VERSION,
    id: "pt",
    name: "Portuguese",
    nativeName: "Português",
    emoji: "🇧🇷",
    direction: "ltr",
    writingSystem: "Latin",
    pronunciation: [
      "Nasal vowels marked with ~ (ã, õ) and by m/n at syllable end (bom, então).",
      "Final unstressed 'o' sounds like /u/; 'e' often like /i/.",
      "European and Brazilian accents differ; this pack leans Brazilian.",
    ],
    grammar: [
      "Two genders (o/a); adjectives agree in gender and number.",
      "Distinguish ser (permanent) from estar (state/location), like Spanish.",
      "Personal infinitive is a distinctive Portuguese feature — introduce it late.",
    ],
    promptHint:
      "Use você for everyday register in Brazilian Portuguese. Keep contractions natural (no, na, do, da).",
    speech: { locale: "pt-BR", voiceHint: "Portuguese" },
  },
];

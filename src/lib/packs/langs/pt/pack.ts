import { PACK_FORMAT_VERSION, type LanguagePack } from "../../schema.ts";

export const pack: LanguagePack = {
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
};

import { PACK_FORMAT_VERSION, type LanguagePack } from "../../schema.ts";

export const pack: LanguagePack = {
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
};

import { PACK_FORMAT_VERSION, type LanguagePack } from "../../schema.ts";

export const pack: LanguagePack = {
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
};

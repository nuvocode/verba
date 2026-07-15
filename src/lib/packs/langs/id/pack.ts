import { PACK_FORMAT_VERSION, type LanguagePack } from "../../schema.ts";

export const pack: LanguagePack = {
  formatVersion: PACK_FORMAT_VERSION,
  id: "id",
  name: "Indonesian",
  nativeName: "Bahasa Indonesia",
  emoji: "🇮🇩",
  direction: "ltr",
  writingSystem: "Latin",
  pronunciation: [
    "Spelling is highly phonetic; Most words are pronounced as they are written.",
    "Stress usually falls on the second-to-last syllable, though there are exceptions.",
    "The letters 'c', 'j', 'g', 'ng', and 'ny' have consistent pronunciations across most words.",
  ],
  grammar: [
    "Nouns have no grammatical gender and do not change for number.",
    "Verbs are not conjugated for person, number, or tense; time is usually shown with context or time expressions.",
    "Word order is generally Subject–Verb–Object (SVO), with prefixes and suffixes playing an important role in word formation.",
  ],
  promptHint:
    "Teach Standard Indonesian (Bahasa Indonesia). Prefer formal, standard vocabulary unless the scenario naturally calls for informal everyday speech. Explain important affixes when they affect meaning.",
  speech: { locale: "id-ID", voiceHint: "Indonesian", recommendedVoices: ["piper-id"] },
};

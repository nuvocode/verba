import { PACK_FORMAT_VERSION, type LanguagePack } from "../../schema.ts";

export const pack: LanguagePack = {
  formatVersion: PACK_FORMAT_VERSION,
  id: "tr",
  name: "Turkish",
  nativeName: "Türkçe",
  emoji: "🇹🇷",
  direction: "ltr",
  writingSystem: "Latin",
  pronunciation: [
    "Spelling is fully phonetic: every letter is pronounced, always the same way.",
    "Dotted 'i' and dotless 'ı' are different letters and different vowels (/i/ vs /ɯ/).",
    "'c' is /dʒ/ (as in jam), 'ç' is /tʃ/, 'ş' is /ʃ/; 'ğ' lengthens the vowel before it.",
    "Stress usually falls on the last syllable, but place names and many loanwords do not.",
  ],
  grammar: [
    "Agglutinative: meaning is built by stacking suffixes onto a stem (ev-ler-im-de = 'in my houses').",
    "Vowel harmony decides which form a suffix takes; suffixes follow the last vowel of the stem.",
    "Word order is subject–object–verb, and the verb comes last.",
    "No grammatical gender and no definite article.",
  ],
  promptHint:
    "Use the informal sen unless the scenario is formal, where siz is expected. Introduce suffixes one at a time — a learner who meets three stacked at once learns none of them.",
  // Kokoro has no Turkish voice, so the bundled tier steers to Piper here. Kokoro
  // is still selectable in Settings; it will simply speak Turkish with an accent
  // it does not have, which is a choice the learner is allowed to make.
  speech: { locale: "tr-TR", voiceHint: "Turkish", recommendedVoices: ["piper-tr"] },
};

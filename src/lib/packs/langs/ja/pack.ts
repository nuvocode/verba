import { PACK_FORMAT_VERSION, type LanguagePack } from "../../schema.ts";

export const pack: LanguagePack = {
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
  speech: { locale: "ja-JP", voiceHint: "Japanese", recommendedVoices: ["kokoro"] },
};

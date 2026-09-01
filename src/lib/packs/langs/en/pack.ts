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
  speech: { locale: "en-US", voiceHint: "English", recommendedVoices: ["piper-en", "kokoro"] },
  stopwords: [
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "it", "is", "was", "are", "were", "be",
    "i", "you", "he", "she", "we", "they", "this", "that", "there", "with", "for", "as", "by", "from", "so",
    "then", "now", "not", "no", "yes", "very", "just", "also", "too", "his", "her", "its", "their", "my", "your",
    "our", "me", "him", "them", "us", "do", "does", "did", "have", "has", "had", "can", "could", "will", "would",
    "should", "may", "might", "must", "about", "into", "over", "after", "before", "between", "through", "during",
    "when", "where", "which", "who", "whom", "what", "how", "why", "if", "because", "while", "until", "up", "down",
    "out", "off", "again", "once", "here", "there", "all", "any", "both", "each", "few", "more", "most", "other",
    "some", "such", "only", "own", "same", "than", "too", "very", "s", "t", "don", "doesn", "didn", "isn", "aren",
    "wasn", "weren", "won", "can", "couldn", "wouldn", "shouldn", "mightn", "mustn",
  ],
  negations: [
    "not", "no", "never", "don't", "doesn't", "didn't", "isn't", "aren't",
    "wasn't", "weren't", "won't", "can't", "cannot", "couldn't", "wouldn't", "shouldn't",
  ],
};

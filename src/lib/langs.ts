// Native-language detection and the list behind the "change" picker.
// ponytail: Intl.DisplayNames does the code→name mapping, so the only thing we
// hand-maintain is the code list. Swap for a full CLDR list if a learner's
// language is missing.

const CODES = [
  "en","es","fr","de","it","pt","nl","sv","nb","da","fi","is","pl","cs","sk","hu","ro","bg","el","ru","uk","sr","hr","sl","lt","lv","et","sq","tr","az","kk","ka","hy","ar","he","fa","ur","hi","bn","pa","ta","te","ml","mr","gu","ne","si","th","vi","id","ms","tl","km","my","mn","ja","ko","zh","sw","am","af","ca","eu","gl","ga","cy",
];

const names = () => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    return null;
  }
};

/** English name for a BCP-47 code ("tr-TR" → "Turkish"). Falls back to the code. */
export function langName(code: string): string {
  const base = code.split("-")[0];
  return names()?.of(base) ?? base;
}

/** Every language offerable as a native language, sorted by English name. */
export function languages(): { code: string; name: string }[] {
  return CODES.map((code) => ({ code, name: langName(code) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The learner's language per the OS locale. English if the platform won't say. */
export function detectNativeLang(): string {
  const locale = typeof navigator !== "undefined" ? navigator.language : "";
  return locale ? langName(locale) : "English";
}

/** The interface languages offered on screen 0. Short on purpose: a language on
 *  this list is one Verba intends to be readable in, not every locale Intl knows. */
export const UI_LANGUAGES = ["en", "tr", "es", "fr", "de", "pt", "it", "id", "ja"] as const;

/** A language's name in its own language ("tr" → "Türkçe"). Falls back to the code. */
export function endonym(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
}

/** The reverse of `langName`: "Turkish" → "tr". "" when no code maps to that name. */
export function langCode(name: string): string {
  const n = name.trim().toLowerCase();
  return CODES.find((c) => langName(c).trim().toLowerCase() === n) ?? "";
}

/** A language's name as another language writes it — langNameIn("es", "tr") → "İspanyolca".
 *  Falls back to `langName(code)` when the locale is unknown to Intl. */
export function langNameIn(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) || langName(code);
  } catch {
    return langName(code);
  }
}

// PLAN-042: the L1 gate's two halves — a script probe for a piece of text, and a
// per-language lookup that turns a language into text the probe can read.

// The scripts the gate can tell apart. This is the closed set the offer list is
// written in; anything else is measured by whichever of these dominates, or is
// Latin by default. No dependency, no table library — just `\p{Script=…}`.
const SCRIPT_NAMES = [
  "Latin",
  "Cyrillic",
  "Greek",
  "Han",
  "Hiragana",
  "Katakana",
  "Hangul",
  "Arabic",
  "Hebrew",
  "Devanagari",
  "Bengali",
  "Gurmukhi",
  "Tamil",
  "Telugu",
  "Malayalam",
  "Gujarati",
  "Sinhala",
  "Thai",
  "Khmer",
  "Myanmar",
  "Georgian",
  "Armenian",
  "Ethiopic",
  "Tibetan",
];

/**
 * The dominant script of a piece of text, as a Unicode script name — "Latin",
 * "Han", "Hiragana", "Cyrillic", "Arabic"… `null` when the text carries no
 * letters. Used by the L1 gate: when the two languages do not share a script, a
 * span in the wrong one was not a fallback, and checkable for nothing.
 *
 * `\p{Script=…}` regex classes, no table and no dependency. Two languages that
 * **share** a script get gate 1 only, and the verification says so plainly
 * rather than implying a check that is not running — for Spanish and English
 * this signal rests on the model.
 */
export function scriptOf(text: string): string | null {
  if (!text) return null;
  if (!/[\p{L}]/u.test(text)) return null; // no letters → no script to be dominant
  let best: string | null = null;
  let bestCount = 0;
  for (const name of SCRIPT_NAMES) {
    const count = (text.match(new RegExp(`\\p{Script=${name}}`, "gu")) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      best = name;
    }
  }
  return best;
}

// A representative character per language that is not written in Latin, so the
// gate can ask "what script is this language?" The offer list is mostly Latin;
// every non-Latin script there has its sample spelled out, and a language absent
// from this map is Latin by default — the same default the gate's "no script
// known" rule uses: an unmeasurable language is treated as sharing the learner's
// own script rather than silently deleting real fallbacks.
const SCRIPT_SAMPLE: Record<string, string> = {
  ja: "あ", // Japanese mixes kana + kanji; Hiragana is the distinct, checkable half.
  ko: "한",
  zh: "文",
  ru: "ы",
  uk: "и",
  bg: "б",
  sr: "р",
  mk: "ќ",
  mn: "м",
  kk: "қ",
  be: "ы",
  el: "λ",
  ka: "ა",
  hy: "ա",
  ar: "ا",
  fa: "ا",
  ur: "ا",
  ps: "ا",
  he: "א",
  hi: "क",
  mr: "क",
  ne: "क",
  bn: "ব",
  pa: "ਪ",
  ta: "த",
  te: "త",
  ml: "മ",
  gu: "ગ",
  si: "ස",
  th: "ท",
  km: "ក",
  my: "မ",
  am: "ሀ",
  ti: "ሀ",
};

/**
 * The dominant script of a language — by code ("ja") or English name ("Japanese").
 * Always answers with a Unicode script name ("Latin", "Hiragana", "Cyrillic"…):
 * any language without a non-Latin sample above, including one we cannot resolve
 * to a code at all, is Latin, the offer list's default. The L1 gate's callers
 * still accept `null` for a script, because "unknown" must leave that gate open —
 * this function simply never has to say it.
 */
export function languageScript(language: string): string {
  const code = langCode(language) || language.split("-")[0];
  const sample = SCRIPT_SAMPLE[code];
  return (sample ? scriptOf(sample) : null) ?? "Latin";
}

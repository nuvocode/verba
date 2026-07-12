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

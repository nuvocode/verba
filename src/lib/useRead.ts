import { useCallback, useState } from "react";
import type { Settings } from "./settings";
import { getProvider } from "./providers";
import {
  storyPrompt,
  continueReadingPrompt,
  explainWordPrompt,
  parseReading,
  parseWordExplanation,
  bareWord,
  type ReadingText,
} from "./reading";
import { getPack } from "./packs";
import { addVocab, saveReading } from "./db";

export interface WordPopover {
  term: string;
  gloss: string;
  x: number;
  y: number;
  flip: boolean;
}

export { bareWord as bare } from "./reading";

export function useRead(settings: Settings) {
  const [text, setText] = useState<ReadingText | null>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [bilingual, setBilingual] = useState(false);
  const [popover, setPopover] = useState<WordPopover | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pack = getPack(settings.packId);

  /** Generate a fresh passage. `goal` folds the day's weak area into the text. */
  const generate = useCallback(
    async (opts: { interests?: string; goal?: string } = {}) => {
      setBusy(true);
      setError("");
      setFocusIdx(-1);
      setPopover(null);
      setSaved([]);
      try {
        const raw = await getProvider(settings).chat(
          [{ role: "user", content: storyPrompt(settings, { ...opts, sentences: 8 }, pack) }],
          { json: true },
        );
        const t = parseReading(raw);
        if (!t.sentences.length) throw new Error("The model returned no readable sentences. Try again.");
        setText(t);
        await saveReading(settings.targetLang, t.title, t).catch(() => {});
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [settings, pack],
  );

  /** Flow reading — append more sentences to the passage in progress. */
  const extend = useCallback(async () => {
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const raw = await getProvider(settings).chat(
        [{ role: "user", content: continueReadingPrompt(settings, text, pack) }],
        { json: true },
      );
      const more = parseReading(raw);
      if (more.sentences.length) setText({ ...text, sentences: [...text.sentences, ...more.sentences] });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [text, busy, settings, pack]);

  /** Tap a word: the coach explains it and it goes straight into Memory. */
  const explain = useCallback(
    async (word: string, sentence: string, rect: DOMRect) => {
      const term = bareWord(word);
      if (!term) return;
      const flip = rect.bottom + 140 > window.innerHeight;
      setPopover({ term, gloss: "…", x: rect.left + rect.width / 2, y: flip ? rect.top : rect.bottom, flip });
      try {
        const raw = await getProvider(settings).chat(
          [{ role: "user", content: explainWordPrompt(settings, term, sentence) }],
          { json: true },
        );
        const w = parseWordExplanation(raw);
        const gloss = w.meaning || "—";
        setPopover((p) => (p && p.term === term ? { ...p, gloss } : p));
        await addVocab(settings.targetLang, { term: w.lemma || term, translation: gloss, example: sentence }).catch(
          () => {},
        );
        setSaved((s) => (s.includes(term) ? s : [...s, term]));
      } catch (e: any) {
        setPopover((p) => (p && p.term === term ? { ...p, gloss: String(e?.message ?? e) } : p));
      }
    },
    [settings],
  );

  return {
    text,
    focusIdx,
    setFocusIdx,
    /** The pack's locale and direction — the reader cuts words and lays out text with them. */
    locale: pack?.speech.locale ?? "en",
    dir: pack?.direction ?? "ltr",
    bilingual,
    toggleBilingual: () => setBilingual((b) => !b),
    popover,
    closePopover: () => setPopover(null),
    saved,
    busy,
    error,
    generate,
    extend,
    explain,
    /** Sentences carrying a coach note, with their index — the margin rail. */
    notes: (text?.sentences ?? []).map((s, i) => ({ i, note: s.note })).filter((n): n is { i: number; note: string } => !!n.note),
  };
}

export type Read = ReturnType<typeof useRead>;

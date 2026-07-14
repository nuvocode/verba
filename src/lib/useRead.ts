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
  LENGTHS,
  DEFAULT_LENGTH,
  type PassageLength,
  type ReadingText,
} from "./reading";
import { getPack } from "./packs";
import { addVocab, recentMemories, saveReading } from "./db";

export interface WordPopover {
  term: string;
  gloss: string;
  x: number;
  y: number;
  flip: boolean;
}

/** Kept in step with `.popover` in theme.css — the clamp below needs to know how wide it is. */
const POPOVER_WIDTH = 260;

export { bareWord as bare } from "./reading";

/** What the reader asked for. `topic` empty means "whatever today's plan is about". */
export interface Ask {
  length: PassageLength;
  topic: string;
}

export function useRead(settings: Settings) {
  const [text, setText] = useState<ReadingText | null>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [bilingual, setBilingual] = useState(false);
  const [popover, setPopover] = useState<WordPopover | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // What they asked for last, so the sheet opens where they left it. Session-only:
  // a topic is a mood, not a setting, and it has no business surviving a restart.
  const [ask, setAsk] = useState<Ask>({ length: DEFAULT_LENGTH, topic: "" });

  const pack = getPack(settings.packId);

  /**
   * Generate a fresh passage. `goal` folds the day's weak area into the text.
   *
   * `length` and `topic` are what the reader asked for in the sheet. Callers that
   * pass neither — Today's plan, the palette — get the remembered length and the
   * day's theme, which is what keeps the daily flow a single keystroke.
   */
  const generate = useCallback(
    async (opts: { interests?: string; goal?: string; length?: PassageLength; topic?: string } = {}) => {
      const length = opts.length ?? ask.length;
      const topic = (opts.topic ?? "").trim();
      setAsk({ length, topic });
      setBusy(true);
      setError("");
      setFocusIdx(-1);
      setPopover(null);
      setSaved([]);
      try {
        // The passage is set in the learner's own world where it can be — the same
        // facts the coach talks to them about, doing a second job here.
        const memories = await recentMemories(settings.targetLang).catch(() => []);
        const raw = await getProvider(settings).chat(
          [
            {
              role: "user",
              content: storyPrompt(
                settings,
                { interests: opts.interests, goal: opts.goal, topic, sentences: LENGTHS[length], memories },
                pack,
              ),
            },
          ],
          { json: true },
        );
        const t = parseReading(raw);
        if (!t.sentences.length) throw new Error("The model returned no readable sentences. Try again.");
        setText(t);
        await saveReading(settings.targetLang, t.title, t, { length, topic }).catch(() => {});
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [settings, pack, ask.length],
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
      // The popover is 260px wide and centred on the word. A word at either margin would
      // hang it off the window, so the anchor is kept half a popover away from both edges.
      const half = POPOVER_WIDTH / 2 + 8;
      const x = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half);
      setPopover({ term, gloss: "…", x, y: flip ? rect.top : rect.bottom, flip });
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
    /** The last thing they asked for — the sheet opens on it. */
    ask,
    generate,
    extend,
    explain,
    /** Sentences carrying a coach note, with their index — the margin rail. */
    notes: (text?.sentences ?? []).map((s, i) => ({ i, note: s.note })).filter((n): n is { i: number; note: string } => !!n.note),
  };
}

export type Read = ReturnType<typeof useRead>;

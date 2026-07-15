import { useCallback, useState } from "react";
import type { Settings } from "./settings";
import { getProvider } from "./providers";
import {
  storyPrompt,
  continueReadingPrompt,
  explainWordPrompt,
  comprehensionPrompt,
  parseReading,
  parseWordExplanation,
  parseComprehension,
  bareWord,
  LENGTHS,
  DEFAULT_LENGTH,
  type PassageLength,
  type ReadingText,
} from "./reading";
import { scoreAnswer, type Question } from "./questions";
import { computeMetrics } from "./metrics";
import { getPack } from "./packs";
import { addVocab, recentMemories, saveReading, saveMetrics, vocabCounts, listReadings, getReading, type ReadingRow } from "./db";

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

/** The comprehension check the reader walks after finishing a passage, one question at a time. */
interface CheckState {
  questions: Question[];
  step: number; // the question in front of the reader
  answers: string[]; // index-aligned with questions
  results: (boolean | undefined)[]; // set the moment each is graded
}

export function useRead(settings: Settings) {
  const [text, setText] = useState<ReadingText | null>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [bilingual, setBilingual] = useState(false);
  const [popover, setPopover] = useState<WordPopover | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Past passages, newest first — the empty state's library. Loaded on demand.
  const [library, setLibrary] = useState<ReadingRow[]>([]);
  // The comprehension check the reader takes after finishing a passage. Null until
  // it's generated; `checking` covers the wait while the questions are written.
  const [check, setCheck] = useState<CheckState | null>(null);
  const [checking, setChecking] = useState(false);
  // What they asked for last, so the sheet opens where they left it. Session-only:
  // a topic is a mood, not a setting, and it has no business surviving a restart.
  const [ask, setAsk] = useState<Ask>({ length: DEFAULT_LENGTH, topic: "" });

  const pack = getPack(settings.packId);

  // Nothing to translate when the target and native language are the same — the
  // "native" line is just the sentence again. Bilingual mode has no meaning here.
  const canBilingual = settings.targetLang.trim().toLowerCase() !== settings.nativeLang.trim().toLowerCase();

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
      setCheck(null);
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
        await saveReading(settings.targetLang, t.title, t, { length, topic, cefr: settings.cefr }).catch(() => {});
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

  /** Load the reading library for the empty state. */
  const loadLibrary = useCallback(async () => {
    setLibrary(await listReadings(settings.targetLang).catch(() => []));
  }, [settings.targetLang]);

  /** Clear the current passage — drops back to the empty state, where the library lives. */
  const close = useCallback(() => {
    setText(null);
    setFocusIdx(-1);
    setPopover(null);
    setSaved([]);
    setError("");
    setCheck(null);
  }, []);

  /** Reopen a saved passage — sets it as the current text without re-generating or re-saving. */
  const open = useCallback(async (id: number) => {
    const t = (await getReading(id).catch(() => null)) as ReadingText | null;
    if (!t?.sentences?.length) return;
    setFocusIdx(-1);
    setPopover(null);
    setSaved([]);
    setError("");
    setCheck(null);
    setText(t);
  }, []);

  /**
   * Turn the finished passage into a comprehension check. Returns whether a check was
   * produced — a passage that yields no questions (or a model that errors) must never
   * block finishing the read, so the caller advances on false.
   */
  const startCheck = useCallback(async (): Promise<boolean> => {
    if (!text) return false;
    setChecking(true);
    setError("");
    try {
      const raw = await getProvider(settings).chat(
        [{ role: "user", content: comprehensionPrompt(settings, text, pack) }],
        { json: true },
      );
      const questions = parseComprehension(raw);
      if (!questions.length) return false;
      setCheck({
        questions,
        step: 0,
        answers: Array(questions.length).fill(""),
        results: Array(questions.length).fill(undefined),
      });
      return true;
    } catch {
      return false;
    } finally {
      setChecking(false);
    }
  }, [text, settings, pack]);

  const answerCheck = useCallback((i: number, v: string) => {
    setCheck((c) => {
      if (!c || c.results[i] !== undefined) return c; // a checked answer is settled
      const answers = [...c.answers];
      answers[i] = v;
      return { ...c, answers };
    });
  }, []);

  /** Grade the question in front of the reader; a missed cloze word falls into the SRS. */
  const gradeCheck = useCallback(async () => {
    const c = check;
    if (!c) return;
    const i = c.step;
    const q = c.questions[i];
    if (!q || c.results[i] !== undefined) return;
    const ok = scoreAnswer(q, c.answers[i] ?? "");
    setCheck((cur) => {
      if (!cur) return cur;
      const results = [...cur.results];
      results[i] = ok;
      return { ...cur, results };
    });
    // Only a missed cloze names an exact word worth reviewing (a missed mcq answer is
    // a whole native phrase), so only cloze seeds a card. Gloss is left blank — the
    // card exists to resurface the word; its meaning fills in the next time it's tapped.
    if (!ok && q.kind === "cloze" && q.answer) {
      await addVocab(settings.targetLang, { term: q.answer, translation: "", example: q.line }).catch(() => {});
    }
  }, [check, settings.targetLang]);

  const nextCheckQuestion = useCallback(() => {
    setCheck((c) => (!c || c.step >= c.questions.length - 1 ? c : { ...c, step: c.step + 1 }));
  }, []);

  /**
   * Fold the check's accuracy into the level signal, then clear it. Comprehension is
   * the cleanest reading-level signal we have, so it rides the same session_metrics
   * row the Coach reads — words = what they read, corrections = what they missed.
   */
  const finishCheck = useCallback(async () => {
    const c = check;
    if (!c || !text) {
      setCheck(null);
      return;
    }
    const correct = c.results.filter((r) => r === true).length;
    const total = c.questions.length || 1;
    try {
      const deckSize = (await vocabCounts(settings.targetLang)).total;
      const m = computeMetrics(text.sentences.map((s) => s.target), {
        corrections: total - correct,
        deckSize,
        locale: pack?.speech.locale,
      });
      await saveMetrics(settings.targetLang, m, Math.round((correct / total) * 100));
    } catch {
      /* the signal is best-effort — a finished check still counts */
    }
    setCheck(null);
  }, [check, text, settings.targetLang, pack]);

  /** Leave the check without recording anything — an escape hatch, not the happy path. */
  const skipCheck = useCallback(() => setCheck(null), []);

  return {
    text,
    focusIdx,
    setFocusIdx,
    /** The pack's locale and direction — the reader cuts words and lays out text with them. */
    locale: pack?.speech.locale ?? "en",
    dir: pack?.direction ?? "ltr",
    bilingual,
    /** False when target and native language match — there is no translation to show. */
    canBilingual,
    toggleBilingual: () => canBilingual && setBilingual((b) => !b),
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
    /** Past passages (newest first) and the loader/opener behind the empty-state library. */
    library,
    loadLibrary,
    open,
    close,
    /** The post-passage comprehension check — runs on the shared question layer. */
    check,
    checking,
    checkScore: check
      ? { correct: check.results.filter((r) => r === true).length, total: check.questions.length }
      : { correct: 0, total: 0 },
    startCheck,
    answerCheck,
    gradeCheck,
    nextCheckQuestion,
    finishCheck,
    skipCheck,
    /** Sentences carrying a coach note, with their index — the margin rail. */
    notes: (text?.sentences ?? []).map((s, i) => ({ i, note: s.note })).filter((n): n is { i: number; note: string } => !!n.note),
  };
}

export type Read = ReturnType<typeof useRead>;

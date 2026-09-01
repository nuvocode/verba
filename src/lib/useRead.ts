import { useCallback, useState } from "react";
import type { Settings } from "./settings";
import { levelOf } from "./model";
import { getProvider } from "./providers";
import {
  continueReadingPrompt,
  explainWordPrompt,
  comprehensionPrompt,
  outlinePrompt,
  draftPrompt,
  rewritePrompt,
  notesPrompt,
  parseOutline,
  parseReading,
  parseRewrite,
  parseWordExplanation,
  parseComprehension,
  parseNotes,
  bareWord,
  LENGTHS,
  DEFAULT_LENGTH,
  type PassageLength,
  type ReadingText,
} from "./reading";
import { coherence, reuse, level, type PassageOutcome, type CoherenceMarkers } from "./passage";
import { validateNotes, type ReadNote } from "./notes";
import { scoreAnswer, type Question } from "./questions";
import { computeMetrics } from "./metrics";
import { getPack } from "./packs";
import { humanError } from "./fmt";
import { addVocab, recentMemories, saveReading, saveMetrics, vocabCounts, listReadings, getReading, latestReadingAtLevel, type ReadingRow } from "./db";

export interface WordPopover {
  /** What was tapped, as it appears in the text. */
  term: string;
  gloss: string;
  /** The dictionary form the card is filed under; falls back to `term`. Empty until the gloss lands. */
  lemma: string;
  /** The sentence it was met in — the card's context, kept so a later save still has it. */
  sentence: string;
  x: number;
  y: number;
  flip: boolean;
  /** Set once this word is in the deck: by this tap, or because it already was. */
  saved: boolean;
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
  // The generation step the learner sees while busy (PLAN-022): "Planning the
  // passage… / Writing it… / Checking it reads properly…". Null when idle.
  const [step, setStep] = useState<string | null>(null);
  // A passage that failed the gates (PLAN-022). Rendered as Unusable — the text
  // is never shown. Null when there is no rejection to show.
  const [outcome, setOutcome] = useState<PassageOutcome | null>(null);
  // The reuse gate's hit list (PLAN-022, invariant 21). The header prints its
  // count or says nothing — the copy reads the gate's output, never the request.
  const [reusedWords, setReusedWords] = useState<string[]>([]);
  // Past passages, newest first — the empty state's library. Loaded on demand.
  const [library, setLibrary] = useState<ReadingRow[]>([]);
  // The comprehension check the reader takes after finishing a passage. Null until
  // it's generated; `checking` covers the wait while the questions are written.
  const [check, setCheck] = useState<CheckState | null>(null);
  const [checking, setChecking] = useState(false);
  // The coach notes (PLAN-023): anchored to the passage, generated in a second
  // call after the gates. `notesFailed` is true when that call came back empty or
  // errored — the passage still renders, with a quiet line and a retry.
  const [notes, setNotes] = useState<ReadNote[]>([]);
  const [notesFailed, setNotesFailed] = useState(false);
  const [notesBusy, setNotesBusy] = useState(false);
  // What they asked for last, so the sheet opens where they left it. Session-only:
  // a topic is a mood, not a setting, and it has no business surviving a restart.
  const [ask, setAsk] = useState<Ask>({ length: DEFAULT_LENGTH, topic: "" });

  const pack = getPack(settings.packId);

  // Nothing to translate when the target and native language are the same — the
  // "native" line is just the sentence again. Bilingual mode has no meaning here.
  const canBilingual = settings.profile.targetLanguage.trim().toLowerCase() !== settings.profile.nativeLanguage.trim().toLowerCase();

  /**
   * Generate the coach notes for a passage (PLAN-023). Runs after the gates, in
   * its own call. A failure is silent: the passage stands, `notesFailed` is set,
   * and the reader can retry notes alone. `want` is half the sentence count.
   */
  const generateNotes = useCallback(
    async (t: ReadingText) => {
      if (!t.sentences.length) return;
      setNotesBusy(true);
      setNotesFailed(false);
      const want = Math.floor(t.sentences.length / 2);
      try {
        const raw = await getProvider(settings).chat(
          [
            {
              role: "user",
              content: notesPrompt(settings, t, levelOf(settings.profile), settings.profile.nativeLanguage, want),
            },
          ],
          { json: true },
        );
        const notes = validateNotes(parseNotes(raw), t, pack?.speech.locale ?? "en", want);
        setNotes(notes);
        // Zero notes is a valid outcome — nothing worth saying. It renders as
        // nothing (no rail), not as a failure. Only an actual error sets the
        // quiet line and the retry.
        setNotesFailed(false);
      } catch {
        setNotes([]);
        setNotesFailed(true);
      } finally {
        setNotesBusy(false);
      }
    },
    [settings, pack],
  );

  /**
   * Generate a fresh passage. `goal` folds the day's weak area into the text.
   *
   * `length` and `topic` are what the reader asked for in the sheet. Callers that
   * pass neither — Today's plan, the palette — get the remembered length and the
   * day's theme, which is what keeps the daily flow a single keystroke.
   *
   * PLAN-022: this is a five-step pipeline, not one call. Outline → draft →
   * per-sentence coherence → reuse → level. Each step reports through `step` so
   * the learner sees progress rather than a twenty-second spinner. A passage that
   * fails the gates is never rendered — it becomes `outcome` (Unusable), with a
   * fallback when one exists.
   */
  const generate = useCallback(
    async (opts: { interests?: string; goal?: string; length?: PassageLength; topic?: string; reuse?: string[] } = {}) => {
      const length = opts.length ?? ask.length;
      const topic = (opts.topic ?? "").trim();
      setAsk({ length, topic });
      setBusy(true);
      setError("");
      setStep(null);
      setOutcome(null);
      setReusedWords([]);
      setFocusIdx(-1);
      setPopover(null);
      setSaved([]);
      setCheck(null);
      setNotes([]);
      setNotesFailed(false);
      setNotesBusy(false);
      const provider = getProvider(settings);
      const locale = pack?.speech.locale ?? "en";
      // The pack's stopword list, or the empty set — the coherence gate's fallback
      // (every word is content) applies when a pack carries none. A short-word
      // language (Japanese, Chinese) must not have every sentence rejected as empty.
      const stopwords = new Set<string>(pack?.stopwords ?? []);
      // The pack's discourse markers and pronouns, or none — the connection test
      // is skipped when a pack has not written them down.
      const markers = pack?.markers
        ? { discourse: new Set(pack.markers.discourse), pronouns: new Set(pack.markers.pronouns) }
        : undefined;
      // The pack's negation words, or none — the contradiction test is skipped
      // when a pack has not written them down.
      const negations = pack?.negations ? new Set(pack.negations) : undefined;
      const target = levelOf(settings.profile);
      const reuseWant = opts.reuse ?? [];
      const storyOpts = { interests: opts.interests, goal: opts.goal, topic, sentences: LENGTHS[length], reuse: reuseWant };
      try {
        // The passage is set in the learner's own world where it can be — the same
        // facts the coach talks to them about, doing a second job here.
        const memories = await recentMemories(settings.profile.targetLanguage).catch(() => []);

        // ---- step 1: outline (4–6 beats, one retry) ----
        setStep("Planning the passage…");
        let outline = parseOutline(
          await provider.chat([{ role: "user", content: outlinePrompt(settings, { ...storyOpts, memories }, pack) }], { json: true }),
        );
        if (outline.beats.length < 4 || outline.beats.length > 6) {
          outline = parseOutline(
            await provider.chat([{ role: "user", content: outlinePrompt(settings, { ...storyOpts, memories }, pack) }], { json: true }),
          );
        }
        if (outline.beats.length < 4 || outline.beats.length > 6) {
          throw new Error("The model could not plan a coherent passage. Try again.");
        }

        // ---- step 2: draft (from the beats) ----
        setStep("Writing it…");
        let t = parseReading(
          await provider.chat([{ role: "user", content: draftPrompt(settings, outline, { ...storyOpts, memories }, pack) }], { json: true }),
        );
        if (!t.sentences.length) throw new Error("The model returned no readable sentences. Try again.");

        // ---- step 3: coherence, sentence by sentence ----
        setStep("Checking it reads properly…");
        let coherenceResult = coherence(t, locale, stopwords, markers, negations);
        if (!coherenceResult.ok) {
          // A failing sentence goes back alone; two failures on the same sentence
          // and the passage is rejected.
          const rewritten = await rewriteFailing(t, coherenceResult, provider, settings, locale, stopwords, markers, negations);
          if (rewritten) {
            t = rewritten;
            coherenceResult = coherence(t, locale, stopwords, markers, negations);
          }
        }
        if (!coherenceResult.ok) {
          return reject("The passage didn't hang together.", target);
        }

        // ---- step 4: reuse (≥ half of the requested words, one retry) ----
        let reuseResult = reuseWant.length ? reuse(t, reuseWant) : null;
        if (reuseResult && !reuseResult.ok) {
          // Back to the draft once, with the missing words named.
          t = parseReading(
            await provider.chat(
              [{ role: "user", content: draftPrompt(settings, outline, { ...storyOpts, memories, reuse: reuseResult.missing }, pack) }],
              { json: true },
            ),
          );
          if (t.sentences.length) {
            reuseResult = reuse(t, reuseWant);
            // A redraft can break coherence — re-check it before accepting.
            const recheck = coherence(t, locale, stopwords, markers, negations);
            if (!recheck.ok) return reject("The passage didn't hang together.", target);
          }
        }
        if (reuseResult && !reuseResult.ok) {
          return reject("The passage didn't reuse the words you asked for.", target);
        }

        // ---- step 5: level (±1 band) ----
        const levelResult = level(t, target, locale);
        if (!levelResult.ok) {
          return reject(`The passage came out at ${levelResult.band}, not ${target}.`, target);
        }

        // ---- accepted ----
        setReusedWords(reuseResult?.hit ?? []);
        setText(t);
        await saveReading(settings.profile.targetLanguage, t.title, t, { length, topic, cefr: target }).catch(() => {});
        // ---- notes: a second call, after the gates (PLAN-023) ----
        // A failed notes call is not a failed passage — the passage renders with
        // no notes and a quiet line, and the reader can retry notes alone.
        await generateNotes(t);
      } catch (e: unknown) {
        const { say: said, log } = humanError(e);
        console.warn("[read] generate failed:", log);
        setError(said);
      } finally {
        setBusy(false);
        setStep(null);
      }

      /** A rejected passage becomes Unusable — never rendered. */
      async function reject(why: string, cefr: string): Promise<void> {
        const fallback = (await latestReadingAtLevel(settings.profile.targetLanguage, cefr).catch(() => null)) as ReadingText | null;
        setOutcome({ ok: false, why, fallback: fallback?.sentences?.length ? fallback : null });
      }
    },
    [settings, pack, ask.length, generateNotes],
  );

  /**
   * Rewrite the failing sentences of a draft, one at a time. Returns a new
   * ReadingText with the failing sentences replaced, or null when a sentence
   * fails twice (the passage is rejected).
   */
  async function rewriteFailing(
    t: ReadingText,
    result: { failed: number[]; why: string[] },
    provider: ReturnType<typeof getProvider>,
    settings: Settings,
    locale: string,
    stopwords: Set<string>,
    markers?: CoherenceMarkers,
    negations?: Set<string>,
  ): Promise<ReadingText | null> {
    const sentences = [...t.sentences];
    for (let k = 0; k < result.failed.length; k++) {
      const i = result.failed[k];
      const prev = i > 0 ? sentences[i - 1].target : "";
      const raw = await provider.chat(
        [{ role: "user", content: rewritePrompt(settings, sentences[i].target, prev, result.why[k] ?? "", pack) }],
        { json: true },
      );
      const rewritten = parseRewrite(raw);
      if (!rewritten) return null; // nothing usable came back — reject
      sentences[i] = rewritten;
      // Two failures on the same sentence and the passage is rejected.
      const single = coherence({ title: t.title, sentences: [rewritten] }, locale, stopwords, markers, negations);
      if (!single.ok) return null;
    }
    return { title: t.title, sentences };
  }

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
    } catch (e: unknown) {
      const { say: said, log } = humanError(e);
      console.warn("[read] extend failed:", log);
      setError(said);
    } finally {
      setBusy(false);
    }
  }, [text, busy, settings, pack]);

  /**
   * Tap a word: the coach explains it. Nothing is written.
   *
   * It used to save every word it explained, which is how a deck fills with words
   * the reader only wanted to get past. Wanting to understand a word is not wanting
   * to learn it — the save is a second, deliberate act (`saveWord`).
   */
  const explain = useCallback(
    async (word: string, sentence: string, rect: DOMRect) => {
      const term = bareWord(word);
      if (!term) return;
      const flip = rect.bottom + 140 > window.innerHeight;
      // The popover is 260px wide and centred on the word. A word at either margin would
      // hang it off the window, so the anchor is kept half a popover away from both edges.
      const half = POPOVER_WIDTH / 2 + 8;
      const x = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half);
      const here = { term, gloss: "…", lemma: "", sentence, x, y: flip ? rect.top : rect.bottom, flip };
      setPopover({ ...here, saved: saved.includes(term) });
      try {
        const raw = await getProvider(settings).chat(
          [{ role: "user", content: explainWordPrompt(settings, term, sentence) }],
          { json: true },
        );
        const w = parseWordExplanation(raw);
        setPopover((p) => (p && p.term === term ? { ...p, gloss: w.meaning || "—", lemma: w.lemma || term } : p));
      } catch (e: unknown) {
        const { say: said, log } = humanError(e);
        console.warn("[read] explain failed:", log);
        setPopover((p) => (p && p.term === term ? { ...p, gloss: said } : p));
      }
    },
    [settings, saved],
  );

  /**
   * Keep the word in front of them. The deliberate half of `explain`.
   *
   * A word whose explanation failed has no meaning to file, so there is nothing to
   * save; `addVocab` would turn it away anyway. The tapped word is marked saved
   * either way the write goes — "already in Memory" is still in Memory.
   */
  const saveWord = useCallback(async () => {
    const p = popover;
    if (!p || !p.lemma || p.gloss === "…") return;
    await addVocab(
      settings.profile.targetLanguage,
      { term: p.lemma, translation: p.gloss, example: p.sentence },
      { capturedBy: "learner", surface: "read", learnerLevel: levelOf(settings.profile) },
    ).catch(() => {});
    setPopover((cur) => (cur && cur.term === p.term ? { ...cur, saved: true } : cur));
    setSaved((s) => (s.includes(p.term) ? s : [...s, p.term]));
  }, [popover, settings.profile.targetLanguage]);

  /** Load the reading library for the empty state. */
  const loadLibrary = useCallback(async () => {
    setLibrary(await listReadings(settings.profile.targetLanguage).catch(() => []));
  }, [settings.profile.targetLanguage]);

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

  /** Open the fallback a rejected generation offered (PLAN-022) — the most recent saved passage at the same level. */
  const openFallback = useCallback(async () => {
    const o = outcome;
    if (!o || o.ok || !o.fallback) return;
    setOutcome(null);
    setFocusIdx(-1);
    setPopover(null);
    setSaved([]);
    setError("");
    setCheck(null);
    setText(o.fallback);
  }, [outcome]);

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
    // A missed comprehension answer used to seed a card here, with a deliberately
    // blank gloss. It was the wrong instinct twice over: the answer is usually a
    // detail of the passage (a time, a name, a number) rather than a word, and a
    // card with no meaning on the back cannot be reviewed at all. Missing a question
    // is a comprehension signal — it feeds the metrics below, and nothing else.
  }, [check]);

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
      const deckSize = (await vocabCounts(settings.profile.targetLanguage)).total;
      const m = computeMetrics(text.sentences.map((s) => s.target), {
        corrections: total - correct,
        deckSize,
        locale: pack?.speech.locale,
      });
      await saveMetrics(settings.profile.targetLanguage, m, Math.round((correct / total) * 100));
    } catch {
      /* the signal is best-effort — a finished check still counts */
    }
    setCheck(null);
  }, [check, text, settings.profile.targetLanguage, pack]);

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
    /** The generation step the learner sees while busy (PLAN-022). */
    step,
    /** A passage that failed the gates — rendered as Unusable, never shown. */
    outcome,
    /** The reuse gate's hit list — the header prints its count or says nothing. */
    reusedWords,
    /** The last thing they asked for — the sheet opens on it. */
    ask,
    generate,
    extend,
    explain,
    /** Commit the word in the popover to Memory — nothing is captured without it. */
    saveWord,
    /** Past passages (newest first) and the loader/opener behind the empty-state library. */
    library,
    loadLibrary,
    open,
    openFallback,
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
    /** The coach notes (PLAN-023) — anchored to the passage, capped at half its sentences. */
    notes,
    /** True when the notes call came back empty or errored — the passage still stands. */
    notesFailed,
    /** True while the notes call is running. */
    notesBusy,
    /** Retry the notes call alone — asks only for notes, never regenerates the passage. */
    retryNotes: () => text && void generateNotes(text),
  };
}

export type Read = ReturnType<typeof useRead>;

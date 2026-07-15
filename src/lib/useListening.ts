import { useCallback, useMemo, useState } from "react";
import type { Settings } from "./settings";
import { getProvider } from "./providers";
import {
  outlinePrompt,
  chapterPrompt,
  parseOutline,
  parseChapter,
  type Chapter,
  type ListeningPiece,
  type ListeningOptions,
} from "./listening";
import { scoreAnswer, type Question } from "./questions";
import { getPack } from "./packs";
import { getSpeech } from "./speech";
import { computeMetrics } from "./metrics";
import { addVocab, recentMemories, saveListening, saveMetrics, vocabCounts } from "./db";

/** One chapter's worth of the learner's work — kept per chapter so it survives moving on. */
export interface ChapterProgress {
  heard: boolean; // chapter played to the end at least once — gates the questions
  step: number; // index of the question currently in front of the learner
  answers: string[]; // index-aligned with the chapter's questions
  results: (boolean | undefined)[]; // per question, set the moment it is checked
  revealed: boolean; // transcript unlocked
}

const blank = (n: number): ChapterProgress => ({
  heard: false,
  step: 0,
  answers: Array(n).fill(""),
  results: Array(n).fill(undefined),
  revealed: false,
});

/**
 * A listening session, mirroring useTalk / useRead. Generation is front-loaded (an
 * outline, then a call per chapter) so the learner never waits mid-piece; playback
 * and the comprehension check are driven from here so the view stays a view.
 */
export function useListening(settings: Settings) {
  const [piece, setPiece] = useState<ListeningPiece | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [progress, setProgress] = useState<ChapterProgress[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(""); // "Writing chapter 2 of 3…"
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);

  const pack = getPack(settings.packId);
  const speech = useMemo(
    () => getSpeech(settings),
    // Same speech-settings surface useTalk watches — rebuild the adapter when any of it changes.
    [
      settings.offline,
      settings.elevenLabsKey,
      settings.deepgramKey,
      settings.localTtsUrl,
      settings.localTtsModel,
      settings.localTtsVoice,
      settings.localSttUrl,
      settings.localSttModel,
      settings.bundledTtsModel,
      settings.bundledTtsVoice,
      settings.bundledSttModel,
      settings.ttsTier,
      settings.sttTier,
    ],
  );

  /** Generate a fresh piece: outline first, then each chapter against it. */
  const generate = useCallback(
    async (opts: ListeningOptions = {}) => {
      setBusy(true);
      setError("");
      setStatus("Planning the story…");
      setPiece(null);
      setFinished(false);
      setChapterIdx(0);
      try {
        const provider = getProvider(settings);
        const interests =
          opts.interests ||
          // Set the story in the learner's own world where nothing else was asked for.
          (await recentMemories(settings.targetLang).catch(() => [])).map((m) => m.fact).slice(0, 3).join("; ") ||
          undefined;
        const outline = parseOutline(await provider.chat([{ role: "user", content: outlinePrompt(settings, { ...opts, interests }, pack) }], { json: true }));
        if (!outline.beats.length) throw new Error("The model returned no chapters. Try again.");

        const chapters: Chapter[] = [];
        for (let i = 0; i < outline.beats.length; i++) {
          setStatus(`Writing chapter ${i + 1} of ${outline.beats.length}…`);
          const ch = parseChapter(
            await provider.chat([{ role: "user", content: chapterPrompt(settings, outline, i, opts, pack) }], { json: true }),
            outline.beats[i].title,
          );
          if (!ch.lines.length) throw new Error(`Chapter ${i + 1} came back empty. Try again.`);
          chapters.push(ch);
        }
        setPiece({ title: outline.title, premise: outline.premise, chapters });
        setProgress(chapters.map((c) => blank(c.questions.length)));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
        setStatus("");
      }
    },
    [settings, pack],
  );

  const chapter: Chapter | null = piece?.chapters[chapterIdx] ?? null;
  const here: ChapterProgress = progress[chapterIdx] ?? blank(0);

  /**
   * Play (or replay) the current chapter aloud. The questions stay hidden until it
   * has been heard to the end — the whole point is that this is a listening exercise.
   * `heard` is set only when playback resolves naturally; stopping early leaves it
   * unset, so a learner who cuts it off can replay before the questions appear.
   */
  const play = useCallback(async () => {
    if (!chapter || playing) return;
    const text = chapter.lines.map((l) => l.target).join(" ");
    if (!text.trim() || !speech.canSpeak) return;
    setPlaying(true);
    // ponytail: no disk cache — a replay regenerates the audio, which is slow on the
    // bundled tier. Cache chapter audio to disk (expose bytes from getSpeech + a Rust
    // write) if replay latency proves annoying in practice.
    try {
      await speech.speak(text, { locale: pack?.speech.locale, voiceHint: pack?.speech.voiceHint });
      setProgress((p) => {
        const next = [...p];
        if (next[chapterIdx] && !next[chapterIdx].heard) next[chapterIdx] = { ...next[chapterIdx], heard: true };
        return next;
      });
    } catch {
      /* a TTS hiccup should not wedge the button */
    } finally {
      setPlaying(false);
    }
  }, [chapter, playing, speech, pack, chapterIdx]);

  const stop = useCallback(() => {
    speech.cancel();
    setPlaying(false);
  }, [speech]);

  const setAnswer = useCallback(
    (qIdx: number, value: string) => {
      setProgress((p) => {
        const next = [...p];
        const cur = next[chapterIdx];
        // A question already checked is settled — its answer does not change under it.
        if (!cur || cur.results[qIdx] !== undefined) return p;
        const answers = [...cur.answers];
        answers[qIdx] = value;
        next[chapterIdx] = { ...cur, answers };
        return next;
      });
    },
    [chapterIdx],
  );

  /** Check the question in front of the learner; a missed cloze word falls into the SRS. */
  const check = useCallback(async () => {
    if (!chapter) return;
    const i = here.step;
    const q = chapter.questions[i];
    if (!q || here.results[i] !== undefined) return; // already checked
    const ok = scoreAnswer(q, here.answers[i] ?? "");
    setProgress((p) => {
      const next = [...p];
      const results = [...next[chapterIdx].results];
      results[i] = ok;
      next[chapterIdx] = { ...next[chapterIdx], results };
      return next;
    });
    // A missed cloze already names the exact word worth reviewing; a missed multiple
    // choice does not (its answer is a whole native phrase), so only cloze seeds a card.
    if (!ok && q.kind === "cloze" && q.answer) {
      // ponytail: translation is left blank here — the card exists to resurface the
      // word the learner missed; its gloss gets filled the next time they tap it.
      await addVocab(settings.targetLang, { term: q.answer, translation: "", example: q.line }).catch(() => {});
    }
  }, [chapter, here, chapterIdx, settings.targetLang]);

  /** Move to the next question in this chapter (the last one hands off to the chapter, not here). */
  const nextQuestion = useCallback(() => {
    setProgress((p) => {
      const next = [...p];
      const cur = next[chapterIdx];
      if (!cur || cur.step >= cur.answers.length - 1) return p;
      next[chapterIdx] = { ...cur, step: cur.step + 1 };
      return next;
    });
  }, [chapterIdx]);

  const reveal = useCallback(() => {
    setProgress((p) => {
      const next = [...p];
      next[chapterIdx] = { ...next[chapterIdx], revealed: true };
      return next;
    });
  }, [chapterIdx]);

  /** Fold the whole piece into the level signal, then mark it finished. */
  const finish = useCallback(async () => {
    if (!piece) return;
    stop();
    const allQ = piece.chapters.flatMap((c) => c.questions);
    const allResults = progress.flatMap((p) => p.results);
    const correct = allResults.filter((r) => r === true).length;
    const total = allQ.length || 1;
    const accuracy = correct / total;

    const answers = piece.chapters.map((c, ci) =>
      c.questions.map((_, qi) => ({ given: progress[ci]?.answers[qi] ?? "", correct: progress[ci]?.results[qi] ?? false })),
    );
    await saveListening(settings.targetLang, piece.title, piece, answers, accuracy).catch(() => {});

    // Comprehension accuracy is a genuine level signal, so it rides the same
    // session_metrics row the Coach already reads — words = what they listened to,
    // corrections = what they missed, score = the accuracy composite (0-100).
    // ponytail: reuses the production metrics row rather than a dedicated listening
    // signal; give it its own component in metrics.ts if the Coach needs to tell them apart.
    try {
      const deckSize = (await vocabCounts(settings.targetLang)).total;
      const heard = piece.chapters.flatMap((c) => c.lines.map((l) => l.target));
      const m = computeMetrics(heard, { corrections: total - correct, deckSize, locale: pack?.speech.locale });
      await saveMetrics(settings.targetLang, m, Math.round(accuracy * 100));
    } catch {
      /* the signal is best-effort — a finished session still counts */
    }
    setFinished(true);
  }, [piece, progress, settings.targetLang, pack, stop]);

  /** Move to the next chapter, or finish the piece if this was the last one. */
  const next = useCallback(() => {
    stop();
    if (!piece) return;
    if (chapterIdx >= piece.chapters.length - 1) return void finish();
    setChapterIdx((i) => i + 1);
  }, [piece, chapterIdx, finish, stop]);

  const score = {
    correct: progress.flatMap((p) => p.results).filter((r) => r === true).length,
    total: piece?.chapters.flatMap((c) => c.questions).length ?? 0,
  };

  return {
    piece,
    chapter,
    chapterIdx,
    chapterCount: piece?.chapters.length ?? 0,
    progress: here,
    /** Writing direction of the target language — transcript lines lay out with it. */
    dir: pack?.direction ?? "ltr",
    busy,
    status,
    error,
    playing,
    finished,
    score,
    generate,
    play,
    replay: play,
    stop,
    canSpeak: speech.canSpeak,
    setAnswer,
    check,
    nextQuestion,
    reveal,
    next,
    reset: () => {
      stop();
      setPiece(null);
      setFinished(false);
    },
  };
}

export type Listening = ReturnType<typeof useListening>;
export type { Question };

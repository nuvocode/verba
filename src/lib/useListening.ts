import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { getSpeech, type Clip } from "./speech";
import { spans, seek, back10, type Span } from "./timeline";
import { computeMetrics } from "./metrics";
import { humanError } from "./fmt";
import { recentMemories, saveListening, saveListeningProgress, latestListeningProgress, saveMetrics, vocabCounts } from "./db";

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
 * Wait until a clip's duration is known. `new Audio(url)` doesn't have it until
 * the container header loads; the timeline is built from real lengths, so play
 * can't start until every line's is known. A fallback resolves after 3 s rather
 * than hanging a chapter on one metadata frame that never landed.
 */
function clipDuration(c: Clip): Promise<number> {
  return new Promise((resolve) => {
    if (c.duration > 0) return resolve(c.duration);
    const el = c.el;
    const done = () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("timeupdate", onTime);
      clearTimeout(timer);
      resolve(el.duration || 0);
    };
    const onMeta = () => done();
    const onTime = () => {
      if (el.duration > 0) done();
    };
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("timeupdate", onTime);
    const timer = setTimeout(done, 3000);
  });
}

/**
 * A listening session, mirroring useTalk / useRead. Generation is front-loaded (an
 * outline, then a call per chapter) so the learner never waits mid-piece; playback
 * and the comprehension check are driven from here so the view stays a view.
 *
 * Playback (PLAN-025) is a real timeline on the seekable tiers: every line is
 * synthesised to its own clip up front, and the transport seeks, re-winds 10 s and
 * changes speed over them. The non-seekable tier (the OS voice — no bytes) falls
 * back to speaking the whole chapter: play/pause only, no fake bar. One clip per
 * line, not per chapter — line boundaries are the only timing that exists.
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

  // ---- the player: clips per line, cumulative spans, and the transport ----
  const clipsRef = useRef<Clip[]>([]);
  const spansRef = useRef<Span[]>([]);
  const currentRef = useRef<HTMLAudioElement | null>(null); // the element "now", kept across pauses
  const lineRef = useRef(0); // which line `current` is, so back10 knows where it is
  const prepJob = useRef(0); // monotonic guard so a superseded prepare can't steal the stage
  const rateRef = useRef(1);
  const [preparing, setPreparing] = useState(false);
  const [prepText, setPrepText] = useState(""); // "Chapter 2 — line 4 of 11"
  const [position, setPosition] = useState(0); // seconds into the chapter
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [lineIdx, setLineIdx] = useState(0);

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

  const pieceRef = useRef(piece);
  useEffect(() => {
    pieceRef.current = piece;
  }, [piece]);
  const playFromRef = useRef<(n: number, o: number) => void>(() => {});
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  /** Release every clip of the current chapter and reset the transport. */
  const releaseChapter = useCallback(() => {
    currentRef.current?.pause();
    currentRef.current = null;
    clipsRef.current.forEach((c) => c.release());
    clipsRef.current = [];
    spansRef.current = [];
    setPosition(0);
    setDuration(0);
    setLineIdx(0);
    setPlaying(false);
  }, []);

  const markHeard = useCallback(() => {
    setProgress((p) => {
      const next = [...p];
      const cur = next[chapterIdx];
      if (cur && !cur.heard) next[chapterIdx] = { ...cur, heard: true };
      return next;
    });
  }, [chapterIdx]);

  /** Play line `n` at `offset`. The heart of the transport. */
  const playFrom = useCallback(
    (n: number, offset: number) => {
      const clips = clipsRef.current;
      if (!speech.seekable || !clips.length) return;
      if (n < 0 || n >= clips.length) return;
      const was = currentRef.current;
      if (was && was !== clips[n].el) was.pause();
      const el = clips[n].el;
      el.currentTime = offset;
      el.playbackRate = rateRef.current;
      currentRef.current = el;
      lineRef.current = n;
      setLineIdx(n);
      void el.play().catch(() => {});
      setPlaying(true);
    },
    [speech],
  );
  playFromRef.current = playFrom;

  /**
   * Prepare a chapter's clips: synthesise every line in order, reporting progress
   * through the generating step. The line durations become the chapter's spans —
   * the timeline everything below seeks over. Clips are given one `timeupdate`
   * (the position read) and one `ended` (advance or mark-heard) listener each.
   */
  const prepareFor = useCallback(
    async (index: number) => {
      const ch = pieceRef.current?.chapters[index];
      if (!ch || !speech.seekable || !speech.clip) return;
      const job = ++prepJob.current;
      releaseChapter();
      setPreparing(true);
      const made: Clip[] = [];
      const durations: number[] = [];
      const bail = () => made.forEach((c) => c.release());
      try {
        for (let i = 0; i < ch.lines.length; i++) {
          if (job !== prepJob.current) return void bail();
          setPrepText(`Chapter ${index + 1} — line ${i + 1} of ${ch.lines.length}`);
          const c = await speech.clip(ch.lines[i].target, {
            locale: pack?.speech.locale,
            voiceHint: pack?.speech.voiceHint,
          });
          c.el.playbackRate = rateRef.current;
          made.push(c);
          durations.push(await clipDuration(c));
        }
        if (job !== prepJob.current) return void bail();
        clipsRef.current = made;
        spansRef.current = spans(durations);
        setDuration(durations.reduce((a, b) => a + b, 0));
        made.forEach((c, i) => {
          c.el.addEventListener("timeupdate", () => {
            if (currentRef.current !== c.el) return;
            setPosition(spansRef.current[i].from + c.el.currentTime);
          });
          c.el.addEventListener("ended", () => {
            if (currentRef.current !== c.el) return;
            if (i >= clipsRef.current.length - 1) {
              // Reaching the final line's *ended* is the only way to mark heard —
              // seeking past the end is not hearing the chapter.
              currentRef.current = null;
              setPlaying(false);
              setLineIdx(i);
              markHeard();
            } else {
              playFromRef.current(i + 1, 0);
            }
          });
        });
      } catch {
        bail();
        clipsRef.current = [];
        spansRef.current = [];
      } finally {
        if (job === prepJob.current) {
          setPreparing(false);
          setPrepText("");
        }
      }
    },
    [speech, pack, releaseChapter, markHeard],
  );
  const prepareRef = useRef(prepareFor);
  prepareRef.current = prepareFor;

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
          (await recentMemories(settings.profile.targetLanguage).catch(() => [])).map((m) => m.fact).slice(0, 3).join("; ") ||
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
        // Persist the in-progress marker at chapter 0 so leaving mid-chapter-1
        // still resumes here (PLAN-025). Position within a chapter is not stored.
        void saveListeningProgress(settings.profile.targetLanguage, outline.title, { title: outline.title, premise: outline.premise, chapters }, 0).catch(() => {});
        // Front-load the first chapter's clips so the first play already has a timeline.
        await prepareRef.current(0);
      } catch (e: unknown) {
        const { say: said, log } = humanError(e);
        console.warn("[listen] generate failed:", log);
        setError(said);
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
   * Persist which chapter is in progress, so re-entering Listen resumes there
   * (PLAN-025). Written on chapter change and on leaving the surface; position
   * within a chapter is deliberately not stored — a chapter is short, and
   * restarting it is better than resuming mid-sentence.
   */
  const saveProgress = useCallback(() => {
    if (!piece) return;
    void saveListeningProgress(settings.profile.targetLanguage, piece.title, piece, chapterIdx).catch(() => {});
  }, [piece, chapterIdx, settings.profile.targetLanguage]);

  /**
   * Re-enter an unfinished piece at the chapter it was left on. Returns whether a
   * session was resumed — the caller falls back to a fresh generation when not.
   */
  const resumeSession = useCallback(async (): Promise<boolean> => {
    const p = await latestListeningProgress(settings.profile.targetLanguage).catch(() => null);
    if (!p || !p.piece) return false;
    const chapters = (p.piece as { chapters?: Chapter[] })?.chapters;
    if (!Array.isArray(chapters) || !chapters.length) return false;
    const idx = Math.min(Math.max(p.chapterIdx, 0), chapters.length - 1);
    setPiece({ title: p.title, premise: (p.piece as { premise?: string })?.premise ?? "", chapters });
    setProgress(chapters.map((c) => blank(c.questions.length)));
    setChapterIdx(idx);
    setFinished(false);
    setError("");
    // Front-load the resumed chapter's clips so the first play already has a timeline.
    await prepareRef.current(idx);
    return true;
  }, [settings.profile.targetLanguage]);

  /**
   * Play the current chapter — the primary button. On a seekable tier this resumes
   * a paused position or starts the prepared timeline from the top; on the OS-voice
   * tier it speaks the whole chapter and marks it heard on natural end. The
   * questions stay hidden until it has been heard to the end — cutting it off leaves
   * `heard` unset, so it can be replayed before the questions appear.
   */
  const play = useCallback(async () => {
    if (!chapter || playing) return;
    if (!speech.canSpeak) return;
    if (speech.seekable) {
      if (preparing) return;
      if (!clipsRef.current.length) return;
      const cur = currentRef.current;
      // A paused element resumes where it stood; otherwise start from line 0.
      if (cur && !cur.ended) playFrom(lineRef.current, cur.currentTime);
      else playFrom(0, 0);
    } else {
      const text = chapter.lines.map((l) => l.target).join(" ");
      if (!text.trim()) return;
      setPlaying(true);
      try {
        await speech.speak(text, { locale: pack?.speech.locale, voiceHint: pack?.speech.voiceHint });
        markHeard();
      } catch {
        /* a TTS hiccup should not wedge the button */
      } finally {
        setPlaying(false);
      }
    }
  }, [chapter, playing, preparing, speech, pack, playFrom, markHeard]);

  const stop = useCallback(() => {
    currentRef.current?.pause();
    currentRef.current = null;
    speech.cancel();
    setPlaying(false);
  }, [speech]);

  /** Pause in place — position preserved for a later resume. */
  const pause = useCallback(() => {
    currentRef.current?.pause();
    setPlaying(false);
  }, []);

  /** Resume from the paused position (or the top if nothing is loaded). */
  const resume = useCallback(() => {
    if (!speech.seekable || !clipsRef.current.length) return;
    const cur = currentRef.current ?? clipsRef.current[0].el;
    if (cur.ended) return playFrom(0, 0);
    cur.playbackRate = rateRef.current;
    lineRef.current = clipsRef.current.findIndex((c) => c.el === cur);
    currentRef.current = cur;
    void cur.play().catch(() => {});
    setPlaying(true);
  }, [speech, playFrom]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else resume();
  }, [playing, pause, resume]);

  /** Drag-release seeking: clamp the requested position into a line and play there. */
  const seekTo = useCallback(
    (t: number) => {
      if (!speech.seekable) return;
      const { line, offset } = seek(spansRef.current, t);
      if (line < 0) return;
      playFrom(line, offset);
    },
    [speech, playFrom],
  );

  /** Back 10 s from where the player is, floored at the chapter's start. */
  const backTen = useCallback(() => {
    if (!speech.seekable) return;
    if (!clipsRef.current.length) return;
    const cur = currentRef.current;
    const at = cur ? spansRef.current[lineRef.current]?.from + cur.currentTime : position;
    if (at === undefined) return;
    const { line, offset } = back10(spansRef.current, at);
    playFrom(line, offset);
  }, [speech, playFrom, position]);

  /** 0.75 / 1 / 1.25 — written to every clip now, and to new ones as they are made. */
  const changeRate = useCallback((r: number) => {
    setRate(r);
    rateRef.current = r;
    clipsRef.current.forEach((c) => (c.el.playbackRate = r));
  }, []);

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
    // A missed cloze used to seed a card here, with its meaning deliberately left
    // blank. Both halves were wrong: the answer is usually a detail of the piece (a
    // time, a name, a number) rather than a word, and a card with nothing on its
    // back cannot be reviewed. A missed question is a comprehension signal, and the
    // accuracy this feeds is where it belongs.
  }, [chapter, here, chapterIdx]);

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
    await saveListening(settings.profile.targetLanguage, piece.title, piece, answers, accuracy).catch(() => {});

    // Comprehension accuracy is a genuine level signal, so it rides the same
    // session_metrics row the Coach already reads — words = what they listened to,
    // corrections = what they missed, score = the accuracy composite (0-100).
    // ponytail: reuses the production metrics row rather than a dedicated listening
    // signal; give it its own component in metrics.ts if the Coach needs to tell them apart.
    try {
      const deckSize = (await vocabCounts(settings.profile.targetLanguage)).total;
      const heard = piece.chapters.flatMap((c) => c.lines.map((l) => l.target));
      const m = computeMetrics(heard, { corrections: total - correct, deckSize, locale: pack?.speech.locale });
      await saveMetrics(settings.profile.targetLanguage, m, Math.round(accuracy * 100));
    } catch {
      /* the signal is best-effort — a finished session still counts */
    }
    setFinished(true);
  }, [piece, progress, settings.profile.targetLanguage, pack, stop]);

  /** Move to the next chapter, or finish the piece if this was the last one. */
  const next = useCallback(() => {
    stop();
    if (!piece) return;
    if (chapterIdx >= piece.chapters.length - 1) return void finish();
    const nextIdx = chapterIdx + 1;
    setChapterIdx(nextIdx);
    saveProgress();
    void prepareRef.current(nextIdx);
  }, [piece, chapterIdx, finish, stop, saveProgress]);

  const score = {
    correct: progress.flatMap((p) => p.results).filter((r) => r === true).length,
    total: piece?.chapters.flatMap((c) => c.questions).length ?? 0,
  };

  /**
   * Every question that was actually answered, flattened across chapters and
   * carrying its own text. `score` is the two numbers on screen; this is what the
   * surface needs to write one signal per question (§1.3), and a chapter left
   * unanswered contributes nothing rather than a row of silent misses.
   */
  const graded = (piece?.chapters ?? [])
    .flatMap((c, ci) =>
      c.questions.map((q, qi) => ({
        prompt: q.prompt,
        given: progress[ci]?.answers[qi] ?? "",
        answer: q.answer,
        correct: progress[ci]?.results[qi],
      })),
    )
    .filter((g): g is { prompt: string; given: string; answer: string; correct: boolean } => g.correct !== undefined);

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
    /** Whether the serving voice can be scrubbed — the transport reads it. */
    seekable: speech.seekable,
    preparing,
    prepText,
    /** Seconds into the chapter where the player is right now. */
    position,
    /** Total chapter length in seconds. 0 until the clips are prepared. */
    duration,
    rate,
    lineIdx,
    score,
    graded,
    generate,
    resume: resumeSession,
    saveProgress,
    play,
    replay: play,
    stop,
    pause,
    toggle,
    seekTo,
    back10: backTen,
    setRate: changeRate,
    canSpeak: speech.canSpeak,
    setAnswer,
    check,
    nextQuestion,
    reveal,
    next,
    reset: () => {
      stop();
      releaseChapter();
      setPiece(null);
      setFinished(false);
    },
  };
}

export type Listening = ReturnType<typeof useListening>;
export type { Question };

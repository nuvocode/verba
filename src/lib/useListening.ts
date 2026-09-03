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
  type ListenQuestion,
} from "./listening";
import { scoreAnswer } from "./questions";
import { getPack } from "./packs";
import { getSpeech, type Clip } from "./speech";
import { spans, seek, back10, type Span } from "./timeline";
import { computeMetrics } from "./metrics";
import { humanError } from "./fmt";
import { recentMemories, saveListening, saveListeningProgress, latestListeningProgress, saveMetrics, vocabCounts } from "./db";
import {
  supported,
  activeFrom,
  applyTo,
  paceMultiplier,
  resumeAudio,
  walkBack,
  harden,
  type Variable,
  type ActiveSet,
} from "./conditions";

/** One chapter's worth of the learner's work — kept per chapter so it survives moving on. */
export interface ChapterProgress {
  heard: boolean; // chapter played to the end at least once — gates the questions
  step: number; // index of the question currently in front of the learner
  answers: string[]; // index-aligned with the chapter's questions
  results: (boolean | undefined)[]; // per question, set the moment it is checked
  revealed: boolean; // transcript unlocked
  /** The transcript was opened at least once this chapter — marks every question assisted. */
  assisted: boolean;
}

const blank = (n: number): ChapterProgress => ({
  heard: false,
  step: 0,
  answers: Array(n).fill(""),
  results: Array(n).fill(undefined),
  revealed: false,
  assisted: false,
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
export function useListening(settings: Settings, onSettings?: (patch: Partial<Settings>) => void) {
  const [piece, setPiece] = useState<ListeningPiece | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [progress, setProgress] = useState<ChapterProgress[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(""); // "Writing chapter 2 of 3…"
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  // The walk-backs this session has recorded (PLAN-036) — written as signals on
  // finish, so the record of what defeated the learner survives without moving
  // the comprehension number.
  const walkBacks = useRef<{ variable: Variable; from: number }[]>([]);

  // ---- the player: clips per line, cumulative spans, and the transport ----
  const clipsRef = useRef<Clip[]>([]);
  const spansRef = useRef<Span[]>([]);
  const currentRef = useRef<HTMLAudioElement | null>(null); // the element "now", kept across pauses
  const lineRef = useRef(0); // which line `current` is, so back10 knows where it is
  const prepJob = useRef(0); // monotonic guard so a superseded prepare can't steal the stage
  const rateRef = useRef(1);
  // PLAN-036: the pace multiplier the active conditions ask for, folded into the
  // single rate door. `rateRef` is the learner's own rate; the effective rate a
  // clip plays at is `rateRef * paceRef`. One door — `playFrom`, `resume` and
  // `changeRate` all write through it, so a pace grade is never clobbered.
  const paceRef = useRef(1);
  const replayingRef = useRef(false); // a replay's ended must not advance the chapter
  const [preparing, setPreparing] = useState(false);
  const [prepText, setPrepText] = useState(""); // "Chapter 2 — line 4 of 11"
  const [position, setPosition] = useState(0); // seconds into the chapter
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [lineIdx, setLineIdx] = useState(0);

  const pack = getPack(settings.packId);
  const speech = useMemo(
    () => getSpeech(settings, () => {}, pack?.speech.locale),
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
      pack?.speech.locale,
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

  // PLAN-036: the grades this tier can honestly produce, and the active set the
  // learner's persisted grades ask for. `supported` reads the tier's declared
  // `can`, so an unsupported grade is not on screen at all.
  const maxGrades = useMemo(() => supported(speech), [speech]);
  const active = useMemo(() => activeFrom(settings.listeningGrades), [settings.listeningGrades]);
  // A walk-back re-prepares the chapter with the *new* grades before the settings
  // re-render lands, so `prepareFor` reads the live set through this ref rather
  // than the closure's `active`.
  const activeRef = useRef<ActiveSet>(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  // The current grades, tracked through a ref so a walk-back or harden is
  // idempotent even before the settings re-render lands — the closure's
  // `settings.listeningGrades` is stale until then.
  const gradesRef = useRef<Partial<Record<Variable, number>>>(settings.listeningGrades);
  useEffect(() => {
    gradesRef.current = settings.listeningGrades;
  }, [settings.listeningGrades]);
  // The variable that was just walked back (PLAN-036). A successful replay of the
  // same chapter must not immediately re-harden the very condition that was
  // eased — `harden` skips it. Cleared when the learner moves to a new chapter.
  const justWalkedBack = useRef<Variable | null>(null);
  // A miss has already eased the grade, so the replay it earned must not ease a
  // second one (PLAN-036). Cleared by the replay that consumes it, and by
  // moving on — a chapter the learner simply carried through keeps its grade.
  const pendingReplay = useRef(false);
  // The pace multiplier follows the active set, so the transport's rate door
  // reads the live value even before a settings re-render lands.
  useEffect(() => {
    paceRef.current = paceMultiplier(active);
  }, [active]);

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
      // The single rate door: the learner's own rate times the pace condition's
      // multiplier. Every path that plays a clip goes through here (or `resume`,
      // which reads the same refs), so a pace grade is never clobbered.
      el.playbackRate = rateRef.current * paceRef.current;
      currentRef.current = el;
      lineRef.current = n;
      setLineIdx(n);
      // A WebAudio context born outside a user gesture starts suspended — resume
      // it on play or the routed element is silent (PLAN-036).
      resumeAudio();
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
          // PLAN-036: route the clip through the WebAudio graph for the active
          // conditions. The element is the same one — `ended` / `error` / cancel
          // resolve exactly as they do now; only its output is filtered. Pace is
          // not applied here — it flows through the transport's rate door.
          const wrapped = applyTo(c, activeRef.current);
          made.push(wrapped);
          durations.push(await clipDuration(wrapped));
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
            if (replayingRef.current) {
              // A replay stops at its line's end — it must not advance the chapter.
              replayingRef.current = false;
              currentRef.current = null;
              setPlaying(false);
              return;
            }
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
    [speech, pack, releaseChapter, markHeard, active],
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
  const saveProgress = useCallback(
    (at = chapterIdx) => {
      if (!piece) return;
      void saveListeningProgress(settings.profile.targetLanguage, piece.title, piece, at).catch(() => {});
    },
    [piece, chapterIdx, settings.profile.targetLanguage],
  );

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
    cur.playbackRate = rateRef.current * paceRef.current;
    lineRef.current = clipsRef.current.findIndex((c) => c.el === cur);
    currentRef.current = cur;
    resumeAudio();
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
    // The single rate door: the learner's own rate times the pace condition's
    // multiplier, so a pace grade survives a rate change.
    clipsRef.current.forEach((c) => (c.el.playbackRate = r * paceRef.current));
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

  /**
   * The grade half of the walk-back: ease the hardest active variable by one and
   * re-prepare this chapter's audio at the new setting. Returns whether anything
   * eased — nothing is active at grade 0, and a session with no active condition
   * is today's Listen, byte for byte, including what a miss does.
   *
   * The reset half is deliberately *not* here. A miss has to stay on screen long
   * enough for the learner to read it: PLAN-026's miss panel renders on
   * `results[step] === false`, and clearing the results in the same tick that
   * recorded them would delete the answer, the reason, and the replay-that-part
   * button before they were ever drawn — and drop the miss out of `graded`, so
   * the comprehension number could only ever read 100%.
   */
  const easeAfterMiss = useCallback((): boolean => {
    if (!piece) return false;
    const result = walkBack(gradesRef.current);
    if (!result.walked) return false;
    walkBacks.current.push(result.walked);
    gradesRef.current = result.grades;
    justWalkedBack.current = result.walked.variable;
    onSettings?.({ listeningGrades: result.grades });
    // Re-prepare with the new grades before the settings re-render lands.
    activeRef.current = activeFrom(result.grades);
    paceRef.current = paceMultiplier(activeRef.current);
    // No re-synthesis here: the easier audio is only needed when the learner
    // actually replays, and `walkBackAndReplay` prepares it then. Re-preparing
    // at miss time would re-synthesise a whole chapter nobody asked to hear.
    return true;
  }, [piece, onSettings]);

  /**
   * A wrong answer walks the hardest active variable back one grade and replays
   * the same chapter — never skipping it, never abandoning the piece, down to
   * grade 0 if that is what it takes. The replay resets the chapter's `answers`
   * and `heard`, so the questions are asked again against the new audio.
   *
   * The miss itself has already eased the grade (`check`), so a replay that
   * follows one does not ease it a second time — one miss is one grade.
   */
  const walkBackAndReplay = useCallback(() => {
    if (!piece) return;
    if (pendingReplay.current) pendingReplay.current = false;
    else easeAfterMiss();
    // Reset this chapter's answers and heard — a replay is a second attempt, not
    // a relabelling of the failure.
    setProgress((p) => {
      const next = [...p];
      const cur = next[chapterIdx];
      if (!cur) return p;
      next[chapterIdx] = { ...cur, answers: Array(cur.answers.length).fill(""), results: Array(cur.results.length).fill(undefined), step: 0, heard: false };
      return next;
    });
    void prepareRef.current(chapterIdx);
  }, [piece, easeAfterMiss, chapterIdx]);

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
    // PLAN-036: a wrong answer eases the hardest active variable by one grade —
    // the walk-back is the consequence of the miss, not of a button. The replay
    // itself waits for the learner: the miss panel has to be readable first, and
    // the miss has to stay in `graded` until they choose to try again.
    if (!ok && easeAfterMiss()) pendingReplay.current = true;
    // A missed cloze used to seed a card here, with its meaning deliberately left
    // blank. Both halves were wrong: the answer is usually a detail of the piece (a
    // time, a name, a number) rather than a word, and a card with nothing on its
    // back cannot be reviewed. A missed question is a comprehension signal, and the
    // accuracy this feeds is where it belongs.
  }, [chapter, here, chapterIdx, easeAfterMiss]);

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

  /**
   * Open the transcript for this chapter. Opening it once marks the chapter's
   * comprehension signals assisted — every question in the chapter, not only the
   * ones answered after. The learner had the text available; that is the fact
   * being recorded. Nothing about the screen changes when it is set.
   */
  const reveal = useCallback(() => {
    setProgress((p) => {
      const next = [...p];
      const cur = next[chapterIdx];
      if (!cur) return p;
      next[chapterIdx] = { ...cur, revealed: true, assisted: true };
      return next;
    });
  }, [chapterIdx]);

  /**
   * Replay the audio a question's answer came from — `spans[lineIdx]`, computed at
   * playback time and never stored. Plays the line and stops at its end (it does
   * not advance to the next line, as normal playback does). Bound to one key (`r`)
   * on the listening surface, so the count announced is the count that works.
   */
  const replayRange = useCallback(
    (lineIdx: number) => {
      if (!speech.seekable || !clipsRef.current.length) return;
      if (lineIdx < 0 || lineIdx >= clipsRef.current.length) return;
      const was = currentRef.current;
      if (was && was !== clipsRef.current[lineIdx].el) was.pause();
      const el = clipsRef.current[lineIdx].el;
      el.currentTime = 0;
      el.playbackRate = rateRef.current * paceRef.current;
      currentRef.current = el;
      lineRef.current = lineIdx;
      setLineIdx(lineIdx);
      setPlaying(true);
      // The shared `ended` listener sees this flag and stops instead of advancing.
      replayingRef.current = true;
      resumeAudio();
      void el.play().catch(() => {});
    },
    [speech],
  );

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
    // PLAN-036: a chapter answered correctly at the current setting hardens one
    // variable one grade, at most one per chapter, never announced. The grade is
    // persisted so it is still there in the next session. A variable that was
    // just walked back is skipped — a successful replay must not immediately
    // re-harden the very condition that was eased.
    const hereResults = progress[chapterIdx]?.results ?? [];
    const allChecked = hereResults.length > 0 && hereResults.every((r) => r === true);
    if (allChecked) {
      const result = harden(gradesRef.current, maxGrades, justWalkedBack.current);
      if (result.hardened) {
        gradesRef.current = result.grades;
        onSettings?.({ listeningGrades: result.grades });
      }
    }
    // Moving on clears the walk-back guard — the next chapter is a fresh setting.
    justWalkedBack.current = null;
    pendingReplay.current = false;
    if (chapterIdx >= piece.chapters.length - 1) return void finish();
    const nextIdx = chapterIdx + 1;
    setChapterIdx(nextIdx);
    saveProgress(nextIdx);
    void prepareRef.current(nextIdx);
  }, [piece, chapterIdx, finish, stop, saveProgress, progress, maxGrades, onSettings]);

  const score = {
    correct: progress.flatMap((p) => p.results).filter((r) => r === true).length,
    total: piece?.chapters.flatMap((c) => c.questions).length ?? 0,
  };

  /**
   * Every question that was actually answered, flattened across chapters and
   * carrying its own text. `score` is the two numbers on screen; this is what the
   * surface needs to write one signal per question (§1.3), and a chapter left
   * unanswered contributes nothing rather than a row of silent misses.
   *
   * `assisted` rides along per question: opening the transcript once in a chapter
   * marks that chapter's comprehension signals assisted (PLAN-026) — recorded,
   * never scored.
   */
  const graded = (piece?.chapters ?? [])
    .flatMap((c, ci) =>
      c.questions.map((q, qi) => ({
        prompt: q.prompt,
        given: progress[ci]?.answers[qi] ?? "",
        answer: q.answer,
        correct: progress[ci]?.results[qi],
        assisted: progress[ci]?.assisted ?? false,
      })),
    )
    .filter((g): g is { prompt: string; given: string; answer: string; correct: boolean; assisted: boolean } => g.correct !== undefined);

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
    /** Prepare a chapter's clips — exposed so a test can drive it after the
     *  pieceRef effect has landed (PLAN-036). */
    prepare: prepareRef.current,
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
    replayRange,
    next,
    // PLAN-036: the grades this tier can honestly produce, the active set the
    // learner's persisted grades ask for, and the walk-backs this session
    // recorded (written as signals on advance, never as comprehension).
    maxGrades,
    active,
    walkBacks: walkBacks.current,
    walkBackAndReplay,
    markHeard,
    reset: () => {
      stop();
      releaseChapter();
      setPiece(null);
      setFinished(false);
      // A fresh session is a fresh record — the walk-backs of the old one are
      // gone with it (PLAN-036).
      walkBacks.current = [];
      justWalkedBack.current = null;
      pendingReplay.current = false;
    },
  };
}

export type Listening = ReturnType<typeof useListening>;
export type { ListenQuestion };

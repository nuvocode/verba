import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReadView, Settings } from "../../lib/settings";
import type { Read as ReadState } from "../../lib/useRead";
import {
  clock,
  ended,
  lineAt,
  pxPerSecond,
  secondsFor,
  stepWpm,
  wordsIn,
  WPM_MAX,
  WPM_MIN,
} from "../../lib/prompter";
import ViewToggle from "./ViewToggle";

/**
 * The teleprompter: the same passage, read out loud, at a pace that doesn't wait for you.
 *
 * The column creeps upward a fraction of a pixel at a time and the line crossing the mark
 * is the one being spoken. Nothing here is tappable and nothing is translated — a word
 * you stop to look at is a word you stopped speaking for, and stopping is the thing this
 * exercise is trying to cost you. Comprehension is the other view's job.
 *
 * The speed lives in `settings` rather than in here, because the useful part is coming
 * back tomorrow to the pace you left off pushing yourself at.
 */
export default function Prompter({
  settings,
  read,
  view,
  onView,
  onWpm,
  onDone,
}: {
  settings: Settings;
  read: ReadState;
  view: ReadView;
  onView: (v: ReadView) => void;
  onWpm: (wpm: number) => void;
  /** Finished with the reading block — mark it done and move the day on. */
  onDone: () => void;
}) {
  const { text } = read;
  const wpm = settings.prompterWpm;

  const [running, setRunning] = useState(false); // it opens still: you start when your voice is ready
  const [done, setDone] = useState(false);
  const [line, setLine] = useState(Math.max(read.focusIdx, 0));

  const stage = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLSpanElement>(null);

  // The column's position, its sentence offsets and its height are read and written 60
  // times a second. They are refs, not state: a render per frame would cost more than
  // the animation it was drawing. React only hears about the line, and only when it turns.
  const offset = useRef(0);
  const tops = useRef<number[]>([]);
  const height = useRef(0);
  const lineRef = useRef(Math.max(read.focusIdx, 0));
  const raf = useRef(0);
  const last = useRef(0);
  const wpmRef = useRef(wpm);
  // Where the column is to be parked once it has been laid out and can be measured:
  // whichever sentence they had focused in the other view, so switching lands you in place.
  const seed = useRef(Math.max(read.focusIdx, 0));
  const seeded = useRef(false);
  const mounted = useRef(false);

  const words = useMemo(
    () => (text?.sentences ?? []).map((s) => wordsIn(s.target, read.locale)),
    [text, read.locale],
  );
  const total = useMemo(() => words.reduce((a, b) => a + b, 0), [words]);

  useEffect(() => {
    wpmRef.current = wpm;
  }, [wpm]);

  /** Put the column where `offset` says it is, and tell React if that changed the line. */
  const paint = useCallback(() => {
    const col = column.current;
    if (!col) return;
    col.style.transform = `translateY(${-offset.current}px)`;
    const h = height.current;
    if (fill.current) fill.current.style.transform = `scaleX(${h > 0 ? Math.min(offset.current / h, 1) : 0})`;
    const i = lineAt(offset.current, tops.current);
    if (i >= 0 && i !== lineRef.current) {
      lineRef.current = i;
      setLine(i);
      // …and the other view is left looking at the sentence you stopped speaking on.
      read.setFocusIdx(i);
    }
  }, [read.setFocusIdx]);

  /**
   * Sentence offsets and column height, straight from the layout — which is what lets
   * words-per-minute mean anything: the pace is words, the column is pixels, and this is
   * the only place the two are ever introduced. Re-measured when the window changes shape,
   * with the reader kept proportionally where they were rather than thrown back to the top.
   */
  const measure = useCallback(() => {
    const col = column.current;
    if (!col) return;
    tops.current = (Array.from(col.children) as HTMLElement[]).map((el) => el.offsetTop);
    const before = height.current;
    height.current = col.scrollHeight;
    if (!seeded.current) {
      seeded.current = true;
      offset.current = tops.current[seed.current] ?? 0;
    } else if (before > 0 && height.current > 0 && before !== height.current) {
      offset.current *= height.current / before;
    }
    paint();
  }, [paint]);

  useLayoutEffect(() => {
    measure();
    const col = column.current;
    if (!col || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure); // the window resized, or the text re-wrapped under it
    ro.observe(col);
    return () => ro.disconnect();
  }, [measure, text]);

  const restart = useCallback(() => {
    offset.current = 0;
    lineRef.current = -1;
    setDone(false);
    paint();
    setRunning(true);
  }, [paint]);

  /** Stumbled, or want that sentence again: step the column a line either way. */
  const skip = useCallback(
    (dir: 1 | -1) => {
      const i = Math.min(Math.max(lineRef.current + dir, 0), tops.current.length - 1);
      offset.current = tops.current[i] ?? 0;
      setDone(false);
      paint();
    },
    [paint],
  );

  const toggle = useCallback(() => {
    if (done) return restart();
    setRunning((r) => !r);
  }, [done, restart]);

  const frame = useCallback(
    (t: number) => {
      const dt = Math.min((t - (last.current || t)) / 1000, 0.25); // a backgrounded tab must not teleport it
      last.current = t;
      const speed = pxPerSecond(wpmRef.current, height.current, total);
      offset.current = Math.min(offset.current + speed * dt, height.current);
      paint();
      if (ended(offset.current, height.current)) {
        setRunning(false);
        return setDone(true);
      }
      raf.current = requestAnimationFrame(frame);
    },
    [paint, total],
  );

  useEffect(() => {
    if (!running) return;
    last.current = 0;
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
  }, [running, frame]);

  // A passage can be replaced from under this view (the palette can write a new one).
  // That is a different text: rewind, and stand still until they say go.
  useEffect(() => {
    if (!mounted.current) return void (mounted.current = true);
    seed.current = 0;
    seeded.current = false;
    lineRef.current = 0;
    offset.current = 0;
    setLine(0);
    setDone(false);
    setRunning(false);
  }, [text]);

  // The keys of the exercise. They are this view's own — App stands its reading keys down
  // while the prompter is up (see the `readView` gate there), so nothing here is contested.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "") || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘K belongs to the palette
      const k = e.key;
      if (k === " ") {
        e.preventDefault(); // …or the body scrolls under the column
        return toggle();
      }
      if (k === "+" || k === "=") {
        e.preventDefault();
        return onWpm(stepWpm(wpmRef.current, 1));
      }
      if (k === "-" || k === "_") {
        e.preventDefault();
        return onWpm(stepWpm(wpmRef.current, -1));
      }
      if (k === "ArrowRight" || k === "ArrowDown") {
        e.preventDefault();
        return skip(1);
      }
      if (k === "ArrowLeft" || k === "ArrowUp") {
        e.preventDefault();
        return skip(-1);
      }
      if (k.toLowerCase() === "r") {
        e.preventDefault();
        return restart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, skip, restart, onWpm]);

  if (!text) return null;

  // Counted from the line they are on, so it answers the pace change immediately — and it
  // is nothing at all once the passage is read, whatever the last line's words would say.
  const left = clock(done ? 0 : secondsFor(words.slice(line).reduce((a, b) => a + b, 0), wpm));

  return (
    <div className="prompter fade">
      <div className="bar">
        <div className="ttl" dir={read.dir}>
          {text.title}
        </div>
        <div className="st">
          {done ? "Finished" : running ? "Reading" : "Paused"} · line {Math.min(line + 1, text.sentences.length)} of{" "}
          {text.sentences.length} · {left} left
        </div>
        <div className="speed">
          <button onClick={() => onWpm(stepWpm(wpm, -1))} disabled={wpm <= WPM_MIN} title="Slower (−)">
            −
          </button>
          {/* An honest number, not a 1–5: this is a claim about your own speech. */}
          <span className="v">{wpm} wpm</span>
          <button onClick={() => onWpm(stepWpm(wpm, 1))} disabled={wpm >= WPM_MAX} title="Faster (+)">
            +
          </button>
        </div>
        <button className="btn sm ghost" onClick={toggle}>
          {done ? "Again" : running ? "Pause" : "Start"}
        </button>
        <ViewToggle view={view} onView={onView} />
      </div>

      <div className="prog">
        <span ref={fill} />
      </div>

      {/* The scrims on the stage are what make one line "now": the passage arrives out of
          nothing at the bottom, is legible for as long as it takes to cross the mark, and
          is gone off the top. Everything else about the view is a consequence of that.
          The column is a direct child of the stage on purpose — see theme.css. */}
      <div className="stage" ref={stage}>
        <div className="mark" />
        <div className="column" ref={column} dir={read.dir}>
          {text.sentences.map((s, i) => (
            <div key={i} className={`pline ${i === line ? "on" : ""}`}>
              {s.target}
            </div>
          ))}
        </div>
      </div>

      {done && (
        <div className="endcard fade">
          <h2>You read it.</h2>
          <p>
            {total} words at {wpm} wpm — {clock(secondsFor(total, wpm))} of speaking.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="btn sm" onClick={onDone}>
              Done reading →
            </button>
            <button className="btn sm ghost" onClick={restart}>
              Read it again
            </button>
            <button className="btn sm ghost" onClick={() => onView("passage")}>
              Back to close reading
            </button>
          </div>
        </div>
      )}

      {settings.showHints && (
        <div className="hints" style={{ padding: "0 28px 20px", gap: 20 }}>
          <span>
            <span className="kbd">space</span> {running ? "pause" : "start"}
          </span>
          <span>
            <span className="kbd">+ −</span> speed
          </span>
          <span>
            <span className="kbd">← →</span> skip a line
          </span>
          <span>
            <span className="kbd">R</span> from the top
          </span>
          <span>
            <span className="kbd">P</span> back to close reading
          </span>
        </div>
      )}
    </div>
  );
}

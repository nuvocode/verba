// The planning screen (§5.1, PLAN-044 §1): during planning the screen shows
// **the topic and a countdown, and nothing else**. There is no notes field —
// written preparation destroys the thing being measured — and that absence is a
// *checkable* invariant, not a promise in a comment: this component contains no
// `<input`, no `<textarea` and no `contentEditable`, and fluency.check §22
// asserts all three by source scan. Same treatment the contract's "no persisted
// key" got, for the same reason — an absence nobody can see is an absence nobody
// maintains.
//
// The countdown is the fluency banner's self-clearing `setTimeout` chain, not an
// interval: an interval left running holds a handle for the length of the
// session and hangs any check file that drives a real one.
import { useEffect, useRef, useState } from "react";

/**
 * The planning screen (§5.1). Shows the topic and a countdown of `seconds`, and
 * nothing else. When the countdown reaches zero it calls `onDone` exactly once.
 */
export default function Planning({
  topic,
  seconds,
  onCancel,
  onDone,
}: {
  /** The topic the learner is about to speak on — the only thing the screen names. */
  topic: string;
  /** The planning time in seconds — 60, 30, or 0 (§5.1's walk). Zero shows the topic and an immediate start. */
  seconds: number;
  onCancel: () => void;
  /** Fired exactly once when the planning time ends (immediately for 0 s). */
  onDone: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  // `onDone` may be recreated each render; fire it exactly once per planning
  // screen, guarded by this ref so a re-render cannot double-start the session.
  // The "Start speaking" button goes through the same guard — pressing it early
  // is the learner's own hand-off, and it must not fire twice.
  const fired = useRef(false);
  const fire = () => {
    if (fired.current) return;
    fired.current = true;
    onDone();
  };

  // A fresh screen starts with the full count and an unfired hand-off.
  useEffect(() => {
    setLeft(seconds);
    fired.current = false;
  }, [seconds]);

  // A deadline-based `setTimeout` chain, outside the state updater: the deadline
  // is fixed when the screen mounts, and each tick schedules the next from the
  // remaining time. The chain stops the moment the count reaches zero. It is
  // never an interval — an interval left running would hold a live handle for
  // the whole session and hang any check file that drives a real one.
  useEffect(() => {
    if (seconds <= 0) {
      fire();
      return;
    }
    const deadline = Date.now() + seconds * 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining <= 0) {
        fire();
        return; // do not re-arm — the countdown is over
      }
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 1000);
    return () => {
      if (timer) clearTimeout(timer);
    };
    // `onDone` is the caller's hand-off; the ref guard makes it idempotent, so
    // it is deliberately not in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, onDone]);

  const mm = String(Math.max(0, Math.floor(left / 60))).padStart(2, "0");
  const ss = String(Math.max(0, left % 60)).padStart(2, "0");

  return (
    <div className="today fade">
      <div className="eyebrow">Planning time</div>
      <h2 className="display">{topic}</h2>
      <div style={{ fontSize: 56, fontWeight: 700, margin: "40px 0", fontVariantNumeric: "tabular-nums" }}>
        {mm}:{ss}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
        <button className="btn sm" onClick={fire}>
          Start speaking →
        </button>
        <button className="btn sm ghost" onClick={onCancel}>
          Back to scenarios
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import * as voice from "../../lib/voice";
import { CUE_MS, expressionFor, rose, type Cue, type Mode } from "./face/expression";
import { EXPRESSIONS } from "./face/paths";
import { Brows, Eyes, Glasses, Head, MouthPart } from "./face/rig";

// The coach, given a face. It opens its mouth on the sound lib/voice.ts is
// measuring, blinks on its own, and breathes.
//
// The drawing lives in face/paths.ts and face/rig.tsx; this file is only the
// driver — what frame, and when. That split is the point of v1.5: the character
// was redrawn from scratch and this logic did not have to change with it.
//
// Not a mascot. The app is set in a serif and reads like a printed page, so the
// character is drawn the way an editorial illustration would be: filled contour
// with the weight shifting down the face, ink everywhere, and exactly one
// terracotta accent — the glasses. Everything that says "app character" is
// deliberately absent.
//
// Nobody reads a mouth for phonemes; they read it for "that one is talking", and
// amplitude carries that. Real lip-sync (visemes, phoneme timings) is still a
// separate task.

/** Blink gaps, in ms. Evenly spaced blinking reads as a metronome, not a face. */
const BLINK_MIN = 2500;
const BLINK_MAX = 5200;
const BLINK_MS = 120;

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface FaceProps {
  /** The learner has something in the composer. */
  typing?: boolean;
  /** Corrections delivered so far this session. Watched for increases, not read. */
  corrections?: number;
  /** Scenario goals ticked, and how many there are. */
  goalsHit?: number;
  goalsTotal?: number;
}

/**
 * Everything defaults to the quiet case, so a caller that passes nothing gets
 * exactly what v1 showed.
 */
export default function Face({
  typing = false,
  corrections = 0,
  goalsHit = 0,
  goalsTotal = 0,
}: FaceProps) {
  const [mouth, setMouth] = useState<voice.Mouth>("rest");
  const [blinking, setBlinking] = useState(false);
  const [cue, setCue] = useState<Cue | null>(null);
  const still = useRef(reducedMotion());

  const mode: Mode = typing ? "listening" : "idle";
  // Reduced motion keeps the mouth (it is the content) and drops everything the
  // face does on its own — the sway is the part that makes people ill, and an
  // expression that arrives unbidden is the same category of motion.
  const shown = still.current ? "neutral" : expressionFor(cue, mode, performance.now());
  const { brow, smiling, tilt } = EXPRESSIONS[shown];

  // The mouth. `subscribe` fires per animation frame while something is speaking,
  // but React is only told when the *frame* changes — hysteresis in mouthFor keeps
  // that down to a handful of renders a second rather than sixty.
  useEffect(() => {
    let state = voice.MOUTH_START;
    return voice.subscribe((level, speaking) => {
      if (!speaking) {
        state = voice.MOUTH_START;
        return setMouth("rest");
      }
      const next = voice.mouthFor(level, state, performance.now());
      if (next.mouth !== state.mouth) setMouth(next.mouth);
      state = next;
    });
  }, []);

  // The moments. Both signals are counters that only ever climb during a session,
  // so a rise is the event — no equality check on the payload, and nothing fires
  // when a session ends and the counts drop back to zero.
  //
  // The smile waits for the *last* goal rather than each one. Talk.tsx ticks goals
  // off by turn count (its own comment calls that a ponytail), so per-goal smiling
  // would have the coach beaming through the opening three turns of every session
  // regardless of what the learner said. All-goals-met fires once and is as true
  // as the checkmarks beside it.
  const seen = useRef({ corrections, goals: goalsHit });
  const fade = useRef(0);
  useEffect(() => {
    const was = seen.current;
    seen.current = { corrections, goals: goalsHit };
    if (still.current) return;

    const done = goalsTotal > 0 && goalsHit >= goalsTotal;
    const kind: Cue["kind"] | null = rose(was.goals, goalsHit) && done
      ? "smiling"
      : rose(was.corrections, corrections)
        ? "raised"
        : null;
    if (!kind) return;

    setCue({ kind, at: performance.now() });
    clearTimeout(fade.current);
    fade.current = window.setTimeout(() => setCue(null), CUE_MS);
  }, [corrections, goalsHit, goalsTotal]);

  useEffect(() => () => clearTimeout(fade.current), []);

  // The blink. One timer, re-armed at a random gap — cheap enough to be free, and
  // the single thing that stops a silent character from reading as a static image.
  useEffect(() => {
    if (still.current) return;
    let open = 0;
    let shut = 0;
    const arm = () => {
      open = window.setTimeout(() => {
        setBlinking(true);
        shut = window.setTimeout(() => {
          setBlinking(false);
          arm();
        }, BLINK_MS);
      }, BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN));
    };
    arm();
    return () => {
      clearTimeout(open);
      clearTimeout(shut);
    };
  }, []);

  return (
    <div className="face">
      <svg viewBox="0 0 120 120" aria-hidden>
        {/* The tilt origin sits at the base of the neck rather than the centre of
            the box; turning a head about its crown reads as a bobbing ball. */}
        <g className="tilt" style={{ transform: `rotate(${tilt}deg)` }}>
          <Head />
          <Brows state={brow} />
          <Eyes shut={blinking} />
          <Glasses />
          <MouthPart mouth={mouth} smiling={smiling} />
        </g>
      </svg>
      <div className="lbl">Coach</div>
    </div>
  );
}

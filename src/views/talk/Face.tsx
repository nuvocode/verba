import { useEffect, useRef, useState } from "react";
import * as voice from "../../lib/voice";

// The coach, given a body. A line-drawn head that opens its mouth on the sound
// lib/voice.ts is measuring, blinks on its own, and breathes.
//
// Not a mascot. The app is set in a serif and reads like a printed page, so the
// character is drawn the way an editorial illustration would be: one stroke
// weight, ink, no fill anywhere except the mouth, which is the one place the
// terracotta accent is allowed. Everything that says "app character" — the round
// eyes, the gradient, the wave — is deliberately absent.
//
// Five frames, and that is the whole animation budget: four mouths plus a blink.
// It works because cartoons have always worked this way. Nobody reads a mouth for
// phonemes; they read it for "that one is talking", and amplitude is enough to
// carry that. Real lip-sync (visemes, phoneme timings) is v2 and a separate task.

/** Mouth outlines, all sharing one command structure so the browser can tween `d`. */
const MOUTHS: Record<voice.Mouth, string> = {
  // Silence: a closed line with the faintest upward curve. It reads as composure
  // when nothing is playing, and as a shut mouth between syllables when something is.
  rest: "M52 79 q8 -2 16 0 q-8 1 -16 0 Z",
  closed: "M52 79 q8 0 16 0 q-8 0 -16 0 Z",
  half: "M52 78 q8 4 16 0 q-8 -2 -16 0 Z",
  open: "M52 76 q8 9 16 0 q-8 -5 -16 0 Z",
  wide: "M52 75 q8 13 16 0 q-8 -7 -16 0 Z",
};

/** Blink gaps, in ms. Evenly spaced blinking reads as a metronome, not a face. */
const BLINK_MIN = 2500;
const BLINK_MAX = 5200;
const BLINK_MS = 120;

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Face() {
  const [mouth, setMouth] = useState<voice.Mouth>("rest");
  const [blinking, setBlinking] = useState(false);
  const still = useRef(reducedMotion());

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
      <svg
        viewBox="0 0 120 120"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {/* Skull with a jaw rather than an oval, a fringe rather than a hairline,
            and a nose — the three things that separate a drawn face from a mascot. */}
        <path d="M60 26 c14 0 24 11 24 25 0 6 -1 12 -3 18 -3 10 -11 19 -21 19 s-18 -9 -21 -19 c-2 -6 -3 -12 -3 -18 0 -14 10 -25 24 -25 Z" />
        <path d="M37 46 c1 -13 11 -21 23 -21 c9 0 16 5 18 11" />
        <path d="M55 25 c-3 7 -9 12 -16 15" />
        <path d="M52 87 v7" />
        <path d="M68 87 v7" />
        <path d="M22 118 c4 -16 16 -24 38 -24 s34 8 38 24" />

        {/* brows and nose: single strokes, and most of the character */}
        <path d="M43 45 q7 -4 13 -1" />
        <path d="M64 44 q6 -3 13 1" />
        {/* The nose stops well short of the mouth on purpose — at `wide` the two
            merge into one shape if the philtrum is any tighter than this. */}
        <path d="M60 57 c0 4 -1 7 -3 8 q3 2 5 -1" />

        {blinking ? (
          <>
            <path d="M44 55 q6 3 12 0" />
            <path d="M64 55 q6 3 12 0" />
          </>
        ) : (
          <>
            <path d="M44 54 q6 -6 12 0 q-6 5 -12 0 Z" />
            <path d="M64 54 q6 -6 12 0 q-6 5 -12 0 Z" />
            <circle cx="50" cy="54" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="70" cy="54" r="1.5" fill="currentColor" stroke="none" />
          </>
        )}

        <path className="m" d={MOUTHS[mouth]} fill="var(--accent)" />
      </svg>
      <div className="lbl">Coach</div>
    </div>
  );
}

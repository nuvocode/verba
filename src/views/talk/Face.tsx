import { useCallback, useEffect, useRef, useState } from "react";
import * as voice from "../../lib/voice";
import {
  CUE_MS,
  earnedSmile,
  expressionFor,
  looksPleased,
  modeFor,
  rose,
  type Cue,
} from "./face/expression";
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

/**
 * How long a smile stays owed while the coach is still talking. Longer than any
 * single reply takes to speak, short enough that it cannot be paid out by some
 * later utterance it had nothing to do with.
 */
const OWED_MS = 30_000;

const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface FaceProps {
  /** The learner has something in the composer. */
  typing?: boolean;
  /** The mic is open — the learner is taking their turn out loud. */
  mic?: boolean;
  /** A reply is in flight. This is the dead air the thinking state covers. */
  waiting?: boolean;
  /** Corrections delivered so far this session. Watched for increases, not read. */
  corrections?: number;
  /** The confidence signal shown in the rail. Watched for a full step, not read. */
  confidence?: number;
  /** Coach turns spoken this session — the first one is the greeting. */
  coachTurns?: number;
  /** What the coach said last. Read only for the marks it uses when it is pleased. */
  coachSaid?: string;
}

/**
 * Everything defaults to the quiet case, so a caller that passes nothing gets
 * exactly what v1 showed.
 */
export default function Face({
  typing = false,
  mic = false,
  waiting = false,
  corrections = 0,
  confidence = 0,
  coachTurns = 0,
  coachSaid = "",
}: FaceProps) {
  const [mouth, setMouth] = useState<voice.Mouth>("rest");
  const [blinking, setBlinking] = useState(false);
  const [cue, setCue] = useState<Cue | null>(null);
  const still = useRef(reducedMotion());

  const mode = modeFor({ mic, typing, waiting });
  // Reduced motion keeps the mouth (it is the content) and drops everything the
  // face does on its own — the sway is the part that makes people ill, and an
  // expression that arrives unbidden is the same category of motion.
  const shown = still.current ? "neutral" : expressionFor(cue, mode, performance.now());
  const { brow, smiling, tilt, gaze } = EXPRESSIONS[shown];

  const fade = useRef(0);
  /** When a smile was last earned but could not be seen. See the mouth effect. */
  const owed = useRef(0);

  /** Put a moment on the face and start its clock. */
  const fire = useCallback((kind: Cue["kind"]) => {
    setCue({ kind, at: performance.now() });
    clearTimeout(fade.current);
    fade.current = window.setTimeout(() => setCue(null), CUE_MS[kind]);
  }, []);

  // The mouth. `subscribe` fires per animation frame while something is speaking,
  // but React is only told when the *frame* changes — hysteresis in mouthFor keeps
  // that down to a handful of renders a second rather than sixty.
  //
  // The end of an utterance is also where an owed smile is paid. Speech owns the
  // mouth — `mouthPath` says so — so a smile cued while the coach is mid-sentence
  // shows nothing but a brow, and every one of the three smile signals arrives
  // exactly then, with the turn. Replaying it once the mouth comes back to rest is
  // what makes it a smile the learner can actually see: the coach finishes its
  // sentence, then smiles. With speech off no edge ever arrives and the first
  // firing is the whole of it, which is also right.
  useEffect(() => {
    let state = voice.MOUTH_START;
    return voice.subscribe((level, speaking) => {
      if (!speaking) {
        state = voice.MOUTH_START;
        setMouth("rest");
        if (owed.current && performance.now() - owed.current < OWED_MS) {
          owed.current = 0;
          fire("smiling");
        }
        return;
      }
      const next = voice.mouthFor(level, state, performance.now());
      if (next.mouth !== state.mouth) setMouth(next.mouth);
      state = next;
    });
  }, [fire]);

  // The moments. Every signal here is a counter that only climbs during a session,
  // so a rise is the event — no equality check on the payload, and nothing fires
  // when a session ends and the counts drop back to zero.
  //
  // Three things earn a smile, and none of them is a goal: v1.5 smiled once a
  // session, at "all goals met", which Talk.tsx derives from a turn count. The
  // learner never saw it. What replaces it is the opening turn (a coach that
  // greets you without smiling is a strange coach), the coach's own pleased
  // emoji, and confidence climbing a full step. Together they land two to four
  // times in a normal session, spread across it rather than spent at once.
  //
  // Warmth outranks correction on the rare turn where both land. The correction is
  // on screen as text either way; the brow is only its echo, and a coach that
  // withholds a smile to raise an eyebrow at you is the character v1.5 shipped.
  const seen = useRef({ corrections, coachTurns });
  const smiledAt = useRef(confidence);
  useEffect(() => {
    const was = seen.current;
    seen.current = { corrections, coachTurns };
    if (still.current) return;

    const spoke = rose(was.coachTurns, coachTurns);
    const warm =
      (spoke && (coachTurns === 1 || looksPleased(coachSaid))) || earnedSmile(smiledAt.current, confidence);
    const kind: Cue["kind"] | null = warm ? "smiling" : rose(was.corrections, corrections) ? "raised" : null;
    if (!kind) return;

    // A correction cancels an unpaid smile rather than queueing behind it: two
    // reactions to one turn, arriving a sentence apart, is a face out of sync
    // with its own conversation.
    owed.current = kind === "smiling" ? performance.now() : 0;
    if (kind === "smiling") smiledAt.current = confidence;
    fire(kind);
  }, [corrections, confidence, coachTurns, coachSaid, fire]);

  useEffect(() => () => clearTimeout(fade.current), []);

  // No nod yet. `noddable` in face/expression.ts picks the turns that deserve one
  // and its rule is checked, but the movement itself is not shipped: from idle a
  // head-dip renders fine, and at the moment it is actually earned — the reply
  // landing, speech starting, the mouth re-rendering — it did not, through both a
  // keyframe animation and a transition on two different groups. Only a dip held
  // for seconds survived that, and a nod held for seconds is a bow. Shipping a cue
  // that cannot be seen is the exact mistake Part A was written to undo.


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
          <Eyes shut={blinking} gaze={gaze} />
          <Glasses />
          <MouthPart mouth={mouth} smiling={smiling} />
        </g>
      </svg>
      <div className="lbl">Coach</div>
    </div>
  );
}

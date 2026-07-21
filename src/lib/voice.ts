// How loud the coach is, right now — and nothing else.
//
// The character on the Talk screen needs one number, sixty times a second: is
// there sound, and how much. It never learns what is being said. That is the
// whole trick, and it is why one code path covers every speech tier: three of
// the four end up as an <audio> element in this webview (lib/speech.ts's
// `play()`), so an AnalyserNode on that element is the real thing, measured.
//
// The fourth is the OS voice, which speaks outside the webview and hands back no
// audio at all. There is nothing to measure there, so the mouth is driven by a
// synthetic curve instead — honest about being a guess, and re-phased on each
// word boundary the synthesiser reports so at least the *starts* line up. A
// static mouth was the alternative; on that tier the coach would simply look
// dead, and the OS voice is what every learner gets before they install anything.

/** The mouth frames, quietest first. `rest` is silence, not a level. */
export type Mouth = "rest" | "closed" | "half" | "open" | "wide";

export interface MouthState {
  mouth: Mouth;
  /** When this frame was entered, in ms. Enforces the dwell below. */
  since: number;
}

/**
 * Where a mouth starts. `since` is -Infinity rather than 0 because 0 is a real
 * timestamp — and a state stamped 0 read against a clock near 0 would have its
 * first change swallowed by the dwell, leaving the mouth shut through the opening
 * syllable. Nothing has been shown yet, so nothing is owed a dwell.
 */
export const MOUTH_START: MouthState = { mouth: "closed", since: -Infinity };

/**
 * Rising and falling thresholds per step, in the 0–1 units `subscribe` emits.
 * The gap between `up` and `down` is the entire anti-flicker mechanism: a level
 * hovering on a threshold — which is most of ordinary speech — crosses `up` and
 * then has to fall all the way back past `down` before the frame gives way.
 */
const STEPS: { mouth: Mouth; up: number; down: number }[] = [
  { mouth: "half", up: 0.06, down: 0.04 },
  { mouth: "open", up: 0.15, down: 0.11 },
  { mouth: "wide", up: 0.3, down: 0.24 },
];

/**
 * Shortest time a frame may be shown. Hysteresis handles a level that wobbles
 * around one threshold; this handles the other flicker — a transient that shoots
 * clean through two thresholds and back inside a couple of frames.
 */
const DWELL_MS = 60;

const RANKS: Mouth[] = ["closed", "half", "open", "wide"];

/**
 * Which mouth a level asks for, given the one already on screen. Pure, so
 * voice.check.ts can drive it without a webview.
 *
 * `rest` is not reachable from here — it means "nothing is speaking", which is a
 * fact about the bus, not about a level, and the caller already knows it.
 */
export function mouthFor(level: number, prev: MouthState, now: number): MouthState {
  // The band of frames this level allows: `hi` is where it would climb to on the
  // way up, `lo` where it would fall to on the way down. Because every `down`
  // sits below its `up`, lo is never below hi — and prev clamped into [hi, lo] is
  // the hysteresis, in one line.
  const hi = STEPS.filter((s) => level >= s.up).length;
  const lo = STEPS.filter((s) => level >= s.down).length;
  const was = Math.max(0, RANKS.indexOf(prev.mouth));
  const want = Math.min(lo, Math.max(hi, was));
  if (want === was) return prev;
  if (now - prev.since < DWELL_MS) return prev;
  return { mouth: RANKS[want], since: now };
}

/**
 * The OS voice's stand-in: two rates that share no common period inside a minute,
 * rectified into something that opens and closes like speech without ever
 * repeating a pattern the eye can catch. `phase` is reset on each reported word
 * boundary, which puts an opening mouth on the front of a word.
 */
export function syntheticLevel(nowMs: number, phase = 0): number {
  const t = (nowMs - phase) / 1000;
  const a = Math.sin(2 * Math.PI * 5.5 * t);
  const b = Math.sin(2 * Math.PI * 3.13 * t + 1.3);
  return Math.min(1, Math.abs(a * 0.6 + b * 0.4) * 0.62);
}

/**
 * Analyser RMS runs quiet — ordinary speech sits around 0.05–0.15 full-scale —
 * so it is lifted into the range STEPS is written in. One fixed number rather
 * than automatic gain: the tiers differ in loudness (a Piper WAV is not an
 * ElevenLabs mp3), but hysteresis absorbs that, and an AGC chasing the level
 * would make quiet passages flap as hard as loud ones, which is worse.
 */
const GAIN = 3;

// ---- the bus ----

type Listener = (level: number, speaking: boolean) => void;

const subs = new Set<Listener>();
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let bytes = new Uint8Array(0);
let source: "" | "audio" | "synthetic" = "";
let phase = 0;
let frame = 0;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** One context for the app's life, built on first use — never at import time,
 *  where a webview would hand back a suspended one nobody has permission to
 *  resume yet. Returns null off the browser (the checks run under node). */
function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = typeof window !== "undefined" ? (window.AudioContext ?? (window as any).webkitAudioContext) : undefined;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

function read(): number {
  if (source === "synthetic") return syntheticLevel(now(), phase);
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(bytes);
  let sum = 0;
  for (const v of bytes) {
    const s = (v - 128) / 128;
    sum += s * s;
  }
  return Math.min(1, Math.sqrt(sum / bytes.length) * GAIN);
}

function emit(level: number) {
  for (const fn of subs) fn(level, source !== "");
}

/** The loop only exists while someone is watching *and* something is speaking.
 *  Silence costs nothing, and neither does a Talk screen nobody is looking at —
 *  the blink and the breathing are CSS, so no JS has to tick for them. */
function start() {
  if (frame || !subs.size || !source) return;
  if (typeof requestAnimationFrame === "undefined") return;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    emit(read());
  };
  frame = requestAnimationFrame(tick);
}

function stop() {
  if (!frame || (subs.size && source)) return;
  cancelAnimationFrame(frame);
  frame = 0;
}

/**
 * Watch the level. Called back with `(level, speaking)` on every animation frame
 * while something is speaking, and once with `(0, false)` when it stops.
 * Returns the unsubscribe.
 */
export function subscribe(fn: Listener): () => void {
  subs.add(fn);
  start();
  return () => {
    subs.delete(fn);
    stop();
  };
}

/**
 * Route a playing element through the analyser. Called by `play()` in
 * lib/speech.ts, which is the one place the bundled, local and cloud tiers all
 * end up.
 *
 * The guard matters more than the rest of this file: routing a live element
 * through a suspended context sends its output nowhere, and the learner gets
 * silence instead of a voice. So the wiring only happens once the context is
 * actually running, and every failure here is swallowed — losing the animation
 * is a worse-looking app, losing the audio is a broken one.
 */
export function attach(el: HTMLAudioElement): void {
  const c = context();
  if (!c) return;

  const wire = () => {
    if (c.state !== "running" || el.ended) return;
    let src: MediaElementAudioSourceNode;
    try {
      src = c.createMediaElementSource(el);
    } catch {
      return; // already routed, or a webview that refuses to
    }
    const an = c.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.6;
    src.connect(an);
    an.connect(c.destination);

    analyser = an;
    bytes = new Uint8Array(an.fftSize);
    source = "audio";
    start();

    // Stop *reading* when the clip ends; deliberately do not tear the graph down.
    // The element is thrown away by the caller either way, and disconnecting a
    // node on a stray `pause` is how you silence audio that was going to resume.
    const done = () => {
      if (analyser !== an) return;
      analyser = null;
      source = "";
      stop();
      emit(0);
    };
    el.addEventListener("ended", done);
    el.addEventListener("pause", done);
    el.addEventListener("error", done);
  };

  if (c.state === "running") wire();
  else void c.resume().then(wire, () => {});
}

/** The OS voice, which has no stream: start or stop the synthetic curve. */
export function synthetic(on: boolean): void {
  if (on) {
    // An <audio> clip that is still playing outranks this — the measured level is
    // always the better one, and the OS voice never overlaps it in practice.
    if (source === "audio") return;
    phase = now();
    source = "synthetic";
    start();
    return;
  }
  if (source !== "synthetic") return;
  source = "";
  stop();
  emit(0);
}

/** A word boundary from the OS synthesiser — re-phase so the word opens the mouth. */
export function boundary(): void {
  if (source === "synthetic") phase = now();
}

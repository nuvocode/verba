// Real listening conditions, honestly graded (PLAN-036).
//
// Five variables, each graded, at most two hardened at once. And one rule that is
// more important than any of them: a grade the speech engine cannot actually
// produce is not shown, and never faked. `supported` reads the tier's declared
// `can` (lib/speech) and returns only the grades that are genuinely available;
// `applyTo` wraps a clip through a WebAudio graph for the active variables; and
// `walkBack` / `harden` move the learner's persisted grades.
//
// The module is pure by contract: it must not import a provider, ./db.ts, React,
// or a settings screen. It takes a clip, a tier's declared capabilities and the
// learner's grades, and returns the graph to build and the grades to persist.

import type { Clip } from "./speech.ts";

/** The five variables, each with its grades. Grade 0 of every variable is the
 *  current behaviour, so a tier that supports nothing still produces exactly
 *  today's Listen. */
export const CONDITIONS = {
  pace: ["teaching", "natural", "fast"],
  accent: ["standard", "regional"],
  noise: ["clean", "light", "loud"],
  channel: ["clear", "phone"],
  speakers: ["one", "two", "overlapping"],
} as const;

export type Variable = keyof typeof CONDITIONS;
export type Grade = number; // 0-based index into CONDITIONS[variable]; 0 = current behaviour

/** The order variables are considered when picking the hardest / next to harden. */
export const VARIABLE_ORDER: Variable[] = ["pace", "accent", "noise", "channel", "speakers"];

/** The tier capability `supported` reads — the `can` field of a `Tts` (lib/speech). */
export interface TierCan {
  rate: boolean;
  voices: number;
  filterable: boolean;
}

/**
 * The grades that are genuinely available on this tier for this pack. Grade 0 of
 * every variable is always available (it is today's Listen); anything above it is
 * offered only where the tier can honestly produce it. `Listening.tsx` renders
 * exactly this, so an unsupported grade is not disabled-with-a-tooltip — it is
 * not there.
 *
 * `accent` and `speakers` are deliberately never offered: no code in this repo
 * selects a voice per grade or synthesises a second speaker, so a tier that
 * happens to have many voices would be promised a grade nothing produces. A
 * grade the engine cannot actually produce is not shown, and never faked — the
 * plan's one rule. `can.voices` stays on the contract for a future
 * implementation, but it gates nothing today.
 */
export function supported(tts: { can: TierCan }, _pack?: unknown): Record<Variable, Grade> {
  return {
    pace: tts.can.rate ? CONDITIONS.pace.length - 1 : 0,
    accent: 0,
    noise: tts.can.filterable ? CONDITIONS.noise.length - 1 : 0,
    channel: tts.can.filterable ? CONDITIONS.channel.length - 1 : 0,
    speakers: 0,
  };
}

// --- the numbers this plan owns ----------------------------------------------

/** A telephone line is a band-pass at 300–3400 Hz — the actual bandwidth limit. */
export const PHONE_LOW = 300;
export const PHONE_HIGH = 3400;
/** The band-pass centre and Q that realise 300–3400 Hz on a BiquadFilterNode. */
export const PHONE_CENTER = Math.sqrt(PHONE_LOW * PHONE_HIGH);
export const PHONE_Q = PHONE_CENTER / (PHONE_HIGH - PHONE_LOW);

/** How loud the generated noise sits under the clip, per grade (light, loud). */
export const NOISE_RATIO: Record<number, number> = { 1: 0.15, 2: 0.35 };
/**
 * The pace multiplier each grade asks for, relative to the learner's own rate.
 * Grade 0 (teaching) is the current behaviour — multiplier 1.0. "natural" and
 * "fast" are genuinely faster, so each is a real multiplier > 1 — a grade that
 * equals grade 0 would be a grade that does nothing.
 */
export const PACE_MULTIPLIER: Record<number, number> = { 1: 1.1, 2: 1.3 };
/** Frames of generated noise — one second at the context's rate, looped. */
export const NOISE_FRAMES = 1 << 15;

// --- applyTo: the graph, wrapped around the clip ------------------------------

export type Active = { variable: Variable; grade: Grade };
/** At most two non-zero variables — a third cannot be passed at all. */
export type ActiveSet = [] | [Active] | [Active, Active];

/**
 * The active variables a set of grades asks for, capped at two. Grade 0 variables
 * are never active — they are today's Listen.
 */
export function activeFrom(grades: Partial<Record<Variable, Grade>>): ActiveSet {
  const active = VARIABLE_ORDER.map((v) => ({ variable: v, grade: grades[v] ?? 0 }))
    .filter((g) => g.grade > 0)
    .slice(0, 2);
  return active as ActiveSet;
}

/**
 * The pace multiplier the active conditions ask for. The transport folds this
 * into its single rate door (`rateRef * pace`), so a pace grade flows through
 * the one place the learner's rate is written — not a second door that
 * `playFrom` / `changeRate` would clobber.
 */
export function paceMultiplier(active: ActiveSet): number {
  const pace = active.find((a) => a.variable === "pace");
  return pace ? PACE_MULTIPLIER[pace.grade] ?? 1 : 1;
}

// One shared AudioContext, created lazily. A chapter's clips all route through
// it, so a chapter never exhausts the webview's context budget (a fresh context
// per clip would hit the ~4–6 limit and throw in `prepareFor`). A context born
// outside a user gesture starts suspended, so `resumeAudio` is called on play.
let sharedCtx: AudioContext | null = null;
function ctx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

/** Resume the shared context — call it on play, so a suspended context does not
 *  silence the element routed through it. A no-op when no graph was ever built. */
export function resumeAudio(): void {
  if (sharedCtx && sharedCtx.state === "suspended") void sharedCtx.resume();
}

/** Test-only: drop the shared context so the next `applyTo` builds a fresh one. */
export function resetAudio(): void {
  sharedCtx = null;
}

/**
 * Route a clip through the shared WebAudio graph for the active variables. The
 * clip's element is the same `HTMLAudioElement` — `ended` / `error` / cancel all
 * resolve exactly as they do now, because `playClip`'s contract is untouched;
 * this only routes the element's output through the graph. With no channel or
 * noise active the source is returned untouched — grade 0 is today's Listen,
 * byte for byte, and pace needs no graph at all.
 *
 * - **channel** — the source through a band-pass at 300–3400 Hz.
 * - **noise** — a generated buffer mixed under at the grade's ratio, started
 *   here and stopped on `release()`; the source path itself is untouched.
 */
export function applyTo(clip: Clip, active: ActiveSet): Clip {
  // Runtime guard for JS callers — the type already refuses a third.
  if (active.length > 2) throw new Error("applyTo: at most two active variables");
  // Pace needs no graph — it is folded into the transport's rate door. Only
  // channel and noise route the element through WebAudio.
  const needsGraph = active.some((a) => a.variable === "channel" || a.variable === "noise");
  if (!needsGraph) return clip;

  const c = ctx();
  const source = c.createMediaElementSource(clip.el);
  const noiseSources: AudioBufferSourceNode[] = [];

  let channelFilter: BiquadFilterNode | null = null;
  let noiseGain: GainNode | null = null;

  for (const { variable, grade } of active) {
    if (grade <= 0) continue;
    if (variable === "channel") {
      const filter = c.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = PHONE_CENTER;
      filter.Q.value = PHONE_Q;
      channelFilter = filter;
    } else if (variable === "noise") {
      const gain = c.createGain();
      gain.gain.value = NOISE_RATIO[grade];
      const buffer = c.createBuffer(1, NOISE_FRAMES, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = c.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      noise.connect(gain);
      // A buffer source that is never started is silence — the two noise grades
      // would both be quiet. Start it here, and stop it on release.
      noise.start();
      noiseSources.push(noise);
      noiseGain = gain;
    }
  }

  // Route: source → (band-pass?) → destination. Noise mixes under via its own
  // gain, leaving the source path untouched.
  if (channelFilter) {
    source.connect(channelFilter);
    channelFilter.connect(c.destination);
  } else {
    source.connect(c.destination);
  }
  if (noiseGain) noiseGain.connect(c.destination);

  return {
    el: clip.el,
    get duration() {
      return clip.duration;
    },
    release() {
      for (const n of noiseSources) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
        n.disconnect();
      }
      // The shared context outlives the clip, so a released element's source
      // node has to leave the graph with it — otherwise every chapter's sources
      // stay fanned into `destination` for the life of the app.
      source.disconnect();
      if (channelFilter) channelFilter.disconnect();
      clip.release();
    },
  };
}

// --- walk back and harden -----------------------------------------------------

export interface WalkBackResult {
  grades: Partial<Record<Variable, Grade>>;
  /** The variable and the grade it walked back from, or null when nothing was active. */
  walked: { variable: Variable; from: Grade } | null;
}

/**
 * Drop the hardest active variable by one grade, floored at 0. The activity is
 * never skipped and the piece is never abandoned — the caller replays the same
 * chapter against the easier audio. Returns the new grades and what walked back.
 */
export function walkBack(grades: Partial<Record<Variable, Grade>>): WalkBackResult {
  const active = VARIABLE_ORDER.map((v) => ({ variable: v, grade: grades[v] ?? 0 }))
    .filter((g) => g.grade > 0)
    .sort((a, b) => b.grade - a.grade);
  if (active.length === 0) return { grades, walked: null };
  const hardest = active[0];
  return {
    grades: { ...grades, [hardest.variable]: Math.max(0, hardest.grade - 1) },
    walked: { variable: hardest.variable, from: hardest.grade },
  };
}

export interface HardenResult {
  grades: Partial<Record<Variable, Grade>>;
  /** The variable raised and its new grade, or null when nothing can be raised. */
  hardened: { variable: Variable; to: Grade } | null;
}

/**
 * Raise one variable one grade, at most one per chapter, and never a third active
 * variable — at most two are hardened at once. Prefers raising an already-active
 * variable; only starts a new one when fewer than two are active. `exclude` is a
 * variable that was just walked back — a successful replay must not immediately
 * re-harden the very condition that was eased. Returns the new grades and what
 * hardened.
 */
export function harden(
  grades: Partial<Record<Variable, Grade>>,
  max: Record<Variable, Grade>,
  exclude?: Variable | null,
): HardenResult {
  const active = VARIABLE_ORDER.filter((v) => (grades[v] ?? 0) > 0);
  for (const v of VARIABLE_ORDER) {
    if (v === exclude) continue;
    const cur = grades[v] ?? 0;
    if (cur >= max[v]) continue;
    const isActive = cur > 0;
    if (isActive || active.length < 2) {
      return { grades: { ...grades, [v]: cur + 1 }, hardened: { variable: v, to: cur + 1 } };
    }
  }
  return { grades, hardened: null };
}

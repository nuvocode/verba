// The speech loop: speak (TTS) → listen (STT) → respond → speak.
//
// TTS and STT are separate halves, not competing "engines". No webview ships a
// usable SpeechRecognition (WKWebView has none at all, WebView2 needs a Google
// key), so dictation is Deepgram or nothing; TTS works offline via the OS voices
// and ElevenLabs is the upgrade. Each half is picked independently — the old
// single radio forced ElevenLabs users onto a recogniser that does not exist.
//
// The third tier is a local server the learner runs themselves: any
// OpenAI-compatible endpoint (Kokoro-FastAPI speaks, speaches listens). It is
// the offline upgrade without a bundled sidecar — no binary to ship, no Rust
// command to write, and it beats the OS voices while never leaving the machine.
//
// The fourth tier is the bundled one: sherpa-onnx (Kokoro/Piper to speak, Whisper
// to listen) running inside this app, on models it downloads on demand. Zero setup
// — no server, no key, no Docker — and it is the only tier that is both offline
// and good. It outranks the rest when a model is installed, and simply is not
// there when one isn't. See lib/bundled.ts for the models, src-tauri/src/speech.rs
// for the engine.

import { fetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import * as voice from "./voice.ts";

export interface SpeakOptions {
  locale?: string; // BCP-47, e.g. "es-ES"
  voiceHint?: string; // preferred voice-name substring
  rate?: number; // 0.1–10, default ~0.95 for learners
}

/**
 * A clip of audio the caller owns. `release()` must be called when it is done
 * with — the clip has handed its blob URL to the caller, and nobody else will
 * revoke it.
 */
export interface Clip {
  el: HTMLAudioElement;
  /** Seconds. Known once metadata loads; 0 until then. */
  duration: number;
  /** Revokes the object URL. Safe to call twice. */
  release(): void;
}

/** Text → audio. */
export interface Tts {
  canSpeak: boolean;
  /** Whether this tier can hand back a seekable clip. `false` → play/pause only. */
  seekable: boolean;
  /**
   * Speak `text`, resolving with the milliseconds it actually held the floor
   * (PLAN-028). `0` when cancelled before starting, `0` on a tier that could
   * not speak, and the measured duration otherwise — so the leaner's thinking
   * time can be separated from the coach's speaking time.
   */
  speak(text: string, opts?: SpeakOptions): Promise<number>;
  /** Bytes → a clip owned by the caller. Absent (and `seekable: false`) on a tier with no bytes. */
  clip?(text: string, opts?: SpeakOptions): Promise<Clip>;
  cancel(): void;
}

/** What a recording observed, beside what it said. */
export interface ListenResult {
  text: string;
  /** How long the learner spoke, in ms. */
  ms: number;
  /** The RMS envelope, one entry per analyser frame (~20/s). */
  levels: number[];
}

export interface ListenOptions {
  locale?: string; // BCP-47, e.g. "es-ES"
  /** 0–1, ~20×/s, straight off the analyser. Drives the meter. */
  onLevel?(level: number): void;
  /** Best-effort running transcript. Only called by tiers with `partials: true`. */
  onPartial?(text: string): void;
  /** Stop after this much continuous silence. 0 disables. Default 1800. */
  silenceMs?: number;
  /** Fired the moment the recorder actually stops — the mic is closed. */
  onStopped?(): void;
}

/** Audio → text. `listen` resolves when `cancel` stops the recording. */
export interface Stt {
  canListen: boolean;
  /** Whether this tier can produce `onPartial` at all. The UI reads it. */
  partials: boolean;
  listen(opts?: ListenOptions): Promise<ListenResult>;
  cancel(): void;
}

export type SpeechAdapter = Tts & Stt;

const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
// Chrome/WebKit expose SpeechRecognition under a webkit prefix. Present in no
// Tauri webview today — kept as a feature-detect so it lights up if one gains it.
const Recognition: any =
  typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

const hasMic = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** "pt-BR" → "pt". The language subtag, which is all some APIs accept. */
const baseLang = (locale?: string) => (locale ?? "").split(/[-_]/)[0].toLowerCase();

function pickVoice(locale?: string, hint?: string): SpeechSynthesisVoice | undefined {
  if (!synth) return undefined;
  const voices = synth.getVoices();
  if (!locale) return voices[0];
  const want = locale.toLowerCase().replace("_", "-");
  const norm = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  // Exact region first: pt-BR and pt-PT are different accents, and picking either
  // for the other is the kind of thing a learner copies for months.
  const exact = voices.filter((v) => norm(v) === want);
  const sameLang = voices.filter((v) => baseLang(norm(v)) === baseLang(want));
  const pool = exact.length ? exact : sameLang;
  if (hint) {
    const h = hint.toLowerCase();
    const match = pool.find((v) => v.name.toLowerCase().includes(h));
    if (match) return match;
  }
  return pool[0] ?? voices[0];
}

/** The OS voices + whatever recogniser the webview has (in practice: none). */
export function webSpeech(): SpeechAdapter {
  let recognition: any = null;
  // Settles the in-flight utterance's promise. This tier speaks outside the
  // webview and a cancelled utterance fires nothing back, so `cancel` has to
  // resolve it here.
  let settle: (() => void) | null = null;
  return {
    canSpeak: !!synth,
    // The OS voice speaks outside the webview and hands back no bytes, so there
    // is no clip and nothing seekable — play/pause only, and the surface hides
    // what this tier cannot do rather than faking it.
    seekable: false,
    canListen: !!Recognition,
    // No webview ships a recogniser that can stream partials — this tier is
    // record-then-transcribe at best, and usually nothing at all.
    partials: false,

    speak(text, opts = {}) {
      return new Promise<number>((resolve) => {
        if (!synth || !text.trim()) return resolve(0);
        synth.cancel();
        settle?.(); // the utterance just cancelled fires no `end` — settle it here
        settle = null;
        const u = new SpeechSynthesisUtterance(text);
        if (opts.locale) u.lang = opts.locale;
        const v = pickVoice(opts.locale, opts.voiceHint);
        if (v) u.voice = v;
        u.rate = opts.rate ?? 0.95;
        const start = performance.now();
        const done = () => {
          settle = null;
          voice.synthetic(false);
          resolve(Math.max(0, performance.now() - start));
        };
        u.onend = done;
        u.onerror = done; // never hang the UI on a TTS hiccup
        // `cancel` reaches the promise through this: a cancelled utterance fires
        // no `end` on most engines, and an unsettled promise hangs its caller.
        settle = done;
        // This tier speaks outside the webview, so there is no audio to measure —
        // the coach's mouth runs on a synthetic curve instead, nudged onto each
        // word by whatever boundary events the synthesiser bothers to fire. The
        // wall clock around the utterance is still the floor it held (PLAN-028).
        u.onboundary = () => voice.boundary();
        voice.synthetic(true);
        synth.speak(u);
      });
    },

    listen(opts = {}) {
      return new Promise((resolve, reject) => {
        if (!Recognition) return reject(new Error("This webview has no speech recognition."));
        recognition = new Recognition();
        recognition.lang = opts.locale ?? "en-US";
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onresult = (e: any) =>
          resolve({ text: e.results?.[0]?.[0]?.transcript ?? "", ms: 0, levels: [] });
        recognition.onerror = (e: any) => reject(new Error(e?.error ?? "recognition error"));
        recognition.onend = () => (recognition = null);
        recognition.start();
      });
    },

    cancel() {
      synth?.cancel();
      // A cancelled utterance fires no `end` on every engine — close the mouth here
      // too, or an interrupted reply leaves the coach mid-syllable forever, and
      // settle the promise by hand or its caller waits on it forever.
      voice.synthetic(false);
      settle?.();
      settle = null;
      recognition?.stop?.();
    },
  };
}

// Chrome loads voices asynchronously; kick a load so the first speak() has them.
if (synth) synth.getVoices();

// ---- cloud speech ----

/** A microphone the learner can pick between. `label` is "" until permission is granted. */
export interface MicDevice {
  id: string;
  label: string;
}

/**
 * The microphones this machine offers.
 *
 * Empty labels are not a bug: a browser withholds device names until the page has
 * been granted the microphone once, so the panel that lists these has to open a
 * stream before the list is worth reading. Callers ask again after the test.
 */
export async function micDevices(): Promise<MicDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput").map((d) => ({ id: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

/**
 * Open the chosen microphone — the one door every recording goes through, so the
 * device picked in Settings is the device the mic test proves and the device Talk
 * then uses. Nothing else in the app calls getUserMedia.
 *
 * A device id that no longer resolves falls back to the system default rather than
 * failing: a headset unplugged since it was chosen would otherwise kill dictation
 * everywhere, with the only clue three screens away. The Speech panel is where the
 * stale choice gets noticed, because its list no longer contains it.
 */
export async function mic(deviceId = ""): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (!deviceId) return md.getUserMedia({ audio: true });
  try {
    return await md.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name !== "OverconstrainedError" && name !== "NotFoundError") throw e;
    return md.getUserMedia({ audio: true });
  }
}

/**
 * Where the operating system keeps the microphone switch. Named per platform
 * because "check your privacy settings" is the kind of help that helps nobody —
 * §7 row 4 asks for the route, not the diagnosis.
 */
export function micRoute(platform = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  if (/Mac|iPhone|iPad/i.test(platform)) return "Open System Settings → Privacy & Security → Microphone and switch Verba on.";
  if (/Win/i.test(platform)) return "Open Settings → Privacy & security → Microphone and switch Verba on.";
  return "Allow Verba to use the microphone in your system's privacy settings.";
}

/**
 * Why the microphone would not open, in words that name the next move.
 *
 * The browser's own messages are written for developers ("Requested device not
 * found"), and the four failures a learner actually hits have four different
 * answers — a permission is granted, a device is plugged in, another app is
 * closed. Anything unrecognised falls through verbatim rather than being
 * flattened into a guess.
 */
export function micTrouble(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return `Verba is not allowed to use the microphone. ${micRoute()}`;
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone is connected to this machine. Plug one in, then try again.";
  if (name === "NotReadableError")
    return "Another app is holding the microphone. Close it, then try again.";
  return `The microphone would not open: ${String((err as { message?: string })?.message ?? err)}`;
}

/**
 * Record until `onStart`'s recorder is stopped — push-to-talk, not a fixed
 * window. A learner mid-sentence at second 6 was the old behaviour; the cap is
 * only there so a mic left open doesn't record until the heat death.
 *
 * The shared work every tier needs: an `AnalyserNode` on the stream measures the
 * RMS envelope (fed to `onLevel` and returned as `levels`), and once at least
 * `minSpeechMs` of speech has been seen, `silenceMs` of continuous below-threshold
 * level calls `rec.stop()` on its own. Before any speech it never fires — a
 * learner thinking for four seconds is not a finished recording. The `AudioContext`
 * is closed on every exit path, including the throwing ones.
 */
export function record(
  onStart: (r: MediaRecorder) => void,
  opts: {
    maxMs?: number;
    deviceId?: string;
    silenceMs?: number;
    onLevel?: (level: number) => void;
    onChunk?: (chunk: BlobPart) => void;
    /** Passed to `rec.start(timeslice)` so the recorder emits chunks as it goes. */
    timeslice?: number;
    /** Fired the moment the recorder stops — the mic is closed. */
    onStopped?: () => void;
  } = {},
): Promise<{ clip: Blob; ms: number; levels: number[] }> {
  const { maxMs = 60_000, deviceId = "", silenceMs = 1800, onLevel, onChunk, timeslice, onStopped } = opts;
  return new Promise(async (resolve, reject) => {
    let stream: MediaStream;
    try {
      stream = await mic(deviceId);
    } catch (e) {
      return reject(new Error(micTrouble(e)));
    }
    const rec = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    const levels: number[] = [];
    const started = performance.now();
    const done = () => stream.getTracks().forEach((t) => t.stop());
    const cap = setTimeout(() => rec.state !== "inactive" && rec.stop(), maxMs);

    // The level meter and the silence detector share one analyser. RMS per frame
    // is the honest measure of "is there speech right now" — a peak meter would
    // light up on a cough, and the silence stop has to be about the voice.
    let ctx: AudioContext | null = null;
    let raf = 0;
    let sawSpeech = false;
    let quietSince = 0;
    let lastFrame = 0;
    let closed = false;
    const teardown = () => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(raf);
      if (ctx) void ctx.close().catch(() => {});
      ctx = null;
    };

    try {
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      // The envelope is emitted at ~20/s (every 50 ms of wall-clock time), not
      // once per animation frame — the analyser runs at the display's refresh
      // rate, and the `levels` contract (~20/s) must not depend on it. The
      // silence detector below still runs every frame; it already measures by
      // wall-clock time, so throttling the level emission does not slow it.
      let lastLevel = 0;
      const frame = (now: number) => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        if (now - lastLevel >= 50) {
          lastLevel = now;
          levels.push(rms);
          onLevel?.(rms);
        }
        // Silence is measured by wall-clock time, not frame count — the analyser
        // runs at the display's refresh rate, and the threshold must not depend
        // on it. `lastFrame` is 0 on the first frame, so the first delta is skipped.
        const dt = lastFrame ? now - lastFrame : 0;
        lastFrame = now;
        // ponytail: 0.02 is the fixed speech floor — a real voice sits well above
        // it, a quiet room below it. Per-mic calibration is the upgrade.
        if (rms > 0.02) {
          sawSpeech = true;
          quietSince = 0;
        } else if (sawSpeech) {
          quietSince += dt;
          if (silenceMs > 0 && quietSince >= silenceMs && rec.state !== "inactive") rec.stop();
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    } catch (e) {
      teardown();
      done();
      clearTimeout(cap);
      return reject(e instanceof Error ? e : new Error(String(e)));
    }

    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      onChunk?.(e.data);
    };
    rec.onstop = () => {
      clearTimeout(cap);
      teardown();
      done();
      onStopped?.();
      resolve({ clip: new Blob(chunks, { type: rec.mimeType || "audio/webm" }), ms: performance.now() - started, levels });
    };
    rec.onerror = (e: any) => {
      clearTimeout(cap);
      teardown();
      done();
      reject(new Error(e?.error?.message ?? "recording error"));
    };
    rec.start(timeslice);
    onStart(rec);
  });
}

/**
 * Turn returned audio bytes into a clip the caller owns. The three byte tiers —
 * bundled, local and cloud all come back as bytes — land here, which makes this
 * the one place the coach's face has to be wired to. `attach` is best-effort by
 * construction and still runs exactly once per clip: it never throws and never
 * delays playback, and if it cannot measure the element the audio is untouched.
 */
function clip(bytes: ArrayBuffer, mime: string): Clip {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = new Audio(url);
  voice.attach(a);
  let released = false;
  return {
    el: a,
    // The duration is a property of the bytes, not of the caller — read it off
    // the element, which fills it the moment the container header loads. A
    // caller that reads `c.duration` after `await clip()` gets a real number
    // instead of a 0 it has to wait for itself.
    get duration() {
      return a.duration > 0 ? a.duration : 0;
    },
    release() {
      // The `el` keeps playing if it was mid-turn; release only revokes the URL.
      // Idempotent — the caller may release twice (a stop path and a reset path),
      // and revoking an already-revoked URL is a no-op the contract need not rely on.
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * Play a clip to the end, resolving with the milliseconds it actually held the
 * floor (PLAN-028). `0` when the clip never started (cancelled or refused) — the
 * coach held no floor, so nothing counts as learner thinking time. Resolves on
 * error too — a TTS hiccup must not hang the turn. `release()` is the caller's
 * job once the clip is done with; speak() owns its clip, so it releases on every
 * exit path (end, error, a play() that refused).
 *
 * `onStop` hands the caller a way to settle the clip early. Pausing an element
 * fires neither `ended` nor `error`, so a cancelled clip would otherwise never
 * settle and every caller awaiting it would wait forever — useTalk's speech
 * queue among them.
 */
function playClip(c: Clip, onStop?: (stop: () => void) => void): Promise<number> {
  return new Promise<number>((resolve) => {
    const el = c.el;
    const start = performance.now();
    let settled = false;
    const settle = (ms: number) => {
      c.release();
      if (settled) return;
      settled = true;
      resolve(ms);
    };
    const held = () => settle(Math.max(0, performance.now() - start));
    el.onended = el.onerror = held;
    // The floor a cancelled clip held is the floor it held — the learner waited
    // through it whether or not it reached its end.
    onStop?.(held);
    el.play().catch(() => settle(0));
  });
}

/**
 * The byte-backed tier skeleton the three seekable tiers share: a `synthesize`
 * that makes a clip, plus `speak` = synthesize → play-to-end, and `cancel` that
 * pauses the in-flight clip. `clip` hands the clip to the caller, who owns its
 * `release()`.
 */
export function byteTier(synthesize: (text: string, opts?: SpeakOptions) => Promise<Clip>): Tts {
  let audio: HTMLAudioElement | null = null;
  // Settles the in-flight clip's promise. `cancel` pauses the element, which
  // fires no event at all — without this the awaited `speak` never returns.
  let stop: (() => void) | null = null;
  return {
    canSpeak: true,
    seekable: true,
    async speak(text, opts) {
      if (!text.trim()) return 0;
      const c = await synthesize(text, opts);
      // A byte tier plays an HTMLAudioElement, which has `playbackRate` — the one
      // knob every byte tier shares, and the one the rewind's SLOW_RATE rides on
      // (PLAN-030). No vendor API involved: elevenLabs and openaiTts drop `rate`
      // in their request, so the slow-down happens here, on the element, for all
      // three byte tiers alike.
      c.el.playbackRate = opts?.rate ?? 1;
      audio = c.el;
      const ms = await playClip(c, (s) => (stop = s));
      audio = null;
      stop = null;
      return ms;
    },
    clip(text, opts) {
      if (!text.trim()) return Promise.reject(new Error("Nothing to synthesise."));
      return synthesize(text, opts);
    },
    cancel() {
      audio?.pause();
      audio = null;
      // A paused element fires neither `ended` nor `error`, so the clip has to be
      // settled by hand or whoever awaits it waits forever.
      stop?.();
      stop = null;
    },
  };
}

/** ElevenLabs text-to-speech. */
export function elevenLabs(apiKey: string, voiceId = "21m00Tcm4TlvDq8ikWAM"): Tts {
  return byteTier(async (text, opts = {}) => {
    // Turbo v2.5 takes an explicit language_code (ISO 639-1) and multilingual_v2
    // refuses it — without one the model just guesses the language from the text.
    // ponytail: one fixed multilingual voice, so e.g. Arabic comes out accented.
    // Per-pack voice ids are the upgrade — add `speech.elevenVoiceId` to the pack
    // schema when someone asks for it.
    if (!apiKey) throw new Error("ElevenLabs API key is not set (Settings → Speech and listening).");
    const lang = baseLang(opts.locale);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        ...(lang ? { language_code: lang } : {}),
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    return clip(await res.arrayBuffer(), "audio/mpeg");
  });
}

// ---- local speech: any OpenAI-compatible server ----

const trimUrl = (u: string) => u.replace(/\/$/, "");

/**
 * `POST /audio/speech` — OpenAI's TTS shape, which Kokoro-FastAPI also serves.
 * The voice is the learner's choice (`af_heart`, `alloy`, …), not something we
 * infer from the pack: voice names are server-specific and guessing one gets a
 * 400, where a wrong-but-valid voice merely sounds wrong.
 */
export function openaiTts(baseUrl: string, model: string, voice: string, apiKey = ""): Tts {
  return byteTier(async (text) => {
    const res = await fetch(`${trimUrl(baseUrl)}/audio/speech`, {
      method: "POST",
      // A local server ignores the key but the OpenAI client shape wants one;
      // sending a dummy is what keeps this the same adapter for both.
      headers: { Authorization: `Bearer ${apiKey || "local"}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
    });
    if (!res.ok) throw new Error(`Speech server ${res.status}: ${await res.text()}`);
    return clip(await res.arrayBuffer(), "audio/mpeg");
  });
}

/**
 * `POST /audio/transcriptions` — multipart, as speaches/faster-whisper serves it.
 * Records until `cancel()`, like Deepgram. A local server is fast enough to
 * re-transcribe the accumulated clip every few seconds, so this tier streams
 * partials (`partials: true`) — the running text fills the draft as it lands.
 */
export function openaiStt(baseUrl: string, model: string, apiKey = "", deviceId = ""): Stt {
  let rec: MediaRecorder | null = null;
  return {
    canListen: hasMic(),
    partials: true,

    async listen(opts = {}) {
      const { locale, onPartial } = opts;
      const partialChunks: BlobPart[] = [];
      let stopped = false;

      const transcribe = async (blob: Blob): Promise<string> => {
        const form = new FormData();
        form.append("model", model);
        // Whisper servers sniff the container from the filename, not the mime type —
        // an ".webm" clip named ".mp3" is rejected, and WebKit hands back mp4 where
        // Chromium hands back webm. Name the file whatever the recorder actually made.
        const ext = (blob.type.split(";")[0].split("/")[1] || "webm").replace("mpeg", "mp3");
        form.append("file", blob, `speech.${ext}`);
        // Whisper takes ISO-639-1, so the pack's "es-ES" goes in as "es". Without it
        // the model auto-detects, and a beginner's accented Spanish detects as English.
        const lang = baseLang(locale);
        if (lang) form.append("language", lang);

        const res = await fetch(`${trimUrl(baseUrl)}/audio/transcriptions`, {
          method: "POST",
          // No Content-Type: the boundary is generated when the body is serialised,
          // and setting the header by hand loses it (the plugin only fills in headers
          // the caller left empty). A hand-set multipart Content-Type = a 400.
          headers: { Authorization: `Bearer ${apiKey || "local"}` },
          body: form,
        });
        if (!res.ok) throw new Error(`Transcription server ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return data.text ?? "";
      };

      // Stream partials while the recording is still open: re-transcribe the
      // accumulated clip every ~3 s, one flight at a time. The timer runs
      // concurrently with `record()` — `onChunk` feeds `partialChunks` as the
      // recorder emits, and the loop reads the growing clip. A partial that lands
      // after the recording stopped is dropped; the final transcription below is
      // the one that counts.
      let inFlight = false;
      let last = 0;
      const timer = onPartial
        ? setInterval(async () => {
            if (inFlight || stopped) return;
            if (performance.now() - last < 3000) return;
            inFlight = true;
            try {
              const blob = new Blob(partialChunks, { type: "audio/webm" });
              if (blob.size) {
                const text = await transcribe(blob);
                if (!stopped && text) onPartial(text);
              }
            } catch {
              /* a partial is best-effort — the final transcription still runs */
            } finally {
              inFlight = false;
              last = performance.now();
            }
          }, 1000)
        : null;

      const { clip, ms, levels } = await record(
        (r) => {
          // `record()` already started the recorder with the timeslice; this
          // callback only keeps a handle so `cancel()` can stop it. Calling
          // `r.start()` again here would throw InvalidStateError — the recorder
          // is already recording.
          rec = r;
        },
        { deviceId, silenceMs: opts.silenceMs, onLevel: opts.onLevel, onChunk: (c) => partialChunks.push(c), timeslice: 1000, onStopped: opts.onStopped },
      );
      rec = null;
      stopped = true;
      if (timer) clearInterval(timer);
      if (!clip.size) return { text: "", ms, levels };

      return { text: await transcribe(clip), ms, levels };
    },

    cancel() {
      if (rec && rec.state !== "inactive") rec.stop(); // resolves the pending listen()
    },
  };
}

// ---- bundled speech: sherpa-onnx, in this process ----

/**
 * Kokoro or Piper, whichever the chosen model is — Rust works that out from the
 * files on disk, so the voice model's layout never leaks into settings. Comes
 * back as WAV bytes, which `play()` already knows what to do with.
 */
export function bundledTts(modelId: string, sid: number): Tts {
  return byteTier(async (text, opts = {}) => {
    // `speed` is the learner-rate knob the OS voices get via `rate`; Kokoro and
    // Piper both take it as a multiplier, so 0.95 means the same thing here.
    const bytes = await invoke<ArrayBuffer>("bundled_tts", {
      id: modelId,
      text,
      sid,
      speed: opts.rate ?? 0.95,
    });
    return clip(bytes, "audio/wav");
  });
}

/**
 * Decode whatever the mic produced (webm on Chromium, mp4 on WebKit) down to the
 * mono 16 kHz float samples Whisper wants. Doing it here means Rust needs no audio
 * decoder at all — the webview already has one, and it is the only thing that
 * knows what its own MediaRecorder just wrote.
 */
async function pcm16k(clip: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await clip.arrayBuffer());
  } finally {
    void ctx.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const off = new OfflineAudioContext(1, frames, 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

/** Whisper, in this process. Records until `cancel()`, like the others. */
export function bundledStt(modelId: string, deviceId = ""): Stt {
  let rec: MediaRecorder | null = null;
  return {
    canListen: hasMic(),
    // Whisper runs in-process, so re-transcribing the accumulated clip every few
    // seconds is cheap — this tier streams partials (`partials: true`).
    partials: true,

    async listen(opts = {}) {
      const { locale, onPartial } = opts;
      const partialChunks: BlobPart[] = [];
      let stopped = false;

      const transcribe = async (blob: Blob): Promise<string> => {
        const samples = await pcm16k(blob);
        if (!samples.length) return "";
        // The samples ride the raw IPC channel, not JSON: a 15-second clip is a
        // quarter of a million floats, and serialising that as a JSON array is
        // several megabytes of text for no reason. Everything else goes in headers.
        return await invoke<string>("bundled_stt", samples.buffer as ArrayBuffer, {
          headers: {
            "x-model": modelId,
            // Whisper takes ISO-639-1: the pack's "es-ES" goes in as "es". Without
            // it the model auto-detects, and a beginner's accent detects as English.
            "x-language": baseLang(locale),
            "x-rate": "16000",
          },
        });
      };

      // Stream partials while the recording is still open, exactly as openaiStt
      // does: re-transcribe the growing clip every ~3 s, one flight at a time.
      let inFlight = false;
      let last = 0;
      const timer = onPartial
        ? setInterval(async () => {
            if (inFlight || stopped) return;
            if (performance.now() - last < 3000) return;
            inFlight = true;
            try {
              const blob = new Blob(partialChunks, { type: "audio/webm" });
              if (blob.size) {
                const text = await transcribe(blob);
                if (!stopped && text) onPartial(text);
              }
            } catch {
              /* a partial is best-effort — the final transcription still runs */
            } finally {
              inFlight = false;
              last = performance.now();
            }
          }, 1000)
        : null;

      const { clip, ms, levels } = await record(
        (r) => {
          // `record()` already started the recorder with the timeslice; this
          // callback only keeps a handle so `cancel()` can stop it.
          rec = r;
        },
        { deviceId, silenceMs: opts.silenceMs, onLevel: opts.onLevel, onChunk: (c) => partialChunks.push(c), timeslice: 1000, onStopped: opts.onStopped },
      );
      rec = null;
      stopped = true;
      if (timer) clearInterval(timer);
      if (!clip.size) return { text: "", ms, levels };

      return { text: await transcribe(clip), ms, levels };
    },

    cancel() {
      if (rec && rec.state !== "inactive") rec.stop(); // resolves the pending listen()
    },
  };
}

/** Deepgram speech-to-text. Records until `cancel()`, then transcribes the clip. */
export function deepgram(apiKey: string, deviceId = ""): Stt {
  let rec: MediaRecorder | null = null;
  return {
    canListen: hasMic(),
    // A cloud tier is record-then-transcribe — no partials, and the UI says so
    // rather than faking a stream.
    partials: false,

    async listen(opts = {}) {
      const { locale } = opts;
      if (!apiKey) throw new Error("Deepgram API key is not set (Settings → Speech and listening).");
      const { clip, ms, levels } = await record(
        (r) => (rec = r),
        { deviceId, silenceMs: opts.silenceMs, onLevel: opts.onLevel, onStopped: opts.onStopped },
      );
      rec = null;
      if (!clip.size) return { text: "", ms, levels };

      // WebKit's MediaRecorder hands back "audio/mp4;codecs=mp4a.40.2"; Deepgram
      // sniffs the container itself but chokes on the codecs parameter, so send
      // the bare mime type.
      const mime = clip.type.split(";")[0] || "audio/webm";
      const audio = await clip.arrayBuffer();
      const transcribe = (lang: string) =>
        fetch(`https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=${lang}`, {
          method: "POST",
          headers: { Authorization: `Token ${apiKey}`, "Content-Type": mime },
          body: audio,
        });

      // Nova-3 takes regional tags for some languages (pt-BR, pt-PT, es-419, fr-CA)
      // and only the base tag for others (ja, de — "es-ES" is not a thing). Ask for
      // the pack's exact locale, fall back to the language on a reject.
      const wanted = (locale ?? "en-US").replace("_", "-");
      let res = await transcribe(wanted);
      if (!res.ok && baseLang(wanted) !== wanted) res = await transcribe(baseLang(wanted));
      if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return { text: data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "", ms, levels };
    },

    cancel() {
      if (rec && rec.state !== "inactive") rec.stop(); // resolves the pending listen()
    },
  };
}

/** Which tier serves a half. "auto" walks BY_RANK; anything else pins it. */
export type Tier = "auto" | "bundled" | "local" | "cloud" | "native";

/** Best first. A tier that can't serve is skipped, so this is also the fallthrough. */
const BY_RANK: Exclude<Tier, "auto">[] = ["bundled", "local", "cloud", "native"];

/** The two things speech does. Every tier is picked for each of them separately. */
export type Half = "tts" | "stt";

export interface SpeechSettings {
  offline?: boolean;
  elevenLabsKey?: string;
  deepgramKey?: string;
  localTtsUrl?: string; // "" → no local server for this half; the tier is skipped
  localTtsModel?: string;
  localTtsVoice?: string;
  localSttUrl?: string; // "" → likewise
  localSttModel?: string;
  // The bundled tier. A model id is only ever written here once the download
  // verified, and pruneBundled() clears it again at startup if the files went away,
  // so a non-empty id means "there are files on disk". A model deleted *during* a
  // session outlives that check: the first call throws and the half falls through.
  bundledTtsModel?: string; // "" → this half skips the bundled tier
  bundledTtsVoice?: number; // sherpa speaker id within that model
  bundledSttModel?: string; // "" → likewise
  /** Which microphone to record from. "" → whichever the system calls default. */
  micDeviceId?: string;
  ttsTier?: Tier; // default "auto"
  sttTier?: Tier;
}

/**
 * Can this tier serve this half right now? A URL is the whole on/off for the local
 * tier — a server runs on the learner's own machine, so offline mode allows it, and
 * so does an in-process bundled model. Only the cloud is the network.
 */
function available(s: SpeechSettings, half: Half, t: Exclude<Tier, "auto">): boolean {
  const tts = half === "tts";
  if (t === "bundled") return !!(tts ? s.bundledTtsModel : s.bundledSttModel);
  if (t === "local") return !!(tts ? s.localTtsUrl : s.localSttUrl);
  if (t === "cloud") return !s.offline && !!(tts ? s.elevenLabsKey : s.deepgramKey);
  const web = webSpeech();
  return tts ? web.canSpeak : web.canListen;
}

/** Dictation the learner owns: a bundled model or their own server — no key, no network. */
const ownStt = (s: SpeechSettings) => available(s, "stt", "bundled") || available(s, "stt", "local");

/**
 * Which tier actually serves a half, right now — the one thing the Speech panel's
 * status line has to get right. "auto" walks BY_RANK and takes the first tier that
 * can serve; a pin takes that tier or, if it cannot serve, the OS.
 */
export function resolveTier(s: SpeechSettings, half: Half): Exclude<Tier, "auto"> {
  const pin = half === "tts" ? s.ttsTier : s.sttTier;
  const ranked = !pin || pin === "auto" ? BY_RANK : [pin as Exclude<Tier, "auto">];
  return ranked.find((t) => available(s, half, t)) ?? "native";
}

/**
 * v1 stored one on/off switch for the whole local tier; v2 stores a source pin per
 * half, and a URL is the switch. Switch on → pin whichever halves had a URL. Switch
 * off → those URLs were inert, so drop them: keeping them would silently promote
 * localhost above the cloud keys the learner is actually using. One-way, and the
 * only thing lost is text that was doing nothing.
 */
export function migrateSpeech<T extends Record<string, unknown>>(raw: T): T {
  if (!("localSpeech" in raw)) return raw;
  const { localSpeech, ...rest } = raw as T & { localSpeech?: boolean };
  if (!localSpeech) return { ...rest, localTtsUrl: "", localSttUrl: "" } as unknown as T;
  return {
    ...rest,
    ttsTier: rest.localTtsUrl ? "local" : (rest.ttsTier ?? "auto"),
    sttTier: rest.localSttUrl ? "local" : (rest.sttTier ?? "auto"),
  } as unknown as T;
}

/**
 * The chosen models, against what is actually on disk. An id is only written once a
 * download verified — but files outlive nothing: clear the app's data folder and the
 * id stays behind, pointing at a model that is gone. The bundled tier would then keep
 * winning the precedence race with nothing to serve, the panel promising "Kokoro
 * (bundled) — offline, no key" while every turn quietly fell through to the OS voice.
 * Forgetting the id is what makes the panel and the adapter agree again.
 *
 * `onDisk` must come from the model index and nowhere else. A caller who *cannot* ask
 * it — no Tauri, no data dir — must not call this at all: "I could not look" would
 * arrive here as "nothing is installed" and wipe a working setup. Hence bundled.ts's
 * installed() returns null rather than [] when it could not look.
 */
export function pruneBundled(s: SpeechSettings, onDisk: Set<string>): Partial<SpeechSettings> {
  const patch: Partial<SpeechSettings> = {};
  if (s.bundledTtsModel && !onDisk.has(s.bundledTtsModel)) patch.bundledTtsModel = "";
  if (s.bundledSttModel && !onDisk.has(s.bundledSttModel)) patch.bundledSttModel = "";
  return patch;
}

/**
 * What a tier is called when it has to be named in a sentence rather than picked
 * from a list. One table, because the Speech panel's status line, the fallback
 * note and Advanced's engine line were all writing their own and could drift.
 */
const TIER_NAME: Record<Exclude<Tier, "auto">, Record<Half, string>> = {
  bundled: { tts: "a voice on this machine", stt: "dictation on this machine" },
  local: { tts: "your local server", stt: "your local server" },
  cloud: { tts: "ElevenLabs", stt: "Deepgram" },
  native: { tts: "your system voice", stt: "your system's speech recognition" },
};

export const tierName = (t: Exclude<Tier, "auto">, half: Half) => TIER_NAME[t][half];

/**
 * §7 row 3: "Seçili ses indirilmemiş → otomatik olarak paketli sese düşülür, bu
 * söylenir." pruneBundled does the falling; this is the saying.
 *
 * Without it the clearing is silent, and a learner whose data folder was cleared
 * finds a voice that simply stopped being the voice — no error, no explanation,
 * a setting that appears to have forgotten itself. The note names what went, what
 * is speaking now, and that it can be downloaded again.
 *
 * `label` turns a model id into the name the learner saw, and is passed in so this
 * file goes on knowing nothing about the catalogue.
 */
export function prunedNote(
  before: SpeechSettings,
  patch: Partial<SpeechSettings>,
  label: (id: string) => string,
): string {
  const after = { ...before, ...patch };
  const parts: string[] = [];
  if (patch.bundledTtsModel === "" && before.bundledTtsModel)
    parts.push(`The ${label(before.bundledTtsModel)} voice is no longer on this machine, so Verba is speaking with ${tierName(resolveTier(after, "tts"), "tts")}.`);
  if (patch.bundledSttModel === "" && before.bundledSttModel)
    parts.push(`The dictation model you chose is no longer on this machine, so Verba is listening with ${tierName(resolveTier(after, "stt"), "stt")}.`);
  if (!parts.length) return "";
  return `${parts.join(" ")} Download ${parts.length > 1 ? "them" : "it"} again under Speech and listening.`;
}

/** Why the mic is dead, in words a learner can act on. "" when it works. */
export function listenBlocker(s: SpeechSettings): string {
  if (webSpeech().canListen) return "";
  if (ownStt(s)) return hasMic() ? "" : "No microphone is available to this app.";
  if (s.offline)
    return "Dictation needs a bundled Whisper model (Settings → Speech and listening) — or Deepgram, a cloud service, with Offline mode off.";
  if (!s.deepgramKey)
    return "Dictation needs a bundled Whisper model or a Deepgram API key (Settings → Speech and listening) — this webview has no built-in speech recognition.";
  if (!hasMic()) return "No microphone is available to this app.";
  return "";
}

/**
 * What the Deepgram key is actually worth, in the order the tiers are walked:
 * bundled, then local, then this. "Required" is a lie the moment either of the
 * first two is there — the mic works without a key, and telling a learner
 * otherwise sells them a cloud account they do not need.
 *
 * `whisperReady` is asked for rather than read off the settings: a model *chosen*
 * is not a model still *on disk*, and only the caller holding the install index
 * knows the difference.
 */
export function deepgramHelp(s: SpeechSettings, whisperReady: boolean): string {
  if (whisperReady) return "Optional — dictation already works offline via Whisper (bundled).";
  if (available(s, "stt", "local")) return "Optional — local server handles dictation.";
  return "Required — the mic does not work without it";
}

/**
 * Compose the two halves independently. Precedence per half is BY_RANK: the
 * bundled models if one is installed, else a local server if one is configured,
 * else the cloud key, else the OS. Offline mode pins the *cloud* halves to the OS
 * and leaves the other two alone — neither localhost nor an in-process model is
 * the network. A learner can pin a half to one tier instead; a pinned tier that
 * cannot serve still degrades to the OS rather than failing.
 *
 * `onFallback` is told, once per half, when the chosen tier failed and the OS
 * covered for it. A voice dying mid-sentence is a bad minute, not a dead
 * conversation — and after one failure the half stays on the OS for the rest of
 * the session rather than stalling on every turn to retry a model that is gone.
 */
export function getSpeech(s: SpeechSettings, onFallback: (msg: string) => void = () => {}): SpeechAdapter {
  const web = webSpeech();

  // resolveTier already asked whether the tier can serve, so these only ever build
  // the one it named; "native" (and a pin that could not serve) lands on the web.
  const ttsTier = resolveTier(s, "tts");
  const sttTier = resolveTier(s, "stt");

  const tts: Tts =
    ttsTier === "bundled"
      ? bundledTts(s.bundledTtsModel!, s.bundledTtsVoice ?? 0)
      : ttsTier === "local"
        ? openaiTts(s.localTtsUrl!, s.localTtsModel || "kokoro", s.localTtsVoice || "af_heart")
        : ttsTier === "cloud"
          ? elevenLabs(s.elevenLabsKey!)
          : web;

  const stt: Stt =
    sttTier === "bundled"
      ? bundledStt(s.bundledSttModel!, s.micDeviceId)
      : sttTier === "local"
        ? openaiStt(s.localSttUrl!, s.localSttModel || "Systran/faster-whisper-small", "", s.micDeviceId)
        : sttTier === "cloud"
          ? deepgram(s.deepgramKey!, s.micDeviceId)
          : web;

  // One warning per half for the life of this adapter (it is rebuilt when the
  // speech settings change), so a tier that stays down doesn't nag every turn.
  let warnedTts = false;
  let warnedStt = false;

  // Only the bundled tier is retired after a failure. A local server that dies is
  // usually a server being restarted, and v1 rightly retried it every turn — take
  // that away and a learner who brings their box back up never gets it back. A
  // bundled model that fails to load is a model whose files are gone: it will fail
  // identically every turn, so asking again just stalls each one. This is what
  // "mark the tier unavailable for the session" means with no process to mark.
  let ttsDead = false;
  let sttDead = false;

  return {
    canSpeak: tts.canSpeak,
    canListen: stt.canListen,
    // Whether the serving STT tier can stream partials — the composer reads it
    // to decide what the line under the box says.
    partials: stt.partials,
    // Whether the serving TTS tier can hand back a seekable clip. The listening
    // player reads it to decide what transport it can offer (PLAN-025). A tier
    // that cannot (`native`/`webSpeech`) has no `clip`, so the property stays false.
    seekable: tts.seekable,
    clip: tts.clip ? (text: string, opts?: SpeakOptions) => tts.clip!(text, opts) : undefined,

    async speak(text, opts) {
      if (tts !== web && !ttsDead) {
        try {
          return await tts.speak(text, opts);
        } catch {
          if (ttsTier === "bundled") ttsDead = true;
          if (!warnedTts) {
            warnedTts = true;
            onFallback(
              ttsTier === "bundled"
                ? "Bundled voice unavailable — using your system voice for the rest of this session."
                : "Local voice unreachable — used your system voice instead.",
            );
          }
        }
      }
      // Safe with no synth: webSpeech().speak resolves immediately rather than
      // hanging the turn, which is the whole reason a failed tier can land here.
      // The fallback must hand the measured floor onward (PLAN-028) — swallowing
      // it would make every degrade turn look unmeasured and empty the baseline.
      return await web.speak(text, opts);
    },

    async listen(opts) {
      if (stt !== web && !sttDead) {
        try {
          return await stt.listen(opts);
        } catch (e) {
          // No webview ships a recogniser, so there is often nothing to fall back
          // *to*: say what actually broke rather than "no speech recognition".
          if (!web.canListen) throw e;
          if (sttTier === "bundled") sttDead = true;
          if (!warnedStt) {
            warnedStt = true;
            onFallback(
              sttTier === "bundled"
                ? "Bundled dictation unavailable — using your system recogniser for the rest of this session."
                : "Local transcription unreachable — used your system recogniser instead.",
            );
          }
        }
      }
      return await web.listen(opts);
    },

    cancel() {
      tts.cancel();
      stt.cancel();
      web.cancel();
    },
  };
}

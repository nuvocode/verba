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
// ponytail: a bundled sidecar (Piper/whisper.cpp behind `invoke("synthesize")`)
// is still the zero-setup version. These same `Tts`/`Stt` seams take it when
// someone is willing to own the packaging.

import { fetch } from "@tauri-apps/plugin-http";

export interface SpeakOptions {
  locale?: string; // BCP-47, e.g. "es-ES"
  voiceHint?: string; // preferred voice-name substring
  rate?: number; // 0.1–10, default ~0.95 for learners
}

/** Text → audio. */
export interface Tts {
  canSpeak: boolean;
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  cancel(): void;
}

/** Audio → text. `listen` resolves when `cancel` stops the recording. */
export interface Stt {
  canListen: boolean;
  listen(locale?: string): Promise<string>;
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
  return {
    canSpeak: !!synth,
    canListen: !!Recognition,

    speak(text, opts = {}) {
      return new Promise((resolve) => {
        if (!synth || !text.trim()) return resolve();
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (opts.locale) u.lang = opts.locale;
        const v = pickVoice(opts.locale, opts.voiceHint);
        if (v) u.voice = v;
        u.rate = opts.rate ?? 0.95;
        u.onend = () => resolve();
        u.onerror = () => resolve(); // never hang the UI on a TTS hiccup
        synth.speak(u);
      });
    },

    listen(locale) {
      return new Promise((resolve, reject) => {
        if (!Recognition) return reject(new Error("This webview has no speech recognition."));
        recognition = new Recognition();
        recognition.lang = locale ?? "en-US";
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onresult = (e: any) => resolve(e.results?.[0]?.[0]?.transcript ?? "");
        recognition.onerror = (e: any) => reject(new Error(e?.error ?? "recognition error"));
        recognition.onend = () => (recognition = null);
        recognition.start();
      });
    },

    cancel() {
      synth?.cancel();
      recognition?.stop?.();
    },
  };
}

// Chrome loads voices asynchronously; kick a load so the first speak() has them.
if (synth) synth.getVoices();

// ---- cloud speech ----

/**
 * Record until `onStart`'s recorder is stopped — push-to-talk, not a fixed
 * window. A learner mid-sentence at second 6 was the old behaviour; the cap is
 * only there so a mic left open doesn't record until the heat death.
 */
function record(onStart: (r: MediaRecorder) => void, maxMs = 60_000): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      // macOS denies here when the user said no to the mic prompt (or Info.plist
      // lacks NSMicrophoneUsageDescription, in which case we never even get here).
      return reject(new Error(`Microphone unavailable: ${e?.message ?? e}. Check System Settings → Privacy → Microphone.`));
    }
    const rec = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    const done = () => stream.getTracks().forEach((t) => t.stop());
    const cap = setTimeout(() => rec.state !== "inactive" && rec.stop(), maxMs);

    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      clearTimeout(cap);
      done();
      resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    };
    rec.onerror = (e: any) => {
      clearTimeout(cap);
      done();
      reject(new Error(e?.error?.message ?? "recording error"));
    };
    rec.start();
    onStart(rec);
  });
}

/** Play returned audio bytes to the end. Resolves on error too — a TTS hiccup must not hang the turn. */
function play(bytes: ArrayBuffer, mime: string, hold: (a: HTMLAudioElement) => void): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = new Audio(url);
  hold(a);
  return new Promise<void>((resolve) => {
    a.onended = a.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    a.play().catch(() => resolve());
  });
}

/** ElevenLabs text-to-speech. */
export function elevenLabs(apiKey: string, voiceId = "21m00Tcm4TlvDq8ikWAM"): Tts {
  let audio: HTMLAudioElement | null = null;
  return {
    canSpeak: true,
    // Turbo v2.5 takes an explicit language_code (ISO 639-1) and multilingual_v2
    // refuses it — without one the model just guesses the language from the text.
    // ponytail: one fixed multilingual voice, so e.g. Arabic comes out accented.
    // Per-pack voice ids are the upgrade — add `speech.elevenVoiceId` to the pack
    // schema when someone asks for it.
    async speak(text, opts = {}) {
      if (!apiKey) throw new Error("ElevenLabs API key is not set (Settings → Speech).");
      if (!text.trim()) return;
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
      await play(await res.arrayBuffer(), "audio/mpeg", (a) => (audio = a));
    },
    cancel() {
      audio?.pause();
      audio = null;
    },
  };
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
  let audio: HTMLAudioElement | null = null;
  return {
    canSpeak: true,
    async speak(text) {
      if (!text.trim()) return;
      const res = await fetch(`${trimUrl(baseUrl)}/audio/speech`, {
        method: "POST",
        // A local server ignores the key but the OpenAI client shape wants one;
        // sending a dummy is what keeps this the same adapter for both.
        headers: { Authorization: `Bearer ${apiKey || "local"}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
      });
      if (!res.ok) throw new Error(`Speech server ${res.status}: ${await res.text()}`);
      await play(await res.arrayBuffer(), "audio/mpeg", (a) => (audio = a));
    },
    cancel() {
      audio?.pause();
      audio = null;
    },
  };
}

/**
 * `POST /audio/transcriptions` — multipart, as speaches/faster-whisper serves it.
 * Records until `cancel()`, like Deepgram.
 */
export function openaiStt(baseUrl: string, model: string, apiKey = ""): Stt {
  let rec: MediaRecorder | null = null;
  return {
    canListen: hasMic(),

    async listen(locale) {
      const clip = await record((r) => (rec = r));
      rec = null;
      if (!clip.size) return "";

      const form = new FormData();
      form.append("model", model);
      // Whisper servers sniff the container from the filename, not the mime type —
      // an ".webm" clip named ".mp3" is rejected, and WebKit hands back mp4 where
      // Chromium hands back webm. Name the file whatever the recorder actually made.
      const ext = (clip.type.split(";")[0].split("/")[1] || "webm").replace("mpeg", "mp3");
      form.append("file", clip, `speech.${ext}`);
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
    },

    cancel() {
      if (rec && rec.state !== "inactive") rec.stop(); // resolves the pending listen()
    },
  };
}

/** Deepgram speech-to-text. Records until `cancel()`, then transcribes the clip. */
export function deepgram(apiKey: string): Stt {
  let rec: MediaRecorder | null = null;
  return {
    canListen: hasMic(),

    async listen(locale) {
      if (!apiKey) throw new Error("Deepgram API key is not set (Settings → Speech).");
      const clip = await record((r) => (rec = r));
      rec = null;
      if (!clip.size) return "";

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
      return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    },

    cancel() {
      if (rec && rec.state !== "inactive") rec.stop(); // resolves the pending listen()
    },
  };
}

export interface SpeechSettings {
  offline?: boolean;
  elevenLabsKey?: string;
  deepgramKey?: string;
  localSpeech?: boolean; // master switch for the local-server tier
  localTtsUrl?: string; // "" → this half stays on the cloud/OS choice below
  localTtsModel?: string;
  localTtsVoice?: string;
  localSttUrl?: string; // "" → likewise
  localSttModel?: string;
}

/** A local server runs on the learner's own machine, so offline mode allows it. */
const localTtsOn = (s: SpeechSettings) => !!(s.localSpeech && s.localTtsUrl);
const localSttOn = (s: SpeechSettings) => !!(s.localSpeech && s.localSttUrl);

/** Why the mic is dead, in words a learner can act on. "" when it works. */
export function listenBlocker(s: SpeechSettings): string {
  if (webSpeech().canListen) return "";
  if (localSttOn(s)) return hasMic() ? "" : "No microphone is available to this app.";
  if (s.offline)
    return "Dictation needs Deepgram, a cloud service — or a local server (Settings → Speech). Turn Offline mode off to use Deepgram.";
  if (!s.deepgramKey)
    return "Dictation needs a Deepgram API key or a local server (Settings → Speech) — this webview has no built-in speech recognition.";
  if (!hasMic()) return "No microphone is available to this app.";
  return "";
}

/**
 * Compose the two halves independently. Precedence per half: a local server if
 * one is configured, else the cloud key, else the OS. Offline mode pins the
 * cloud halves to the OS but leaves local alone — localhost never leaves the box.
 *
 * `onFallback` is told, once per half, when a configured local server failed and
 * the OS voice covered for it. A speech box dying mid-sentence is a bad minute,
 * not a dead conversation.
 */
export function getSpeech(s: SpeechSettings, onFallback: (msg: string) => void = () => {}): SpeechAdapter {
  const web = webSpeech();
  const cloud = !s.offline;
  const tts: Tts = localTtsOn(s)
    ? openaiTts(s.localTtsUrl!, s.localTtsModel || "kokoro", s.localTtsVoice || "af_heart")
    : cloud && s.elevenLabsKey
      ? elevenLabs(s.elevenLabsKey)
      : web;
  const stt: Stt = localSttOn(s)
    ? openaiStt(s.localSttUrl!, s.localSttModel || "Systran/faster-whisper-small")
    : cloud && s.deepgramKey
      ? deepgram(s.deepgramKey)
      : web;

  // One warning per half for the life of this adapter (it is rebuilt when the
  // speech settings change), so a server that stays down doesn't nag every turn.
  let warnedTts = false;
  let warnedStt = false;

  return {
    canSpeak: tts.canSpeak,
    canListen: stt.canListen,

    async speak(text, opts) {
      try {
        await tts.speak(text, opts);
      } catch (e) {
        if (tts === web) throw e;
        if (!warnedTts) {
          warnedTts = true;
          onFallback("Local voice unreachable — used your system voice instead.");
        }
        await web.speak(text, opts);
      }
    },

    async listen(locale) {
      try {
        return await stt.listen(locale);
      } catch (e) {
        // No webview ships a recogniser, so there is nothing to fall back *to*:
        // say what actually broke rather than "no speech recognition available".
        if (stt === web || !web.canListen) throw e;
        if (!warnedStt) {
          warnedStt = true;
          onFallback("Local transcription unreachable — used your system recogniser instead.");
        }
        return await web.listen(locale);
      }
    },

    cancel() {
      tts.cancel();
      stt.cancel();
      web.cancel();
    },
  };
}

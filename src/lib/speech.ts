// The speech loop: speak (TTS) → listen (STT) → respond → speak.
//
// TTS and STT are separate halves, not competing "engines". No webview ships a
// usable SpeechRecognition (WKWebView has none at all, WebView2 needs a Google
// key), so dictation is Deepgram or nothing; TTS works offline via the OS voices
// and ElevenLabs is the upgrade. Each half is picked independently — the old
// single radio forced ElevenLabs users onto a recogniser that does not exist.
//
// ponytail: Whisper (STT) and Piper/Kokoro (TTS) are the real offline upgrade,
// but they need a bundled sidecar binary + a Rust `#[tauri::command]` to shell
// out to it. The seams below are the whole integration point: implement a `Stt`/
// `Tts` against a Tauri `invoke("transcribe"|"synthesize", …)` when it lands.

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
      const url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: "audio/mpeg" }));
      audio = new Audio(url);
      const a = audio;
      await new Promise<void>((resolve) => {
        a.onended = a.onerror = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        a.play().catch(() => resolve());
      });
    },
    cancel() {
      audio?.pause();
      audio = null;
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
}

/** Why the mic is dead, in words a learner can act on. "" when it works. */
export function listenBlocker(s: SpeechSettings): string {
  if (webSpeech().canListen) return "";
  if (s.offline) return "Dictation needs Deepgram, a cloud service. Turn Offline mode off in Settings to use it.";
  if (!s.deepgramKey) return "Dictation needs a Deepgram API key (Settings → Speech) — this webview has no built-in speech recognition.";
  if (!hasMic()) return "No microphone is available to this app.";
  return "";
}

/** Compose the two halves independently. Offline mode pins both to the OS. */
export function getSpeech(s: SpeechSettings): SpeechAdapter {
  const web = webSpeech();
  const cloud = !s.offline;
  const tts: Tts = cloud && s.elevenLabsKey ? elevenLabs(s.elevenLabsKey) : web;
  const stt: Stt = cloud && s.deepgramKey ? deepgram(s.deepgramKey) : web;
  return {
    canSpeak: tts.canSpeak,
    canListen: stt.canListen,
    speak: (text, opts) => tts.speak(text, opts),
    listen: (locale) => stt.listen(locale),
    cancel() {
      tts.cancel();
      stt.cancel();
    },
  };
}

// Offline speech loop: speak (TTS) → listen (STT) → respond → speak.
//
// The default adapter uses the webview's native SpeechSynthesis + Speech-
// Recognition — zero dependencies and genuinely offline for TTS on macOS.
//
// ponytail: Whisper (STT) and Piper/Kokoro (TTS) are the real offline upgrade,
// but they need a bundled sidecar binary + a Rust `#[tauri::command]` to shell
// out to it — far more than a few lines and no binary to ship here. The
// adapter seam below is the whole integration point: implement `listen`/`speak`
// against a Tauri `invoke("transcribe"|"synthesize", …)` when the sidecar lands.

export interface SpeakOptions {
  locale?: string; // BCP-47, e.g. "es-ES"
  voiceHint?: string; // preferred voice-name substring
  rate?: number; // 0.1–10, default ~0.95 for learners
}

export interface SpeechAdapter {
  canSpeak: boolean;
  canListen: boolean;
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  /** Resolve with the recognised transcript in the given locale. */
  listen(locale?: string): Promise<string>;
  cancel(): void;
}

const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
// Chrome/WebKit expose SpeechRecognition under a webkit prefix.
const Recognition: any =
  typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

function pickVoice(locale?: string, hint?: string): SpeechSynthesisVoice | undefined {
  if (!synth) return undefined;
  const voices = synth.getVoices();
  const lang = locale?.toLowerCase();
  const byLocale = lang ? voices.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) : voices;
  if (hint) {
    const h = hint.toLowerCase();
    const match = byLocale.find((v) => v.name.toLowerCase().includes(h));
    if (match) return match;
  }
  return byLocale[0] ?? voices[0];
}

/** Native webview speech adapter. */
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
        if (!Recognition) return reject(new Error("Speech recognition is not available in this webview."));
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

// ---- cloud speech adapters (Phase 3) ----
//
// ElevenLabs (TTS) and Deepgram (STT) each cover one half of the loop, so each
// adapter fills the other half from the native webView. They call the vendor
// APIs through @tauri-apps/plugin-http (no browser CORS), record via
// MediaRecorder, and play via a blob URL.
// ponytail: fixed multilingual model + default voice — expose voice/model
// pickers when someone actually wants to tune them.

import { fetch } from "@tauri-apps/plugin-http";

/** Record a short mic clip and resolve with the audio Blob (webm/opus). */
async function recordClip(ms = 6000): Promise<Blob> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
    throw new Error("Microphone capture is not available in this webview.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  return new Promise((resolve, reject) => {
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    };
    rec.onerror = (e: any) => reject(new Error(e?.error?.message ?? "recording error"));
    rec.start();
    setTimeout(() => rec.state !== "inactive" && rec.stop(), ms);
  });
}

/** ElevenLabs TTS; STT falls back to the native webview recogniser. */
export function elevenLabs(apiKey: string, voiceId = "21m00Tcm4TlvDq8ikWAM"): SpeechAdapter {
  const web = webSpeech();
  return {
    canSpeak: true,
    canListen: web.canListen,
    async speak(text) {
      if (!apiKey) throw new Error("ElevenLabs API key is not set (Settings).");
      if (!text.trim()) return;
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
      const buf = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      const audio = new Audio(url);
      await new Promise<void>((resolve) => {
        audio.onended = audio.onerror = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.play().catch(() => resolve());
      });
    },
    listen: (locale) => web.listen(locale),
    cancel: () => web.cancel(),
  };
}

/** Deepgram STT; TTS falls back to the native webview synthesiser. */
export function deepgram(apiKey: string): SpeechAdapter {
  const web = webSpeech();
  return {
    canSpeak: web.canSpeak,
    canListen: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    speak: (text, opts) => web.speak(text, opts),
    async listen(locale) {
      if (!apiKey) throw new Error("Deepgram API key is not set (Settings).");
      const clip = await recordClip();
      const lang = locale ? locale.slice(0, 2) : "en";
      const res = await fetch(
        `https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=${lang}`,
        {
          method: "POST",
          headers: { Authorization: `Token ${apiKey}`, "Content-Type": clip.type },
          body: await clip.arrayBuffer(),
        },
      );
      if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    },
    cancel: () => web.cancel(),
  };
}

/** Pick the speech adapter for the current settings. Cloud engines need a key. */
export function getSpeech(s: {
  speechEngine?: string;
  elevenLabsKey?: string;
  deepgramKey?: string;
}): SpeechAdapter {
  if (s.speechEngine === "elevenlabs" && s.elevenLabsKey) return elevenLabs(s.elevenLabsKey);
  if (s.speechEngine === "deepgram" && s.deepgramKey) return deepgram(s.deepgramKey);
  return webSpeech();
}

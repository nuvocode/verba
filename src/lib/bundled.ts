// The bundled speech tier: models the app downloads and runs itself, with no
// server for the learner to start and no key to paste. The adapters that speak
// and listen live in speech.ts next to their cloud/local siblings; this file is
// only about the models — what exists, what is on disk, and how it gets there.
//
// Models are not settings. They are files under Tauri's appDataDir (models/<id>/)
// with a JSON index beside them, written by src-tauri/src/speech.rs. localStorage
// holds only *which* model is chosen.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const TTS_RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";
const ASR_RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";

export type Engine = "kokoro" | "piper" | "whisper";

export interface Voice {
  name: string; // the voice's own name, as sherpa knows it — "af_heart"
  sid: number; // speaker id in voices.bin; the only thing the model actually takes
  lang: string; // ISO-639-1, so a pack can be matched to a voice
}

export interface CatalogModel {
  id: string; // also the directory name under models/
  engine: Engine;
  half: "tts" | "stt";
  label: string;
  langs: string[]; // ISO-639-1 codes this model can speak/hear
  mb: number; // download size, for the settings row
  url: string;
  sha256: string;
  voices: Voice[]; // [] for whisper; one entry for a piper voice; many for kokoro
}

// Kokoro's speaker ids are positions in voices.bin, fixed by the script that built
// it (scripts/kokoro/v1.0/generate_voices_bin.py). The names are the learner-facing
// half of that mapping. Curated to the languages the app ships packs for — the
// model carries 53 voices, most of them Chinese, and a wall of them helps nobody.
//
// Note what is *not* here: German and Turkish. Kokoro v1.0 has no voice for either,
// which is why packs steer those languages to Piper (see recommendedVoices).
const KOKORO_VOICES: Voice[] = [
  { name: "af_heart", sid: 3, lang: "en" },
  { name: "af_bella", sid: 2, lang: "en" },
  { name: "am_michael", sid: 16, lang: "en" },
  { name: "bf_emma", sid: 21, lang: "en" },
  { name: "bm_george", sid: 26, lang: "en" },
  { name: "ef_dora", sid: 28, lang: "es" },
  { name: "em_alex", sid: 29, lang: "es" },
  { name: "ff_siwis", sid: 30, lang: "fr" },
  { name: "if_sara", sid: 35, lang: "it" },
  { name: "im_nicola", sid: 36, lang: "it" },
  { name: "jf_alpha", sid: 37, lang: "ja" },
  { name: "jm_kumo", sid: 41, lang: "ja" },
  { name: "pf_dora", sid: 42, lang: "pt" },
  { name: "pm_alex", sid: 43, lang: "pt" },
];

/** A Piper voice: one language, one speaker, ~21 MB. */
// The label carries the engine only; the voice name is appended by the row, which
// is the one place that knows *which* voice is showing (Kokoro has 14 to choose
// from, Piper exactly one). Putting the voice in both spellings "Piper · fettah ·
// fettah", which is what this used to do.
const piper = (lang: string, voice: string, asset: string, mb: number, sha256: string): CatalogModel => ({
  id: `piper-${lang}`,
  engine: "piper",
  half: "tts",
  label: "Piper",
  langs: [lang],
  mb,
  url: `${TTS_RELEASE}/${asset}.tar.bz2`,
  sha256,
  voices: [{ name: voice, sid: 0, lang }],
});

/**
 * The catalog. Static, in-app, no remote service — a model list that can change
 * under you is a model list that can serve you a different binary tomorrow.
 *
 * ponytail: Kokoro ships fp32, not the int8 build the smaller download would
 * suggest. int8 is *slower* here — measured on an M-series, int8 runs at roughly
 * real time (RTF 0.96 at 4 threads) while fp32 manages RTF 0.41, because ARM pays
 * a dequantisation tax the quantised weights never earn back. Piper is the other
 * way round: its int8 build is both smaller and fast (RTF 0.14), so that is what
 * we take. Re-measure before "optimising" either one.
 */
export const CATALOG: CatalogModel[] = [
  {
    id: "kokoro",
    engine: "kokoro",
    half: "tts",
    label: "Kokoro",
    langs: ["en", "es", "fr", "it", "ja", "pt"],
    mb: 349,
    url: `${TTS_RELEASE}/kokoro-multi-lang-v1_0.tar.bz2`,
    sha256: "c133d26353d776da730870dac7da07dbfc9a5e3bc80cc5e8e83ab6e823be7046",
    voices: KOKORO_VOICES,
  },
  piper("en", "amy", "vits-piper-en_US-amy-medium-int8", 21, "bd23c0aa629eb3719448582f45ede49e8fa6a679061fed5eab16a6a6fd8e7e82"),
  piper("es", "davefx", "vits-piper-es_ES-davefx-medium-int8", 21, "8bb8ac1cefb727caec9bd9c6c3185c673c8b42c53bd29bb25d5a7715dac37125"),
  piper("fr", "siwis", "vits-piper-fr_FR-siwis-medium-int8", 21, "3909cff9b3cfd4820c66aa13bf554315c82e34899c161f0b446ece372bc4b5ec"),
  piper("de", "thorsten", "vits-piper-de_DE-thorsten-medium-int8", 21, "07e240b7b9c1fc9211d5a69512f8cbe11b3286c2ed79c15c076ac6ed427fdf13"),
  piper("it", "paola", "vits-piper-it_IT-paola-medium-int8", 21, "2b975ed305391c056944a4dde67ee754dd824099503a860295bb4c1d724662d8"),
  piper("pt", "faber", "vits-piper-pt_BR-faber-medium-int8", 21, "05386120a50ee0c46e246bd0b9ad1c7b3116606b3f0c037db8ee4dd5dda712c5"),
  piper("tr", "fettah", "vits-piper-tr_TR-fettah-medium-int8", 21, "4374bfdabb88ada0f3edf9bd46eacf1c5391a8a93bdce364196495891e5bc323"),
  {
    id: "whisper-base",
    engine: "whisper",
    half: "stt",
    label: "Whisper base",
    langs: [], // multilingual: the pack's language is passed in per request
    mb: 208,
    url: `${ASR_RELEASE}/sherpa-onnx-whisper-base.tar.bz2`,
    sha256: "911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de",
    voices: [],
  },
  {
    id: "whisper-small",
    engine: "whisper",
    half: "stt",
    label: "Whisper small",
    langs: [],
    mb: 639,
    url: `${ASR_RELEASE}/sherpa-onnx-whisper-small.tar.bz2`,
    sha256: "486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6",
    voices: [],
  },
];

export const catalogModel = (id: string) => CATALOG.find((m) => m.id === id);

/** The voice a sid names, for the settings row. */
export function voiceOf(modelId: string, sid: number): Voice | undefined {
  return catalogModel(modelId)?.voices.find((v) => v.sid === sid);
}

/**
 * Human size. Whisper's download carries fp32 and int8 weights both; we keep only
 * int8, so what lands on disk is smaller than what comes down the wire. The row
 * shows the download, because that is what the learner waits for.
 */
export const sizeLabel = (m: CatalogModel) => `${m.mb} MB`;

/** What a model row is doing right now. Downloads are never automatic. */
export type ModelState =
  | { s: "absent" }
  | { s: "downloading"; pct: number }
  | { s: "ready"; bytes: number }
  | { s: "failed"; why: string };

export interface Installed {
  id: string;
  bytes: number;
  sha256: string;
  downloadedAt: number;
}

/**
 * Models on disk, as the Rust index records them (and whose folders still exist), or
 * null when there is no store to ask: not under Tauri (the .check scripts, a browser
 * dev server), or the data dir is unreadable.
 *
 * null is not an empty list. One says "nothing is installed", the other says "I could
 * not look" — and only the first is grounds for forgetting a model the learner chose
 * (speech.ts's pruneBundled). Callers that only render a catalog can read null as [].
 */
export async function installed(): Promise<Installed[] | null> {
  try {
    const list = await invoke<{ id: string; bytes: number; sha256: string; downloaded_at: number }[]>(
      "models_installed",
    );
    return list.map((m) => ({ id: m.id, bytes: m.bytes, sha256: m.sha256, downloadedAt: m.downloaded_at }));
  } catch {
    return null;
  }
}

/**
 * Download → verify sha256 → unpack, atomically, in Rust. A failed checksum
 * deletes the part file and throws; nothing half-installed is ever left behind.
 * Rejects carry the reason, which the settings row shows verbatim.
 */
export async function download(id: string, onPct: (pct: number) => void): Promise<void> {
  const m = catalogModel(id);
  if (!m) throw new Error(`unknown model "${id}"`);
  const stop = await listen<{ id: string; received: number; total: number }>("model-progress", (e) => {
    if (e.payload.id === id && e.payload.total > 0) onPct((e.payload.received / e.payload.total) * 100);
  });
  try {
    await invoke("model_download", { id, url: m.url, sha256: m.sha256 });
  } finally {
    stop();
  }
}

export async function remove(id: string): Promise<void> {
  await invoke("model_delete", { id });
}

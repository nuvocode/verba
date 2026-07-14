// The bundled speech tier: Kokoro/Piper for voice, Whisper for dictation, both
// running in this process via sherpa-onnx.
//
// ponytail: no sidecar. The plan was a long-running sherpa-onnx child process,
// but sherpa-onnx ships no TTS server binary — only one-shot CLIs — so a sidecar
// meant writing and shipping our own per-platform process, plus spawn/kill,
// restart-on-crash, a JSON-RPC protocol and a port. The project's own Rust
// binding gives the same models in-process for none of that, and the thing a
// warm process was supposed to buy (skipping model load) turns out to be worth
// ~0.6s: Kokoro loads in 0.57s and spends the rest of its time *generating*.
// Models are cached in state below, so we keep that 0.6s anyway.
//
// The trade we accept: an onnxruntime segfault takes the app with it, where a
// sidecar would have contained it. Not observed; revisit if it ever is.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use sherpa_onnx::{
    GenerationConfig, OfflineRecognizer, OfflineRecognizerConfig, OfflineTts, OfflineTtsConfig,
    OfflineTtsKokoroModelConfig, OfflineTtsModelConfig, OfflineTtsVitsModelConfig,
    OfflineWhisperModelConfig,
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Msg(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("download: {0}")]
    Http(#[from] reqwest::Error),
}

impl serde::Serialize for Error {
    fn serialize<S: serde::ser::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

fn err<T>(m: impl Into<String>) -> Result<T, Error> {
    Err(Error::Msg(m.into()))
}

// sherpa-onnx's handles are raw pointers behind a C API; they are not Send, but
// they are only ever touched under the Mutex below, one call at a time.
struct Loaded<T>(T);
unsafe impl<T> Send for Loaded<T> {}

#[derive(Default)]
pub struct SpeechState {
    tts: Mutex<Option<(String, Loaded<OfflineTts>)>>,
    stt: Mutex<Option<(String, Loaded<OfflineRecognizer>)>>,
}

// ---- model store ----
//
// Models are not settings: they live under appDataDir/models/<id>/, with a small
// JSON index beside them. The index is the record of what a download *verified*
// (sha256, size, when) — the directory alone can't say that.

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Installed {
    pub id: String,
    pub bytes: u64,
    pub sha256: String,
    pub downloaded_at: u64,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, Error> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| Error::Msg(format!("no app data dir: {e}")))?
        .join("models");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, Error> {
    Ok(models_dir(app)?.join("index.json"))
}

fn read_index(app: &AppHandle) -> Vec<Installed> {
    (|| -> Result<Vec<Installed>, Error> {
        let raw = std::fs::read_to_string(index_path(app)?)?;
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    })()
    .unwrap_or_default()
}

fn write_index(app: &AppHandle, list: &[Installed]) -> Result<(), Error> {
    std::fs::write(index_path(app)?, serde_json::to_string_pretty(list).unwrap())?;
    Ok(())
}

/// Installed models, filtered to those whose directory actually still exists —
/// a learner who deletes the folder by hand gets a fall-through, not a crash.
#[tauri::command]
pub fn models_installed(app: AppHandle) -> Vec<Installed> {
    let dir = match models_dir(&app) {
        Ok(d) => d,
        Err(_) => return vec![],
    };
    read_index(&app)
        .into_iter()
        .filter(|m| dir.join(&m.id).is_dir())
        .collect()
}

#[derive(Clone, Serialize)]
struct Progress {
    id: String,
    received: u64,
    total: u64,
}

/// Download → verify → unpack, in that order and never any other. The archive
/// lands in a .part file, is hashed, and only a matching sha256 earns the right
/// to be unpacked; a mismatch deletes the part file and leaves nothing behind.
/// Unpacking goes to a .tmp dir that is renamed into place, so a half-extracted
/// model is never visible under its real name.
#[tauri::command]
pub async fn model_download(
    app: AppHandle,
    id: String,
    url: String,
    sha256: String,
) -> Result<Installed, Error> {
    let dir = models_dir(&app)?;
    let rec = install(&dir, &id, &url, &sha256, |received, total| {
        let _ = app.emit("model-progress", Progress { id: id.clone(), received, total });
    })
    .await?;

    let mut list = read_index(&app);
    list.retain(|m| m.id != id);
    list.push(rec.clone());
    write_index(&app, &list)?;
    Ok(rec)
}

/// The part with all the risk in it, kept free of Tauri so the tests below can
/// drive it against a real archive: stream, hash, verify, unpack, swap.
async fn install(
    dir: &Path,
    id: &str,
    url: &str,
    sha256: &str,
    on_progress: impl Fn(u64, u64),
) -> Result<Installed, Error> {
    let part = dir.join(format!("{id}.part"));
    let tmp = dir.join(format!("{id}.tmp"));
    let dest = dir.join(id);

    let res = reqwest::get(url).await?;
    if !res.status().is_success() {
        return err(format!("{url} → HTTP {}", res.status()));
    }
    let total = res.content_length().unwrap_or(0);

    // Stream to disk and hash as it goes — a 350MB model should never be held in
    // memory just to checksum it.
    let mut file = std::fs::File::create(&part)?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut stream = res.bytes_stream();
    let mut last_emit = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        std::io::Write::write_all(&mut file, &chunk)?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        // ~1% granularity: a progress event per chunk would flood the webview.
        if total == 0 || received - last_emit > total / 100 {
            last_emit = received;
            on_progress(received, total);
        }
    }
    drop(file);

    let got = format!("{:x}", hasher.finalize());
    if !sha256.is_empty() && got != sha256 {
        let _ = std::fs::remove_file(&part);
        return err(format!("checksum mismatch — expected {sha256}, got {got}. Nothing was installed."));
    }

    // Unpack into .tmp, then swap. tar entries are prefixed with the archive's own
    // top-level dir (kokoro-multi-lang-v1_0/…); strip it so <id>/ is the model root.
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;
    let reader = bzip2::read::BzDecoder::new(std::fs::File::open(&part)?);
    let mut ar = tar::Archive::new(reader);
    for entry in ar.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        let stripped: PathBuf = path.components().skip(1).collect();
        if stripped.as_os_str().is_empty() {
            continue;
        }
        // Refuse anything that would climb out of the model directory.
        if stripped.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            continue;
        }
        let out = tmp.join(&stripped);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&out)?;
        } else {
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            entry.unpack(&out)?;
        }
    }
    std::fs::remove_file(&part)?;

    // Whisper archives carry both fp32 and int8 weights; we load int8, so the fp32
    // twin is ~400MB of a small model the learner never runs. Drop it.
    prune_fp32_twins(&tmp)?;

    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(&tmp, &dest)?;

    Ok(Installed {
        id: id.to_string(),
        bytes: received,
        sha256: got,
        downloaded_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    })
}

/// Delete `x.onnx` where `x.int8.onnx` sits beside it. Only Whisper ships both.
fn prune_fp32_twins(dir: &Path) -> Result<(), Error> {
    for e in std::fs::read_dir(dir)? {
        let p = e?.path();
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if let Some(stem) = name.strip_suffix(".onnx") {
            if !stem.ends_with(".int8") && dir.join(format!("{stem}.int8.onnx")).exists() {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn model_delete(app: AppHandle, id: String, state: State<'_, SpeechState>) -> Result<(), Error> {
    // Drop it from the cache first, or the next call happily serves from a model
    // whose files are gone. The STT cache is keyed "<id>:<language>", so match the
    // id prefix rather than the whole key.
    let mine = |k: &String| k == &id || k.starts_with(&format!("{id}:"));
    let mut tts = state.tts.lock().unwrap();
    if tts.as_ref().map(|(k, _)| mine(k)).unwrap_or(false) {
        *tts = None;
    }
    let mut stt = state.stt.lock().unwrap();
    if stt.as_ref().map(|(k, _)| mine(k)).unwrap_or(false) {
        *stt = None;
    }
    drop(tts);
    drop(stt);

    let dir = models_dir(&app)?.join(&id);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    let mut list = read_index(&app);
    list.retain(|m| m.id != id);
    write_index(&app, &list)?;
    Ok(())
}

// ---- engine config, inferred from what the archive actually contains ----
//
// The catalog (TS side) knows labels, sizes and URLs. It deliberately does not
// know file layouts: sherpa's archives are self-describing enough that one look
// at the directory says which engine it is, and that keeps model layout out of
// the settings schema.

fn one_file(dir: &Path, pred: impl Fn(&str) -> bool) -> Option<String> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.file_name().and_then(|s| s.to_str()).map(&pred).unwrap_or(false))
        .map(|p| p.to_string_lossy().into_owned())
}

fn tts_config(dir: &Path, threads: i32) -> Result<OfflineTtsConfig, Error> {
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    let mut model = OfflineTtsModelConfig { num_threads: threads, ..Default::default() };

    if dir.join("voices.bin").exists() {
        // Kokoro. Its espeak data covers the Latin languages; the zh lexicon and
        // jieba dict are only wired up when the archive actually carries them.
        let onnx = one_file(dir, |n| n.ends_with(".onnx"))
            .ok_or_else(|| Error::Msg("kokoro: no .onnx in model dir".into()))?;
        let lexicons: Vec<String> = ["lexicon-us-en.txt", "lexicon-zh.txt"]
            .iter()
            .filter(|f| dir.join(f).exists())
            .map(|f| s(dir.join(f)))
            .collect();
        model.kokoro = OfflineTtsKokoroModelConfig {
            model: Some(onnx),
            voices: Some(s(dir.join("voices.bin"))),
            tokens: Some(s(dir.join("tokens.txt"))),
            data_dir: Some(s(dir.join("espeak-ng-data"))),
            lexicon: (!lexicons.is_empty()).then(|| lexicons.join(",")),
            dict_dir: dir.join("dict").is_dir().then(|| s(dir.join("dict"))),
            length_scale: 1.0,
            ..Default::default()
        };
    } else {
        // Piper (a VITS model): one .onnx, its tokens, and espeak data.
        let onnx = one_file(dir, |n| n.ends_with(".onnx"))
            .ok_or_else(|| Error::Msg("piper: no .onnx in model dir".into()))?;
        model.vits = OfflineTtsVitsModelConfig {
            model: Some(onnx),
            tokens: Some(s(dir.join("tokens.txt"))),
            data_dir: Some(s(dir.join("espeak-ng-data"))),
            length_scale: 1.0,
            ..Default::default()
        };
    }
    Ok(OfflineTtsConfig { model, ..Default::default() })
}

fn stt_config(dir: &Path, language: &str, threads: i32) -> Result<OfflineRecognizerConfig, Error> {
    let enc = one_file(dir, |n| n.contains("encoder") && n.ends_with(".onnx"))
        .ok_or_else(|| Error::Msg("whisper: no encoder in model dir".into()))?;
    let dec = one_file(dir, |n| n.contains("decoder") && n.ends_with(".onnx"))
        .ok_or_else(|| Error::Msg("whisper: no decoder in model dir".into()))?;
    let tokens = one_file(dir, |n| n.ends_with("tokens.txt"))
        .ok_or_else(|| Error::Msg("whisper: no tokens.txt in model dir".into()))?;

    let mut cfg = OfflineRecognizerConfig::default();
    cfg.model_config.whisper = OfflineWhisperModelConfig {
        encoder: Some(enc),
        decoder: Some(dec),
        // Whisper takes ISO-639-1. Empty means auto-detect, which mishears a
        // beginner's accented Spanish as English — the pack's language is better.
        language: Some(language.to_string()),
        task: Some("transcribe".into()),
        ..Default::default()
    };
    cfg.model_config.tokens = Some(tokens);
    cfg.model_config.num_threads = threads;
    Ok(cfg)
}

// Kokoro is ~2x faster at 4 threads than 2; past that it stops paying (measured
// on an M-series: RTF 0.54 → 0.41 → 0.49 for 2/4/8).
const THREADS: i32 = 4;

fn model_dir(app: &AppHandle, id: &str) -> Result<PathBuf, Error> {
    let dir = models_dir(app)?.join(id);
    if !dir.is_dir() {
        // The learner deleted the model. Say so plainly: the TS side turns any
        // error from this tier into a fall-through to the next one.
        return err(format!("model \"{id}\" is not installed"));
    }
    Ok(dir)
}

/// Text → 16-bit PCM WAV bytes. Returned raw (not JSON) — a few hundred KB of
/// audio through serde is a waste the IPC layer already has an answer for.
#[tauri::command]
pub fn bundled_tts(
    app: AppHandle,
    state: State<'_, SpeechState>,
    id: String,
    text: String,
    sid: i32,
    speed: f32,
) -> Result<tauri::ipc::Response, Error> {
    if text.trim().is_empty() {
        return err("nothing to speak");
    }
    let dir = model_dir(&app, &id)?;
    let mut slot = state.tts.lock().unwrap();
    if slot.as_ref().map(|(k, _)| k != &id).unwrap_or(true) {
        let cfg = tts_config(&dir, THREADS)?;
        let tts = OfflineTts::create(&cfg)
            .ok_or_else(|| Error::Msg(format!("could not load voice model \"{id}\"")))?;
        *slot = Some((id.clone(), Loaded(tts)));
    }
    let tts = &slot.as_ref().unwrap().1 .0;

    let audio = tts
        .generate_with_config(
            &text,
            &GenerationConfig { sid, speed, ..Default::default() },
            None::<fn(&[f32], f32) -> bool>,
        )
        .ok_or_else(|| Error::Msg("the voice model produced no audio".to_string()))?;

    Ok(tauri::ipc::Response::new(wav(audio.samples(), audio.sample_rate())))
}

/// Minimal 16-bit mono WAV. The webview plays this straight from a blob URL.
fn wav(samples: &[f32], rate: i32) -> Vec<u8> {
    let rate = rate as u32;
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    out
}

/// Audio → text. The body is raw 32-bit float PCM, mono, at the rate given in the
/// `x-rate` header: the webview already has to decode whatever container the mic
/// produced (webm on Chromium, mp4 on WebKit), so it hands over samples and no
/// audio decoder is needed on this side.
#[tauri::command]
pub fn bundled_stt(
    app: AppHandle,
    state: State<'_, SpeechState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, Error> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return err("bundled_stt expects a raw body");
    };
    let head = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("");
    let id = head("x-model").to_string();
    let language = head("x-language").to_string();
    let rate: i32 = head("x-rate").parse().unwrap_or(16000);
    if id.is_empty() {
        return err("bundled_stt: no model");
    }

    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    if samples.is_empty() {
        return Ok(String::new());
    }

    let dir = model_dir(&app, &id)?;
    // Whisper's language is baked into the recogniser at load, so a learner who
    // switches pack mid-session reloads it — keyed by id+language, not id alone.
    let key = format!("{id}:{language}");
    let mut slot = state.stt.lock().unwrap();
    if slot.as_ref().map(|(k, _)| k != &key).unwrap_or(true) {
        let cfg = stt_config(&dir, &language, THREADS)?;
        let rec = OfflineRecognizer::create(&cfg)
            .ok_or_else(|| Error::Msg(format!("could not load dictation model \"{id}\"")))?;
        *slot = Some((key, Loaded(rec)));
    }
    let rec = &slot.as_ref().unwrap().1 .0;

    let stream = rec.create_stream();
    stream.accept_waveform(rate, &samples);
    rec.decode(&stream);
    Ok(stream.get_result().map(|r| r.text).unwrap_or_default().trim().to_string())
}

// The bundled tier's whole promise is "speak, hear, no network, no setup". These
// tests hold it to that: a real archive off the real release, verified, unpacked,
// spoken, and heard back. They hit the network once (~230MB) and are slow; that is
// the point — mocking the download would test the mock.
//
// Run: cargo test --release -- --nocapture --test-threads=1
#[cfg(test)]
mod tests {
    use super::*;

    const REL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
    const PIPER_TR: &str = "vits-piper-tr_TR-fettah-medium-int8";
    const PIPER_SHA: &str = "4374bfdabb88ada0f3edf9bd46eacf1c5391a8a93bdce364196495891e5bc323";
    const WHISPER_SHA: &str = "911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de";

    fn scratch() -> PathBuf {
        let d = std::env::temp_dir().join("verba-speech-test");
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// A corrupt download must leave *nothing* behind — not a model, not a part file.
    #[tokio::test]
    async fn bad_checksum_installs_nothing() {
        let dir = scratch();
        let _ = std::fs::remove_dir_all(dir.join("corrupt"));
        let res = install(
            &dir,
            "corrupt",
            &format!("{REL}/tts-models/{PIPER_TR}.tar.bz2"),
            "0000000000000000000000000000000000000000000000000000000000000000",
            |_, _| {},
        )
        .await;

        let why = res.expect_err("a wrong sha256 must fail").to_string();
        assert!(why.contains("checksum mismatch"), "{why}");
        assert!(!dir.join("corrupt").exists(), "no model directory may survive a bad checksum");
        assert!(!dir.join("corrupt.part").exists(), "no part file may survive a bad checksum");
        assert!(!dir.join("corrupt.tmp").exists(), "no temp directory may survive a bad checksum");
    }

    /// The loop the whole feature exists for, with no network and no keys: speak a
    /// Turkish sentence with Piper, hear it back with Whisper.
    #[tokio::test]
    async fn speaks_turkish_and_hears_it_back() {
        let dir = scratch();

        if !dir.join("piper-tr").is_dir() {
            install(&dir, "piper-tr", &format!("{REL}/tts-models/{PIPER_TR}.tar.bz2"), PIPER_SHA, |_, _| {})
                .await
                .expect("piper download");
        }
        if !dir.join("whisper-base").is_dir() {
            install(
                &dir,
                "whisper-base",
                &format!("{REL}/asr-models/sherpa-onnx-whisper-base.tar.bz2"),
                WHISPER_SHA,
                |_, _| {},
            )
            .await
            .expect("whisper download");
        }

        // The archive's top-level directory is stripped, so the model root is <id>/.
        let tts_dir = dir.join("piper-tr");
        assert!(tts_dir.join("tokens.txt").exists(), "unpack must strip the archive's top dir");
        assert!(tts_dir.join("espeak-ng-data").is_dir());

        // Whisper ships fp32 and int8 both; we keep only int8.
        let stt_dir = dir.join("whisper-base");
        assert!(stt_dir.join("base-encoder.int8.onnx").exists(), "int8 weights must survive");
        assert!(!stt_dir.join("base-encoder.onnx").exists(), "the fp32 twin must be pruned");

        // Engine detection: no voices.bin → Piper, not Kokoro.
        let cfg = tts_config(&tts_dir, THREADS).unwrap();
        assert!(cfg.model.vits.model.is_some(), "a piper archive must configure vits");
        assert!(cfg.model.kokoro.model.is_none(), "…and must not configure kokoro");

        let tts = OfflineTts::create(&cfg).expect("load piper");
        let said = "Günaydın. Bugün nasılsın?";
        let audio = tts
            .generate_with_config(
                said,
                &GenerationConfig { sid: 0, speed: 1.0, ..Default::default() },
                None::<fn(&[f32], f32) -> bool>,
            )
            .expect("speak");
        assert!(!audio.samples().is_empty(), "Piper must produce audio");

        // The WAV we hand the webview must really be a WAV.
        let bytes = wav(audio.samples(), audio.sample_rate());
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(bytes.len(), 44 + audio.samples().len() * 2);

        // …and Whisper, told the pack's language, must hear roughly what was said.
        let rec = OfflineRecognizer::create(&stt_config(&stt_dir, "tr", THREADS).unwrap()).expect("load whisper");
        let stream = rec.create_stream();
        stream.accept_waveform(audio.sample_rate(), audio.samples());
        rec.decode(&stream);
        let heard = stream.get_result().map(|r| r.text).unwrap_or_default().to_lowercase();
        println!("said:  {said}\nheard: {heard}");

        assert!(
            heard.contains("bugün") || heard.contains("bugun") || heard.contains("nasılsın"),
            "whisper heard {heard:?}, which is not the Turkish it was given",
        );
    }
}

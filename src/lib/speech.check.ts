// Runnable self-check for the speech seam: the two halves (TTS/STT) must be
// picked independently, and the mic must explain itself when it can't work.
// Runs headless — no window, so webSpeech() reports no synth and no recogniser,
// which is exactly the macOS-webview situation this code exists to survive.
// Run: node --experimental-strip-types src/lib/speech.check.ts
import assert from "node:assert";
import {
  bundledStt,
  deepgram,
  deepgramHelp,
  getSpeech,
  listenBlocker,
  micRoute,
  micTrouble,
  migrateSpeech,
  openaiStt,
  pruneBundled,
  prunedNote,
  record,
  resolveTier,
  tierName,
  webSpeech,
} from "./speech.ts";

// --- the original bug: an ElevenLabs key must not decide dictation ---
// The old single-radio design made these mutually exclusive, so picking
// ElevenLabs silently routed STT to a recogniser that does not exist.
const both = getSpeech({ elevenLabsKey: "el", deepgramKey: "dg" });
assert(both.canSpeak, "ElevenLabs + Deepgram together: TTS must come from ElevenLabs");
assert.equal(
  listenBlocker({ elevenLabsKey: "el", deepgramKey: "dg" }),
  "No microphone is available to this app.",
  "with both keys the only thing left to block the mic is hardware",
);

// A TTS key alone must still leave dictation asking for Deepgram, not claiming it works.
assert.match(listenBlocker({ elevenLabsKey: "el" }), /Deepgram API key/);
assert.match(listenBlocker({}), /Deepgram API key/);

// --- offline pins both halves to the OS ---
assert(!getSpeech({ elevenLabsKey: "el", offline: true }).canSpeak, "offline must not reach ElevenLabs");
assert(getSpeech({ elevenLabsKey: "el" }).canSpeak, "online with a key must reach ElevenLabs");
assert.match(listenBlocker({ deepgramKey: "dg", offline: true }), /Offline mode/);

// --- no key, no cloud: the OS halves, which on this webview means no dictation ---
assert(!getSpeech({}).canListen, "no webview ships a usable recogniser");

// --- the local tier ---
// The URL is the whole on/off switch: blank means the tier isn't there.
const local = { localTtsUrl: "http://localhost:8880/v1", localSttUrl: "http://localhost:8000/v1" };

// A local server is on the learner's own machine, so offline mode must not pin it
// to the OS the way it pins the cloud halves. This is the whole point of the tier.
assert(getSpeech({ ...local, offline: true }).canSpeak, "offline must still reach a local speech server");
assert(
  getSpeech({ ...local, offline: true, elevenLabsKey: "el" }).canSpeak,
  "a local server outranks a cloud key that offline mode has disabled",
);

assert(
  !getSpeech({ ...local, localTtsUrl: "", offline: true, elevenLabsKey: "el" }).canSpeak,
  "a blank URL must not enable the local half",
);

// Dictation stops begging for a Deepgram key once a local server is configured.
assert.doesNotMatch(listenBlocker(local), /Deepgram/, "a local STT server is an answer to 'how do I dictate'");
assert.match(listenBlocker({ ...local, localSttUrl: "" }), /Deepgram API key/, "…but only when it is configured");

// --- the server dies mid-session: degrade, warn once, keep talking ---
// There is no server here and no Tauri IPC to reach one, so every local call
// fails — which is precisely the mid-session-death path. It must not throw.
const warnings: string[] = [];
const dying = getSpeech({ ...local, offline: true }, (m) => warnings.push(m));
await dying.speak("hola");
await dying.speak("otra vez");
assert.equal(warnings.length, 1, "a server that stays down must warn once, not once per turn");
assert.match(warnings[0], /system voice/, "the warning says what was used instead");
assert.match(warnings[0], /Local voice unreachable/, "v1's wording for the local tier is unchanged");

// --- the bundled tier ---
// Models the app runs itself (sherpa-onnx, in-process). A model id is only ever
// written to settings once its download verified, so a non-empty id means "there
// are files on disk"; the tier is skipped entirely when it's blank.
const bundled = { bundledTtsModel: "piper-es", bundledSttModel: "whisper-base" };

// It outranks every other tier, and — like the local server, and unlike the cloud
// keys — it survives offline mode: an in-process model is not the network.
assert(getSpeech({ ...bundled, offline: true }).canSpeak, "offline must still reach a bundled model");
assert(
  getSpeech({ ...bundled, ...local, offline: true, elevenLabsKey: "el" }).canSpeak,
  "bundled outranks a local server, which outranks a cloud key",
);
// (canListen is gated on real mic hardware, which this headless run has none of —
// so the bundled recogniser is asserted through listenBlocker below, as in v1.)

// Blank id → the tier isn't there, and the tiers below carry on exactly as in v1.
assert(
  !getSpeech({ bundledTtsModel: "", offline: true, elevenLabsKey: "el" }).canSpeak,
  "a blank bundled id must not enable the tier",
);
assert(
  !getSpeech({ ...local, localTtsUrl: "", bundledTtsModel: "", offline: true }).canSpeak,
  "no bundled model and no local URL → the OS voices, as before",
);

// Dictation stops begging for a Deepgram key once a bundled model is installed.
assert.doesNotMatch(listenBlocker(bundled), /Deepgram/, "a bundled whisper is an answer to 'how do I dictate'");
assert.match(listenBlocker({}), /Deepgram/, "…and with nothing installed it still asks");

// A half can be pinned to one tier. Pinning past an available tier really skips it:
// with a bundled model installed AND a cloud key, pinning "cloud" must reach the key.
assert(
  getSpeech({ ...bundled, elevenLabsKey: "el", ttsTier: "cloud" }).canSpeak,
  "a pinned tier is used even when a better one is installed",
);
// A pin at a tier that cannot serve degrades to the OS rather than throwing.
assert(!getSpeech({ ttsTier: "cloud", offline: true, elevenLabsKey: "el" }).canSpeak, "a pin cannot beat offline mode");

// --- the model is deleted mid-session ---
// There is no Tauri IPC here, so every bundled call throws — which is exactly what
// a deleted model looks like. One banner, fall through to the OS, never a crash.
const gone: string[] = [];
const orphan = getSpeech({ ...bundled, offline: true }, (m) => gone.push(m));
await orphan.speak("hola");
await orphan.speak("otra vez");
assert.equal(gone.length, 1, "a missing model must warn once, not once per turn");
assert.match(gone[0], /Bundled voice unavailable/, "the banner names the tier that went away");
assert.match(gone[0], /system voice/, "…and says what spoke instead");

// --- the model is deleted between sessions ---
// The mid-session case above costs one turn; this one must cost none. App checks the
// model index on the way in, and an id whose files are gone is forgotten there — so
// the tier is already out of the race by the time the learner says anything.
const onDisk = new Set(["whisper-base"]); // the voice is gone; the recogniser is not
assert.deepEqual(
  pruneBundled(bundled, onDisk),
  { bundledTtsModel: "" },
  "a chosen model that is no longer on disk is forgotten, and only that one",
);
const pruned = { ...bundled, ...pruneBundled(bundled, onDisk) };
assert.equal(resolveTier(pruned, "tts"), "native", "…so the bundled tier stops winning with nothing to serve");
assert.equal(resolveTier(pruned, "stt"), "bundled", "…while the half whose model survived keeps it");

// A pin is not a licence to serve nothing: the panel already degrades a pin that
// cannot serve, and a pruned id is exactly that.
assert.equal(
  resolveTier({ ...bundled, ...pruneBundled(bundled, new Set()), ttsTier: "bundled" }, "tts"),
  "native",
  "a pin at a tier whose model is gone degrades to the OS",
);

// Nothing to forget must write nothing — a no-op patch that still saves would rewrite
// settings on every launch.
assert.deepEqual(pruneBundled(bundled, new Set(["piper-es", "whisper-base"])), {}, "models on disk are left alone");
assert.deepEqual(pruneBundled({}, new Set()), {}, "…and so is a learner who never chose one");

// --- what the Deepgram field promises, in tier order ---
// The bug this fixes: the field said "required" while a bundled Whisper model was
// already doing the listening, which reads as "pay up or no mic".
assert.match(deepgramHelp({}, true), /^Optional/, "a bundled Whisper model outranks the key");
assert.match(deepgramHelp(local, true), /Whisper/, "…and outranks a local server too");
assert.match(deepgramHelp(local, false), /local server/, "no Whisper, but a server: still optional");
assert.match(deepgramHelp({ localSttUrl: "" }, false), /^Required/, "a server with no URL is no server");
assert.match(deepgramHelp({}, false), /^Required/, "neither: the key is the only way the mic works");

// --- what the Speech panel's status line prints ---
// It must be the tier the adapter actually built, not a second guess at it: a panel
// that says "Piper" while Talk speaks through ElevenLabs is worse than no panel.
assert.equal(resolveTier(bundled, "tts"), "bundled", "a bundled model installed → bundled speaks");
assert.equal(resolveTier(local, "tts"), "local", "no model, a server → the server speaks");
assert.equal(resolveTier({ elevenLabsKey: "el" }, "tts"), "cloud", "neither, but a key → the cloud speaks");
assert.equal(resolveTier({}, "tts"), "native", "none of the above → the OS speaks");
assert.equal(resolveTier({ elevenLabsKey: "el", offline: true }, "tts"), "native", "offline retires the cloud tier");
assert.equal(resolveTier({ ...bundled, ttsTier: "native" }, "tts"), "native", "a pin beats a better tier");
assert.equal(resolveTier({ ttsTier: "cloud" }, "tts"), "native", "a pin that cannot serve degrades to the OS");
// The halves are pinned independently — the decoupling this whole panel is built on.
assert.equal(resolveTier({ ...bundled, ...local, ttsTier: "bundled" }, "stt"), "bundled", "stt follows its own auto…");
assert.equal(resolveTier({ ...bundled, ...local, sttTier: "local" }, "stt"), "local", "…and its own pin");

// --- v1 settings land somewhere sane ---
// The switch was on: the halves that had a URL are pinned to it, and nothing else moves.
const wasOn = migrateSpeech({ localSpeech: true, ...local, elevenLabsKey: "el" });
assert.equal(resolveTier(wasOn, "tts"), "local", "localSpeech=true → the local server keeps speaking");
assert.equal(resolveTier(wasOn, "stt"), "local", "…and keeps listening");
assert(!("localSpeech" in wasOn), "the old switch is gone, not carried along");

// The switch was off: the URLs were inert, so they must not come back to life as a
// tier that outranks the key the learner is actually using.
const wasOff = migrateSpeech({ localSpeech: false, ...local, elevenLabsKey: "el" });
assert.equal(resolveTier(wasOff, "tts"), "cloud", "localSpeech=false → the cloud key still speaks, as before");
assert.equal(resolveTier(migrateSpeech({ localSpeech: false, ...local }), "tts"), "native", "…or the OS, as before");

// A half the switch left blank is not pinned to a server it never had.
const halfOn = migrateSpeech({ localSpeech: true, localTtsUrl: "", localSttUrl: local.localSttUrl, elevenLabsKey: "el" });
assert.equal(resolveTier(halfOn, "tts"), "cloud", "no TTS URL → that half was never local; leave it on the key");
assert.equal(resolveTier(halfOn, "stt"), "local", "…while the half that had one is pinned");

// Blank state, and anything already migrated, passes through untouched.
assert.equal(resolveTier(migrateSpeech({}), "tts"), "native", "a fresh install is Automatic → the OS");
assert.deepEqual(migrateSpeech({ ttsTier: "cloud" }), { ttsTier: "cloud" }, "migrating twice changes nothing");

// ---- state 3: a chosen voice whose files went away says so ----
//
// §7 row 3. pruneBundled clears the id; without a sentence the learner sees a
// setting that forgot itself and a coach that changed voice for no reason.
const label = (id: string) => (id === "kokoro" ? "Kokoro" : id === "whisper-base" ? "Whisper base" : id);

const lostVoice = { bundledTtsModel: "kokoro", bundledSttModel: "" };
const clearTts = pruneBundled(lostVoice, new Set());
assert.deepEqual(clearTts, { bundledTtsModel: "" }, "the missing model is what gets cleared");

const said = prunedNote(lostVoice, clearTts, label);
assert.match(said, /Kokoro/, "state 3: the note names the voice that went");
assert.match(said, /your system voice/, "state 3: …and what is speaking instead");
assert.match(said, /Download it again/, "state 3: …and the way to get it back");

// The replacement is read off the same walk the adapter does, not guessed: with a
// local server configured, that is what speaks, and the note has to say so.
const withServer = { ...lostVoice, localTtsUrl: "http://localhost:8880/v1" };
assert.match(
  prunedNote(withServer, pruneBundled(withServer, new Set()), label),
  /your local server/,
  "state 3: the note names the tier that actually took over",
);

// Both halves gone is one sentence pair, and the plural has to follow.
const lostBoth = { bundledTtsModel: "kokoro", bundledSttModel: "whisper-base" };
const clearBoth = prunedNote(lostBoth, pruneBundled(lostBoth, new Set()), label);
assert.match(clearBoth, /speaking with/, "state 3: the speaking half is named");
assert.match(clearBoth, /listening with/, "state 3: …and so is the listening half");
assert.match(clearBoth, /Download them again/, "state 3: two losses take the plural");

// The dictation half names no model — §5.4 keeps that name in Advanced, and a note
// is still the main flow.
assert(!/Whisper/.test(clearBoth), "state 3: the dictation model's name stays out of this page");

// Nothing lost, nothing said. A note on every start-up is a note nobody reads.
assert.equal(prunedNote(lostVoice, {}, label), "", "state 3: an untouched setup says nothing");
assert.equal(prunedNote({}, pruneBundled({}, new Set()), label), "", "…and neither does one that never chose");

// ---- state 4: the microphone's refusals name the way out ----
//
// §7 row 4: "Konuşma bölümü nedeni yazar, izne giden yolu gösterir." Four failures,
// four different next moves — flattening them into one apology is what this replaces.
const denied = micTrouble(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }));
assert.match(denied, /not allowed/i, "state 4: a refusal says it was refused");
assert.match(denied, /Privacy/i, "state 4: …and names where the switch is");

assert.match(
  micTrouble(Object.assign(new Error("x"), { name: "NotFoundError" })),
  /Plug one in/,
  "state 4: no device is a different problem with a different answer",
);
assert.match(
  micTrouble(Object.assign(new Error("x"), { name: "NotReadableError" })),
  /Another app/,
  "state 4: a mic held by something else is a third",
);
// Anything unrecognised arrives whole rather than being flattened into a guess.
assert.match(micTrouble(new Error("something new")), /something new/, "state 4: an unknown failure is quoted, not invented");

// The route is per platform, because "check your privacy settings" helps nobody.
assert.match(micRoute("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), /System Settings/, "state 4: macOS route");
assert.match(micRoute("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), /Privacy & security/, "state 4: Windows route");
assert.match(micRoute("Mozilla/5.0 (X11; Linux x86_64)"), /privacy settings/, "state 4: and a fallback that is still a route");

// ---- what a tier is called, once ----
assert.equal(tierName("native", "tts"), "your system voice");
assert.equal(tierName("native", "stt"), "your system's speech recognition");
assert.notEqual(tierName("cloud", "tts"), tierName("cloud", "stt"), "the two halves use different cloud services");

// ---- PLAN-018: every tier's partials flag matches what it can do ----
// Asserted by construction over the exported factories: a tier either streams
// partials (bundled whisper, a local server) or it does not (cloud, the OS).
assert.equal(bundledStt("whisper-base").partials, true, "bundled whisper streams partials");
assert.equal(openaiStt("http://localhost:8000/v1", "m").partials, true, "a local server streams partials");
assert.equal(deepgram("key").partials, false, "Deepgram is record-then-transcribe — no partials");
assert.equal(webSpeech().partials, false, "the OS recogniser has no partials");

// ---- PLAN-018: record() measures the envelope and stops on silence ----
// Headless node has no mic, no MediaRecorder, no AudioContext — give it fakes
// that drive the analyser frames the silence detector reads.
{
  let rafCb: (() => void) | null = null;
  (globalThis as any).requestAnimationFrame = (cb: () => void) => {
    rafCb = cb;
    return 1;
  };
  (globalThis as any).cancelAnimationFrame = () => {
    rafCb = null;
  };

  class FakeAnalyser {
    level = 0;
    getByteTimeDomainData(buf: Uint8Array) {
      // A constant level fills the buffer with a constant sample; RMS reads it back.
      const v = Math.max(0, Math.min(255, Math.round(this.level * 128) + 128));
      buf.fill(v);
    }
  }
  let currentCtx: { analyser: FakeAnalyser } | null = null;
  (globalThis as any).AudioContext = class {
    analyser = new FakeAnalyser();
    constructor() {
      currentCtx = this;
    }
    createMediaStreamSource() {
      return { connect: () => {} };
    }
    createAnalyser() {
      return this.analyser;
    }
    // pcm16k() decodes the clip before handing it to whisper; the fake returns a
    // short buffer so the decode path runs without a real audio engine.
    async decodeAudioData() {
      return { duration: 0.1 };
    }
    close() {
      return Promise.resolve();
    }
  };
  // pcm16k() re-renders the decoded clip at 16 kHz through an OfflineAudioContext.
  (globalThis as any).OfflineAudioContext = class {
    destination = {};
    createBufferSource() {
      return { buffer: null, connect: () => {}, start: () => {} };
    }
    async startRendering() {
      return { getChannelData: () => new Float32Array(1600) };
    }
  };

  let stopped = false;
  class FakeMediaRecorder {
    static instances: FakeMediaRecorder[] = [];
    state = "inactive";
    mimeType = "audio/webm";
    startedWith: number | undefined;
    ondataavailable: ((e: any) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: any) => void) | null = null;
    constructor() {
      FakeMediaRecorder.instances.push(this);
    }
    start(timeslice?: number) {
      // A real MediaRecorder throws InvalidStateError if start() is called while
      // already recording. The fake must too, or a tier that double-starts would
      // pass here and crash on a real webview.
      if (this.state === "recording") {
        const err = new Error("Failed to execute 'start' on 'MediaRecorder': The MediaRecorder's state is 'recording'.");
        (err as any).name = "InvalidStateError";
        throw err;
      }
      this.state = "recording";
      this.startedWith = timeslice;
    }
    stop() {
      this.state = "inactive";
      stopped = true;
      this.onstop?.();
    }
  }
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(globalThis, "navigator", {
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    configurable: true,
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));
  let t = 0;
  const frames = (level: number, n: number) => {
    if (currentCtx) currentCtx.analyser.level = level;
    for (let i = 0; i < n; i++) {
      t += 16; // ~60 fps, as requestAnimationFrame actually runs
      rafCb?.(t);
    }
  };

  // Quiet before any speech must not stop the recording — a learner thinking for
  // a few seconds is not a finished recording.
  stopped = false;
  const levels: number[] = [];
  const p1 = record(() => {}, { silenceMs: 200, onLevel: (l) => levels.push(l) });
  await flush(); // let mic() resolve and the analyser attach
  frames(0, 10); // ten quiet frames, no speech yet
  assert.equal(stopped, false, "quiet before any speech must not stop the recording");

  // Speech, then enough quiet to trip the stop.
  frames(0.1, 5); // speech
  frames(0, 15); // 15 quiet frames = 240 ms > 200 ms silenceMs
  const r1 = await p1;
  assert.equal(stopped, true, "silence after speech must stop the recording on its own");
  assert(r1.ms > 0, "the recording reports how long it ran");
  assert(r1.levels.length > 0, "the recording returns a non-empty envelope");
  assert(levels.length > 0, "onLevel is fed the live meter");

  // A recording that never sees speech must not self-stop on silence — only the
  // cap (or a hand stop) ends it. Capture the recorder via onStart and stop it
  // by hand, as cancel() would.
  stopped = false;
  let rec2: any = null;
  const p2 = record((r) => (rec2 = r), { maxMs: 10_000, silenceMs: 200 });
  await flush();
  frames(0, 20); // still quiet — silence must not have stopped it
  assert.equal(stopped, false, "a recording that never saw speech must not self-stop on silence");
  rec2.stop(); // hand stop, as cancel() does
  const r2 = await p2;
  assert(r2.ms >= 0, "a hand-stopped recording still resolves with the record shape");
  assert(r2.levels.length > 0, "the envelope is measured even when nothing was said");

  // ---- review: record() passes the timeslice through to rec.start() ----
  // A tier that wants partials asks for a timeslice; record() is the one place
  // that calls start(), and it must hand the timeslice over. The fake records
  // what it was started with.
  stopped = false;
  const p3 = record(() => {}, { timeslice: 1000 });
  await flush();
  const rec3 = FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];
  assert.equal(rec3.startedWith, 1000, "record() passes the timeslice to rec.start()");
  rec3.stop();
  await p3;

  // ---- review: a tier's listen() runs over the fake recorder, partials flow ----
  // Drive bundledStt (in-process whisper) end to end over the fakes: the recorder
  // is started with a timeslice, chunks feed the partial re-transcription, and
  // onStopped fires the moment the recorder stops. The invoke mock stands in for
  // the Rust whisper call.
  {
    (globalThis as any).window = {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string) => (cmd === "bundled_stt" ? "hola" : ""),
      },
    };
    const partials: string[] = [];
    let stoppedFired = false;
    const stt = bundledStt("whisper-base");
    const p4 = stt.listen({
      onPartial: (t) => partials.push(t),
      onStopped: () => (stoppedFired = true),
    });
    await flush(); // let mic() resolve and the analyser attach
    const rec4 = FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];
    assert.equal(rec4.startedWith, 1000, "bundledStt asks for a timeslice so partials can see the growing clip");
    frames(0.1, 5); // speech, so the recording is real
    // Feed a chunk the way the recorder would — this is what the partial
    // re-transcription reads.
    rec4.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    // The partial timer re-transcribes every ~1 s; give it a beat to run.
    await new Promise((r) => setTimeout(r, 1200));
    assert(partials.length > 0, "partials actually flow through the tier's listen()");
    rec4.stop(); // as cancel() would — resolves the pending listen()
    const r4 = await p4;
    assert.equal(stoppedFired, true, "onStopped fires the moment the recorder stops");
    assert.equal(r4.text, "hola", "the final transcription is the one that counts");
    assert(r4.levels.length > 0, "the tier's listen() returns the measured envelope");
  }
}

console.log("speech.check: ok");

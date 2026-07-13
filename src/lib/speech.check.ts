// Runnable self-check for the speech seam: the two halves (TTS/STT) must be
// picked independently, and the mic must explain itself when it can't work.
// Runs headless — no window, so webSpeech() reports no synth and no recogniser,
// which is exactly the macOS-webview situation this code exists to survive.
// Run: node --experimental-strip-types src/lib/speech.check.ts
import assert from "node:assert";
import { deepgramHelp, getSpeech, listenBlocker } from "./speech.ts";

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
const local = { localSpeech: true, localTtsUrl: "http://localhost:8880/v1", localSttUrl: "http://localhost:8000/v1" };

// A local server is on the learner's own machine, so offline mode must not pin it
// to the OS the way it pins the cloud halves. This is the whole point of the tier.
assert(getSpeech({ ...local, offline: true }).canSpeak, "offline must still reach a local speech server");
assert(
  getSpeech({ ...local, offline: true, elevenLabsKey: "el" }).canSpeak,
  "a local server outranks a cloud key that offline mode has disabled",
);

// The master switch off, or the URL blank, means nothing changed for anyone.
assert(!getSpeech({ ...local, localSpeech: false, offline: true }).canSpeak, "switch off → the OS voices, as before");
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

// --- what the Deepgram field promises, in tier order ---
// The bug this fixes: the field said "required" while a bundled Whisper model was
// already doing the listening, which reads as "pay up or no mic".
assert.match(deepgramHelp({}, true), /^Optional/, "a bundled Whisper model outranks the key");
assert.match(deepgramHelp(local, true), /Whisper/, "…and outranks a local server too");
assert.match(deepgramHelp(local, false), /local server/, "no Whisper, but a server: still optional");
assert.match(deepgramHelp({ localSpeech: true }, false), /^Required/, "a server with no URL is no server");
assert.match(deepgramHelp({}, false), /^Required/, "neither: the key is the only way the mic works");

console.log("speech.check: ok");

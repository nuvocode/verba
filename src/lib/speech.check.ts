// Runnable self-check for the speech seam: the two halves (TTS/STT) must be
// picked independently, and the mic must explain itself when it can't work.
// Runs headless — no window, so webSpeech() reports no synth and no recogniser,
// which is exactly the macOS-webview situation this code exists to survive.
// Run: node --experimental-strip-types src/lib/speech.check.ts
import assert from "node:assert";
import { getSpeech, listenBlocker } from "./speech.ts";

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

console.log("speech.check: ok");

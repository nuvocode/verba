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

console.log("speech.check: ok");

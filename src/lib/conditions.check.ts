// Real listening conditions, honestly graded (PLAN-036), pinned.
//
// Twelve cases: `supported` reads the tier's declared `can` (never a fixture for
// the webSpeech tier); `applyTo` refuses a third variable at the type and runtime
// level; the graph it *requests* is asserted against a recording stub (Node has
// no WebAudio, so the sound itself is an acceptance criterion, checked by a
// person); grade 0 is today's Listen byte for byte; a wrong answer walks the
// hardest active variable back one grade and replays the same chapter; walking
// back from grade 1 stops at 0 and never skips or abandons; a correct answer
// hardens at most one variable; a replay clears the chapter's answers and heard;
// the walk-back signal is not a miss and leaves comprehension byte-identical;
// Listening.tsx renders only supported grades (probed with a seeded violation);
// and listeningGrades is persisted, round-trips, and appears in no settings
// panel.
//
// Cases 2, 7 and 10 are driven from the production path, not fixtures — each must
// fail when its own rule is removed. Run:
//   node --experimental-strip-types src/lib/conditions.check.ts
import assert from "node:assert";
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  CONDITIONS,
  supported,
  activeFrom,
  applyTo,
  paceMultiplier,
  resumeAudio,
  resetAudio,
  walkBack,
  harden,
  PHONE_CENTER,
  PHONE_Q,
  NOISE_RATIO,
  PACE_MULTIPLIER,
  type Active,
} from "./conditions.ts";
import { webSpeech } from "./speech.ts";
import { signalMiss } from "./model.ts";
import { coachMetrics } from "./coachmetrics.ts";
import { defaultSettings, loadSettings, saveSettings } from "./settings.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// --- a fake clip and a recording AudioContext --------------------------------
const fakeClip = () => ({
  el: { playbackRate: 1 },
  duration: 3.5,
  release() {},
});

// Node has no WebAudio — `AudioContext`, `OfflineAudioContext` and `AudioBuffer`
// are all absent. So a check cannot measure the output, and writing a second,
// plain-JS biquad to test against would be a second door that proves nothing
// about `BiquadFilterNode`. What is asserted instead is the graph `applyTo`
// *requests*, against a recording stub.
function recordingContext() {
  const nodes: any[] = [];
  const edges: [any, any][] = [];
  const mk = (kind: string) => {
    const n: any = {
      kind,
      connect(target: any) {
        edges.push([this, target]);
        return this;
      },
      disconnect() {
        n.disconnected = true;
      },
      disconnected: false,
    };
    nodes.push(n);
    return n;
  };
  const ctx: any = {
    sampleRate: 48000,
    state: "running",
    destination: { kind: "destination" },
    createMediaElementSource: () => mk("source"),
    createBiquadFilter: () => Object.assign(mk("biquad"), { type: "", frequency: { value: 0 }, Q: { value: 0 } }),
    createGain: () => Object.assign(mk("gain"), { gain: { value: 0 } }),
    createBuffer: (channels: number, frames: number, rate: number) => ({
      channels,
      frames,
      rate,
      getChannelData: () => new Float32Array(frames),
    }),
    createBufferSource: () => {
      const n = Object.assign(mk("bufferSource"), { buffer: null, loop: false, started: false });
      n.start = () => { n.started = true; };
      n.stop = () => { n.stopped = true; };
      return n;
    },
  };
  return { ctx, nodes, edges };
}

// `applyTo` uses one shared context (created lazily). `resetAudio()` drops it so
// each case builds a fresh one; the recording stub is installed once and the
// shared context is captured through it.
const contexts: ReturnType<typeof recordingContext>[] = [];
(globalThis as any).AudioContext = function () {
  const c = recordingContext();
  contexts.push(c);
  return c.ctx;
};
resetAudio();

// --- case 1: accent and speakers are never offered — nothing produces them -----
{
  const one = supported({ can: { rate: true, voices: 1, filterable: true } });
  assert.equal(one.speakers, 0, "case 1: a one-voice tier offers no speakers grade above one");
  assert.equal(one.accent, 0, "case 1: a one-voice tier offers no accent grade above standard");
  // Even a many-voice tier offers neither — no code selects a voice per grade or
  // synthesises a second speaker, so a grade nothing produces is not shown.
  const many = supported({ can: { rate: true, voices: 5, filterable: true } });
  assert.equal(many.speakers, 0, "case 1: a many-voice tier still offers no speakers grade — nothing synthesises a second speaker");
  assert.equal(many.accent, 0, "case 1: a many-voice tier still offers no accent grade — nothing selects a voice per grade");
}

// --- case 2: rate:false and filterable:false omit grades; webSpeech is real ---
// conditions ledger 20 — listening variables are graded; an unsupported grade is not shown.
{
  const noRate = supported({ can: { rate: false, voices: 1, filterable: true } });
  assert.equal(noRate.pace, 0, "case 2: a tier with rate:false offers no pace grade above teaching");
  const noFilter = supported({ can: { rate: true, voices: 1, filterable: false } });
  assert.equal(noFilter.noise, 0, "case 2: a tier with filterable:false offers no noise grade above clean");
  assert.equal(noFilter.channel, 0, "case 2: a tier with filterable:false offers no channel grade above clear");

  // The webSpeech tier's real declaration, not a fixture — a hand-built tier
  // object proves only that the fixture was written correctly.
  const web = webSpeech();
  assert.equal(web.can.filterable, false, "case 2: webSpeech declares filterable:false — it has no clip()");
  const webSupported = supported(web);
  assert.equal(webSupported.noise, 0, "case 2: webSpeech offers no noise grade — there is nothing to mix under");
  assert.equal(webSupported.channel, 0, "case 2: webSpeech offers no channel grade — there is nothing to band-pass");
  assert.equal(webSupported.pace, CONDITIONS.pace.length - 1, "case 2: webSpeech still honours a rate, so pace is available");
  // webSpeech's voices are counted for the locale, not the whole machine — and
  // even so, accent/speakers are never offered (case 1).
  assert.equal(webSupported.accent, 0, "case 2: webSpeech offers no accent grade even with voices");
  assert.equal(webSupported.speakers, 0, "case 2: webSpeech offers no speakers grade even with voices");
}

// --- case 3: applyTo cannot be called with three variables -------------------
{
  const clip = fakeClip();
  // Type-level half: a third variable is refused by the type. This lives in a
  // function that is never called, so the `@ts-expect-error` is a compile-time
  // assertion, not a runtime call.
  function typeLevel() {
    // @ts-expect-error — a third active variable must not type-check
    applyTo(clip, [
      { variable: "pace", grade: 1 },
      { variable: "noise", grade: 1 },
      { variable: "channel", grade: 1 },
    ]);
  }
  void typeLevel;
  // Runtime half: a JS caller that slips past the type is still refused.
  assert.throws(
    () => applyTo(clip, [
      { variable: "pace", grade: 1 },
      { variable: "noise", grade: 1 },
      { variable: "channel", grade: 1 },
    ] as unknown as [Active, Active]),
    /at most two active variables/,
    "case 3: the runtime guard refuses a third variable",
  );
}

// --- case 4: the graph, not the sound ----------------------------------------
{
  // channel: "phone" — one band-pass in series with the source at 300–3400 Hz.
  resetAudio();
  contexts.length = 0;
  applyTo(fakeClip(), [{ variable: "channel", grade: 1 }]);
  const c1 = contexts[contexts.length - 1];
  const biquads = c1.nodes.filter((n) => n.kind === "biquad");
  assert.equal(biquads.length, 1, "case 4: channel requests exactly one band-pass");
  assert.equal(biquads[0].type, "bandpass", "case 4: the filter is a band-pass");
  assert.equal(biquads[0].frequency.value, PHONE_CENTER, "case 4: the band-pass centre is the plan's number");
  assert.equal(biquads[0].Q.value, PHONE_Q, "case 4: the band-pass Q is the plan's number");
  const source1 = c1.nodes.find((n) => n.kind === "source");
  assert(c1.edges.some(([a, b]) => a === source1 && b === biquads[0]), "case 4: the source feeds the band-pass");
  assert(c1.edges.some(([a, b]) => a === biquads[0] && b === c1.ctx.destination), "case 4: the band-pass feeds the destination");

  // noise — a gain node at the grade's ratio with a generated buffer, source
  // untouched, and the buffer source *started* (a never-started source is silence).
  resetAudio();
  contexts.length = 0;
  applyTo(fakeClip(), [{ variable: "noise", grade: 2 }]);
  const c2 = contexts[contexts.length - 1];
  const gains = c2.nodes.filter((n) => n.kind === "gain");
  assert.equal(gains.length, 1, "case 4: noise requests exactly one gain");
  assert.equal(gains[0].gain.value, NOISE_RATIO[2], "case 4: the gain is the grade's ratio");
  const buffers = c2.nodes.filter((n) => n.kind === "bufferSource");
  assert.equal(buffers.length, 1, "case 4: noise requests one generated buffer source");
  assert.equal(buffers[0].loop, true, "case 4: the noise buffer loops");
  assert(buffers[0].buffer, "case 4: the noise source carries a generated buffer");
  assert.equal(buffers[0].started, true, "case 4: the noise source is started — a never-started source is silence");
  const source2 = c2.nodes.find((n) => n.kind === "source");
  assert(c2.edges.some(([a, b]) => a === source2 && b === c2.ctx.destination), "case 4: the source path is untouched under noise");
  assert(c2.edges.some(([a, b]) => a === buffers[0] && b === gains[0]), "case 4: the noise buffer feeds its gain");
  assert(c2.edges.some(([a, b]) => a === gains[0] && b === c2.ctx.destination), "case 4: the noise gain feeds the destination");

  // release() takes the clip back out of the shared graph: the noise stops, and
  // the source node leaves. The context outlives the clip, so a source left
  // connected would keep every chapter's elements fanned into `destination`.
  resetAudio();
  contexts.length = 0;
  const releasable = applyTo(fakeClip(), [{ variable: "channel", grade: 1 }, { variable: "noise", grade: 1 }]);
  const c3 = contexts[contexts.length - 1];
  releasable.release();
  assert.equal(c3.nodes.find((n) => n.kind === "bufferSource").stopped, true, "case 4: release stops the noise source");
  assert.equal(c3.nodes.find((n) => n.kind === "source").disconnected, true, "case 4: release disconnects the element from the shared graph");
  assert.equal(c3.nodes.find((n) => n.kind === "biquad").disconnected, true, "case 4: release disconnects the band-pass too");

  // pace needs no graph at all — it is folded into the transport's rate door.
  resetAudio();
  contexts.length = 0;
  const paceClip = fakeClip();
  assert.equal(applyTo(paceClip, [{ variable: "pace", grade: 2 }]), paceClip, "case 4: pace returns the source untouched — no graph is built");
  assert.equal(contexts.length, 0, "case 4: pace builds no AudioContext");
  assert.equal(paceMultiplier([{ variable: "pace", grade: 2 }]), PACE_MULTIPLIER[2], "case 4: the pace multiplier is the plan's number");
  assert.equal(paceMultiplier([{ variable: "pace", grade: 1 }]), PACE_MULTIPLIER[1], "case 4: natural is a real multiplier, not grade 0");
  assert.equal(paceMultiplier([]), 1, "case 4: no pace grade is multiplier 1");
}

// --- case 5: grade 0 is today's Listen, byte for byte ------------------------
{
  const clip = fakeClip();
  assert.equal(applyTo(clip, []), clip, "case 5: no active variables returns the source untouched");
  assert.equal(applyTo(clip, []).duration, clip.duration, "case 5: the untouched clip keeps its duration");
  contexts.length = 0;
  const noisy = applyTo(fakeClip(), [{ variable: "noise", grade: 1 }]);
  assert.equal(noisy.duration, 3.5, "case 5: a noise grade does not change the clip's duration");
}

// --- case 5b: every supported grade produces an observable difference ---------
// The plan's name-bearing claim: a grade `supported` offers must actually change
// the audio. For each supported grade, assert the graph / multiplier it requests
// differs from grade 0 — a grade that does nothing is a grade that should not be
// offered.
{
  const tier = { can: { rate: true, voices: 1, filterable: true } };
  const max = supported(tier);
  // pace: each grade is a real multiplier, distinct from grade 0 and from each other.
  for (let g = 1; g <= max.pace; g++) {
    const m = paceMultiplier([{ variable: "pace", grade: g }]);
    assert(m !== 1, `case 5b: pace grade ${g} must be a real multiplier, not grade 0`);
    if (g > 1) assert(m !== paceMultiplier([{ variable: "pace", grade: g - 1 }]), `case 5b: pace grade ${g} must differ from grade ${g - 1}`);
  }
  // noise: each grade requests a gain at a non-zero ratio, distinct per grade.
  for (let g = 1; g <= max.noise; g++) {
    resetAudio();
    contexts.length = 0;
    applyTo(fakeClip(), [{ variable: "noise", grade: g }]);
    const c = contexts[contexts.length - 1];
    const gain = c.nodes.find((n) => n.kind === "gain");
    assert(gain && gain.gain.value > 0, `case 5b: noise grade ${g} must request a non-zero gain`);
    if (g > 1) {
      resetAudio();
      contexts.length = 0;
      applyTo(fakeClip(), [{ variable: "noise", grade: g - 1 }]);
      const prev = contexts[contexts.length - 1].nodes.find((n) => n.kind === "gain");
      assert(gain.gain.value !== prev.gain.value, `case 5b: noise grade ${g} must differ from grade ${g - 1}`);
    }
  }
  // channel: grade 1 requests a band-pass (grade 0 builds no graph).
  for (let g = 1; g <= max.channel; g++) {
    resetAudio();
    contexts.length = 0;
    applyTo(fakeClip(), [{ variable: "channel", grade: g }]);
    const c = contexts[contexts.length - 1];
    assert(c.nodes.some((n) => n.kind === "biquad"), `case 5b: channel grade ${g} must request a band-pass`);
  }
  // accent and speakers are never offered — nothing to assert a difference for.
  assert.equal(max.accent, 0, "case 5b: accent is not offered, so no grade to fake");
  assert.equal(max.speakers, 0, "case 5b: speakers is not offered, so no grade to fake");
}

// --- case 6: a wrong answer walks back the hardest active variable ------------
// Driven from the production path: render the real `useListening`, generate a
// piece, answer wrong, and walk back.
{
  const { register } = await import("node:module");
  const loader = new URL("./conditions.loader.mjs", import.meta.url).href;
  register(loader, import.meta.url);

  globalThis.window = globalThis;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.HTMLIFrameElement = function () {};

  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { useListening } = await import("./useListening.ts");
  const { defaultSettings } = await import("./settings.ts");
  const { clips } = await import("./conditions.mock-speech.mjs");

  const makeEl = (tag = "div") => ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
    appendChild(c: any) { this.children.push(c); return c; },
    removeChild(c: any) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    insertBefore(c: any, ref: any) { const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    setAttribute() {},
    removeAttribute() {},
  });

  const harness = (settings: any, onSettings?: (p: any) => void) => {
    let listening: any;
    function H() {
      listening = useListening(settings, onSettings);
      return React.createElement("div", null, "x");
    }
    const container = makeEl();
    const doc = makeEl();
    doc.createElement = (t: string) => makeEl(t);
    doc.createTextNode = (t: string) => ({ nodeType: 3, text: t });
    container.ownerDocument = doc;
    const root = createRoot(container);
    return {
      render: () => act(async () => { root.render(React.createElement(H)); }),
      listening: () => listening,
    };
  };

  // `generate` calls `prepareRef.current(0)` before the `pieceRef` effect has
  // landed, so no clips are made on the production path's first call. Drive
  // `prepare` explicitly after the piece is set — the point where `applyTo`
  // actually runs — so the behavioral cases exercise the real synthesis path.
  const prepareChapter = async (h: any) => {
    clips.length = 0;
    await act(async () => { await h.listening().prepare(0); });
    assert(clips.length > 0, "case 6-9: the production path really synthesised clips — applyTo ran on real clips");
  };

  // case 6: pace at 2 and noise at 1 — the hardest active is pace; a wrong
  // answer walks it back to 1 and replays the same chapter. The walk-back is
  // the consequence of the miss, not of a button.
  {
    const patches: any[] = [];
    const h = harness({ ...defaultSettings, listeningGrades: { pace: 2, noise: 1 } }, (p: any) => patches.push(p));
    await h.render();
    await act(async () => { await h.listening().generate({}); });
    // Drop the shared context so the production path builds a fresh one — the
    // graph `applyTo` requests is then observable here.
    resetAudio();
    contexts.length = 0;
    await prepareChapter(h);
    assert(contexts.length > 0, "case 6: applyTo ran on the production path — noise built a graph");
    assert(h.listening().piece, "case 6: a piece was generated");
    act(() => { h.listening().setAnswer(0, "Ana"); }); // wrong
    await act(async () => { await h.listening().check(); });
    const gradePatch = patches.find((p) => p.listeningGrades);
    assert(gradePatch, "case 6: a wrong answer persists a grade change");
    assert.equal(gradePatch.listeningGrades.pace, 1, "case 6: the hardest active variable (pace) walks back one grade");
    assert.equal(gradePatch.listeningGrades.noise, 1, "case 6: the other active variable is untouched");
    assert.equal(h.listening().chapterIdx, 0, "case 6: the same chapter index is returned — never skipped");
  }

  // case 6b: the miss survives its own consequence. Easing the grade must not
  // delete the thing that earned it — PLAN-026's miss panel renders on
  // `results[step] === false`, and `graded` is what the comprehension signals
  // are built from. A reset in the same tick as the result would wipe both, so
  // the comprehension number could only ever read 100%.
  {
    const patches: any[] = [];
    const h = harness({ ...defaultSettings, listeningGrades: { channel: 1, noise: 2 } }, (p: any) => patches.push(p));
    await h.render();
    await act(async () => { await h.listening().generate({}); });
    await prepareChapter(h);
    act(() => { h.listening().markHeard(); });
    act(() => { h.listening().setAnswer(0, "Ana"); }); // wrong
    await act(async () => { await h.listening().check(); });
    assert.equal(h.listening().progress.results[0], false, "case 6b: the miss is still recorded after the grade eased");
    assert.equal(h.listening().progress.heard, true, "case 6b: the chapter is still heard — the questions stay on screen");
    assert.equal(h.listening().graded.length, 1, "case 6b: the miss is still in graded — comprehension can read a miss");
    assert.equal(h.listening().graded[0].correct, false, "case 6b: and it is still a miss");
    assert.equal(patches.filter((p) => p.listeningGrades).length, 1, "case 6b: the miss eased exactly one grade");

    // The replay the miss earned resets the chapter — and does not ease a
    // second grade. One miss is one grade.
    await act(async () => { await h.listening().walkBackAndReplay(); });
    assert.equal(h.listening().progress.results[0], undefined, "case 6b: the replay clears the result for a second attempt");
    assert.equal(h.listening().progress.heard, false, "case 6b: the replay clears heard");
    assert.equal(patches.filter((p) => p.listeningGrades).length, 1, "case 6b: the replay after a miss does not ease a second grade");
  }

  // case 6c: at grade 0 a miss is exactly today's Listen. Nothing is active, so
  // nothing eases — and nothing may be reset either. Every learner starts here.
  {
    const patches: any[] = [];
    const h = harness({ ...defaultSettings, listeningGrades: {} }, (p: any) => patches.push(p));
    await h.render();
    await act(async () => { await h.listening().generate({}); });
    await prepareChapter(h);
    act(() => { h.listening().markHeard(); });
    act(() => { h.listening().setAnswer(0, "Ana"); }); // wrong
    await act(async () => { await h.listening().check(); });
    assert.equal(h.listening().progress.results[0], false, "case 6c: grade 0 — the miss stands");
    assert.equal(h.listening().progress.answers[0], "Ana", "case 6c: grade 0 — the answer stands");
    assert.equal(h.listening().progress.heard, true, "case 6c: grade 0 — the chapter is still heard");
    assert.equal(h.listening().graded.length, 1, "case 6c: grade 0 — the miss is in graded");
    assert.equal(patches.filter((p) => p.listeningGrades).length, 0, "case 6c: grade 0 — nothing to ease, so nothing is persisted");
  }

  // case 7: walking back from grade 1 reaches 0 and stops; never skipped, never abandoned.
  {
    const patches: any[] = [];
    const h = harness({ ...defaultSettings, listeningGrades: { pace: 1 } }, (p: any) => patches.push(p));
    await h.render();
    await act(async () => { await h.listening().generate({}); });
    await prepareChapter(h);
    // Ten misses deep — each miss alone walks the grade back and replays.
    for (let i = 0; i < 10; i++) {
      act(() => { h.listening().setAnswer(0, "Ana"); });
      await act(async () => { await h.listening().check(); });
    }
    const gradePatches = patches.filter((p) => p.listeningGrades);
    assert.equal(gradePatches.length, 1, "case 7: only the first walk-back changes a grade — grade 1 reaches 0 and stops");
    assert.equal(gradePatches[0].listeningGrades.pace, 0, "case 7: walking back from grade 1 reaches grade 0");
    assert(h.listening().piece, "case 7: the piece is never abandoned");
    assert.equal(h.listening().finished, false, "case 7: the activity is never marked finished/skipped");
    assert.equal(h.listening().chapterIdx, 0, "case 7: the chapter is never skipped");
  }

  // case 8: a correct answer hardens at most one variable by one grade.
  {
    const patches: any[] = [];
    const h = harness({ ...defaultSettings, listeningGrades: { pace: 1 } }, (p: any) => patches.push(p));
    await h.render();
    await act(async () => { await h.listening().generate({}); });
    await prepareChapter(h);
    act(() => { h.listening().setAnswer(0, "Luis"); }); // correct
    await act(async () => { await h.listening().check(); });
    act(() => { h.listening().nextQuestion(); });
    act(() => { h.listening().setAnswer(1, "cuenta"); }); // correct
    await act(async () => { await h.listening().check(); });
    await act(async () => { await h.listening().next(); });
    const gradePatch = patches.find((p) => p.listeningGrades);
    assert(gradePatch, "case 8: a correct chapter hardens a grade");
    const changed = Object.entries(gradePatch.listeningGrades).filter(([, v]) => v > 0);
    assert.equal(changed.length, 1, "case 8: at most one variable hardens");
    assert.equal(changed[0][1], 2, "case 8: the hardened variable rises by exactly one grade");
  }

  // case 8b: a successful replay does not immediately re-harden the variable
  // that was just walked back.
  {
    const patches: any[] = [];
    const h = harness({ ...defaultSettings, listeningGrades: { pace: 2, noise: 1 } }, (p: any) => patches.push(p));
    await h.render();
    await act(async () => { await h.listening().generate({}); });
    await prepareChapter(h);
    // Miss → pace walks back to 1. The miss stays on screen (case 6b), so the
    // second attempt begins where the learner begins it: at the replay.
    act(() => { h.listening().setAnswer(0, "Ana"); });
    await act(async () => { await h.listening().check(); });
    await act(async () => { await h.listening().walkBackAndReplay(); });
    // Replay the same chapter correctly — the just-walked-back pace must not
    // be re-hardened; the other active variable (noise) may be.
    act(() => { h.listening().setAnswer(0, "Luis"); });
    await act(async () => { await h.listening().check(); });
    act(() => { h.listening().nextQuestion(); });
    act(() => { h.listening().setAnswer(1, "cuenta"); });
    await act(async () => { await h.listening().check(); });
    await act(async () => { await h.listening().next(); });
    const gradePatches = patches.filter((p) => p.listeningGrades);
    const last = gradePatches[gradePatches.length - 1];
    assert(last, "case 8b: a correct replay hardens a grade");
    assert.equal(last.listeningGrades.pace, 1, "case 8b: the just-walked-back pace is not re-hardened");
    assert.equal(last.listeningGrades.noise, 2, "case 8b: the other active variable hardens instead");
  }

  // case 9: a replay clears the chapter's answers and its heard flag.
  {
    const h = harness({ ...defaultSettings, listeningGrades: { pace: 1 } }, () => {});
    await h.render();
    await act(async () => { await h.listening().generate({}); });
    await prepareChapter(h);
    act(() => { h.listening().markHeard(); });
    act(() => { h.listening().setAnswer(0, "Luis"); });
    assert.equal(h.listening().progress.heard, true, "case 9: the chapter was heard");
    assert.equal(h.listening().progress.answers[0], "Luis", "case 9: an answer was given");
    await act(async () => { await h.listening().walkBackAndReplay(); });
    assert.equal(h.listening().progress.heard, false, "case 9: a replay clears the heard flag");
    assert.equal(h.listening().progress.answers[0], "", "case 9: a replay clears the answers");
  }
}

// --- case 10: the walk-back signal is not a miss ------------------------------
// Assert the metric, not just the predicate: comprehension is byte-identical
// across ten walk-backs.
{
  const at = 1_000_000_000_000;
  const walk = (i: number) => ({
    id: `w${i}`,
    activityId: "a1",
    kind: "listenWalkBack" as const,
    observedAt: at,
    payload: { label: "listening pace", variable: "pace", from: 2 },
  });
  const comp = (correct: boolean, i: number) => ({
    id: `c${i}`,
    activityId: "a1",
    kind: "comprehension" as const,
    observedAt: at,
    payload: { label: "listening comprehension", correct },
  });
  const withWalk = [...Array(10).keys()].map(walk).concat([comp(true, 0), comp(false, 1)]);
  const withoutWalk = [comp(true, 0), comp(false, 1)];
  for (const w of withWalk.filter((s) => s.kind === "listenWalkBack")) {
    assert.equal(signalMiss(w), false, "case 10: a walk-back is never a miss");
  }
  const m1 = coachMetrics(withWalk, at);
  const m2 = coachMetrics(withoutWalk, at);
  const c1 = m1.find((m) => m.id === "comprehension")!;
  const c2 = m2.find((m) => m.id === "comprehension")!;
  assert.equal(c1.value, c2.value, "case 10: comprehension value is byte-identical across ten walk-backs");
  assert.equal(c1.sample, c2.sample, "case 10: comprehension sample is byte-identical across ten walk-backs");
}

// --- case 11: Listening.tsx renders only supported grades --------------------
// Probed with a seeded violation so a scan that silently matches nothing fails.
{
  const src = readFileSync(`${ROOT}src/views/Listening.tsx`, "utf8");
  assert(/listening\.maxGrades/.test(src), "case 11: Listening.tsx reads the supported grades");
  assert(/listening\.active/.test(src), "case 11: Listening.tsx reads the active set");
  const hardcoded = /CONDITIONS\.\w+\[\d\]/;
  assert(!hardcoded.test(src), "case 11: no hardcoded grade index in Listening.tsx");
  const probe = join(tmpdir(), "conditions.probe.tsx");
  writeFileSync(probe, "const x = CONDITIONS.pace[2];");
  try {
    assert(hardcoded.test(readFileSync(probe, "utf8")), "case 11 probe: the scan catches a hardcoded grade");
  } finally {
    unlinkSync(probe);
  }
}

// --- case 12: listeningGrades is persisted, round-trips, and in no panel ------
{
  assert.deepEqual(defaultSettings.listeningGrades, {}, "case 12: listeningGrades is in defaultSettings");
  let store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
  saveSettings({ ...defaultSettings, listeningGrades: { pace: 2 } });
  const loaded = loadSettings();
  assert.deepEqual(loaded.listeningGrades, { pace: 2 }, "case 12: listeningGrades survives a settings round-trip");

  // No settings panel reads it — the same scan difficultyStep carries.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) out.push(...walk(p));
      else if (e.endsWith(".tsx")) out.push(p);
    }
    return out;
  };
  const reading = walk(join(ROOT, "src/views")).filter((f) => /listeningGrades/.test(readFileSync(f, "utf8")));
  assert(reading.length === 0, `case 12: a settings panel reads listeningGrades:\n${reading.join("\n")}`);
}

console.log("conditions.check: ok");

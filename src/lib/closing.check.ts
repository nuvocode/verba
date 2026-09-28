// A session that is closing belongs to `end()` until it is closed.
//
// `end()` awaits the model several times — vocabulary, summary, the self-repair
// pass, memory — and reads the session's refs (`sessionId`, `voice`, `history`,
// `produced` …) after those awaits. The reflection screen offered "New scenario"
// while it still said "Looking back…", and a `start` landing there reset every
// one of those refs: the summary was filed under the new session's row, and the
// spoken turns were gone before the self-repair pass could read them, so the
// session measured nothing. Found in PLAN-041's hand sample, where a six-turn
// session left no trace.
//
// Behavioural, through the real hook: the mock provider is parked inside
// `end()`'s first model call, and the check tries to open another session from
// there. Removing the `closing` guard from `start` turns this red.
// Run: node --experimental-strip-types src/lib/closing.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const { register } = await import("node:module");
register(new URL("./rehearsal.loader.mjs", import.meta.url).href, import.meta.url);

// The client renderer, as in brought.check.ts: `end()`'s effects are React
// state, and only the client renderer commits them.
Object.assign(globalThis, { window: globalThis, IS_REACT_ACT_ENVIRONMENT: true, HTMLIFrameElement: function () {} });
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { useTalk } = await import("./useTalk.ts");
const { defaultSettings } = await import("./settings.ts");
const { calls, gate } = await import("./rehearsal.mock-providers.mjs");
const { created } = await import("./rehearsal.mock-db.mjs");
const { heard } = await import("./rehearsal.mock-speech.mjs");

// The wait machine's timers are captured and fired inside `act`, as the other
// hook checks do, so no state update lands outside one.
const timers: (() => void)[] = [];
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = ((fn: () => void) => {
  timers.push(fn);
  return timers.length;
}) as typeof globalThis.setTimeout;
globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout;
const fireTimers = () => {
  for (const fn of timers.splice(0)) {
    try {
      fn();
    } catch {
      /* a timer that re-arms is fine */
    }
  }
};
// Let `end()` run up to the parked model call.
const ticks = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const makeEl = (tag = "div"): any => ({
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

const settings = { ...defaultSettings, provider: "ollama" as const, monitorLoad: true };
const scenario = { id: "free", title: "Free talk", emoji: "💬", setup: "Talk about anything.", persona: { name: "Marta", role: "a friendly conversation partner", emoji: "🧑‍🏫" } };
const SAID = "I go— I went home early yesterday.";

let talk: ReturnType<typeof useTalk> | undefined;
function H() {
  talk = useTalk(settings);
  return React.createElement("div", null, "x");
}
const container = makeEl();
const doc = makeEl();
doc.createElement = (t: string) => makeEl(t);
doc.createTextNode = (t: string) => ({ nodeType: 3, text: t });
container.ownerDocument = doc;
const root = createRoot(container);

try {
  await act(async () => { root.render(React.createElement(H)); });

  // One spoken turn, through the mic path, so `voice` has something to lose.
  await act(async () => { await talk!.start(scenario); fireTimers(); });
  heard.push({ text: SAID, ms: 2400, levels: Array(48).fill(0.2) });
  await act(async () => { await talk!.mic(); fireTimers(); });
  await act(async () => { await talk!.send(SAID); fireTimers(); });
  assert.equal(created.length, 1, "setup: one session opened");

  // Close it, and park the model inside the wrap-up's first call.
  let release!: () => void;
  gate.hold = new Promise<void>((r) => { release = r; });
  calls.length = 0;
  let ending!: Promise<void>;
  await act(async () => { ending = talk!.end(); await ticks(); });
  assert.equal(calls.length, 1, "setup: end() is parked in its first model call");

  // 1. A new session cannot be opened under a closing one.
  // Not awaited: without the guard, `start` would itself park on the gate, and
  // the check must fail on the assertion rather than hang.
  await act(async () => { void talk!.start(scenario); await ticks(); });
  assert.equal(created.length, 1, "start() while end() is running opens no session");
  assert.equal(calls.length, 1, "start() while end() is running sends nothing to the model");

  // 2. Nor can the closing one be dropped out from under the reflection.
  await act(async () => { talk!.reset(); await ticks(); });
  assert.equal(talk!.started, true, "reset() while end() is running keeps the closing session");

  // 3. Once released, the wrap-up still has the session it started with: the
  //    self-repair pass is sent the spoken turn.
  gate.hold = null;
  release();
  await act(async () => { await ending; fireTimers(); });
  const production = calls.find((c) => c.messages[0]?.content?.includes("interrupted themselves"));
  assert(production, "the self-repair pass runs after the parked call — the spoken turn survived");
  assert(production.messages[0].content.includes(SAID), "the self-repair pass reads the closing session's own transcript");
  assert(talk!.reflection, "the reflection lands");

  // 4. And the guard lets go: after the wrap-up, a new session opens.
  await act(async () => { await talk!.start(scenario); fireTimers(); });
  assert.equal(created.length, 2, "start() after end() has finished opens a session");
} finally {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}

// The reflection screen's "New scenario" is disabled while the wrap-up is
// written — the guard above holds either way; this is so the button says so.
{
  const src = readFileSync(`${ROOT}src/views/Talk.tsx`, "utf8");
  assert(/onClick=\{talk\.reset\} disabled=\{talk\.busy\}/.test(src), "New scenario is disabled while the reflection is being written");
}

console.log("closing.check: ok");

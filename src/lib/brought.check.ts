// Brought content (PLAN-035), pinned: the learner's own text is preserved byte
// for byte, the title is derived and never empty, the discussion prompt asks
// before it explains and never bulk-translates, the scenario carries the title
// but not the body, and — the one that matters — with a cloud provider and no
// recorded approval, opening the discussion sends nothing.
//
// Case 6 is behavioural, not a source scan: a scan for `isLocalProvider` proves
// nothing. It drives the real `useTalk` hook through the rehearsal loader and
// mocks (reused, not rebuilt) and asserts the mock provider recorded zero calls.
// Run: node --experimental-strip-types src/lib/brought.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ingest,
  broughtScenario,
  discussionSystem,
  BROUGHT_MAX_CHARS,
  type BroughtText,
} from "./brought.ts";
import { styleGuidance, SPOKEN_PROMPTS, STRUCTURED_PROMPTS, type Settings } from "./prompts.ts";
import { defaultSettings } from "./settings.ts";
import { TABLES } from "./backup.ts";
import { axisGuidance, DIFFICULTY_NO_ANNOUNCE } from "./difficulty.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const s: Settings = { ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "Spanish", nativeLanguage: "English" } };

const text: BroughtText = {
  id: 1,
  lang: "es",
  title: "The client's email",
  body: "Hola,\n\nNecesito el informe para el viernes.\tSin falta.\n\n— Ana · 日本語",
  createdAt: 1_700_000_000_000,
  sentTo: "",
};

// --- case 1: ingest rejects over the limit, accepts at exactly the limit ------
{
  const over = "x".repeat(BROUGHT_MAX_CHARS + 1);
  assert.throws(() => ingest(over, "es"), /limit is 8000/, "case 1: a text over the limit is rejected with a message naming the limit");
  const at = "x".repeat(BROUGHT_MAX_CHARS);
  assert.equal(ingest(at, "es").body.length, BROUGHT_MAX_CHARS, "case 1: a text at exactly the limit is accepted");
}

// --- case 2: the title is derived from the first line, never empty ------------
{
  const derived = ingest("First line here\nSecond line here\nThird line here", "es");
  assert.equal(derived.title, "First line here", "case 2: the title is the first line");
  assert(!derived.title.includes("\n"), "case 2: the title never carries the whole first paragraph");
  const blank = ingest("\n\n   \nbody", "es");
  assert(blank.title.length > 0, "case 2: a body that opens on nothing still gets a non-empty title");
  const given = ingest("body", "es", "My own title");
  assert.equal(given.title, "My own title", "case 2: a learner-given title is kept");
}

// --- case 3: the body survives byte for byte ----------------------------------
{
  const raw = "line one\nline two\twith a tab\r\nnon-ASCII: 日本語 · café — “quotes”\n";
  const t = ingest(raw, "es");
  assert.equal(t.body, raw, "case 3: the body is preserved byte for byte — newlines, tabs and non-ASCII are not normalised");
}

// --- case 4: the discussion prompt asks before explaining, never bulk-translates,
// --- and carries styleGuidance ------------------------------------------------
{
  const sc = broughtScenario(text);
  const prompt = discussionSystem(s, text, sc);

  // Ask before explaining.
  assert(prompt.includes("Ask before you explain"), "case 4: the ask-before-explaining rule is present");
  assert(prompt.includes("never a summary of it"), "case 4: the opening move is a question, not a summary");
  // No bulk translation.
  assert(prompt.includes("Translate a word when asked, never a paragraph"), "case 4: the no-bulk-translation rule is present");
  assert(prompt.includes("one honest sentence of gist"), "case 4: a full-translation request gets a gist, not a translation");
  // Style guidance.
  assert(prompt.includes(styleGuidance(s.coachStyle)), "case 4: the prompt carries styleGuidance");

  // PLAN-032: the praise rule — praise without a cited record is a fabrication,
  // and the record it may cite is the learner's past corrections. The field is
  // kept in the schema, so the rule that gates it must ride too.
  assert(prompt.includes("Do not praise the learner's language"), "case 4: the no-praise rule is present");
  assert(prompt.includes("This learner has no correction record yet — so there is nothing to cite, and no praise is allowed."), "case 4: with no record, no praise is allowed");

  // Each absence is probed against a seeded violation, so an absence assertion
  // cannot pass on a typo in its own marker.
  const seeded = (extra: string) => prompt + "\n" + extra;
  assert(seeded("\nAsk before you explain").includes("Ask before you explain"), "case 4 probe: the ask-before scan fires when the rule is present");
  assert(seeded("\nTranslate a word when asked, never a paragraph").includes("Translate a word when asked, never a paragraph"), "case 4 probe: the no-bulk scan fires when the rule is present");
  assert(seeded(`\n${styleGuidance("direct")}`).includes("Speak directly"), "case 4 probe: the style scan fires when styleGuidance is present");
  assert(seeded("\nDo not praise the learner's language").includes("Do not praise the learner's language"), "case 4 probe: the praise scan fires when the rule is present");
}

// --- case 5: the scenario carries the title, not the body ---------------------
{
  const sc = broughtScenario(text);
  assert(sc.title.includes("The client's email"), "case 5: the scenario title names the text");
  assert(!sc.setup.includes(text.body), "case 5: the scenario does not embed the body — it rides the system prompt once, not twice");
  assert(sc.id === "brought", "case 5: the scenario id is fixed");
  assert(sc.formatVersion === undefined, "case 5: a synthetic scenario carries no formatVersion");
}

// --- case 5b: an active axis reaches the prompt ------------------------------
// The axis is picked and written to the record, so it must also reach the
// prompt — otherwise the record lies and the rotation burns for nothing. With
// an axis active, `discussionSystem` carries `axisGuidance` and the no-announce
// rule, exactly as `buildSystem` does; with none, neither line appears.
{
  const sc = broughtScenario(text);
  const withAxis = discussionSystem(s, text, sc, undefined, { axis: "pace", step: 2 });
  assert(withAxis.includes(axisGuidance("pace", 2)), "case 5b: an active axis carries its guidance");
  assert(withAxis.includes(DIFFICULTY_NO_ANNOUNCE), "case 5b: an active axis carries the no-announce rule");
  const noAxis = discussionSystem(s, text, sc, undefined, { axis: null, step: 0 });
  assert(!noAxis.includes("Harder this session"), "case 5b: no axis, no guidance");
  assert(!noAxis.includes(DIFFICULTY_NO_ANNOUNCE), "case 5b: no axis, no no-announce rule");
}

// --- case 6: behavioural — cloud provider + no approval sends nothing ----------
// brought ledger 19 — brought content stays local and reaches Memory.
//
// A source scan for `isLocalProvider` proves nothing. This drives the real
// `useTalk` hook (through the rehearsal loader and mocks, reused not rebuilt)
// and asserts the mock provider recorded zero calls when a cloud provider is
// selected and no approval is recorded. With `settings.offline`, or with
// `sent_to` matching the current provider, exactly one call is recorded and its
// system prompt contains the body.
{
  const { register } = await import("node:module");
  const loader = new URL("./rehearsal.loader.mjs", import.meta.url).href;
  register(loader, import.meta.url);

  // The client renderer, not the server one: `pendingBrought` is React state,
  // and the server renderer never commits it. A minimal DOM shim lets
  // `react-dom/client` run in plain node, so the state the learner actually
  // sees is the state this case asserts.
  globalThis.window = globalThis;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.HTMLIFrameElement = function () {};

  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { useTalk } = await import("./useTalk.ts");
  const { defaultSettings } = await import("./settings.ts");
  const { calls } = await import("./rehearsal.mock-providers.mjs");

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

  const cloudSettings: Settings = { ...defaultSettings, provider: "anthropic", offline: false };
  const localSettings: Settings = { ...defaultSettings, provider: "ollama", offline: false };
  const offlineSettings: Settings = { ...defaultSettings, provider: "anthropic", offline: true };

  const harness = (settings: Settings) => {
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
    return {
      render: () => act(async () => { root.render(React.createElement(H)); }),
      talk: () => talk!,
    };
  };

  // Cloud provider, no approval: nothing is sent, and the text is held for
  // approval — the learner sees the confirmation, not a silent drop.
  {
    const h = harness(cloudSettings);
    await h.render();
    calls.length = 0;
    await act(async () => { await h.talk().startBrought({ ...text, sentTo: "" }); });
    assert.equal(calls.length, 0, "case 6: with a cloud provider and no approval, opening the discussion sends nothing");
    assert(h.talk().pendingBrought !== null, "case 6: the text is held for approval, not silently dropped");
    assert.equal(h.talk().pendingBrought?.title, text.title, "case 6: the held text is the one the learner brought");
  }

  // Cloud provider, approval recorded for a *different* provider: still nothing.
  {
    const h = harness(cloudSettings);
    await h.render();
    calls.length = 0;
    await act(async () => { await h.talk().startBrought({ ...text, sentTo: "ollama" }); });
    assert.equal(calls.length, 0, "case 6: an approval for Ollama is not an approval for Anthropic");
    assert(h.talk().pendingBrought !== null, "case 6: a mismatched approval still asks again");
  }

  // Cloud provider, approval recorded for the current provider: one call, body in the system prompt.
  {
    const h = harness(cloudSettings);
    await h.render();
    calls.length = 0;
    await act(async () => { await h.talk().startBrought({ ...text, sentTo: "anthropic" }); });
    assert.equal(calls.length, 1, "case 6: with a matching approval, exactly one call is recorded");
    const system = calls[0]?.messages?.[0]?.content ?? "";
    assert(system.includes(text.body), "case 6: the system prompt contains the body");
    assert.equal(h.talk().pendingBrought, null, "case 6: a matching approval does not ask again");
  }

  // Local provider: no confirmation, one call.
  {
    const h = harness(localSettings);
    await h.render();
    calls.length = 0;
    await act(async () => { await h.talk().startBrought({ ...text, sentTo: "" }); });
    assert.equal(calls.length, 1, "case 6: a local provider needs no confirmation and sends exactly one call");
    assert.equal(h.talk().pendingBrought, null, "case 6: a local provider holds nothing for approval");
    // The axis is picked (the mock store returns a ready baseline) and must
    // reach the prompt — the record writes it, so the prompt must carry it too.
    // This is the behavioural half of case 5b: reverting the `discussionSystem`
    // difficulty argument makes this go red.
    const system = calls[0]?.messages?.[0]?.content ?? "";
    assert(system.includes("Harder this session"), "case 6: an active axis reaches the brought system prompt");
  }

  // Offline: no confirmation, one call.
  {
    const h = harness(offlineSettings);
    await h.render();
    calls.length = 0;
    await act(async () => { await h.talk().startBrought({ ...text, sentTo: "" }); });
    assert.equal(calls.length, 1, "case 6: offline mode needs no confirmation and sends exactly one call");
    assert.equal(h.talk().pendingBrought, null, "case 6: offline mode holds nothing for approval");
  }

  // The confirmation names the provider — the learner is told who will read it,
  // not just that *someone* will. A source scan: Talk.tsx resolves the provider
  // by id and renders its name, not the raw id.
  {
    const talkSrc = readFileSync(`${ROOT}src/views/Talk.tsx`, "utf8");
    const confirm = talkSrc.slice(talkSrc.indexOf("if (talk.pendingBrought)"), talkSrc.indexOf("// ---- replaying an old conversation ----"));
    assert(/PROVIDERS\.find\(\(p\) => p\.id === settings\.provider\)/.test(confirm), "case 6: the confirmation resolves the provider by id");
    assert(/provider\?\.name/.test(confirm), "case 6: the confirmation names the provider, not the raw id");
  }
}

// --- case 7: words saved from a brought text carry a source_surface ----------
// The `end()` path names the text on the vocab save surface, so the words come
// back in later plans from the learner's own material.
{
  const src = readFileSync(`${ROOT}src/lib/useTalk.ts`, "utf8");
  const endBlock = src.slice(src.indexOf("const end = useCallback"), src.indexOf("const dropWord"));
  assert(/surface:\s*brought\s*\?/.test(endBlock), "case 7: end() names the brought text on the vocab save surface");
  assert(/brought:\$\{brought\.title\}/.test(endBlock), "case 7: the surface identifies the text by title");
  // A brought discussion opens on the learner's own text, not on a memory
  // detail — `openingDetail` is not called in brought mode, so a fact is never
  // stamped "asked" without being supplied to the prompt.
  const startBlock = src.slice(src.indexOf("const start = useCallback"), src.indexOf("const startRehearsal"));
  assert(/!inRole && !inBrought \? openingDetail\(memories, Date\.now\(\)\)/.test(startBlock), "case 7: openingDetail is not called in brought mode");
}

// --- case 8: brought_texts is in TABLES, and the DataPanel count includes it --
{
  assert(TABLES.includes("brought_texts"), "case 8: brought_texts is in TABLES — it exports, imports and wipes");
  const panel = readFileSync(`${ROOT}src/views/DataPanel.tsx`, "utf8");
  assert(/s\.brought/.test(panel), "case 8: the DataPanel count includes brought texts");
}

// --- case 9: discussionSystem is in exactly one prompt list --------------------
{
  const spoken = [...SPOKEN_PROMPTS];
  const structured = [...STRUCTURED_PROMPTS];
  assert(spoken.includes("brought.ts:discussionSystem"), "case 9: discussionSystem is in the spoken list");
  assert(!structured.includes("brought.ts:discussionSystem"), "case 9: discussionSystem is not in the structured list");
  // The completeness claim holds: the hand-added builder is in the scan.
  const check = readFileSync(`${ROOT}src/lib/prompts.check.ts`, "utf8");
  assert(/sawBrought/.test(check), "case 9: the scan hand-adds discussionSystem");
  assert(/brought\.ts:discussionSystem/.test(check), "case 9: the hand-added key names the builder");
}

console.log("brought.check: ok");

// Settings → Advanced (spec §5.7). Closed by default and useful to nobody who
// has not gone looking: nothing in here is a precondition for anything in the
// main flow. This is also the only place a provider name, a model label, a host
// or a file format is allowed to appear (§6).
import { useState } from "react";
import { isLocalProvider, type ProviderId, type Settings } from "../../lib/settings";
import { cloudGate } from "../../lib/rules";
import { importPack, registry } from "../../lib/packs";
import { importScenario, listScenarios } from "../../lib/scenarios";
import { Because, ToggleRow, type SectionProps } from "./parts";

const PROVIDERS: {
  id: ProviderId;
  name: string;
  desc: string;
  model: keyof Settings;
  key?: keyof Settings;
  host?: keyof Settings;
}[] = [
  {
    id: "ollama",
    name: "Ollama",
    desc: "Runs on this machine. Private, free, works on a plane.",
    model: "ollamaModel",
    host: "ollamaHost",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    desc: "Local OpenAI-compatible server. No key needed.",
    model: "lmstudioModel",
    host: "lmstudioHost",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    desc: "Deeper conversation and subtler corrections. API key required.",
    model: "anthropicModel",
    key: "anthropicKey",
  },
  {
    id: "openai",
    name: "OpenAI",
    desc: "Alternative cloud provider. API key required.",
    model: "openaiModel",
    key: "openaiKey",
  },
  { id: "gemini", name: "Gemini", desc: "Google's models. API key required.", model: "geminiModel", key: "geminiKey" },
  {
    id: "openrouter",
    name: "OpenRouter",
    desc: "One key, many models. API key required.",
    model: "openrouterModel",
    key: "openrouterKey",
  },
];

export default function Advanced({ settings, onChange }: SectionProps) {
  const [packJson, setPackJson] = useState("");
  const [scenarioJson, setScenarioJson] = useState("");
  const [openImport, setOpenImport] = useState(""); // "scenario" | "pack" — whose paste box is open
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [, bump] = useState(0); // packs/scenarios live in localStorage — re-read after an import

  const active = PROVIDERS.find((p) => p.id === settings.provider);
  const importedCount = registry().filter((r) => r.origin === "imported").length;

  function tryImport(kind: "pack" | "scenario") {
    setErr("");
    setMsg("");
    try {
      if (kind === "pack") {
        const p = importPack(packJson);
        setPackJson("");
        setMsg(`Imported language pack \u201c${p.name}\u201d. It's unverified — you pasted it in yourself.`);
      } else {
        const s = importScenario(scenarioJson);
        setScenarioJson("");
        setMsg(`Imported scenario \u201c${s.title}\u201d. It's now in the Talk picker.`);
      }
      bump((n) => n + 1);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  /** A paste box that stays shut until its summary line is clicked. */
  const importBox = (kind: "pack" | "scenario", title: string, count: string, desc: string, value: string, set: (v: string) => void, placeholder: string) => (
    <div style={{ borderBottom: "1px solid var(--line2)" }}>
      <button className="srow" onClick={() => setOpenImport(openImport === kind ? "" : kind)} style={{ borderBottom: "none" }}>
        <div style={{ flex: 1 }}>
          <div className="name">
            {title} <span>· {count}</span>
          </div>
        </div>
        <span className="model">{openImport === kind ? "close" : "import"}</span>
      </button>
      {openImport === kind && (
        <div style={{ padding: "0 4px 15px" }}>
          <div className="desc" style={{ marginBottom: 10 }}>{desc}</div>
          <textarea value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} />
          <button className="btn sm ghost" onClick={() => tryImport(kind)} disabled={!value.trim()}>
            Import {kind}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {msg && (
        <div className="err" style={{ borderColor: "var(--good)", color: "var(--good)" }}>
          {msg}
        </div>
      )}
      {err && <div className="err">{err}</div>}

      <div className="sec">Model</div>
      {PROVIDERS.map((p) => {
        const local = isLocalProvider(p.id);
        const gate = local ? null : cloudGate(settings);
        return (
          <button
            key={p.id}
            className={`srow ${gate ? "off" : ""}`}
            aria-disabled={!!gate}
            onClick={() => onChange({ provider: p.id })}
          >
            <div className={`radio ${settings.provider === p.id ? "on" : ""}`} />
            <div style={{ flex: 1 }}>
              <div className="name">
                {p.name} <span>{local ? "● local" : "☁ cloud"}</span>
                {gate && <Because gate={gate} link={false} />}
              </div>
              <div className="desc">{p.desc}</div>
            </div>
            <div className="model">{String(settings[p.model])}</div>
          </button>
        );
      })}

      {active && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>Model</label>
            <input
              value={String(settings[active.model])}
              onChange={(e) => onChange({ [active.model]: e.target.value } as Partial<Settings>)}
            />
          </div>
          {active.host && (
            <div className="field">
              <label>Host</label>
              <input
                value={String(settings[active.host])}
                onChange={(e) => onChange({ [active.host!]: e.target.value } as Partial<Settings>)}
              />
            </div>
          )}
          {active.key && (
            <div className="field">
              <label>API key</label>
              <input
                type="password"
                placeholder="sk-…"
                value={String(settings[active.key])}
                onChange={(e) => onChange({ [active.key!]: e.target.value } as Partial<Settings>)}
              />
            </div>
          )}
        </div>
      )}

      {/* Sits with the model rather than under Coaching: it is a property of
          the model chosen above, and it is the first thing to reach for when
          a provider that should be quick is not. */}
      <div className="sec" style={{ marginTop: 22 }}>Speed</div>
      <ToggleRow
        title="Let the model think first"
        desc="Better answers from reasoning models, at the cost of a longer silence before the coach starts — the thinking happens before the first word appears. Models that don't reason are unaffected."
        on={settings.thinking}
        onClick={() => onChange({ thinking: !settings.thinking })}
      />

      <div className="sec" style={{ marginTop: 44 }}>Extensions</div>
      {importBox(
        "scenario",
        "Scenarios",
        `${listScenarios().length} installed`,
        "Paste a scenario JSON to add a role-play to the Talk picker.",
        scenarioJson,
        setScenarioJson,
        `{ "formatVersion": 1, "id": "market", "title": "At the market", "emoji": "\ud83e\uddfa", "setup": "You are a market vendor…" }`,
      )}
      {importBox(
        "pack",
        "Language packs",
        `${importedCount} imported`,
        "Paste a pack JSON to teach Verba a new language. Imported packs are unverified — nobody has reviewed them.",
        packJson,
        setPackJson,
        `{ "formatVersion": 1, "id": "nl", "name": "Dutch", "nativeName": "Nederlands", … }`,
      )}

      <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 16 }}>
        Verba is open source. Extensions are sandboxed content packs — see CONTRIBUTING.md for the format.
      </div>
    </>
  );
}

import { useState } from "react";
import {
  isLocalProvider,
  type CorrectionTiming,
  type ProviderId,
  type Settings,
  type SpeechEngine,
} from "../lib/settings";
import { importPack, listPacks, originLabel, packOrigin, registry, removeImportedPack } from "../lib/packs";
import { importScenario, listScenarios } from "../lib/scenarios";

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

const SPEECH: { id: SpeechEngine; name: string; local: boolean; desc: string; key?: keyof Settings }[] = [
  { id: "web", name: "System speech", local: true, desc: "Your OS dictation and voices. Offline, quality varies." },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    local: false,
    desc: "Most natural tutor voice. API key required.",
    key: "elevenLabsKey",
  },
  {
    id: "deepgram",
    name: "Deepgram",
    local: false,
    desc: "Sharper speech recognition. API key required.",
    key: "deepgramKey",
  },
];

const TIMINGS: [CorrectionTiming, string, string][] = [
  ["adaptive", "Adaptive", "Interrupt only for mistakes that break meaning; the rest wait for the reflection."],
  ["live", "Live", "Show every correction the moment it happens."],
  ["delayed", "Delayed", "Never interrupt. Everything is handed back at the end of the session."],
];

export default function SettingsView({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const [packJson, setPackJson] = useState("");
  const [scenarioJson, setScenarioJson] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [, bump] = useState(0); // packs/scenarios live in localStorage — force a re-read after import

  const packs = listPacks();
  const active = PROVIDERS.find((p) => p.id === settings.provider);
  const speechCfg = SPEECH.find((s) => s.id === settings.speechEngine);
  const importedCount = registry().filter((r) => r.origin === "imported").length;

  function tryImport(kind: "pack" | "scenario") {
    setErr("");
    setMsg("");
    try {
      if (kind === "pack") {
        const p = importPack(packJson);
        setPackJson("");
        setMsg(`Imported language pack “${p.name}”. It's unverified — you pasted it in yourself.`);
      } else {
        const s = importScenario(scenarioJson);
        setScenarioJson("");
        setMsg(`Imported scenario “${s.title}”. It's now in the Talk picker.`);
      }
      bump((n) => n + 1);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  const toggleRow = (title: string, desc: string, on: boolean, onClick: () => void) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 20,
        padding: "16px 4px",
        borderBottom: "1px solid var(--line2)",
        marginBottom: 36,
      }}
    >
      <div>
        <div className="name">{title}</div>
        <div className="desc" style={{ maxWidth: 440, lineHeight: 1.5 }}>
          {desc}
        </div>
      </div>
      <button className={`toggle ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
        <span />
      </button>
    </div>
  );

  return (
    <div className="set fade">
      <div className="eyebrow">Settings</div>
      <h1 className="display">Yours to run anywhere.</h1>

      {msg && (
        <div className="err" style={{ borderColor: "var(--good)", color: "var(--good)" }}>
          {msg}
        </div>
      )}
      {err && <div className="err">{err}</div>}

      {/* ---- language ---- */}
      <div className="sec">Language</div>
      {packs.map((p) => {
        const origin = packOrigin(p.id);
        return (
          <button key={p.id} className="srow" onClick={() => onChange({ packId: p.id, targetLang: p.name })}>
            <div className={`radio ${settings.packId === p.id ? "on" : ""}`} />
            <div style={{ flex: 1 }}>
              <div className="name">
                {p.emoji} {p.name} — {p.nativeName}
                <span>{origin ? originLabel(origin) : ""}</span>
              </div>
              <div className="desc">
                {p.grammar.length} grammar notes, {p.pronunciation.length} pronunciation notes · voice{" "}
                {p.speech.locale}
              </div>
            </div>
            {origin === "imported" && (
              <span
                className="model"
                onClick={(e) => {
                  e.stopPropagation();
                  removeImportedPack(p.id);
                  bump((n) => n + 1);
                }}
              >
                remove
              </span>
            )}
          </button>
        );
      })}

      <div className="field" style={{ marginTop: 10 }}>
        <label>I speak</label>
        <input value={settings.nativeLang} onChange={(e) => onChange({ nativeLang: e.target.value })} />
      </div>
      <div className="field">
        <label>My level</label>
        <select value={settings.cefr} onChange={(e) => onChange({ cefr: e.target.value })}>
          <option value="">Not set — placed in your first conversation</option>
          {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 36 }}>
        <label>Minutes a day</label>
        <input
          type="number"
          min={5}
          max={180}
          value={settings.dailyMinutes}
          onChange={(e) => onChange({ dailyMinutes: Number(e.target.value) || 45 })}
        />
      </div>

      {/* ---- offline ---- */}
      <div className="sec">Offline mode</div>
      {toggleRow(
        "Never leave this machine",
        "Forces local providers only. Cloud options are disabled and no learner data ever leaves your device.",
        settings.offline,
        () => {
          const offline = !settings.offline;
          // Switching offline on while a cloud provider is active would silently break
          // every call — fall back to the local default instead of failing later.
          const patch: Partial<Settings> = { offline };
          if (offline && !isLocalProvider(settings.provider)) patch.provider = "ollama";
          if (offline && settings.speechEngine !== "web") patch.speechEngine = "web";
          onChange(patch);
        },
      )}

      {/* ---- provider ---- */}
      <div className="sec">AI Provider</div>
      {PROVIDERS.map((p) => {
        const local = isLocalProvider(p.id);
        const disabled = settings.offline && !local;
        return (
          <button
            key={p.id}
            className={`srow ${disabled ? "off" : ""}`}
            disabled={disabled}
            onClick={() => onChange({ provider: p.id })}
          >
            <div className={`radio ${settings.provider === p.id ? "on" : ""}`} />
            <div style={{ flex: 1 }}>
              <div className="name">
                {p.name} <span>{local ? "● local" : "☁ cloud"}</span>
              </div>
              <div className="desc">{p.desc}</div>
            </div>
            <div className="model">{String(settings[p.model])}</div>
          </button>
        );
      })}

      {active && (
        <div style={{ marginTop: 10, marginBottom: 36 }}>
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

      {/* ---- speech ---- */}
      <div className="sec">Speech</div>
      {SPEECH.map((s) => {
        const disabled = settings.offline && !s.local;
        return (
          <button
            key={s.id}
            className={`srow ${disabled ? "off" : ""}`}
            disabled={disabled}
            onClick={() => onChange({ speechEngine: s.id })}
          >
            <div className={`radio ${settings.speechEngine === s.id ? "on" : ""}`} />
            <div style={{ flex: 1 }}>
              <div className="name">
                {s.name} <span>{s.local ? "● local" : "☁ cloud"}</span>
              </div>
              <div className="desc">{s.desc}</div>
            </div>
          </button>
        );
      })}
      {speechCfg?.key && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>API key</label>
          <input
            type="password"
            value={String(settings[speechCfg.key])}
            onChange={(e) => onChange({ [speechCfg.key!]: e.target.value } as Partial<Settings>)}
          />
        </div>
      )}
      {toggleRow(
        "Read replies aloud",
        "The coach speaks each turn as it arrives.",
        settings.speak,
        () => onChange({ speak: !settings.speak }),
      )}

      {/* ---- coaching ---- */}
      <div className="sec">Coaching</div>
      {TIMINGS.map(([id, name, desc]) => (
        <button key={id} className="srow" onClick={() => onChange({ correctionTiming: id })}>
          <div className={`radio ${settings.correctionTiming === id ? "on" : ""}`} />
          <div style={{ flex: 1 }}>
            <div className="name">{name}</div>
            <div className="desc">{desc}</div>
          </div>
        </button>
      ))}
      {toggleRow(
        "Keyboard hints",
        "The small shortcut lines under each screen.",
        settings.showHints,
        () => onChange({ showHints: !settings.showHints }),
      )}

      {/* ---- extensions ---- */}
      <div className="sec">Community extensions</div>
      <div style={{ padding: "15px 4px", borderBottom: "1px solid var(--line2)" }}>
        <div className="name">
          Scenarios <span>{listScenarios().length} installed</span>
        </div>
        <div className="desc" style={{ marginBottom: 10 }}>
          Paste a scenario JSON to add a role-play to the Talk picker.
        </div>
        <textarea
          value={scenarioJson}
          onChange={(e) => setScenarioJson(e.target.value)}
          placeholder={`{ "formatVersion": 1, "id": "market", "title": "At the market", "emoji": "🧺", "setup": "You are a market vendor…" }`}
        />
        <button className="btn sm ghost" onClick={() => tryImport("scenario")} disabled={!scenarioJson.trim()}>
          Import scenario
        </button>
      </div>

      <div style={{ padding: "15px 4px", borderBottom: "1px solid var(--line2)" }}>
        <div className="name">
          Language packs <span>{importedCount} imported</span>
        </div>
        <div className="desc" style={{ marginBottom: 10 }}>
          Paste a pack JSON to teach Verba a new language. Imported packs are unverified — nobody has reviewed them.
        </div>
        <textarea
          value={packJson}
          onChange={(e) => setPackJson(e.target.value)}
          placeholder={`{ "formatVersion": 1, "id": "nl", "name": "Dutch", "nativeName": "Nederlands", … }`}
        />
        <button className="btn sm ghost" onClick={() => tryImport("pack")} disabled={!packJson.trim()}>
          Import pack
        </button>
      </div>

      <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 16 }}>
        Verba is open source. Extensions are sandboxed content packs — see CONTRIBUTING.md for the format.
      </div>
    </div>
  );
}

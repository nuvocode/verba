// Settings → Advanced (spec §5.7). Closed by default and useful to nobody who
// has not gone looking: nothing in here is a precondition for anything in the
// main flow. This is also the only place a provider name, a model label, a host
// or an API key is allowed to appear (§6) — and, since §5.4, the only place the
// speech engines are chosen.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isLocalProvider, type ProviderId, type Settings } from "../../lib/settings";
import { AT, cloudGate } from "../../lib/rules";
import { importPack, missingPackNote, originLabel, registry, removeImportedPack } from "../../lib/packs";
import { importScenario, removeImportedScenario, scenarioRegistry } from "../../lib/scenarios";
import {
  CLOUD_MODELS,
  KEY_SOURCE,
  isRemoteModel,
  listModels,
  localChoices,
  machineRam,
  testConnection,
  type Choice,
  type Installed,
  type LocalProvider,
  type Probe,
} from "../../lib/models";
import { Because, linkish, ToggleRow, type SectionProps } from "./parts";
import { EngineHalf } from "./engines";

/** Where the format, the schema and the worked examples live. Not a filename on screen (§5.7). */
const DOCS = "https://github.com/nuvocode/verba/blob/master/CONTRIBUTING.md";

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
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [, bump] = useState(0); // packs/scenarios live in localStorage — re-read after a change

  const active = PROVIDERS.find((p) => p.id === settings.provider);
  const local = isLocalProvider(settings.provider);
  const host = active?.host ? String(settings[active.host]) : "";
  const chosen = active ? String(settings[active.model]) : "";

  // ---- what this machine is serving ----

  /** null = the server never answered, which reads differently from "running, nothing pulled". */
  const [served, setServed] = useState<Installed[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [ram, setRam] = useState(0);

  useEffect(() => {
    void machineRam().then(setRam);
  }, []);

  useEffect(() => {
    if (!local || !host) return setServed(null);
    let live = true;
    setProbing(true);
    // The host changes on every keystroke; wait for the typing to stop.
    const t = setTimeout(() => {
      void listModels(settings.provider as LocalProvider, host).then((list) => {
        if (!live) return;
        setServed(list);
        setProbing(false);
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [local, host, settings.provider]);

  /** The rows to choose from: what a local server serves, or the short cloud list. */
  const choices: Choice[] = local
    ? localChoices(served ?? [], ram, settings.offline)
    : (CLOUD_MODELS[settings.provider] ?? []);

  /** How many rows the lock took off the list, so a shorter list is never a mystery. */
  const withheld = settings.offline ? (served ?? []).filter((m) => isRemoteModel(m.id)).length : 0;

  // ---- does it answer? ----

  const [probe, setProbe] = useState<Probe | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    setProbe(null);
    setProbe(await testConnection(settings));
    setTesting(false);
  };

  // ---- extensions ----

  const packs = registry();
  const scenarios = scenarioRegistry();
  const gone = missingPackNote(settings.packId, settings.profile.targetLanguage);

  const said = (what: string) => {
    setErr("");
    setMsg(what);
    bump((n) => n + 1);
  };

  const [pasting, setPasting] = useState<"" | "pack" | "scenario">("");
  const [pasted, setPasted] = useState("");

  const take = (kind: "pack" | "scenario", text: string) => {
    setErr("");
    setMsg("");
    try {
      if (kind === "pack") {
        const p = importPack(text);
        said(`Added the language pack for ${p.name}. Nobody has reviewed it — you brought it here yourself.`);
      } else {
        const s = importScenario(text);
        said(`Added “${s.title}”. It's in the Talk picker now.`);
      }
      setPasting("");
      setPasted("");
    } catch (e: any) {
      setMsg("");
      setErr(String(e?.message ?? e));
    }
  };

  /** The primary way in: pick the file you were given. Pasting is the fallback under it. */
  const addFromFile = async (kind: "pack" | "scenario") => {
    setErr("");
    setMsg("");
    try {
      const path = await open({ filters: [{ name: "Verba add-on", extensions: ["json"] }], multiple: false });
      if (typeof path !== "string") return;
      take(kind, await invoke<string>("file_read", { path }));
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  const removeRow = (name: string, origin: string, removable: boolean, onRemove: () => void, note?: string) => (
    <div
      key={`${name}-${origin}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 4px",
        borderBottom: "1px solid var(--line2)",
      }}
    >
      <div style={{ flex: 1 }}>
        <div className="name">
          {name} <span>· {origin}</span>
        </div>
        {note && <div className="desc">{note}</div>}
      </div>
      {removable ? (
        <button className="model" style={linkish} onClick={onRemove}>
          remove
        </button>
      ) : (
        // Not a disabled button with no explanation (#42): the row simply says
        // why there is nothing to press.
        <span className="model" style={{ color: "var(--ink3)" }}>
          ships with Verba
        </span>
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

      {/* §5.7 asks this section to say what it is for. It is not collapsed — the
          five sections are the nav (§5.1) — so the sentence does that job. */}
      <div className="desc" style={{ maxWidth: 480, lineHeight: 1.6, padding: "0 4px 20px" }}>
        Nothing on this page is needed to use Verba. It is here for the machinery underneath — which model answers,
        where speech comes from, and what you have added yourself.
      </div>

      <div className="sec">Model</div>
      {PROVIDERS.map((p) => {
        const isLocal = isLocalProvider(p.id);
        const gate = isLocal ? null : cloudGate(settings);
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
                {p.name} <span>{isLocal ? "● local" : "☁ cloud"}</span>
                {gate && <Because gate={gate} link={false} />}
              </div>
              <div className="desc">{p.desc}</div>
            </div>
            <div className="model">{String(settings[p.model])}</div>
          </button>
        );
      })}

      {active && (
        <div style={{ marginTop: 18 }}>
          {active.host && (
            <div className="field">
              <label>Host</label>
              <input
                value={host}
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
              {KEY_SOURCE[active.id] && (
                <a className="model" href={KEY_SOURCE[active.id]} target="_blank" rel="noreferrer">
                  where to get one ↗
                </a>
              )}
            </div>
          )}

          {/* The list. Local providers are asked what they are actually serving —
              §5.7: the model is picked, not typed. The typed field below is for
              the one the list misses, and is marked as exactly that. */}
          <div className="sec" style={{ marginTop: 22 }}>
            {local ? "Installed models" : "Models"}
          </div>

          {local && probing && <div className="desc" style={{ padding: "12px 4px" }}>Asking {host}…</div>}

          {local && !probing && served === null && (
            <div className="desc" style={{ padding: "12px 4px", maxWidth: 480, lineHeight: 1.5 }}>
              No answer from {host}. Start {active.name}, or correct the address above — the field below still takes a
              model name, and nothing here is lost while the server is down.
            </div>
          )}

          {local && !probing && served?.length === 0 && (
            <div className="desc" style={{ padding: "12px 4px", maxWidth: 480, lineHeight: 1.5 }}>
              {active.name} is running but has no models yet. Pull one, then come back — this list reads whatever it is
              serving.
            </div>
          )}

          {choices.map((c) => (
            <button
              key={c.id}
              className="srow"
              onClick={() => onChange({ [active.model]: c.id } as Partial<Settings>)}
            >
              <div className={`radio ${chosen === c.id ? "on" : ""}`} />
              <div style={{ flex: 1 }}>
                <div className="name">
                  {c.id}
                  {c.recommended && <span> · recommended</span>}
                </div>
                {c.hint && <div className="desc">{c.hint}</div>}
                {c.warning && (
                  <div className="desc" style={{ color: "var(--sev)" }}>
                    {c.warning}
                  </div>
                )}
              </div>
            </button>
          ))}

          {/* Separate and marked as such (§5.7). It holds the live value, so a
              row picked above shows up here — the field is a second way to set
              the same setting, not a second setting. */}
          {withheld > 0 && (
            // Hidden, but not silently (#42): the reason and the switch that
            // caused it are both here.
            <div className="desc" style={{ padding: "12px 4px 0", maxWidth: 480, lineHeight: 1.5 }}>
              {withheld} more {withheld === 1 ? "model runs" : "models run"} on Ollama's servers rather than on this
              machine, so {withheld === 1 ? "it is" : "they are"} not offered —{" "}
              <a href={AT.privacy} style={{ color: "inherit" }}>
                Offline lock
              </a>
              .
            </div>
          )}

          <div className="field" style={{ marginTop: 18 }}>
            <label>Any other model</label>
            <input
              placeholder="A name the list doesn't offer"
              value={chosen}
              onChange={(e) => onChange({ [active.model]: e.target.value } as Partial<Settings>)}
            />
          </div>

          {/* §5.7: a real request, and how long it took. A server that lists a
              model can still fail on the first actual turn — a deleted model, a
              key without credit — and only the real thing catches that. */}
          <div className="field">
            <button className="btn sm ghost" onClick={test} disabled={testing}>
              {testing ? "Asking…" : "Test connection"}
            </button>
            {probe?.ok && (
              <span className="model" style={{ color: "var(--good)" }}>
                Answered in {(probe.ms / 1000).toFixed(1)}s — “{probe.reply}”
              </span>
            )}
          </div>
          {probe && !probe.ok && (
            <div className="err">
              {/* A failure that came back in 40 ms did not "take" any time —
                  printing 0.0s would be a number with nothing behind it (§6). */}
              No answer{probe.ms >= 1000 ? ` after ${(probe.ms / 1000).toFixed(1)}s` : ""} — {probe.error}
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

      {/* Moved out of Speech and listening (§5.4). That page names what is in use
          and links here; the choice, and the addresses and keys behind it, are
          an Advanced question. */}
      <div className="sec" style={{ marginTop: 44 }}>Speech engine</div>
      <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, marginBottom: 4 }}>Where the voice comes from.</div>
      <EngineHalf half="tts" settings={settings} onChange={onChange} />

      <div className="sec" style={{ marginTop: 30 }}>Dictation engine</div>
      <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, marginBottom: 4 }}>
        What turns your speech into words.
      </div>
      <EngineHalf half="stt" settings={settings} onChange={onChange} />

      <div className="sec" style={{ marginTop: 44 }}>Language packs</div>

      {gone && (
        // §7 row 9: the app is open, and the one thing that is quietly worse says so.
        <div className="err" style={{ borderColor: "var(--sev)" }}>
          {gone}
          <div style={{ marginTop: 8 }}>
            <a href={AT.learning} style={{ color: "inherit" }}>
              Pick another language
            </a>
          </div>
        </div>
      )}

      {packs.map((r) =>
        removeRow(
          `${r.pack.emoji} ${r.pack.nativeName}`,
          originLabel(r.origin),
          r.origin === "imported",
          () => {
            removeImportedPack(r.pack.id);
            said(`Removed the pack for ${r.pack.name}.`);
          },
          r.origin === "imported" ? "Nobody reviewed this one." : undefined,
        ),
      )}
      {addRow("pack", "Add a language pack", addFromFile, pasting, setPasting, pasted, setPasted, take)}

      <div className="sec" style={{ marginTop: 44 }}>Role-plays</div>
      {scenarios.map((r) =>
        removeRow(
          `${r.scenario.emoji} ${r.scenario.title}`,
          r.origin === "bundled" ? "Official" : "Added by you",
          r.origin === "imported",
          () => {
            removeImportedScenario(r.scenario.id);
            said(`Removed “${r.scenario.title}”.`);
          },
        ),
      )}
      {addRow("scenario", "Add a role-play", addFromFile, pasting, setPasting, pasted, setPasted, take)}

      <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 24, maxWidth: 480, lineHeight: 1.6 }}>
        Verba is open source, and both of these are plain content files — no code runs from them.{" "}
        <a href={DOCS} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
          How to write one ↗
        </a>
      </div>
    </>
  );
}

/**
 * The two ways in, in the order §5.7 puts them: a file picker first, pasting as
 * the fallback behind a link. The paste box carries no example JSON — the shape
 * of the file is documentation, not interface.
 */
function addRow(
  kind: "pack" | "scenario",
  label: string,
  fromFile: (k: "pack" | "scenario") => void,
  pasting: string,
  setPasting: (v: "" | "pack" | "scenario") => void,
  pasted: string,
  setPasted: (v: string) => void,
  take: (k: "pack" | "scenario", text: string) => void,
) {
  const showing = pasting === kind;
  return (
    <div style={{ paddingTop: 14 }}>
      <div className="field">
        <button className="btn sm ghost" onClick={() => fromFile(kind)}>
          {label}…
        </button>
        <button className="model" style={linkish} onClick={() => setPasting(showing ? "" : kind)}>
          {showing ? "cancel" : "or paste it"}
        </button>
      </div>
      {showing && (
        <div style={{ padding: "10px 4px 0" }}>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste what you were given"
          />
          <button className="btn sm ghost" onClick={() => take(kind, pasted)} disabled={!pasted.trim()}>
            Add it
          </button>
        </div>
      )}
    </div>
  );
}

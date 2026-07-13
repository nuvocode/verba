import { useEffect, useState } from "react";
import { isLocalProvider, type CorrectionTiming, type ProviderId, type Settings } from "../lib/settings";
import { deepgramHelp, listenBlocker } from "../lib/speech";
import {
  CATALOG,
  download,
  installed as listInstalled,
  remove,
  sizeLabel,
  voiceOf,
  type CatalogModel,
  type Installed,
  type ModelState,
} from "../lib/bundled";
import { reachable } from "../lib/models";
import { importPack, listPacks, originLabel, packDocs, packOrigin, registry, removeImportedPack } from "../lib/packs";
import { importScenario, listScenarios } from "../lib/scenarios";

/**
 * Is the speech server the learner typed actually there? Same shape as the model
 * probe in Onboarding: a `live` flag so a stale answer can't overwrite a fresh one.
 * An unreachable server is reported, never enforced — settings still save.
 *
 * This only ever mounts inside the Speech panel, so opening Settings on any other
 * tab probes nothing.
 */
function ServerStatus({ name, url }: { name: string; url: string }) {
  const [state, setState] = useState<"probing" | "up" | "down">("probing");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setState("probing");
    // The URL changes on every keystroke; wait for the typing to stop rather than
    // firing a request per character.
    const t = setTimeout(() => {
      void reachable(url).then((ok) => live && setState(ok ? "up" : "down"));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [url, retry]);

  if (!url.trim()) return <div className="desc">Empty — this half stays on your system voice.</div>;
  if (state === "probing") return <div className="desc">{name} · checking…</div>;
  if (state === "up") return <div className="desc" style={{ color: "var(--good)" }}>{name} · reachable</div>;
  return (
    <div className="desc" style={{ color: "var(--sev)" }}>
      {name} · no answer at {url} — start the server, or leave it: speech falls back to your system voice.{" "}
      <button className="model" style={linkish} onClick={() => setRetry((n) => n + 1)}>
        retry
      </button>
    </div>
  );
}

/**
 * One model, one row. Nothing here downloads without a click — these are hundreds
 * of megabytes, and a language app that helps itself to 350 MB because you opened
 * Settings is a language app you uninstall.
 */
function ModelRow({
  m,
  settings,
  onChange,
  packLang,
  recommended,
  installed,
  refresh,
}: {
  m: CatalogModel;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  packLang: string;
  recommended: string[];
  installed: Record<string, Installed>;
  refresh: () => Promise<void>;
}) {
  const [state, setState] = useState<ModelState>({ s: "absent" });

  const here = !!installed[m.id];
  const isRec = recommended.includes(m.id);
  const chosen = m.half === "tts" ? settings.bundledTtsModel === m.id : settings.bundledSttModel === m.id;

  /** The voice to start on: one that speaks the language being learned, if any. */
  const defaultSid = (m.voices.find((v) => v.lang === packLang) ?? m.voices[0])?.sid ?? 0;

  const choose = () =>
    onChange(
      m.half === "tts"
        ? { bundledTtsModel: chosen ? "" : m.id, bundledTtsVoice: defaultSid }
        : { bundledSttModel: chosen ? "" : m.id },
    );

  async function get() {
    setState({ s: "downloading", pct: 0 });
    try {
      await download(m.id, (pct) => setState({ s: "downloading", pct }));
      setState({ s: "ready", bytes: 0 });
      await refresh();
      // A model nobody selected is a model nobody uses. The first one downloaded
      // for a half becomes that half's choice — the click already said "I want this".
      const half = m.half === "tts" ? settings.bundledTtsModel : settings.bundledSttModel;
      if (!half) choose();
    } catch (e: any) {
      // Includes the checksum mismatch, which Rust reports having installed nothing.
      setState({ s: "failed", why: String(e?.message ?? e) });
    }
  }

  async function drop() {
    await remove(m.id);
    if (chosen) onChange(m.half === "tts" ? { bundledTtsModel: "" } : { bundledSttModel: "" });
    setState({ s: "absent" });
    await refresh();
  }

  const st: ModelState = state.s === "absent" && here ? { s: "ready", bytes: installed[m.id].bytes } : state;

  // Which voice this row is showing. A Piper model has exactly one, so it shows
  // that one whether or not it's selected; Kokoro has fourteen, so it shows the one
  // you picked — or, until you pick, the one that fits the language you're learning.
  const voice =
    m.half !== "tts"
      ? undefined
      : chosen && m.voices.length > 1
        ? voiceOf(m.id, settings.bundledTtsVoice)
        : (m.voices.find((v) => v.lang === packLang) ?? m.voices[0]);

  return (
    <div style={{ padding: "12px 4px", borderBottom: "1px solid var(--line2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {here && (
          <button
            className={`radio ${chosen ? "on" : ""}`}
            onClick={choose}
            aria-label={`Use ${m.label}`}
            style={{ border: "none", padding: 0, cursor: "pointer" }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div className="name">
            {m.label}
            {voice ? ` · ${voice.name}` : ""} <span>{isRec ? "· recommended" : ""}</span>
          </div>
          <div className="desc">
            {m.half === "stt" ? "Dictation · any language" : langNames(m.langs)} · {sizeLabel(m)}
            {st.s === "failed" ? ` · ${st.why}` : ""}
          </div>
        </div>
        <div className="model">
          {st.s === "downloading" ? `${st.pct.toFixed(0)}%` : st.s === "failed" ? "failed" : here ? "ready" : ""}
        </div>
        {st.s !== "downloading" &&
          (here ? (
            <button className="model" style={linkish} onClick={() => void drop()}>
              delete
            </button>
          ) : (
            <button className="model" style={linkish} onClick={() => void get()}>
              {st.s === "failed" ? "retry" : "download"}
            </button>
          ))}
      </div>

      {st.s === "downloading" && (
        <div style={{ height: 2, background: "var(--line2)", marginTop: 8 }}>
          <div style={{ height: 2, width: `${st.pct}%`, background: "var(--fg)" }} />
        </div>
      )}

      {/* Kokoro carries 14 curated voices; Piper carries one, so there is nothing to
          choose and we don't ask. */}
      {chosen && m.voices.length > 1 && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>Voice</label>
          <select value={settings.bundledTtsVoice} onChange={(e) => onChange({ bundledTtsVoice: Number(e.target.value) })}>
            {m.voices.map((v) => (
              <option key={v.sid} value={v.sid}>
                {v.name} — {langNames([v.lang])}
                {v.lang === packLang ? " · matches your language" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/**
 * The bundled tier: models the app downloads and runs itself, grouped by the
 * language they speak. The language being learned leads — with Spanish active, the
 * Spanish voice is the first thing on screen and the other seven languages sit
 * behind one click. Nothing is hidden for good: Kokoro speaks no Turkish, but a
 * learner who wants to hear it try is one disclosure away.
 *
 * ponytail: a multilingual model is filed under its first language (Kokoro → the
 * English group) rather than repeated under all six. One row per model keeps the
 * download button unambiguous; the row's own line still names every language it
 * speaks. Split it per-language if learners start missing it.
 */
function BundledModels(props: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  packLang: string;
  recommended: string[];
  installed: Record<string, Installed>;
  refresh: () => Promise<void>;
  loaded: boolean;
}) {
  const { packLang, recommended, loaded } = props;
  const [showAll, setShowAll] = useState(false);

  if (!loaded) return <div className="desc">Bundled models · checking…</div>;

  const tts = CATALOG.filter((m) => m.half === "tts");
  const stt = CATALOG.filter((m) => m.half === "stt");

  // Recommended first, in the pack's own order; then whatever else speaks the language.
  const rank = (m: CatalogModel) => {
    const i = recommended.indexOf(m.id);
    return i >= 0 ? i : 50;
  };
  const mine = tts.filter((m) => m.langs.includes(packLang)).sort((a, b) => rank(a) - rank(b) || a.mb - b.mb);
  const rest = tts.filter((m) => !m.langs.includes(packLang));

  // Everything else, one group per language, ordered as the catalog lists them.
  const restLangs = [...new Set(rest.map((m) => m.langs[0]))];

  const row = (m: CatalogModel) => <ModelRow key={m.id} m={m} {...props} />;
  const group = (title: string, models: CatalogModel[]) => (
    <div key={title} style={{ marginTop: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{title}</div>
      {models.map(row)}
    </div>
  );

  return (
    <div style={{ marginBottom: 36 }}>
      {mine.length > 0 && group(langNames([packLang]), mine)}

      {showAll ? (
        restLangs.map((l) => group(langNames([l]), rest.filter((m) => m.langs[0] === l)))
      ) : (
        <button className="btn sm ghost" style={{ marginTop: 14 }} onClick={() => setShowAll(true)}>
          Show all voices ({restLangs.length} language{restLangs.length === 1 ? "" : "s"})
        </button>
      )}

      {group("Dictation", stt)}
    </div>
  );
}

const linkish = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
  textDecoration: "underline",
} as const;

const LANG_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  tr: "Turkish",
};
const langNames = (ls: string[]) => ls.map((l) => LANG_NAMES[l] ?? l).join(", ") || "any language";

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

/** The tabs, in nav order. The id is also the hash: #settings/speech opens Speech. */
const NAV = [
  ["language", "Language"],
  ["offline", "Offline"],
  ["provider", "AI Provider"],
  ["speech", "Speech"],
  ["coaching", "Coaching"],
  ["extensions", "Extensions"],
] as const;

export type Tab = (typeof NAV)[number][0];

const TAB_KEY = "verba.settingsTab";
const isTab = (s: string): s is Tab => NAV.some(([id]) => id === s);

/** The panel a `#settings/<tab>` hash names, if it names one we have. */
export function tabFromHash(): Tab | undefined {
  const t = /^#settings\/(\w+)/.exec(window.location.hash)?.[1];
  return t && isTab(t) ? t : undefined;
}

/** Deep link first, then wherever they were last. A learner who left Settings on
 *  Speech comes back to Speech. */
function initialTab(): Tab {
  const stored = localStorage.getItem(TAB_KEY) ?? "";
  return tabFromHash() ?? (isTab(stored) ? stored : "language");
}

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
  const [tab, setTab] = useState<Tab>(initialTab);
  const [packJson, setPackJson] = useState("");
  const [scenarioJson, setScenarioJson] = useState("");
  const [openImport, setOpenImport] = useState(""); // "scenario" | "pack" — the one whose paste box is open
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [openDoc, setOpenDoc] = useState(""); // slug of the language doc being read
  const [, bump] = useState(0); // packs/scenarios live in localStorage — force a re-read after import

  // Bundled models on disk. Lives here, not in BundledModels, because the Deepgram
  // field needs to know whether dictation already works offline.
  const [installed, setInstalled] = useState<Record<string, Installed>>({});
  const [loaded, setLoaded] = useState(false);
  const refresh = () =>
    listInstalled().then((list) => {
      setInstalled(Object.fromEntries(list.map((m) => [m.id, m])));
      setLoaded(true);
    });
  useEffect(() => {
    void refresh();
  }, []);

  const packs = listPacks();
  // An imported pack shadows the in-tree pack of the same id, docs included — so
  // say so, or "I pasted my es pack and the Spanish guide vanished" reads as a bug.
  const packShadowed = packOrigin(settings.packId) === "imported";
  const docs = packShadowed ? [] : packDocs(settings.packId);
  const active = PROVIDERS.find((p) => p.id === settings.provider);
  const importedCount = registry().filter((r) => r.origin === "imported").length;
  const micBlocked = listenBlocker(settings);
  const whisperReady = CATALOG.some((m) => m.half === "stt" && installed[m.id]);

  // The tab is the URL: reload lands back here, and #settings/speech is a link
  // anything in the app can hand out.
  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
    if (tabFromHash() !== tab) window.history.replaceState(null, "", `#settings/${tab}`);
  }, [tab]);

  // …and a link followed while Settings is already open still moves the panel.
  useEffect(() => {
    const onHash = () => {
      const t = tabFromHash();
      if (t) setTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Up/down or [ ] walks the tabs — the same keys the palette uses, and Esc still
  // leaves for Today (App owns that). Typing in a field is never a shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "") || el?.isContentEditable) return;
      const step = e.key === "ArrowDown" || e.key === "]" ? 1 : e.key === "ArrowUp" || e.key === "[" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const i = NAV.findIndex(([id]) => id === tab);
      setTab(NAV[(i + step + NAV.length) % NAV.length][0]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

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
    <div className="set fade">
      <nav className="setnav">
        {NAV.map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="eyebrow">Settings</div>
      <h1 className="display">Yours to run anywhere.</h1>

      {msg && (
        <div className="err" style={{ borderColor: "var(--good)", color: "var(--good)" }}>
          {msg}
        </div>
      )}
      {err && <div className="err">{err}</div>}

      {tab === "language" && (
        <>
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

          {/* The selected language's markdown docs — the long-form guide a pack's three
              bullet points have no room for. Docs marked for the tutor also ride along
              on every model call, so the learner is told which ones those are. */}
          {packShadowed && packDocs(settings.packId).length > 0 && (
            <div className="desc" style={{ marginTop: 16 }}>
              You imported your own <strong>{settings.targetLang}</strong> pack, so it replaces the built-in one — the
              bundled language guide is hidden and the tutor follows your pack's instructions only. Remove the imported
              pack to get the built-in guide back.
            </div>
          )}

          {docs.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="desc" style={{ marginBottom: 8 }}>
                Language guide — {docs.length} document{docs.length > 1 ? "s" : ""} shipped with this pack.
              </div>
              {docs.map((d) => (
                <div key={d.slug}>
                  <button className="srow" onClick={() => setOpenDoc(openDoc === d.slug ? "" : d.slug)}>
                    <div style={{ flex: 1 }}>
                      <div className="name">
                        {d.title}
                        {d.prompt && <span>Tutor reads this</span>}
                      </div>
                      <div className="desc">{d.slug}.md</div>
                    </div>
                    <span className="model">{openDoc === d.slug ? "close" : "read"}</span>
                  </button>
                  {/* ponytail: markdown rendered as its own source — it is written to be
                      read plain, and this ships no parser and no XSS surface. Add a
                      renderer when a doc needs tables or images to land. */}
                  {openDoc === d.slug && (
                    <pre
                      className="desc"
                      style={{
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.6,
                        maxHeight: 420,
                        overflow: "auto",
                        padding: "4px 4px 16px",
                        margin: 0,
                        fontFamily: "inherit",
                      }}
                    >
                      {d.body}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

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
          <div className="field">
            <label>Minutes a day</label>
            <input
              type="number"
              min={5}
              max={180}
              value={settings.dailyMinutes}
              onChange={(e) => onChange({ dailyMinutes: Number(e.target.value) || 45 })}
            />
          </div>
        </>
      )}

      {tab === "offline" && (
        <>
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
              onChange(patch);
            },
          )}
        </>
      )}

      {tab === "provider" && (
        <>
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
        </>
      )}

      {/* Two independent halves, not rival engines: ElevenLabs only speaks and
          Deepgram only listens. A key means "use it"; empty falls back to the OS
          voices for TTS, and to nothing for STT — no webview ships a recogniser. */}
      {tab === "speech" && (
        <>
          <div className="sec">Speech</div>

          {/* The bundled tier leads, because it is the one that needs nothing: no
              server to start, no key to paste, and it keeps working on a plane. */}
          <div className="name" style={{ marginBottom: 2, marginTop: 4 }}>Bundled models</div>
          <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, marginBottom: 10 }}>
            Speech that runs inside this app — no server, no key, no network once it's here. Downloads only when you
            ask. Picked ahead of everything below when a model is installed.
          </div>
          <BundledModels
            settings={settings}
            onChange={onChange}
            packLang={settings.packId}
            recommended={packs.find((p) => p.id === settings.packId)?.speech.recommendedVoices ?? []}
            installed={installed}
            refresh={refresh}
            loaded={loaded}
          />

          {toggleRow(
            "Local speech server",
            "Speech from a server you run yourself. Any OpenAI-compatible server works — Kokoro-FastAPI for speech, speaches for transcription. Overrides the keys below and works in offline mode: localhost is not the network.",
            settings.localSpeech,
            () => onChange({ localSpeech: !settings.localSpeech }),
          )}

          {settings.localSpeech && (
            <div style={{ marginBottom: 36 }}>
              <div className="field">
                <label>Voice — server</label>
                <input
                  placeholder="http://localhost:8880/v1"
                  value={settings.localTtsUrl}
                  onChange={(e) => onChange({ localTtsUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Voice — model</label>
                <input value={settings.localTtsModel} onChange={(e) => onChange({ localTtsModel: e.target.value })} />
              </div>
              <div className="field">
                <label>Voice — voice</label>
                <input
                  placeholder="af_heart"
                  value={settings.localTtsVoice}
                  onChange={(e) => onChange({ localTtsVoice: e.target.value })}
                />
              </div>
              <ServerStatus name="Kokoro server" url={settings.localTtsUrl} />

              <div className="field" style={{ marginTop: 14 }}>
                <label>Dictation — server</label>
                <input
                  placeholder="http://localhost:8000/v1"
                  value={settings.localSttUrl}
                  onChange={(e) => onChange({ localSttUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Dictation — model</label>
                <input value={settings.localSttModel} onChange={(e) => onChange({ localSttModel: e.target.value })} />
              </div>
              <ServerStatus name="speaches server" url={settings.localSttUrl} />
            </div>
          )}

          <div className="field">
            <label>
              Voice — ElevenLabs key{" "}
              {settings.localSpeech && settings.localTtsUrl ? (
                <span>· using local server</span>
              ) : (
                settings.offline && <span>· disabled offline</span>
              )}
            </label>
            <input
              type="password"
              disabled={settings.offline || (settings.localSpeech && !!settings.localTtsUrl)}
              placeholder="Empty → your system voices"
              value={settings.elevenLabsKey}
              onChange={(e) => onChange({ elevenLabsKey: e.target.value })}
            />
          </div>
          <div className="field">
            <label>
              Dictation — Deepgram key{" "}
              {settings.localSpeech && settings.localSttUrl ? (
                <span>· using local server</span>
              ) : (
                settings.offline && <span>· disabled offline</span>
              )}
            </label>
            <input
              type="password"
              disabled={settings.offline || (settings.localSpeech && !!settings.localSttUrl)}
              placeholder={deepgramHelp(settings, whisperReady)}
              value={settings.deepgramKey}
              onChange={(e) => onChange({ deepgramKey: e.target.value })}
            />
          </div>
          <div className="desc" style={{ marginBottom: 14 }}>
            {micBlocked || "Microphone ready — click ◉ in Talk to speak, click again to send."}
          </div>
          {toggleRow(
            "Read replies aloud",
            "The coach speaks each turn as it arrives.",
            settings.speak,
            () => onChange({ speak: !settings.speak }),
          )}
        </>
      )}

      {tab === "coaching" && (
        <>
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
        </>
      )}

      {tab === "extensions" && (
        <>
          <div className="sec">Community extensions</div>
          {importBox(
            "scenario",
            "Scenarios",
            `${listScenarios().length} installed`,
            "Paste a scenario JSON to add a role-play to the Talk picker.",
            scenarioJson,
            setScenarioJson,
            `{ "formatVersion": 1, "id": "market", "title": "At the market", "emoji": "🧺", "setup": "You are a market vendor…" }`,
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
      )}
    </div>
  );
}

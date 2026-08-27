// Settings → Speech and listening (spec §5.4). Two independent halves, not rival
// engines: one answers "how does Verba speak", the other "how does it hear me".
// Each shows the configuration of the one source it is actually using, so setting
// up a voice never means walking past a dictation key. Nothing is hidden; it is
// one radio away.
import { useEffect, useState } from "react";
import type { Settings } from "../../lib/settings";
import { langName } from "../../lib/langs";
import { AT } from "../../lib/rules";
import { listenBlocker, resolveTier, type Tier } from "../../lib/speech";
import {
  CATALOG,
  catalogModel,
  download,
  installed as listInstalled,
  remove,
  sizeLabel,
  voiceOf,
  type CatalogModel,
  type Installed,
  type ModelState,
} from "../../lib/bundled";
import { listPacks } from "../../lib/packs";
import { linkish, ToggleRow, type SectionProps } from "./parts";

const langNames = (ls: string[]) => ls.map(langName).join(", ") || "any language";

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
            style={{ padding: 0, cursor: "pointer" }}
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
 * The bundled tier for one half: models the app downloads and runs itself. The
 * voices are grouped by the language they speak, and the language being learned
 * leads — with Spanish active, the Spanish voice is the first thing on screen and
 * the other seven languages sit behind one click. Nothing is hidden for good:
 * Kokoro speaks no Turkish, but a learner who wants to hear it try is one
 * disclosure away. The Whisper models transcribe any language, so they are a plain
 * list with nothing to group.
 *
 * ponytail: a multilingual model is filed under its first language (Kokoro → the
 * English group) rather than repeated under all six. One row per model keeps the
 * download button unambiguous; the row's own line still names every language it
 * speaks. Split it per-language if learners start missing it.
 */
function BundledModels(props: {
  half: "tts" | "stt";
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  packLang: string;
  recommended: string[];
  installed: Record<string, Installed>;
  refresh: () => Promise<void>;
  loaded: boolean;
}) {
  const { half, packLang, recommended, loaded } = props;
  const [showAll, setShowAll] = useState(false);

  if (!loaded) return <div className="desc">Bundled models · checking…</div>;

  const models = CATALOG.filter((m) => m.half === half);
  const row = (m: CatalogModel) => <ModelRow key={m.id} m={m} {...props} />;

  if (half === "stt") return <div>{models.map(row)}</div>;

  // Recommended first, in the pack's own order; then whatever else speaks the language.
  const rank = (m: CatalogModel) => {
    const i = recommended.indexOf(m.id);
    return i >= 0 ? i : 50;
  };
  const mine = models.filter((m) => m.langs.includes(packLang)).sort((a, b) => rank(a) - rank(b) || a.mb - b.mb);
  const rest = models.filter((m) => !m.langs.includes(packLang));

  // Everything else, one group per language, ordered as the catalog lists them.
  const restLangs = [...new Set(rest.map((m) => m.langs[0]))];

  const group = (title: string, ms: CatalogModel[]) => (
    <div key={title} style={{ marginTop: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{title}</div>
      {ms.map(row)}
    </div>
  );

  return (
    <div>
      {mine.length > 0 && group(langNames([packLang]), mine)}

      {showAll ? (
        restLangs.map((l) => group(langNames([l]), rest.filter((m) => m.langs[0] === l)))
      ) : (
        <button className="btn sm ghost" style={{ marginTop: 14 }} onClick={() => setShowAll(true)}>
          Show all voices ({restLangs.length} language{restLangs.length === 1 ? "" : "s"})
        </button>
      )}
    </div>
  );
}

export default function Speech({ settings, onChange }: SectionProps) {
  // Bundled models on disk. Lives here, not in BundledModels, because the cloud
  // dictation field needs to know whether dictation already works offline.
  const [installed, setInstalled] = useState<Record<string, Installed>>({});
  const [loaded, setLoaded] = useState(false);
  // null (no store to ask — a browser dev server) renders the same as nothing
  // installed: every row offers a download, and the one that matters, the cloud
  // dictation field, correctly stops claiming Whisper is already listening.
  const refresh = () =>
    listInstalled().then((list) => {
      setInstalled(Object.fromEntries((list ?? []).map((m) => [m.id, m])));
      setLoaded(true);
    });
  useEffect(() => {
    void refresh();
  }, []);

  const micBlocked = listenBlocker(settings);

  // Which half has its bundled catalog open from the Automatic hint. Automatic shows
  // a one-line summary, not the catalog: a learner who hasn't chosen a source has no
  // use for eight download buttons, and the one who does is one click away.
  const [manage, setManage] = useState<"" | "tts" | "stt">("");

  // The tier actually serving each half right now, through the same precedence the
  // adapter walks — the status lines and the Automatic labels are read off this, so
  // the panel cannot claim one thing while Talk does another.
  const ttsNow = resolveTier(settings, "tts");
  const sttNow = resolveTier(settings, "stt");

  const bundledVoice = () => {
    const m = catalogModel(settings.bundledTtsModel);
    const v = voiceOf(settings.bundledTtsModel, settings.bundledTtsVoice);
    return m ? `${m.label}${v ? ` · ${v.name}` : ""}` : "no voice chosen";
  };
  const bundledWhisper = () => catalogModel(settings.bundledSttModel)?.label ?? "no model chosen";

  /** What each half is doing right now, and what it costs — the status line. */
  const usingTts = (t: Exclude<Tier, "auto">) =>
    t === "bundled"
      ? `${bundledVoice()} (bundled) — offline, no key`
      : t === "local"
        ? "your local server — offline, no key"
        : t === "cloud"
          ? "ElevenLabs — cloud, needs the network and your key"
          : "your system voice — basic, works everywhere";
  const usingStt = (t: Exclude<Tier, "auto">) =>
    t === "bundled"
      ? `${bundledWhisper()} (bundled) — offline, no key`
      : t === "local"
        ? "your local server — offline, no key"
        : t === "cloud"
          ? "Deepgram — cloud, needs the network and your key"
          : micBlocked
            ? "nothing — this system has no speech recognition"
            : "system recognition — basic, works everywhere";

  const bundledProps = {
    settings,
    onChange,
    packLang: settings.packId,
    recommended: listPacks().find((p) => p.id === settings.packId)?.speech.recommendedVoices ?? [],
    installed,
    refresh,
    loaded,
  };

  const statusLine = (text: string) => (
    <div className="desc" style={{ padding: "2px 4px 12px", maxWidth: 480, lineHeight: 1.5 }}>
      <strong style={{ color: "var(--fg)", fontWeight: 500 }}>Using:</strong> {text}
    </div>
  );

  /**
   * Which engine is doing this, and where to change it. The choice itself moved
   * to Advanced (§5.4): a learner picking a voice is picking a voice, and the
   * machinery under it is a different question on a different page.
   */
  const engineLine = () => (
    <div className="desc" style={{ padding: "0 4px 6px", maxWidth: 480, lineHeight: 1.5 }}>
      Choose a different engine under{" "}
      <a href={AT.advanced} style={{ color: "inherit" }}>
        Advanced
      </a>
      .
    </div>
  );

  /** What is on this machine, and the way to more of it. The catalogue itself is a click away. */
  const browse = (half: "tts" | "stt") => {
    const n = CATALOG.filter((m) => m.half === half && installed[m.id]).length;
    const noun = half === "tts" ? "voice" : "dictation model";
    return (
      <div style={{ padding: "12px 4px 4px" }}>
        <button className="model" style={linkish} onClick={() => setManage(manage === half ? "" : half)}>
          {n === 0 ? `No ${noun}s installed · browse` : `${n} ${noun}${n === 1 ? "" : "s"} installed · manage`}
        </button>
        {manage === half && <BundledModels half={half} {...bundledProps} />}
      </div>
    );
  };

  return (
        <>
          <div className="sec">Voice</div>
          <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, marginBottom: 4 }}>How Verba speaks.</div>

          <ToggleRow
            title="Read replies aloud"
            desc="The coach speaks each turn as it arrives."
            on={settings.speak}
            onClick={() => onChange({ speak: !settings.speak })}
          />

          {statusLine(usingTts(ttsNow))}
          {engineLine()}
          {browse("tts")}

          <div className="sec" style={{ marginTop: 44 }}>Dictation</div>
          <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, marginBottom: 4 }}>How Verba listens.</div>

          {statusLine(usingStt(sttNow))}
          {engineLine()}
          {browse("stt")}

          <div className="desc" style={{ margin: "18px 4px 14px" }}>
            {micBlocked || "Microphone ready — click ◉ in Talk to speak, click again to send."}
          </div>
        </>
  );
}

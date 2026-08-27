// Which engine each half of speech uses, and the technical fields that engine
// needs — a server URL, a model name, an API key.
//
// It lives under Advanced rather than in Speech because of §5.4: "Konuşma
// bölümünde gizlenen motor seçimleri burada bulunur." A learner choosing a voice
// is choosing a voice; the machinery underneath it is a separate question, asked
// by a different kind of person, on the page for that kind of person. Speech
// keeps one line naming what is in use, and links here.
import { useEffect, useState } from "react";
import { LOCAL_STT_URL, LOCAL_TTS_URL, type Settings } from "../../lib/settings";
import { cloudGate, type Gate } from "../../lib/rules";
import { catalogModel, CATALOG, installed as listInstalled, voiceOf } from "../../lib/bundled";
import { deepgramHelp, resolveTier, type Tier } from "../../lib/speech";
import { reachable } from "../../lib/models";
import { Because, linkish, type SectionProps } from "./parts";

/** The five answers to "where does this half get its speech". Order is the tier order. */
const SOURCES: [Tier, string][] = [
  ["auto", "Automatic"],
  ["bundled", "Bundled"],
  ["local", "Local server"],
  ["cloud", "Cloud"],
  ["native", "System"],
];

/**
 * Is the speech server the learner typed actually there? Same shape as the model
 * probe in Onboarding: a `live` flag so a stale answer can't overwrite a fresh one.
 * An unreachable server is reported, never enforced — settings still save.
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
 * The source picker for one half. Selecting a source pins the half to it, and the
 * panel below then shows that source's config and nothing else. Automatic carries
 * its own resolution in its label, so "what happens if I leave this alone" is
 * answered without picking anything.
 *
 * Cloud in offline mode is shown disabled rather than hidden: a missing option reads
 * as a missing feature, a disabled one reads as a switch you flipped.
 */
function SourceSelect({
  value,
  onPick,
  now,
  gate,
}: {
  value: Tier;
  onPick: (t: Tier) => void;
  now: string; // what Automatic currently resolves to
  /** Non-null when the cloud row is closed — it then says so, in place (#42). */
  gate: Gate | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px 20px",
        padding: "12px 4px 14px",
        borderBottom: "1px solid var(--line2)",
      }}
    >
      {SOURCES.map(([id, label]) => {
        const off = !!gate && id === "cloud";
        return (
          <button
            key={id}
            className={`model ${off ? "off" : ""}`}
            // Closed, not dead: `disabled` would take the row out of the tab
            // order and swallow the click that explains it. Picking it goes
            // through the same door as everything else and is refused there.
            aria-disabled={off}
            aria-pressed={value === id}
            onClick={() => onPick(id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: "none",
              border: "none",
              padding: 0,
              cursor: off ? "default" : "pointer",
            }}
          >
            <span className={`radio ${value === id ? "on" : ""}`} />
            {id === "auto" ? `Automatic — currently ${now}` : label}
            {off && gate && <Because gate={gate} link={false} />}
          </button>
        );
      })}
    </div>
  );
}

/** The engine in use for one half, in three words. Speech reads this too, for its one line. */
export function engineName(s: Settings, half: "tts" | "stt", micBlocked = ""): string {
  const t = resolveTier(s, half);
  if (t === "bundled") {
    const m = catalogModel(half === "tts" ? s.bundledTtsModel : s.bundledSttModel);
    if (half === "stt") return m?.label ?? "no model chosen";
    const v = voiceOf(s.bundledTtsModel, s.bundledTtsVoice);
    return m ? `${m.label}${v ? ` · ${v.name}` : ""}` : "no voice chosen";
  }
  if (t === "local") return "local server";
  if (t === "cloud") return half === "tts" ? "ElevenLabs" : "Deepgram";
  if (half === "stt" && micBlocked) return "nothing";
  return half === "tts" ? "system voice" : "system recognition";
}

/**
 * One half's engine: the source, and whatever that source needs to be told.
 *
 * The bundled catalogue is deliberately absent — downloading and previewing a
 * voice is a Speech job (§5.4), and this page is only about which machinery is
 * asked for it.
 */
export function EngineHalf({
  half,
  settings,
  onChange,
}: SectionProps & { half: "tts" | "stt" }) {
  const tts = half === "tts";
  const tier = tts ? settings.ttsTier : settings.sttTier;

  // Only the cloud dictation field needs this: its placeholder changes when
  // Whisper is already installed and listening offline.
  const [whisperReady, setWhisperReady] = useState(false);
  useEffect(() => {
    if (tts) return;
    void listInstalled().then((list) =>
      setWhisperReady(CATALOG.some((m) => m.half === "stt" && (list ?? []).some((i) => i.id === m.id))),
    );
  }, [tts]);

  // Picking "Local server" *is* the switch that used to sit above these fields, so it
  // fills in the URL the documented one-liner listens on rather than handing over an
  // empty box. A URL already typed is never overwritten.
  const pick = (t: Tier) =>
    onChange(
      tts
        ? { ttsTier: t, ...(t === "local" && !settings.localTtsUrl ? { localTtsUrl: LOCAL_TTS_URL } : {}) }
        : { sttTier: t, ...(t === "local" && !settings.localSttUrl ? { localSttUrl: LOCAL_STT_URL } : {}) },
    );

  return (
    <>
      <SourceSelect
        value={tier}
        onPick={pick}
        now={engineName({ ...settings, [tts ? "ttsTier" : "sttTier"]: "auto" } as Settings, half)}
        gate={cloudGate(settings)}
      />

      {tier === "auto" && (
        <div className="desc" style={{ padding: "12px 4px 4px", maxWidth: 460, lineHeight: 1.5 }}>
          Verba walks bundled, then your own server, then the cloud, then the system — and uses the first that is
          actually there. {tts ? "Voices are" : "Dictation models are"} downloaded under Speech and listening.
        </div>
      )}

      {tier === "bundled" && (
        <div className="desc" style={{ padding: "12px 4px 4px", maxWidth: 460, lineHeight: 1.5 }}>
          Runs on this machine, with nothing to configure here. Which {tts ? "voice" : "model"} it uses is chosen under
          Speech and listening.
        </div>
      )}

      {tier === "local" && (
        <div style={{ paddingTop: 14 }}>
          <div className="field">
            <label>Server</label>
            <input
              placeholder={tts ? LOCAL_TTS_URL : LOCAL_STT_URL}
              value={tts ? settings.localTtsUrl : settings.localSttUrl}
              onChange={(e) => onChange(tts ? { localTtsUrl: e.target.value } : { localSttUrl: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Model</label>
            <input
              value={tts ? settings.localTtsModel : settings.localSttModel}
              onChange={(e) => onChange(tts ? { localTtsModel: e.target.value } : { localSttModel: e.target.value })}
            />
          </div>
          {tts && (
            <div className="field">
              <label>Voice</label>
              <input
                placeholder="af_heart"
                value={settings.localTtsVoice}
                onChange={(e) => onChange({ localTtsVoice: e.target.value })}
              />
            </div>
          )}
          <ServerStatus
            name={tts ? "Kokoro server" : "speaches server"}
            url={tts ? settings.localTtsUrl : settings.localSttUrl}
          />
        </div>
      )}

      {tier === "cloud" && (
        <div className="field" style={{ marginTop: 14 }}>
          <label>
            {tts ? "ElevenLabs key" : "Deepgram key"} {cloudGate(settings) && <Because gate={cloudGate(settings)!} />}
          </label>
          <input
            type="password"
            disabled={settings.offline}
            placeholder={tts ? "Empty → your system voices" : deepgramHelp(settings, whisperReady)}
            value={tts ? settings.elevenLabsKey : settings.deepgramKey}
            onChange={(e) => onChange(tts ? { elevenLabsKey: e.target.value } : { deepgramKey: e.target.value })}
          />
        </div>
      )}

      {tier === "native" && (
        <div className="desc" style={{ padding: "14px 4px 4px" }}>
          Uses the OS {tts ? "voice" : "speech recognition"}. Nothing to set up.
        </div>
      )}
    </>
  );
}

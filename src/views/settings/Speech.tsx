// Settings → Speech and listening (spec §5.4). Two halves, two questions: how does
// Verba speak, and how does it hear me?
//
// Both are answered by doing rather than by reading. A voice is chosen by hearing
// it — including the ones that are not downloaded yet, because committing 349 MB
// to a voice you have never heard is the thing this section exists to stop. The
// microphone is chosen by speaking into it and reading back what came through.
//
// What is *not* here: which engine drives either half. That question belongs to a
// different kind of person and lives under Advanced; this page names the engine in
// one line and links there.
import { useEffect, useRef, useState } from "react";
import type { Settings } from "../../lib/settings";
import { langName } from "../../lib/langs";
import { AT } from "../../lib/rules";
import {
  bundledTts,
  getSpeech,
  listenBlocker,
  mic,
  micDevices,
  micTrouble,
  resolveTier,
  tierName,
  type MicDevice,
  type Tier,
} from "../../lib/speech";
import {
  CATALOG,
  catalogModel,
  download,
  installed as listInstalled,
  noVoiceNote,
  remove,
  sampleLine,
  sizeLabel,
  voiceList,
  voiceOf,
  voicesFor,
  type CatalogModel,
  type Installed,
  type ModelState,
  type Voice,
} from "../../lib/bundled";
import { listPacks } from "../../lib/packs";
import { humanError } from "../../lib/fmt";
import { linkish, ToggleRow, type SectionProps } from "./parts";

const langNames = (ls: string[]) => ls.map(langName).join(", ") || "any language";

/** Everything a row needs from the section around it, in one bag. */
interface Shelf {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  packLang: string;
  recommended: string; // exactly one model id, or ""
  installed: Record<string, Installed>;
  refresh: () => Promise<void>;
}

// ---- hearing a voice ----

/**
 * Play one voice's sample, downloading the model first if it is not here yet.
 *
 * The download *is* the preview — there is no audition without the weights, and
 * pretending otherwise (an OS voice standing in for Piper) would be a demo of a
 * voice the learner is not choosing. So the button says what it costs before it
 * is pressed, and the row shows the progress bar it always did.
 */
async function audition(
  m: CatalogModel,
  voice: Voice | undefined,
  here: boolean,
  set: (s: ModelState) => void,
  refresh: () => Promise<void>,
): Promise<boolean> {
  try {
    if (!here) {
      set({ s: "downloading", pct: 0 });
      await download(m.id, (pct) => set({ s: "downloading", pct }));
      await refresh();
    }
    set({ s: "playing" });
    await bundledTts(m.id, voice?.sid ?? 0).speak(sampleLine(voice?.lang ?? "en"));
    set({ s: "ready", bytes: 0 });
    return true;
  } catch (e) {
    // A failed sample never reaches the learner raw (PLAN-015): the detail goes
    // to the log, and the button shows one calm sentence.
    const { say, log } = humanError(e);
    console.warn("[speech] sample playback failed:", log);
    set({ s: "failed", why: say });
    return false;
  }
}

/**
 * One voice model. The radio only appears once the files are here, because until
 * then there is nothing to select — the way to get there is to listen to it.
 */
function VoiceRow({ m, shelf }: { m: CatalogModel; shelf: Shelf }) {
  const { settings, onChange, packLang, recommended, installed, refresh } = shelf;
  const [state, setState] = useState<ModelState>({ s: "absent" });
  const [leaving, setLeaving] = useState(false);
  const [showVoices, setShowVoices] = useState(false);

  const here = !!installed[m.id];
  const chosen = settings.bundledTtsModel === m.id;

  /** The voice to start on: one that speaks the language being learned, if any. */
  const preferred = m.voices.find((v) => v.lang === packLang) ?? m.voices[0];
  const shown = chosen ? (voiceOf(m.id, settings.bundledTtsVoice) ?? preferred) : preferred;

  const choose = (sid = preferred?.sid ?? 0) => onChange({ bundledTtsModel: m.id, bundledTtsVoice: sid });

  const st: ModelState = state.s === "absent" && here ? { s: "ready", bytes: installed[m.id].bytes } : state;

  const hear = (v: Voice | undefined) =>
    void audition(m, v, !!installed[m.id], setState, refresh).then((ok) => {
      // Hearing a voice that nothing else has claimed is as clear a "I want this"
      // as clicking the radio would have been, and saves a second click that only
      // ever has one right answer.
      if (ok && !settings.bundledTtsModel) choose(v?.sid);
    });

  return (
    <div style={{ padding: "12px 4px", borderBottom: "1px solid var(--line2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {here && (
          <button
            className={`radio ${chosen ? "on" : ""}`}
            onClick={() => choose(shown?.sid)}
            aria-label={`Speak with ${m.label}`}
            aria-pressed={chosen}
            style={{ padding: 0, cursor: "pointer" }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div className="name">
            {m.label}
            {shown ? ` · ${shown.name}` : ""}
            {recommended === m.id ? <span> · recommended</span> : ""}
          </div>
          <div className="desc">
            {langNames(m.langs)} · {sizeLabel(m)}
            {st.s === "failed" ? ` · ${st.why}` : ""}
          </div>
        </div>

        {st.s === "downloading" ? (
          <div className="model">{st.pct.toFixed(0)}%</div>
        ) : (
          <>
            <button className="model" style={linkish} onClick={() => hear(shown)} disabled={st.s === "playing"}>
              {st.s === "playing" ? "playing…" : here ? "hear it" : st.s === "failed" ? "retry" : `hear it · ${sizeLabel(m)}`}
            </button>
            {here && (
              <button className="model" style={linkish} onClick={() => setLeaving(true)}>
                remove
              </button>
            )}
          </>
        )}
      </div>

      {st.s === "downloading" && (
        <div style={{ height: 2, background: "var(--line2)", marginTop: 8 }}>
          <div style={{ height: 2, width: `${st.pct}%`, background: "var(--fg)" }} />
        </div>
      )}

      {leaving && <Removing m={m} shelf={shelf} close={() => setLeaving(false)} />}

      {/* Kokoro carries 14 curated voices and every one of them is auditionable —
          "hear every voice" means the voices, not one per model. Piper carries a
          single voice, so there is nothing to open. */}
      {here && m.voices.length > 1 && (
        <div style={{ paddingTop: 10 }}>
          <button className="model" style={linkish} onClick={() => setShowVoices(!showVoices)}>
            {showVoices ? "hide voices" : `${m.voices.length} voices · choose`}
          </button>
          {showVoices && (
            <VoicePicker m={m} shelf={shelf} chosen={chosen} onPick={choose} onHear={(v) => hear(v)} playing={st.s === "playing"} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The voices inside one model, the language being learned first.
 *
 * The heading over each group is the language of every voice under it — §5.4 is
 * blunt about this ("bir başlık, altındaki içerikle çelişemez"), and a "Spanish"
 * group with an English voice in it is exactly the contradiction it names.
 */
function VoicePicker({
  m,
  shelf,
  chosen,
  onPick,
  onHear,
  playing,
}: {
  m: CatalogModel;
  shelf: Shelf;
  chosen: boolean;
  onPick: (sid: number) => void;
  onHear: (v: Voice) => void;
  playing: boolean;
}) {
  const { settings, packLang } = shelf;
  const [showAll, setShowAll] = useState(false);
  const { mine, others } = voicesFor(m, packLang);

  const row = (v: Voice) => (
    <div key={v.sid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 6px 12px" }}>
      <button
        className={`radio ${chosen && settings.bundledTtsVoice === v.sid ? "on" : ""}`}
        onClick={() => onPick(v.sid)}
        aria-label={`Speak with ${v.name}`}
        aria-pressed={chosen && settings.bundledTtsVoice === v.sid}
        style={{ padding: 0, cursor: "pointer" }}
      />
      <div className="desc" style={{ flex: 1 }}>{v.name}</div>
      <button className="model" style={linkish} onClick={() => onHear(v)} disabled={playing}>
        hear it
      </button>
    </div>
  );

  const group = (lang: string, vs: Voice[]) => (
    <div key={lang} style={{ marginTop: 8 }}>
      <div className="eyebrow" style={{ marginBottom: 2 }}>{langNames([lang])}</div>
      {vs.map(row)}
    </div>
  );

  return (
    <div style={{ paddingTop: 6 }}>
      {mine.length > 0 && group(packLang, mine)}
      {showAll ? (
        others.map((g) => group(g.lang, g.voices))
      ) : (
        others.length > 0 && (
          <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setShowAll(true)}>
            Other languages ({others.length})
          </button>
        )
      )}
    </div>
  );
}

/**
 * Removing a voice that is doing the talking (§5.4: "kullanımdaki ses kaldırılmak
 * istendiğinde önce yerine ne geçeceği sorulur").
 *
 * Deleting the voice in use is not a destructive act — the files come back with
 * one download — but it silently changes how the coach sounds on the next turn,
 * and a change nobody chose is a change nobody can undo. So the replacement is
 * picked *before* the files go, and the default answer is spelled out rather than
 * left to be discovered.
 */
function Removing({ m, shelf, close }: { m: CatalogModel; shelf: Shelf; close: () => void }) {
  const { settings, onChange, packLang, installed, refresh } = shelf;
  const inUse = settings.bundledTtsModel === m.id;

  // Every other voice that is actually on disk, with the voice each would start on.
  const others = CATALOG.filter((o) => o.half === "tts" && o.id !== m.id && installed[o.id]).map((o) => {
    const v = o.voices.find((x) => x.lang === packLang) ?? o.voices[0];
    return { id: o.id, sid: v?.sid ?? 0, label: `${o.label}${v ? ` · ${v.name}` : ""}` };
  });

  // What speaks if nothing here is chosen — the same walk the adapter does, so the
  // sentence and the next turn cannot disagree.
  const fallback = tierName(resolveTier({ ...settings, bundledTtsModel: "" }, "tts"), "tts");
  const [pick, setPick] = useState("");

  async function go() {
    if (inUse)
      onChange(
        pick
          ? { bundledTtsModel: pick, bundledTtsVoice: others.find((o) => o.id === pick)?.sid ?? 0 }
          : { bundledTtsModel: "", bundledTtsVoice: 0 },
      );
    await remove(m.id);
    await refresh();
    close();
  }

  return (
    <div style={{ padding: "12px 0 4px" }}>
      <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5 }}>
        {inUse
          ? `Verba speaks with this voice. Remove it and something else has to.`
          : `Remove ${m.label}? The download is ${sizeLabel(m)} if you want it back.`}
      </div>

      {inUse && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>Then speak with</label>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{fallback}</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button className="btn sm" onClick={() => void go()}>
          Remove
        </button>
        <button className="btn sm ghost" onClick={close}>
          Keep it
        </button>
      </div>
    </div>
  );
}

/**
 * A dictation model, offered as the trade it is rather than as its name.
 *
 * §5.4 keeps the model's name out of this page — "faster" against "more accurate,
 * slower" is the question a learner can answer, and "Whisper base" is not. The
 * name is in Advanced, next to everything else technical. The size stays on the
 * button: what a row is called is a description, but pressing download is a
 * commitment, and a commitment states its cost.
 */
function DictationRow({ m, shelf }: { m: CatalogModel; shelf: Shelf }) {
  const { settings, onChange, installed, refresh } = shelf;
  const [state, setState] = useState<ModelState>({ s: "absent" });

  const here = !!installed[m.id];
  const chosen = settings.bundledSttModel === m.id;
  const st: ModelState = state.s === "absent" && here ? { s: "ready", bytes: installed[m.id].bytes } : state;

  async function get() {
    setState({ s: "downloading", pct: 0 });
    try {
      await download(m.id, (pct) => setState({ s: "downloading", pct }));
      setState({ s: "ready", bytes: 0 });
      await refresh();
      if (!settings.bundledSttModel) onChange({ bundledSttModel: m.id });
    } catch (e) {
      const { say, log } = humanError(e);
      console.warn("[speech] model download failed:", log);
      setState({ s: "failed", why: say });
    }
  }

  async function drop() {
    await remove(m.id);
    if (chosen) onChange({ bundledSttModel: "" });
    setState({ s: "absent" });
    await refresh();
  }

  return (
    <div style={{ padding: "12px 4px", borderBottom: "1px solid var(--line2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {here && (
          <button
            className={`radio ${chosen ? "on" : ""}`}
            onClick={() => onChange({ bundledSttModel: chosen ? "" : m.id })}
            aria-label={`Listen with the ${m.tradeoff} model`}
            aria-pressed={chosen}
            style={{ padding: 0, cursor: "pointer" }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div className="name">{m.tradeoff ?? m.label}</div>
          <div className="desc">
            Understands any language
            {st.s === "failed" ? ` · ${st.why}` : ""}
          </div>
        </div>
        {st.s === "downloading" ? (
          <div className="model">{st.pct.toFixed(0)}%</div>
        ) : here ? (
          <button className="model" style={linkish} onClick={() => void drop()}>
            remove
          </button>
        ) : (
          <button className="model" style={linkish} onClick={() => void get()}>
            {st.s === "failed" ? "retry" : `download · ${sizeLabel(m)}`}
          </button>
        )}
      </div>
      {st.s === "downloading" && (
        <div style={{ height: 2, background: "var(--line2)", marginTop: 8 }}>
          <div style={{ height: 2, width: `${st.pct}%`, background: "var(--fg)" }} />
        </div>
      )}
    </div>
  );
}

// ---- the microphone ----

/**
 * §5.4: "kullanıcı konuşur, seviye göstergesini görür, söylediğinin yazıya
 * dökülmüş hâlini okur. Konuşma özelliği, çalıştığı görülmeden kullanılmaz."
 *
 * Two signals, not one, because they fail separately and mean different things: a
 * bar that never moves is a microphone problem, and a moving bar with no words
 * back is a dictation problem. Both go through the same doors Talk uses — the same
 * `mic()` for the device, the same adapter for the transcription — so a test that
 * passes here is not a test of something else.
 */
function MicTest({ settings, onChange }: SectionProps) {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [phase, setPhase] = useState<"idle" | "listening" | "thinking">("idle");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState<string | null>(null);
  const [trouble, setTrouble] = useState("");
  const stop = useRef<(() => void) | null>(null);

  const list = () => void micDevices().then(setDevices);
  useEffect(list, []);
  // The meter and the recorder are two independent streams; leaving either one
  // open would hold the microphone after the panel is gone.
  useEffect(() => () => stop.current?.(), []);

  const locale = listPacks().find((p) => p.id === settings.packId)?.speech.locale;
  const deaf = listenBlocker(settings);

  async function start() {
    setTrouble("");
    setHeard(null);

    let stream: MediaStream;
    try {
      stream = await mic(settings.micDeviceId);
    } catch (e) {
      setTrouble(micTrouble(e));
      return;
    }
    // Device *names* are withheld until a page has held the microphone once, so
    // the list is only worth re-reading now — before this, every entry is blank.
    list();

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      // RMS of speech at a normal distance sits near 0.05; ×6 puts that around a
      // third of the bar, so a quiet talker still sees it move.
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
      frame = requestAnimationFrame(tick);
    };
    tick();

    const closeMeter = () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      setLevel(0);
    };

    const stt = getSpeech(settings);
    setPhase("listening");

    if (!stt.canListen) {
      // The bar still answers "does this machine hear me", which is the half that
      // has to work before dictation is worth setting up at all.
      stop.current = () => {
        closeMeter();
        setPhase("idle");
        stop.current = null;
      };
      return;
    }

    const said = stt.listen(locale);
    stop.current = () => {
      stt.cancel();
      closeMeter();
      setPhase("thinking");
      stop.current = null;
    };
    try {
      setHeard((await said).trim());
    } catch (e) {
      setTrouble(micTrouble(e));
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div style={{ padding: "4px 4px 0" }}>
      {devices.length > 1 && (
        <div className="field" data-setting="microphone">
          <label>Microphone</label>
          <select value={settings.micDeviceId} onChange={(e) => onChange({ micDeviceId: e.target.value })}>
            <option value="">System default</option>
            {devices.map((d, i) => (
              <option key={d.id} value={d.id}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0" }}>
        <button className="btn sm" onClick={() => (phase === "idle" ? void start() : stop.current?.())} disabled={phase === "thinking"}>
          {phase === "idle" ? "Test the microphone" : phase === "listening" ? "Stop" : "Working…"}
        </button>
        <div style={{ flex: 1, maxWidth: 260, height: 6, background: "var(--line2)", borderRadius: 3 }}>
          <div
            style={{
              height: 6,
              width: `${level * 100}%`,
              background: level > 0.02 ? "var(--good)" : "var(--line2)",
              borderRadius: 3,
              transition: "width 60ms linear",
            }}
          />
        </div>
      </div>

      {phase === "listening" && (
        <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5 }}>
          Say a few words. The bar should move while you talk — press Stop when you are done.
        </div>
      )}

      {heard !== null && (
        <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, paddingTop: 4 }}>
          {heard ? (
            <>
              Verba heard: <strong style={{ color: "var(--fg)", fontWeight: 500 }}>“{heard}”</strong>
            </>
          ) : (
            "Nothing came through. If the bar did move, the dictation model heard silence — try again a little closer to the microphone."
          )}
        </div>
      )}

      {trouble && (
        <div className="desc" style={{ color: "var(--sev)", maxWidth: 460, lineHeight: 1.5, paddingTop: 4 }}>
          {trouble}
        </div>
      )}

      {deaf && phase === "idle" && heard === null && (
        <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, paddingTop: 4 }}>
          The bar will show whether this machine hears you, but nothing can write down what you said yet — pick a
          dictation model below first.
        </div>
      )}
    </div>
  );
}

// ---- the section ----

export default function Speech({ settings, onChange }: SectionProps) {
  const [installed, setInstalled] = useState<Record<string, Installed>>({});
  const [loaded, setLoaded] = useState(false);
  // null (no store to ask — a browser dev server) renders the same as nothing
  // installed: every row offers to download, and nothing claims to be here.
  const refresh = () =>
    listInstalled().then((list) => {
      setInstalled(Object.fromEntries((list ?? []).map((m) => [m.id, m])));
      setLoaded(true);
    });
  useEffect(() => {
    void refresh();
  }, []);

  const pack = listPacks().find((p) => p.id === settings.packId);
  const { mine, rest, recommended } = voiceList(settings.packId, pack?.speech.recommendedVoices ?? []);
  const shelf: Shelf = { settings, onChange, packLang: settings.packId, recommended, installed, refresh };
  const noVoice = noVoiceNote(mine, langName(settings.packId));

  // The tier actually serving each half right now, through the same precedence the
  // adapter walks — so the panel cannot claim one thing while Talk does another.
  const ttsNow = resolveTier(settings, "tts");
  const sttNow = resolveTier(settings, "stt");

  const bundledVoice = () => {
    const m = catalogModel(settings.bundledTtsModel);
    const v = voiceOf(settings.bundledTtsModel, settings.bundledTtsVoice);
    return m ? `${m.label}${v ? ` · ${v.name}` : ""}` : "no voice chosen";
  };

  /** What each half is doing right now, and what it costs — the status line. */
  const usingTts = (t: Exclude<Tier, "auto">) =>
    t === "bundled"
      ? `${bundledVoice()}, on this machine — offline, no key`
      : t === "cloud"
        ? `${tierName(t, "tts")} — needs the network and your key`
        : t === "local"
          ? `${tierName(t, "tts")} — offline, no key`
          : `${tierName(t, "tts")} — basic, works everywhere`;

  const usingStt = (t: Exclude<Tier, "auto">) =>
    t === "bundled"
      ? // The trade, not the name: the name is Advanced's business (§5.4).
        `${catalogModel(settings.bundledSttModel)?.tradeoff ?? "dictation"}, on this machine — offline, no key`
      : t === "cloud"
        ? `${tierName(t, "stt")} — needs the network and your key`
        : t === "local"
          ? `${tierName(t, "stt")} — offline, no key`
          : listenBlocker(settings)
            ? "nothing — this system has no speech recognition"
            : `${tierName(t, "stt")} — basic, works everywhere`;

  const statusLine = (text: string) => (
    <div className="desc" style={{ padding: "2px 4px 12px", maxWidth: 480, lineHeight: 1.5 }}>
      <strong style={{ color: "var(--fg)", fontWeight: 500 }}>Using:</strong> {text}
    </div>
  );

  /**
   * Which engine is doing this, and where to change it. The choice itself lives in
   * Advanced (§5.4): a learner picking a voice is picking a voice, and the
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

  const [showAll, setShowAll] = useState(false);

  return (
    <>
      <div className="sec">Voice</div>
      <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, marginBottom: 4 }}>How Verba speaks.</div>

      <div data-setting="speak">
        <ToggleRow
          title="Read replies aloud"
          desc="The coach speaks each turn as it arrives."
          on={settings.speak}
          onClick={() => onChange({ speak: !settings.speak })}
        />
      </div>

      {statusLine(usingTts(ttsNow))}
      {engineLine()}

      {!loaded ? (
        <div className="desc" style={{ padding: "12px 4px" }}>Checking what is installed…</div>
      ) : (
        <div style={{ paddingTop: 8 }} data-setting="voice">
          <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, paddingBottom: 6 }}>
            Every voice can be heard before you keep it. Pressing <em>hear it</em> on one that is not here yet
            downloads it first — the size is on the button.
          </div>

          {noVoice ? (
            <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, padding: "8px 0 2px" }}>
              {noVoice}
            </div>
          ) : (
            <div>
              <div className="eyebrow" style={{ margin: "10px 0 2px" }}>{langNames([settings.packId])}</div>
              {mine.map((m) => (
                <VoiceRow key={m.id} m={m} shelf={shelf} />
              ))}
            </div>
          )}

          {/* Nothing is hidden for good: Kokoro speaks no Turkish, but a learner who
              wants to hear it try is one disclosure away. */}
          {showAll ? (
            <div>
              <div className="eyebrow" style={{ margin: "18px 0 2px" }}>Other languages</div>
              {rest.map((m) => (
                <VoiceRow key={m.id} m={m} shelf={shelf} />
              ))}
            </div>
          ) : (
            rest.length > 0 && (
              <button className="btn sm ghost" style={{ marginTop: 14 }} onClick={() => setShowAll(true)}>
                Other languages ({rest.length})
              </button>
            )
          )}
        </div>
      )}

      <div className="sec" style={{ marginTop: 44 }}>Dictation</div>
      <div className="desc" style={{ maxWidth: 460, lineHeight: 1.5, marginBottom: 4 }}>How Verba hears you.</div>

      <div data-setting="dictation">
        <MicTest settings={settings} onChange={onChange} />
      </div>

      {statusLine(usingStt(sttNow))}
      {engineLine()}

      {loaded && (
        <div style={{ paddingTop: 8 }}>
          {CATALOG.filter((m) => m.half === "stt").map((m) => (
            <DictationRow key={m.id} m={m} shelf={shelf} />
          ))}
        </div>
      )}
    </>
  );
}

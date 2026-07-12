import { useEffect, useState } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import type { ProviderId, SpeechEngine, Settings } from "../lib/settings";
import { getProvider } from "../lib/providers";
import { registry, getPack, importPack, originLabel } from "../lib/packs";
import { latestLevelSignal } from "../lib/db";
import { webSpeech } from "../lib/speech";

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
const speech = webSpeech();

export default function SettingsView({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const [test, setTest] = useState("");
  const [packs, setPacks] = useState(() => registry());
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [level, setLevel] = useState<{ estimate: string; confidence: string; rationale: string } | null>(null);
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  useEffect(() => {
    latestLevelSignal(settings.targetLang)
      .then(setLevel)
      .catch(() => {});
  }, [settings.targetLang]);

  /** Selecting a pack also sets the target language name from the pack. */
  function selectPack(id: string) {
    const p = getPack(id);
    set(p ? { packId: id, targetLang: p.name } : { packId: id });
  }

  function doImport() {
    try {
      const p = importPack(importText);
      setPacks(registry());
      setImportText("");
      setImportMsg(`✅ Imported ${p.name} (${p.id}) — labelled Unverified until reviewed.`);
    } catch (e: any) {
      setImportMsg(`❌ ${e?.message ?? e}`);
    }
  }

  async function testConnection() {
    setTest("Testing…");
    try {
      if (settings.provider === "ollama") {
        const r = await fetch(`${settings.ollamaHost}/api/tags`);
        const d = await r.json();
        const models = (d.models ?? []).map((m: any) => m.name).join(", ");
        setTest(`✅ Ollama reachable. Models: ${models || "(none)"}`);
      } else {
        const reply = await getProvider(settings).chat(
          [{ role: "user", content: "Reply with the single word: ok" }],
          { temperature: 0 },
        );
        setTest(`✅ Reply: ${reply.slice(0, 60)}`);
      }
    } catch (e: any) {
      setTest(`❌ ${e?.message ?? e}`);
    }
  }

  return (
    <div className="settings">
      <h1>Settings</h1>

      <section>
        <h3>Language</h3>
        <label>
          Language pack
          <select value={settings.packId} onChange={(e) => selectPack(e.target.value)}>
            <option value="">None (freeform)</option>
            {packs.map(({ pack: p, origin, verified }) => (
              <option key={p.id} value={p.id}>
                {p.emoji} {p.name} — {p.nativeName} {verified ? "" : "· ⚠️ "}[{originLabel(origin)}]
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Packs are labelled <strong>Official</strong>, <strong>Community</strong> (both reviewed), or{" "}
          <strong>Unverified</strong> (imported by you, not reviewed).
        </p>
        <label>
          I am learning
          <input value={settings.targetLang} onChange={(e) => set({ targetLang: e.target.value })} />
        </label>
        <label>
          My native language
          <input value={settings.nativeLang} onChange={(e) => set({ nativeLang: e.target.value })} />
        </label>
        <label>
          My level
          <select value={settings.cefr} onChange={(e) => set({ cefr: e.target.value })}>
            {CEFR.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <p className="muted">Level is self-reported — Speaksy gives soft feedback, not an official CEFR assessment.</p>
        {level && (
          <p className="muted">
            Recent AI estimate: <strong>{level.estimate}</strong> ({level.confidence} confidence)
            {level.rationale ? ` — ${level.rationale}` : ""}
          </p>
        )}
      </section>

      <section>
        <h3>Speech</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.speak}
            onChange={(e) => set({ speak: e.target.checked })}
          />
          Read replies and reading text aloud (offline TTS)
        </label>
        <p className="muted">
          {speech.canSpeak ? "🔊 Text-to-speech available." : "Text-to-speech not available in this webview."}{" "}
          {speech.canListen ? "🎤 Voice input available." : "Voice input not available here."}
        </p>
        <label>
          Speech engine
          <select
            value={settings.speechEngine}
            onChange={(e) => set({ speechEngine: e.target.value as SpeechEngine })}
          >
            <option value="web">Native (offline)</option>
            <option value="elevenlabs">ElevenLabs (cloud TTS)</option>
            <option value="deepgram">Deepgram (cloud STT)</option>
          </select>
        </label>
        {settings.speechEngine === "elevenlabs" && (
          <label>
            ElevenLabs API key
            <input
              type="password"
              value={settings.elevenLabsKey}
              onChange={(e) => set({ elevenLabsKey: e.target.value })}
            />
          </label>
        )}
        {settings.speechEngine === "deepgram" && (
          <label>
            Deepgram API key
            <input
              type="password"
              value={settings.deepgramKey}
              onChange={(e) => set({ deepgramKey: e.target.value })}
            />
          </label>
        )}
        <p className="muted">
          Cloud engines cover one half of the loop (ElevenLabs speaks, Deepgram listens); the other half falls back to
          the native webview.
        </p>
      </section>

      <section>
        <h3>Import language pack</h3>
        <p className="muted">Paste a pack JSON to add or update a language (community packs, format v1).</p>
        <textarea
          className="import"
          value={importText}
          placeholder='{ "formatVersion": 1, "id": "it", "name": "Italian", … }'
          onChange={(e) => setImportText(e.target.value)}
        />
        <button onClick={doImport} disabled={!importText.trim()}>
          Import pack
        </button>
        {importMsg && <p className="test" style={{ whiteSpace: "pre-line" }}>{importMsg}</p>}
      </section>

      <section>
        <h3>AI provider</h3>
        <label>
          Provider
          <select
            value={settings.provider}
            onChange={(e) => set({ provider: e.target.value as ProviderId })}
          >
            <option value="ollama">Ollama (offline / local)</option>
            <option value="lmstudio">LM Studio (offline / local)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini (Google)</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </label>

        {settings.provider === "ollama" && (
          <>
            <label>
              Host
              <input value={settings.ollamaHost} onChange={(e) => set({ ollamaHost: e.target.value })} />
            </label>
            <label>
              Model
              <input value={settings.ollamaModel} onChange={(e) => set({ ollamaModel: e.target.value })} />
            </label>
          </>
        )}
        {settings.provider === "openai" && (
          <>
            <label>
              Model
              <input value={settings.openaiModel} onChange={(e) => set({ openaiModel: e.target.value })} />
            </label>
            <label>
              API key
              <input type="password" value={settings.openaiKey} onChange={(e) => set({ openaiKey: e.target.value })} />
            </label>
          </>
        )}
        {settings.provider === "anthropic" && (
          <>
            <label>
              Model
              <input value={settings.anthropicModel} onChange={(e) => set({ anthropicModel: e.target.value })} />
            </label>
            <label>
              API key
              <input
                type="password"
                value={settings.anthropicKey}
                onChange={(e) => set({ anthropicKey: e.target.value })}
              />
            </label>
          </>
        )}
        {settings.provider === "gemini" && (
          <>
            <label>
              Model
              <input value={settings.geminiModel} onChange={(e) => set({ geminiModel: e.target.value })} />
            </label>
            <label>
              API key
              <input type="password" value={settings.geminiKey} onChange={(e) => set({ geminiKey: e.target.value })} />
            </label>
          </>
        )}
        {settings.provider === "openrouter" && (
          <>
            <label>
              Model
              <input value={settings.openrouterModel} onChange={(e) => set({ openrouterModel: e.target.value })} />
            </label>
            <label>
              API key
              <input
                type="password"
                value={settings.openrouterKey}
                onChange={(e) => set({ openrouterKey: e.target.value })}
              />
            </label>
          </>
        )}
        {settings.provider === "lmstudio" && (
          <>
            <label>
              Host
              <input value={settings.lmstudioHost} onChange={(e) => set({ lmstudioHost: e.target.value })} />
            </label>
            <label>
              Model
              <input value={settings.lmstudioModel} onChange={(e) => set({ lmstudioModel: e.target.value })} />
            </label>
          </>
        )}

        <button onClick={testConnection}>Test connection</button>
        {test && <p className="test">{test}</p>}
      </section>
    </div>
  );
}

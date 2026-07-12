import { useMemo, useState } from "react";
import type { Settings } from "../lib/settings";
import { getProvider } from "../lib/providers";
import { getPack } from "../lib/packs";
import {
  storyPrompt,
  continueReadingPrompt,
  explainWordPrompt,
  parseReading,
  parseWordExplanation,
  type ReadingText,
  type WordExplanation,
  type StoryOptions,
} from "../lib/reading";
import { saveReading, addVocab } from "../lib/db";
import { getSpeech } from "../lib/speech";

export default function Reading({ settings }: { settings: Settings }) {
  const speech = useMemo(
    () => getSpeech(settings),
    [settings.speechEngine, settings.elevenLabsKey, settings.deepgramKey],
  );
  const [opts, setOpts] = useState<StoryOptions>({ interests: "", goal: "", sentences: 8 });
  const [text, setText] = useState<ReadingText | null>(null);
  const [sel, setSel] = useState<number | null>(null); // synced sentence highlight
  const [word, setWord] = useState<WordExplanation | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const pack = useMemo(() => getPack(settings.packId), [settings.packId]);
  const dir = pack?.direction ?? "ltr";

  async function generate() {
    setError("");
    setWord(null);
    setSel(null);
    setBusy("Writing your story…");
    try {
      const raw = await getProvider(settings).chat([{ role: "user", content: storyPrompt(settings, opts, pack) }], {
        json: true,
      });
      const t = parseReading(raw);
      if (!t.sentences.length) throw new Error("The model returned no readable sentences — try again.");
      setText(t);
      await persist(t);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy("");
    }
  }

  async function flowMore() {
    if (!text) return;
    setBusy("Continuing…");
    setError("");
    try {
      const raw = await getProvider(settings).chat(
        [{ role: "user", content: continueReadingPrompt(settings, text, pack) }],
        { json: true },
      );
      const more = parseReading(raw);
      const merged = { title: text.title, sentences: [...text.sentences, ...more.sentences] };
      setText(merged);
      await persist(merged);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy("");
    }
  }

  async function persist(t: ReadingText) {
    try {
      await saveReading(settings.targetLang, t.title, t);
    } catch {
      /* reading still works without history */
    }
  }

  async function explain(w: string, sentence: string) {
    const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!clean) return;
    setWord({ word: clean, meaning: "…", lemma: "", note: "" });
    try {
      const raw = await getProvider(settings).chat([{ role: "user", content: explainWordPrompt(settings, clean, sentence) }], {
        json: true,
      });
      setWord(parseWordExplanation(raw));
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setWord(null);
    }
  }

  function speak(sentence: string) {
    if (!speech.canSpeak) return;
    speech.speak(sentence, { locale: pack?.speech.locale, voiceHint: pack?.speech.voiceHint });
  }

  // ---- setup form ----
  if (!text) {
    return (
      <div className="reading">
        <h1>Reading</h1>
        <p className="muted">
          Generate a level-appropriate story in <strong>{settings.targetLang}</strong> ({settings.cefr}) with a native
          translation alongside.
        </p>
        <div className="reading-setup">
          <label>
            Interests (optional)
            <input
              value={opts.interests}
              placeholder="space travel, cooking, football…"
              onChange={(e) => setOpts({ ...opts, interests: e.target.value })}
            />
          </label>
          <label>
            Grammar focus (optional)
            <input
              value={opts.goal}
              placeholder="past tense, questions…"
              onChange={(e) => setOpts({ ...opts, goal: e.target.value })}
            />
          </label>
          <label>
            Length
            <select
              value={opts.sentences}
              onChange={(e) => setOpts({ ...opts, sentences: Number(e.target.value) })}
            >
              <option value={5}>Short (~5)</option>
              <option value={8}>Medium (~8)</option>
              <option value={14}>Long (~14)</option>
            </select>
          </label>
          <button className="primary" onClick={generate} disabled={!!busy}>
            {busy || "Generate story"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  // ---- dual-page reader ----
  return (
    <div className="reading">
      <header className="chat-head">
        <div>📖 {text.title}</div>
        <div className="chat-actions">
          {speech.canSpeak && (
            <button className="ghost" onClick={() => speak(text.sentences.map((s) => s.target).join(" "))}>
              🔊 Read all
            </button>
          )}
          <button className="ghost" onClick={flowMore} disabled={!!busy}>
            {busy || "Continue ↓"}
          </button>
          <button className="ghost" onClick={() => setText(null)}>
            New
          </button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="pages" dir={dir}>
        <div className="page target">
          {text.sentences.map((s, i) => (
            <span
              key={i}
              className={`sentence ${sel === i ? "hl" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => speak(s.target)}
            >
              {s.target.split(/(\s+)/).map((tok, j) =>
                tok.trim() ? (
                  <span
                    key={j}
                    className="word"
                    onClick={(e) => {
                      e.stopPropagation();
                      explain(tok, s.target);
                    }}
                  >
                    {tok}
                  </span>
                ) : (
                  tok
                ),
              )}{" "}
            </span>
          ))}
        </div>
        <div className="page native" dir="ltr">
          {text.sentences.map((s, i) => (
            <span
              key={i}
              className={`sentence ${sel === i ? "hl" : ""}`}
              onMouseEnter={() => setSel(i)}
            >
              {s.native}{" "}
            </span>
          ))}
        </div>
      </div>

      {word && (
        <div className="word-card">
          <button className="close" onClick={() => setWord(null)}>
            ✕
          </button>
          <div className="w-term">
            {word.word}
            {word.lemma && word.lemma !== word.word && <span className="w-lemma"> · {word.lemma}</span>}
          </div>
          <div className="w-meaning">{word.meaning}</div>
          {word.note && <div className="w-note">{word.note}</div>}
          <div className="w-actions">
            {speech.canSpeak && (
              <button className="ghost" onClick={() => speak(word.lemma || word.word)}>
                🔊
              </button>
            )}
            <button
              className="ghost"
              onClick={() =>
                addVocab({ term: word.lemma || word.word, translation: word.meaning, example: "" }).catch(() => {})
              }
            >
              ＋ Save word
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

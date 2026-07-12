import { useEffect, useMemo, useRef, useState } from "react";
import type { Settings } from "../lib/settings";
import { getProvider, type ChatMessage } from "../lib/providers";
import {
  buildSystem,
  parseTurn,
  vocabPrompt,
  parseVocab,
  summaryPrompt,
  parseSummary,
  type SessionSummary,
} from "../lib/prompts";
import { listScenarios, type Scenario } from "../lib/scenarios";
import { getPack } from "../lib/packs";
import { levelPrompt, parseLevel } from "../lib/level";
import { computeMetrics, estimateLevelV2 } from "../lib/metrics";
import { getSpeech } from "../lib/speech";
import { addMessage, addVocab, createSession, setSummary, saveLevelSignal, saveMetrics, vocabCounts } from "../lib/db";

interface Correction {
  original: string;
  fixed: string;
  note: string;
}
interface UIMsg {
  role: "user" | "assistant";
  content: string;
  corrections?: Correction[];
}

export default function Chat({ settings }: { settings: Settings }) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [ui, setUi] = useState<UIMsg[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummaryState] = useState<(SessionSummary & { learned: number }) | null>(null);
  const [listening, setListening] = useState(false);

  const history = useRef<ChatMessage[]>([]); // full provider context incl. system + seed
  const scrollRef = useRef<HTMLDivElement>(null);
  const pack = getPack(settings.packId);
  const speech = useMemo(
    () => getSpeech(settings),
    [settings.speechEngine, settings.elevenLabsKey, settings.deepgramKey],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [ui, busy]);

  function say(text: string) {
    if (settings.speak && speech.canSpeak)
      speech.speak(text, { locale: pack?.speech.locale, voiceHint: pack?.speech.voiceHint });
  }

  async function mic() {
    if (!speech.canListen || busy) return;
    setError("");
    setListening(true);
    try {
      const heard = await speech.listen(pack?.speech.locale);
      if (heard.trim()) await send(heard);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setListening(false);
    }
  }

  async function start(sc: Scenario) {
    setError("");
    setScenario(sc);
    setUi([]);
    setSuggestions([]);
    setSummaryState(null);
    history.current = [{ role: "system", content: buildSystem(settings, sc, pack) }];
    try {
      const id = await createSession(sc.id);
      setSessionId(id);
      setBusy(true);
      // Seed an opening turn (the user message is kept in context but not shown).
      history.current.push({ role: "user", content: "(Begin the conversation. Greet me and start.)" });
      const raw = await getProvider(settings).chat(history.current, { json: true });
      const turn = parseTurn(raw);
      history.current.push({ role: "assistant", content: turn.reply });
      await addMessage(id, "assistant", turn.reply);
      setUi([{ role: "assistant", content: turn.reply }]);
      setSuggestions(turn.suggestions);
      say(turn.reply);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy || !sessionId) return;
    setInput("");
    setError("");
    setSuggestions([]);
    const userIdx = ui.length;
    setUi((u) => [...u, { role: "user", content: msg }]);
    history.current.push({ role: "user", content: msg });
    await addMessage(sessionId, "user", msg);

    setBusy(true);
    try {
      const raw = await getProvider(settings).chat(history.current, { json: true });
      const turn = parseTurn(raw);
      history.current.push({ role: "assistant", content: turn.reply });
      await addMessage(sessionId, "assistant", turn.reply);
      setUi((u) => {
        const next = [...u];
        // attach corrections to the user message they refer to
        if (turn.corrections.length) next[userIdx] = { ...next[userIdx], corrections: turn.corrections };
        next.push({ role: "assistant", content: turn.reply });
        return next;
      });
      setSuggestions(turn.suggestions);
      say(turn.reply);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    if (!sessionId || busy) return;
    setBusy(true);
    setError("");
    try {
      const provider = getProvider(settings);
      // Vocabulary capture
      const vocabRaw = await provider.chat(
        [...history.current, { role: "user", content: vocabPrompt(settings) }],
        { json: true },
      );
      const items = parseVocab(vocabRaw);
      for (const it of items) await addVocab(it);
      // Session summary
      const sumRaw = await provider.chat(
        [...history.current, { role: "user", content: summaryPrompt(settings) }],
        { json: true },
      );
      const sum = parseSummary(sumRaw);
      await setSummary(sessionId, sum.summary);
      setSummaryState({ ...sum, learned: items.length });
      // Level estimation v2 — measured metrics off the learner's own messages.
      try {
        const userTexts = ui.filter((m) => m.role === "user").map((m) => m.content);
        const corrections = ui.reduce((n, m) => n + (m.corrections?.length ?? 0), 0);
        const deckSize = (await vocabCounts()).total;
        const metrics = computeMetrics(userTexts, { corrections, deckSize });
        await saveMetrics(settings.targetLang, metrics, estimateLevelV2(metrics).score);
      } catch {
        /* metrics are best-effort */
      }
      // Level estimation v1 — soft AI signal off the learner's own messages.
      try {
        const lvlRaw = await provider.chat([...history.current, { role: "user", content: levelPrompt(settings) }], {
          json: true,
        });
        const lvl = parseLevel(lvlRaw);
        if (lvl) await saveLevelSignal(settings.targetLang, lvl);
      } catch {
        /* level signal is best-effort */
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  // --- scenario picker ---
  if (!scenario) {
    return (
      <div className="chat">
        <h1>Start a conversation</h1>
        <p className="muted">
          Practising <strong>{settings.targetLang}</strong> at level {settings.cefr}. Pick a scenario:
        </p>
        <div className="scenario-grid">
          {listScenarios().map((sc) => (
            <button key={sc.id} className="scenario-card" onClick={() => start(sc)}>
              <span className="emoji">{sc.emoji}</span>
              <span>{sc.title}</span>
              {sc.level && <span className="muted">{sc.level[0]}–{sc.level[1]}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="chat">
      <header className="chat-head">
        <div>
          <span className="emoji">{scenario.emoji}</span> {scenario.title}
        </div>
        <div className="chat-actions">
          <button className="ghost" onClick={endSession} disabled={busy || ui.length < 2}>
            End & summarise
          </button>
          <button className="ghost" onClick={() => setScenario(null)}>
            New
          </button>
        </div>
      </header>

      <div className="messages" ref={scrollRef}>
        {ui.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <div className="text">{m.content}</div>
            {m.corrections?.map((c, j) => (
              <div key={j} className="correction">
                <span className="was">{c.original}</span> → <span className="fix">{c.fixed}</span>
                {c.note && <div className="note">{c.note}</div>}
              </div>
            ))}
          </div>
        ))}
        {busy && <div className="bubble assistant"><div className="text typing">…</div></div>}
      </div>

      {error && <div className="error">{error}</div>}

      {summary && (
        <div className="summary">
          <h3>Session summary</h3>
          <p>{summary.summary}</p>
          {summary.strengths.length > 0 && (
            <p>
              <strong>Strengths:</strong> {summary.strengths.join(", ")}
            </p>
          )}
          {summary.focus.length > 0 && (
            <p>
              <strong>Focus next:</strong> {summary.focus.join(", ")}
            </p>
          )}
          <p className="muted">📚 {summary.learned} word(s) added to your vocabulary deck.</p>
        </div>
      )}

      {suggestions.length > 0 && !busy && (
        <div className="suggestions">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening…" : `Type in ${settings.targetLang}…`}
          disabled={busy}
          autoFocus
        />
        {speech.canListen && (
          <button
            type="button"
            className={`mic ${listening ? "on" : ""}`}
            onClick={mic}
            disabled={busy}
            title="Speak"
          >
            🎤
          </button>
        )}
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

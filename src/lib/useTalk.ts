import { useCallback, useMemo, useRef, useState } from "react";
import type { Settings } from "./settings";
import { getProvider, type ChatMessage } from "./providers";
import {
  buildSystem,
  parseTurn,
  vocabPrompt,
  parseVocab,
  summaryPrompt,
  parseSummary,
  shouldShowInline,
  type Correction,
  type SessionSummary,
} from "./prompts";
import { BUNDLED_SCENARIOS, listScenarios, type Scenario } from "./scenarios";
import { getPack } from "./packs";
import { levelPrompt, parseLevel } from "./level";
import { computeMetrics, estimateLevelV2 } from "./metrics";
import { getSpeech } from "./speech";
import { addMessage, addVocab, createSession, setSummary, saveLevelSignal, saveMetrics, vocabCounts } from "./db";

export interface TalkMsg {
  role: "user" | "ai";
  text: string;
  corrections: Correction[];
  /** Corrections shown under the message right away vs. held back for the reflection. */
  inline: boolean;
  isAsk?: boolean; // a ⌘K question to the coach, not part of the scenario
}

export interface Reflection extends SessionSummary {
  turns: number;
  corrections: Correction[];
  words: { term: string; translation: string }[];
}

const CONF_START = 50;

/**
 * One conversation with the coach. Lives above the router so switching to Read
 * or opening ⌘K mid-sentence doesn't throw the session away.
 */
export function useTalk(settings: Settings, onSettings?: (patch: Partial<Settings>) => void) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [msgs, setMsgs] = useState<TalkMsg[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [reflecting, setReflecting] = useState(false);
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [confidence, setConfidence] = useState(CONF_START);

  const history = useRef<ChatMessage[]>([]); // full provider context, incl. system
  const sessionId = useRef<number | null>(null);
  const pack = getPack(settings.packId);
  const speech = useMemo(
    () => getSpeech(settings),
    [settings.speechEngine, settings.elevenLabsKey, settings.deepgramKey],
  );

  const userTurns = msgs.filter((m) => m.role === "user" && !m.isAsk).length;

  const say = useCallback(
    (text: string) => {
      if (settings.speak && speech.canSpeak)
        void speech.speak(text, { locale: pack?.speech.locale, voiceHint: pack?.speech.voiceHint }).catch(() => {});
    },
    [settings.speak, speech, pack],
  );

  /** Open a scenario and let the coach speak first. */
  const start = useCallback(
    async (sc: Scenario, goal?: string) => {
      setScenario(sc);
      setMsgs([]);
      setSuggestions([]);
      setReflecting(false);
      setReflection(null);
      setConfidence(CONF_START);
      setError("");
      const system = buildSystem(settings, sc, pack) + (goal ? `\nQuietly give the learner practice with: ${goal}.` : "");
      history.current = [{ role: "system", content: system }];
      setBusy(true);
      try {
        try {
          sessionId.current = await createSession(sc.id);
        } catch {
          sessionId.current = null; // DB unavailable — the conversation still works
        }
        history.current.push({ role: "user", content: "(Begin the conversation. Greet me and start.)" });
        const raw = await getProvider(settings).chat(history.current, { json: true });
        const turn = parseTurn(raw);
        history.current.push({ role: "assistant", content: turn.reply });
        if (sessionId.current) await addMessage(sessionId.current, "assistant", turn.reply);
        setMsgs([{ role: "ai", text: turn.reply, corrections: [], inline: false }]);
        setSuggestions(turn.suggestions);
        say(turn.reply);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [settings, pack, say],
  );

  const send = useCallback(
    async (text: string, fromSuggestion = false) => {
      const msg = text.trim();
      if (!msg || busy || !scenario) return;
      setInput("");
      setError("");
      setSuggestions([]);
      const idx = msgs.length;
      setMsgs((m) => [...m, { role: "user", text: msg, corrections: [], inline: false }]);
      history.current.push({ role: "user", content: msg });
      if (sessionId.current) await addMessage(sessionId.current, "user", msg).catch(() => {});

      setBusy(true);
      try {
        const raw = await getProvider(settings).chat(history.current, { json: true });
        const turn = parseTurn(raw);
        history.current.push({ role: "assistant", content: turn.reply });
        if (sessionId.current) await addMessage(sessionId.current, "assistant", turn.reply).catch(() => {});

        const worst = turn.corrections.find((c) => c.severity === "severe") ?? turn.corrections[0];
        setMsgs((m) => {
          const next = [...m];
          if (next[idx])
            next[idx] = {
              ...next[idx],
              corrections: turn.corrections,
              inline: shouldShowInline(settings.correctionTiming, worst?.severity),
            };
          next.push({ role: "ai", text: turn.reply, corrections: [], inline: false });
          return next;
        });
        setSuggestions(turn.suggestions);
        // Confidence tracks unaided, accurate production — a picked suggestion is
        // worth less than a sentence the learner found on their own.
        const gain = worst ? (worst.severity === "severe" ? 0 : 2) : fromSuggestion ? 1 : 4;
        setConfidence((c) => Math.min(100, c + gain));
        say(turn.reply);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [busy, scenario, msgs.length, settings, say],
  );

  const mic = useCallback(async () => {
    if (busy || listening) return speech.cancel();
    if (!speech.canListen) return setError("Speech recognition is not available in this webview.");
    setError("");
    setListening(true);
    try {
      const heard = await speech.listen(pack?.speech.locale);
      if (heard.trim()) setInput(heard);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setListening(false);
    }
  }, [busy, listening, speech, pack]);

  /** Close the session: capture vocabulary, summarise, and record the level signals. */
  const end = useCallback(async () => {
    if (!scenario || busy) return;
    setReflecting(true);
    setBusy(true);
    setError("");
    const userTexts = msgs.filter((m) => m.role === "user" && !m.isAsk).map((m) => m.text);
    const corrections = msgs.flatMap((m) => m.corrections);
    let words: { term: string; translation: string }[] = [];
    let summary: SessionSummary = { summary: "", strengths: [], focus: [] };

    try {
      const provider = getProvider(settings);
      const vocabRaw = await provider.chat([...history.current, { role: "user", content: vocabPrompt(settings) }], {
        json: true,
      });
      const items = parseVocab(vocabRaw);
      for (const it of items) await addVocab(it).catch(() => {});
      words = items.map((i) => ({ term: i.term, translation: i.translation }));

      const sumRaw = await provider.chat([...history.current, { role: "user", content: summaryPrompt(settings) }], {
        json: true,
      });
      summary = parseSummary(sumRaw);
      if (sessionId.current) await setSummary(sessionId.current, summary.summary).catch(() => {});

      // Measured level signal (v2) — from the learner's own messages only.
      try {
        const deckSize = (await vocabCounts()).total;
        const m = computeMetrics(userTexts, { corrections: corrections.length, deckSize });
        await saveMetrics(settings.targetLang, m, estimateLevelV2(m).score);
      } catch {
        /* metrics are best-effort */
      }
      // Soft AI level signal (v1).
      try {
        const lvlRaw = await provider.chat([...history.current, { role: "user", content: levelPrompt(settings) }], {
          json: true,
        });
        const lvl = parseLevel(lvlRaw);
        if (lvl) {
          await saveLevelSignal(settings.targetLang, lvl);
          // Onboarding was skipped, so this conversation is the placement — commit the level.
          if (!settings.cefr) onSettings?.({ cefr: lvl.estimate });
        }
      } catch {
        /* level signal is best-effort */
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
    setReflection({ ...summary, turns: userTexts.length, corrections, words });
  }, [scenario, busy, msgs, settings]);

  /** ⌘K → "ask the coach": a side question, answered in the learner's own language. */
  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) return;
      setReflecting(false);
      setError("");
      setMsgs((m) => [...m, { role: "user", text: q, corrections: [], inline: false, isAsk: true }]);
      setBusy(true);
      try {
        const ctx: ChatMessage[] = history.current.length
          ? [...history.current]
          : [{ role: "system", content: `You are a warm, precise ${settings.targetLang} tutor.` }];
        ctx.push({
          role: "user",
          content: `Step out of the roleplay for one message. Answer this question about ${settings.targetLang} in ${settings.nativeLang}, clearly and briefly, as plain prose (no JSON): ${q}`,
        });
        const raw = await getProvider(settings).chat(ctx);
        setMsgs((m) => [...m, { role: "ai", text: raw.trim(), corrections: [], inline: false, isAsk: true }]);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [settings],
  );

  return {
    scenario,
    scenarios: listScenarios(),
    msgs,
    suggestions,
    input,
    setInput,
    busy,
    listening,
    error,
    reflecting,
    reflection,
    confidence,
    confDelta: confidence - CONF_START,
    userTurns,
    started: !!scenario,
    start,
    send,
    mic,
    end,
    ask,
    exitReflection: () => setReflecting(false),
    reset: () => setScenario(null),
    /** The scenario a plan block points at, falling back to free conversation. */
    scenarioById: (id?: string) =>
      listScenarios().find((s) => s.id === id) ?? BUNDLED_SCENARIOS.find((s) => s.id === "free")!,
  };
}

export type Talk = ReturnType<typeof useTalk>;

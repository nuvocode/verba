import { useCallback, useMemo, useRef, useState } from "react";
import type { Settings } from "./settings";
import { getProvider, type ChatMessage } from "./providers";
import {
  buildSystem,
  parseTurn,
  partialReply,
  TURN_MAX_TOKENS,
  vocabPrompt,
  parseVocab,
  summaryPrompt,
  parseSummary,
  titlePrompt,
  parseTitle,
  memoryPrompt,
  parseMemory,
  shouldShowInline,
  type Correction,
  type SessionSummary,
} from "./prompts";
import { BUNDLED_SCENARIOS, listScenarios, type Scenario } from "./scenarios";
import { getPack } from "./packs";
import { levelPrompt, parseLevel } from "./level";
import { computeMetrics, estimateLevelV2 } from "./metrics";
import { getSpeech, listenBlocker } from "./speech";
import {
  addMessage,
  addVocab,
  createSession,
  deleteVocabTerm,
  setSummary,
  setTitle,
  saveLevelSignal,
  saveMemories,
  saveMetrics,
  recentMemories,
  vocabCounts,
} from "./db";

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
 * Messages exchanged before the coach re-names the conversation. By the fourth
 * exchange the opening pleasantries are behind us and the actual subject is on
 * the table — early enough that the name in the list is still worth fixing.
 */
const TITLE_SETTLES_AT = 8;

/**
 * A provider `onDelta` handler that keeps the raw text and publishes the reply
 * inside it as it grows.
 *
 * The deltas are fragments of a JSON object, not of the reply, so most of them
 * move nothing on screen — `partialReply` returns "" until the reply key opens,
 * and again for a model that nested its answer. Publishing those blanks would
 * clear a bubble mid-sentence, so an empty read is treated as "no news".
 */
function live(publish: (text: string) => void): (chunk: string) => void {
  let raw = "";
  return (chunk) => {
    raw += chunk;
    const so_far = partialReply(raw);
    if (so_far) publish(so_far);
  };
}

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
  // Cloud STT has two phases the learner can feel: the mic is open, then the clip
  // is in flight. One "Listening…" bar covering both is a lie for the second half.
  const [micPhase, setMicPhase] = useState<"" | "recording" | "transcribing">("");
  const [error, setError] = useState("");
  // Not an error: something degraded (a local speech server went away) and the
  // conversation carried on. Raised once per adapter, and cleared when the next
  // turn starts so a server that came back doesn't leave a stale warning behind.
  const [notice, setNotice] = useState("");
  // The coach's reply as it arrives, before the turn's JSON has closed and the
  // corrections and suggestions are known. Rendered as the last bubble and
  // handed over to `msgs` in the same commit the finished turn lands in.
  const [streaming, setStreaming] = useState("");
  const [reflecting, setReflecting] = useState(false);
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [confidence, setConfidence] = useState(CONF_START);

  const history = useRef<ChatMessage[]>([]); // full provider context, incl. system
  const sessionId = useRef<number | null>(null);
  // How far the session's title has got: 0 unnamed, 1 named off the opening,
  // 2 re-named once the subject settled. Not a rolling rewrite — 2 is the end.
  const titleStage = useRef<0 | 1 | 2>(0);
  const pack = getPack(settings.packId);
  const speech = useMemo(
    () => getSpeech(settings, setNotice),
    [
      settings.offline,
      settings.elevenLabsKey,
      settings.deepgramKey,
      settings.localTtsUrl,
      settings.localTtsModel,
      settings.localTtsVoice,
      settings.localSttUrl,
      settings.localSttModel,
      settings.bundledTtsModel,
      settings.bundledTtsVoice,
      settings.bundledSttModel,
      settings.ttsTier,
      settings.sttTier,
    ],
  );

  const userTurns = msgs.filter((m) => m.role === "user" && !m.isAsk).length;

  const say = useCallback(
    (text: string) => {
      if (settings.speak && speech.canSpeak)
        void speech.speak(text, { locale: pack?.speech.locale, voiceHint: pack?.speech.voiceHint }).catch(() => {});
    },
    [settings.speak, speech, pack],
  );

  /**
   * Name the session in the history list. Deliberately not awaited: the coach
   * writes the title beside the conversation, and if the provider refuses, the
   * turn is untouched and whatever title the session already had still stands.
   */
  const nameSession = useCallback(
    (stage: "opening" | "settled") => {
      const id = sessionId.current;
      if (!id) return; // no DB row — there is nothing to name
      const ctx = [...history.current, { role: "user" as const, content: titlePrompt(settings, stage) }];
      void (async () => {
        try {
          const title = parseTitle(await getProvider(settings).chat(ctx, { json: true }));
          if (title) await setTitle(id, title);
        } catch {
          /* a title is never worth interrupting the conversation for */
        }
      })();
    },
    [settings],
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
      setNotice("");
      titleStage.current = 0;
      setBusy(true);
      // What earlier conversations left behind. It rides in the system prompt, so
      // every call made off this history — the turns, the wrap-up, the vocabulary
      // capture — is talking to a coach that has read it.
      const memories = await recentMemories(settings.targetLang).catch(() => []);
      const system =
        buildSystem(settings, sc, pack, memories) + (goal ? `\nQuietly give the learner practice with: ${goal}.` : "");
      history.current = [{ role: "system", content: system }];
      try {
        try {
          sessionId.current = await createSession(sc.id);
        } catch {
          sessionId.current = null; // DB unavailable — the conversation still works
        }
        history.current.push({
          role: "user",
          content: "(Begin the conversation. Greet me and start.)",
        });
        const raw = await getProvider(settings).chat(history.current, {
          json: true,
          maxTokens: TURN_MAX_TOKENS,
          onDelta: live(setStreaming),
        });
        const turn = parseTurn(raw);
        history.current.push({ role: "assistant", content: turn.reply });
        if (sessionId.current) await addMessage(sessionId.current, "assistant", turn.reply);
        setStreaming(""); // same commit as the message that replaces it
        setMsgs([{ role: "ai", text: turn.reply, corrections: [], inline: false }]);
        setSuggestions(turn.suggestions);
        say(turn.reply);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setStreaming(""); // a half-streamed reply is not a turn — it must not linger
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
      setNotice(""); // last turn's degrade notice is not this turn's news
      setSuggestions([]);
      const idx = msgs.length;
      setMsgs((m) => [...m, { role: "user", text: msg, corrections: [], inline: false }]);
      history.current.push({ role: "user", content: msg });
      if (sessionId.current) await addMessage(sessionId.current, "user", msg).catch(() => {});

      setBusy(true);
      try {
        const raw = await getProvider(settings).chat(history.current, {
          json: true,
          maxTokens: TURN_MAX_TOKENS,
          onDelta: live(setStreaming),
        });
        const turn = parseTurn(raw);
        history.current.push({ role: "assistant", content: turn.reply });
        if (sessionId.current) await addMessage(sessionId.current, "assistant", turn.reply).catch(() => {});

        const worst = turn.corrections.find((c) => c.severity === "severe") ?? turn.corrections[0];
        // Dropped in the same commit the real message lands in — anywhere earlier
        // and the DB write above sits between them as a frame of empty screen.
        setStreaming("");
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

        // The session is named off its first real exchange — that is also the turn
        // it starts showing up in the history list — and re-named exactly once,
        // when enough has been said for the subject to be the subject.
        const exchanged = msgs.filter((m) => !m.isAsk).length + 2; // this turn's pair included
        if (titleStage.current === 0) {
          titleStage.current = 1;
          nameSession("opening");
        } else if (titleStage.current === 1 && exchanged >= TITLE_SETTLES_AT) {
          titleStage.current = 2;
          nameSession("settled");
        }

        // Confidence tracks unaided, accurate production — a picked suggestion is
        // worth less than a sentence the learner found on their own.
        const gain = worst ? (worst.severity === "severe" ? 0 : 2) : fromSuggestion ? 1 : 4;
        setConfidence((c) => Math.min(100, c + gain));
        say(turn.reply);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setStreaming(""); // a half-streamed reply is not a turn — it must not linger
        setBusy(false);
      }
    },
    [busy, scenario, msgs, settings, say, nameSession],
  );

  /** Push-to-talk: click to open the mic, click again to stop and transcribe. */
  const mic = useCallback(async () => {
    if (busy) return;
    if (micPhase === "recording") {
      // Stops the recorder, which resolves the listen() promise still awaited below.
      setMicPhase("transcribing");
      return speech.cancel();
    }
    if (micPhase) return; // a clip is already in flight
    const blocked = listenBlocker(settings);
    if (blocked) return setError(blocked);

    setError("");
    setMicPhase("recording");
    try {
      const heard = await speech.listen(pack?.speech.locale);
      if (heard.trim()) setInput(heard);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setMicPhase("");
    }
  }, [busy, micPhase, speech, pack, settings]);

  /** Close the session: capture vocabulary, summarise, and record the level signals. */
  const end = useCallback(async () => {
    if (!scenario || busy) return;
    setReflecting(true);
    setBusy(true);
    setError("");
    const userTexts = msgs.filter((m) => m.role === "user" && !m.isAsk).map((m) => m.text);
    const corrections = msgs.flatMap((m) => m.corrections);
    const words: { term: string; translation: string }[] = [];
    let summary: SessionSummary = { summary: "", strengths: [], focus: [] };

    try {
      const provider = getProvider(settings);
      const vocabRaw = await provider.chat(
        [...history.current, { role: "user", content: vocabPrompt(settings, pack) }],
        { json: true },
      );
      // Only the cards this conversation actually added are reported back, and so
      // only those can be dropped in the wrap-up: a term already in the deck carries
      // review history that a stray tap has no business erasing. `addVocab` is also
      // where the capture gate lives, so anything that isn't vocabulary never counts.
      for (const it of parseVocab(vocabRaw)) {
        const added = await addVocab(settings.targetLang, it).catch(() => false);
        if (added) words.push({ term: it.term, translation: it.translation });
      }

      const sumRaw = await provider.chat(
        [...history.current, { role: "user", content: summaryPrompt(settings, pack) }],
        { json: true },
      );
      summary = parseSummary(sumRaw);
      if (sessionId.current) await setSummary(sessionId.current, summary.summary).catch(() => {});

      // What the learner told us about themselves. Best-effort like the rest of the
      // wrap-up: a coach that fails to take a note is a coach that took no note, not
      // a conversation that failed.
      try {
        const known = await recentMemories(settings.targetLang);
        const memRaw = await provider.chat(
          [...history.current, { role: "user", content: memoryPrompt(settings, known) }],
          { json: true },
        );
        await saveMemories(settings.targetLang, parseMemory(memRaw), sessionId.current);
      } catch {
        /* memory is best-effort */
      }

      // Measured level signal (v2) — from the learner's own messages only, cut
      // into words and sentences by the target language's own rules.
      try {
        const deckSize = (await vocabCounts(settings.targetLang)).total;
        const m = computeMetrics(userTexts, {
          corrections: corrections.length,
          deckSize,
          locale: pack?.speech.locale,
        });
        await saveMetrics(settings.targetLang, m, estimateLevelV2(m).score);
      } catch {
        /* metrics are best-effort */
      }
      // Soft AI level signal (v1).
      try {
        const lvlRaw = await provider.chat(
          [...history.current, { role: "user", content: levelPrompt(settings, pack) }],
          { json: true },
        );
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
  }, [scenario, busy, msgs, settings, pack]);

  /**
   * Strike a word off the wrap-up. The conversation proposes; the learner disposes.
   *
   * Written first and undone here, rather than held back and committed on the way
   * out: the reflection can be left in four ways, one of which is walking away to
   * another screen, and a capture that depends on leaving correctly is a capture
   * that gets lost.
   */
  const dropWord = useCallback(
    async (term: string) => {
      await deleteVocabTerm(settings.targetLang, term).catch(() => {});
      setReflection((r) => (r ? { ...r, words: r.words.filter((w) => w.term !== term) } : r));
    },
    [settings.targetLang],
  );

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
        // Not streamed: an aside is short prose, and the live bubble is labelled
        // and laid out as a scenario turn — it would carry the wrong voice here.
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
    /** Writing direction of the target language — target text is laid out with it. */
    dir: pack?.direction ?? "ltr",
    msgs,
    /** The coach's reply mid-flight: render it as the last bubble while it lasts. */
    streaming,
    suggestions,
    input,
    setInput,
    busy,
    listening: micPhase !== "",
    micPhase,
    error,
    notice,
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
    /** Remove one of the wrap-up's captured words from the deck again. */
    dropWord,
    exitReflection: () => setReflecting(false),
    reset: () => setScenario(null),
    /** The scenario a plan block points at, falling back to free conversation. */
    scenarioById: (id?: string) =>
      listScenarios().find((s) => s.id === id) ?? BUNDLED_SCENARIOS.find((s) => s.id === "free")!,
  };
}

export type Talk = ReturnType<typeof useTalk>;

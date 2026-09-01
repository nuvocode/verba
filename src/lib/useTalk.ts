import { useCallback, useMemo, useRef, useState } from "react";
import type { Settings } from "./settings";
import { levelOf } from "./model";
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
import { BUNDLED_SCENARIOS, listScenarios, type Persona, type Scenario } from "./scenarios";
import { getPack } from "./packs";
import { computeMetrics, estimateLevelV2 } from "./metrics";
import { getSpeech, listenBlocker } from "./speech";
import { humanError } from "./fmt";
import { words } from "./text";
import { confidence as computeConfidence } from "./confidence";
import { verifyRepair, type RepairObservation } from "./repair";
import {
  addMessage,
  addVocab,
  createSession,
  deleteVocabTerm,
  getSession,
  keepVocab,
  sessionMessages,
  setSummary,
  setTitle,
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
  produced: ProducedTurn[];
  /** What each spoken turn observed, beside what it said — feeds `voiceSignals`. */
  voice: VoiceTurn[];
  /** Times the learner asked to see the coach's text (PLAN-021) — recorded, never scored. */
  reveals: { what: "line" | "all" }[];
  /** Repair moves the learner used or the coach modelled (PLAN-027) — feeds `repairSignals`. */
  repairs: RepairObservation[];
}

/** One thing the learner actually sent, and whether they found it themselves. */
export interface ProducedTurn {
  text: string;
  fromSuggestion: boolean;
  /** Word count in the learner's own message — the length component of confidence. */
  words: number;
  /** Time from the coach's line landing to the send, in ms; null if unknown. */
  latencyMs: number | null;
}

/** A spoken turn as the mic observed it: the transcript and the envelope. */
export interface VoiceTurn {
  text: string;
  ms: number;
  levels: number[];
  locale: string;
}

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
export function useTalk(settings: Settings, _onSettings?: (patch: Partial<Settings>) => void) {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [msgs, setMsgs] = useState<TalkMsg[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Cloud STT has two phases the learner can feel: the mic is open, then the clip
  // is in flight. One "Listening…" bar covering both is a lie for the second half.
  const [micPhase, setMicPhase] = useState<"" | "recording" | "transcribing">("");
  // The live level meter while the mic is open — 0–1, straight off the analyser.
  const [micLevel, setMicLevel] = useState(0);
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
  // The coach's identity for this session, resolved once at start. A TTS fallback
  // mid-session does not re-pick a voice — the persona holds (§2.2).
  const [persona, setPersona] = useState<Persona | null>(null);
  // How far each scenario goal has got. Starts all pending; a returned index moves
  // one to met (never back); end() marks whatever is still pending as missed.
  const [goalState, setGoalState] = useState<("pending" | "met" | "missed")[]>([]);

  const history = useRef<ChatMessage[]>([]); // full provider context, incl. system
  const sessionId = useRef<number | null>(null);
  // What the learner produced, and whether it was theirs. `msgs` cannot answer the
  // second question — a picked suggestion and a typed sentence are the same bubble.
  const produced = useRef<ProducedTurn[]>([]);
  // `produced` is a ref (it is read by the reflection without re-rendering), but
  // confidence is derived from it and must re-render. A version counter bumps on
  // every push so the memo below recomputes without turning the ref into state.
  const [producedVersion, setProducedVersion] = useState(0);
  // What each spoken turn observed, beside what it said. Accumulated in `mic()`
  // and handed to the reflection, where `voiceSignals` turns it into signals.
  const voice = useRef<VoiceTurn[]>([]);
  // Times the learner asked to see the coach's text (PLAN-021). Recorded, never
  // scored — the reflection carries them so `talkSignals` can write a reveal
  // signal per ask, and nothing counts them against the learner.
  const reveals = useRef<{ what: "line" | "all" }[]>([]);
  // Repair moves the learner used (and, later, the coach modelled — PLAN-030).
  // Only a variant the learner actually wrote lands here: `verifyRepair` runs in
  // `send`, and a reported variant that was never written is dropped there, so
  // this ref only ever holds the learner's own words.
  const repairs = useRef<RepairObservation[]>([]);
  // How far the session's title has got: 0 unnamed, 1 named off the opening,
  // 2 re-named once the subject settled. Not a rolling rewrite — 2 is the end.
  const titleStage = useRef<0 | 1 | 2>(0);
  // When the coach's last reply finished rendering — the reference point for the
  // next send's latency. null until the first reply has landed.
  const coachReplyAt = useRef<number | null>(null);
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

  // Confidence is the unprompted-production rate, derived from what was actually
  // produced — never seeded. `null` until MEASURES_AT turns exist (invariant 26).
  // The length component measures against the learner's own level.
  const confidence = useMemo(() => computeConfidence(produced.current, levelOf(settings.profile)), [producedVersion]);

  const userTurns = msgs.filter((m) => m.role === "user" && !m.isAsk).length;

  const say = useCallback(
    (text: string) => {
      if (settings.speak && speech.canSpeak)
        void speech
          .speak(text, { locale: pack?.speech.locale, voiceHint: persona?.voiceHint || pack?.speech.voiceHint })
          .catch(() => {});
    },
    [settings.speak, speech, pack, persona],
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
      setPersona(sc.persona);
      setGoalState((sc.goals ?? []).map(() => "pending" as const));
      setMsgs([]);
      setSuggestions([]);
      setReflecting(false);
      setReflection(null);
      setError("");
      setNotice("");
      titleStage.current = 0;
      coachReplyAt.current = null;
      produced.current = [];
      setProducedVersion((v) => v + 1);
      voice.current = [];
      reveals.current = [];
      repairs.current = [];
      setBusy(true);
      // What earlier conversations left behind. It rides in the system prompt, so
      // every call made off this history — the turns, the wrap-up, the vocabulary
      // capture — is talking to a coach that has read it.
      const memories = await recentMemories(settings.profile.targetLanguage).catch(() => []);
      const system =
        buildSystem(settings, sc, sc.persona, pack, memories) +
        (goal ? `\nQuietly give the learner practice with: ${goal}.` : "");
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
      } catch (e: unknown) {
        const { say: said, log } = humanError(e);
        console.warn("[talk] start failed:", log);
        setError(said);
      } finally {
        setStreaming(""); // a half-streamed reply is not a turn — it must not linger
        setBusy(false);
      }
    },
    [settings, pack, say],
  );

  /**
   * Resume a past conversation: load its stored messages back into the session
   * and keep writing to the same `sessions` row. The persona and the produced
   * turns come back with it, so the reflection and confidence stay honest.
   */
  const resume = useCallback(
    async (sessionIdToResume: number) => {
      setError("");
      setNotice("");
      setReflecting(false);
      setReflection(null);
      setSuggestions([]);
      setBusy(true);
      try {
        const rows = await sessionMessages(sessionIdToResume);
        const sess = await getSession(sessionIdToResume);
        const sc = listScenarios().find((s) => s.id === sess?.scenario) ?? BUNDLED_SCENARIOS.find((s) => s.id === "free")!;
        setScenario(sc);
        setPersona(sc.persona);
        setGoalState((sc.goals ?? []).map(() => "pending" as const));
        setMsgs(
          rows.map((m) => ({
            role: m.role === "user" ? "user" : "ai",
            text: m.content,
            corrections: [],
            inline: false,
          })),
        );
        // `produced` is deliberately left empty. It is rebuilt from the stored
        // transcript, but which turn came from a suggestion is not stored — a
        // resumed session would have to guess, and a guessed `fromSuggestion`
        // would quietly poison confidence and the reflection. So a resumed
        // session measures nothing it cannot recount: confidence starts over
        // from the resumed point, and the reflection reports only the turns
        // actually produced after resuming.
        produced.current = [];
        setProducedVersion((v) => v + 1);
        voice.current = [];
        reveals.current = [];
        repairs.current = [];
        sessionId.current = sessionIdToResume;
        // The provider context is rebuilt from the stored transcript so the next
        // turn continues the conversation rather than starting a new one.
        const memories = await recentMemories(settings.profile.targetLanguage).catch(() => []);
        history.current = [
          { role: "system", content: buildSystem(settings, sc, sc.persona, pack, memories) },
          ...rows.map((m) => ({
            role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
            content: m.content,
          })),
        ];
        titleStage.current = 2; // a resumed session is already named
        coachReplyAt.current = null;
      } catch (e: unknown) {
        const { say: said, log } = humanError(e);
        console.warn("[talk] resume failed:", log);
        setError(said);
      } finally {
        setBusy(false);
      }
    },
    [settings, pack],
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
      // Latency is the time from the coach's line landing to this send. The
      // coach's reply was stamped when it finished rendering; the first turn has
      // no prior reply, so its latency is unknown.
      const latencyMs = coachReplyAt.current ? performance.now() - coachReplyAt.current : null;
      produced.current.push({ text: msg, fromSuggestion, words: words(msg, pack?.speech.locale ?? "en").length, latencyMs });
      setProducedVersion((v) => v + 1);
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
        // The coach's reply has landed — stamp it so the next send can measure
        // its latency against it.
        coachReplyAt.current = performance.now();

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

        // A goal the coach says was just met ticks — and only that one. A returned
        // index moves a pending goal to met and never moves it back; a goal already
        // met is left alone, and an index past the list is ignored.
        if (turn.goalsMet.length) {
          setGoalState((gs) => {
            const next = [...gs];
            for (const i of turn.goalsMet) {
              if (i >= 0 && i < next.length && next[i] === "pending") next[i] = "met";
            }
            return next;
          });
        }

        // A repair move is believed only when it is the learner's own words
        // (PLAN-027). `verifyRepair` compares the reported variant against what
        // was actually sent and returns null when it was never written — a model
        // may classify what the learner did, it may not author it. So a variant
        // the learner never said leaves no signal behind at all.
        const repair = turn.repair ? verifyRepair({ category: turn.repair.category, variant: turn.repair.variant }, msg, pack?.speech.locale ?? "en") : null;
        if (repair) repairs.current.push(repair);

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

        say(turn.reply);
      } catch (e: unknown) {
        const { say: said, log } = humanError(e);
        console.warn("[talk] send failed:", log);
        setError(said);
      } finally {
        setStreaming(""); // a half-streamed reply is not a turn — it must not linger
        setBusy(false);
      }
    },
    [busy, scenario, msgs, settings, say, nameSession, pack],
  );

  /**
   * Push-to-talk: click to open the mic, click again to stop. The transcript
   * lands in the input box as an editable draft — nothing is sent automatically.
   * Partials (where the tier can produce them) fill the box as they arrive.
   */
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
    setMicLevel(0);
    try {
      const heard = await speech.listen({
        locale: pack?.speech.locale,
        onLevel: setMicLevel,
        onPartial: (text) => setInput(text),
        // The moment the recorder actually stops, the mic is closed and the clip
        // is in flight — that is the "transcribing" phase. Fired by record() on
        // rec.onstop, so it covers silence auto-stop and a hand stop alike.
        onStopped: () => setMicPhase("transcribing"),
      });
      // The final text lands in the box, focused and editable — the draft. The
      // envelope is kept for the voice signals; the learner's own words are what
      // the conversation measures, so a spoken turn is a produced turn too.
      if (heard.text.trim()) {
        setInput(heard.text);
        voice.current.push({ text: heard.text, ms: heard.ms, levels: heard.levels, locale: pack?.speech.locale ?? "en" });
      }
    } catch (e: unknown) {
      const { say: said, log } = humanError(e);
      console.warn("[talk] transcribe failed:", log);
      setError(said);
    } finally {
      setMicPhase("");
      setMicLevel(0);
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
    // `null` when the summary call came back unusable — the DB row keeps NULL and
    // the reflection renders Unusable (PLAN-020). No fallback text, ever.
    let summary: SessionSummary | null = null;

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
      // Words land as *candidates* (PLAN-020) — nothing enters the deck until the
      // learner presses "Keep these N".
      for (const it of parseVocab(vocabRaw)) {
        const added = await addVocab(settings.profile.targetLanguage, it, {
          capturedBy: "coach",
          surface: "talk",
          learnerLevel: levelOf(settings.profile),
        }, "candidate").catch(() => false);
        if (added) words.push({ term: it.term, translation: it.translation });
      }

      const sumRaw = await provider.chat(
        [...history.current, { role: "user", content: summaryPrompt(settings, pack) }],
        { json: true },
      );
      summary = parseSummary(sumRaw);
      // A failed summary writes nothing — `sessions.summary` stays NULL (invariant
      // 22). The reflection renders Unusable and offers a regenerate.
      if (summary && sessionId.current) await setSummary(sessionId.current, summary.summary).catch(() => {});

      // What the learner told us about themselves. Best-effort like the rest of the
      // wrap-up: a coach that fails to take a note is a coach that took no note, not
      // a conversation that failed. Paused in Settings → About me: the learner asked
      // the coach to stop writing new facts, and a wrap-up is exactly where they
      // would otherwise be written.
      if (!settings.memoryPaused) {
        try {
          const known = await recentMemories(settings.profile.targetLanguage);
          const memRaw = await provider.chat(
            [...history.current, { role: "user", content: memoryPrompt(settings, known) }],
            { json: true },
          );
          await saveMemories(settings.profile.targetLanguage, parseMemory(memRaw), sessionId.current);
        } catch {
          /* memory is best-effort */
        }
      }

      // Measured level signal (v2) — from the learner's own messages only, cut
      // into words and sentences by the target language's own rules.
      try {
        const deckSize = (await vocabCounts(settings.profile.targetLanguage)).total;
        const m = computeMetrics(userTexts, {
          corrections: corrections.length,
          deckSize,
          locale: pack?.speech.locale,
        });
        await saveMetrics(settings.profile.targetLanguage, m, estimateLevelV2(m).score);
      } catch {
        /* metrics are best-effort */
      }
    } catch (e: unknown) {
      const { say: said, log } = humanError(e);
      console.warn("[talk] end failed:", log);
      setError(said);
    } finally {
      setBusy(false);
    }
    // Whatever is still pending when the session closes was never met — it is
    // missed, and the reflection's scorecard reads it that way.
    setGoalState((gs) => gs.map((g) => (g === "pending" ? "missed" : g)));
    setReflection({
      ...(summary ?? { summary: "", strengths: [], focus: [] }),
      turns: userTexts.length,
      corrections,
      words,
      produced: produced.current,
      voice: voice.current,
      reveals: reveals.current,
      repairs: repairs.current,
    });
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
      await deleteVocabTerm(settings.profile.targetLanguage, term).catch(() => {});
      setReflection((r) => (r ? { ...r, words: r.words.filter((w) => w.term !== term) } : r));
    },
    [settings.profile.targetLanguage],
  );

  /**
   * Commit the wrap-up's captured candidates to the deck — the "Keep these N"
   * press. Nothing enters the deck without it (PLAN-020).
   */
  const keepWords = useCallback(
    async (terms: string[]) => {
      for (const t of terms) await keepVocab(settings.profile.targetLanguage, t).catch(() => {});
      setReflection((r) => (r ? { ...r, words: [] } : r));
    },
    [settings.profile.targetLanguage],
  );

  /**
   * Re-run the summary call after a failed one — the reflection's regenerate.
   * Only the summary is retried; the rest of the wrap-up already landed.
   */
  const regenerateSummary = useCallback(async () => {
    if (!scenario) return;
    setBusy(true);
    setError("");
    try {
      const provider = getProvider(settings);
      const sumRaw = await provider.chat(
        [...history.current, { role: "user", content: summaryPrompt(settings, pack) }],
        { json: true },
      );
      const summary = parseSummary(sumRaw);
      if (summary && sessionId.current) await setSummary(sessionId.current, summary.summary).catch(() => {});
      setReflection((r) =>
        r
          ? {
              ...r,
              summary: summary?.summary ?? "",
              strengths: summary?.strengths ?? [],
              focus: summary?.focus ?? [],
            }
          : r,
      );
    } catch (e: unknown) {
      const { say: said, log } = humanError(e);
      console.warn("[talk] regenerate summary failed:", log);
      setError(said);
    } finally {
      setBusy(false);
    }
  }, [scenario, settings, pack]);

  /**
   * The learner asked to see the coach's text (PLAN-021). Recorded, never scored:
   * the reveal rides into the reflection so `talkSignals` writes one assisted
   * comprehension signal per ask, and nothing counts it against the learner.
   */
  const reveal = useCallback((what: "line" | "all") => {
    reveals.current.push({ what });
  }, []);

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
          : [{ role: "system", content: `You are a warm, precise ${settings.profile.targetLanguage} tutor.` }];
        ctx.push({
          role: "user",
          content: `Step out of the roleplay for one message. Answer this question about ${settings.profile.targetLanguage} in ${settings.profile.nativeLanguage}, clearly and briefly, as plain prose (no JSON): ${q}`,
        });
        // Not streamed: an aside is short prose, and the live bubble is labelled
        // and laid out as a scenario turn — it would carry the wrong voice here.
        const raw = await getProvider(settings).chat(ctx);
        setMsgs((m) => [...m, { role: "ai", text: raw.trim(), corrections: [], inline: false, isAsk: true }]);
      } catch (e: unknown) {
        const { say: said, log } = humanError(e);
        console.warn("[talk] ask failed:", log);
        setError(said);
      } finally {
        setBusy(false);
      }
    },
    [settings],
  );

  return {
    scenario,
    scenarios: listScenarios(),
    /** The coach's identity for this session, resolved once at start. */
    persona,
    /** How far each scenario goal has got: pending, met, or missed. */
    goalState,
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
    /** The live level meter while the mic is open — 0–1. */
    micLevel,
    /** Whether the serving STT tier can stream partials into the draft. */
    partials: speech.partials,
    error,
    notice,
    reflecting,
    reflection,
    /** The unprompted-production rate, or null until MEASURES_AT turns exist. */
    confidence,
    userTurns,
    started: !!scenario,
    start,
    resume,
    send,
    mic,
    end,
    /** The learner asked to see the coach's text — recorded, never scored. */
    reveal,
    ask,
    /** Remove one of the wrap-up's captured words from the deck again. */
    dropWord,
    /** Commit the wrap-up's candidates to the deck — "Keep these N". */
    keepWords,
    /** Re-run the summary call after a failed one — the reflection's regenerate. */
    regenerateSummary,
    /**
     * Close the reflection. Any captured word still sitting as a *candidate* is
     * dropped — the learner never pressed "Keep these N", so nothing enters the
     * deck. Words they did keep are already gone from `reflection.words` (keepWords
     * empties it), so this only ever touches the un-kept candidates.
     */
    exitReflection: () => {
      const pending = reflection?.words ?? [];
      if (pending.length) {
        for (const w of pending) void deleteVocabTerm(settings.profile.targetLanguage, w.term).catch(() => {});
      }
      setReflecting(false);
    },
    reset: () => setScenario(null),
    /** The scenario a plan block points at, falling back to free conversation. */
    scenarioById: (id?: string) =>
      listScenarios().find((s) => s.id === id) ?? BUNDLED_SCENARIOS.find((s) => s.id === "free")!,
  };
}

export type Talk = ReturnType<typeof useTalk>;

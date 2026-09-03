import { useCallback, useMemo, useRef, useState } from "react";
import type { Settings } from "./settings";
import { levelOf, signalLabel } from "./model";
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
  openingDetail,
  shouldShowInline,
  rewindOwnPrompt,
  parseOwnLine,
  rewindUnpackPrompt,
  parseUnpack,
  type UnpackResult,
  type Correction,
  type SessionSummary,
} from "./prompts";
import {
  rehearsalScenario,
  rehearsalSystem,
  parseRole,
  debriefPrompt,
  parseDebrief,
  type RehearsalBrief,
  type Debrief,
  type RoleTurn,
} from "./rehearsal";
import { BUNDLED_SCENARIOS, listScenarios, type Persona, type Scenario } from "./scenarios";
import { getPack } from "./packs";
import { computeMetrics, estimateLevelV2 } from "./metrics";
import { getSpeech, listenBlocker } from "./speech";
import { humanError } from "./fmt";
import { words } from "./text";
import { confidence as computeConfidence } from "./confidence";
import { verifyRepair, inventoryFrom, nextTarget, type RepairObservation } from "./repair";
import {
  baselineFrom,
  judge as judgeTurn,
  medianTurnWords,
  turnSignalsFor,
  type SessionBudget,
} from "./breakdown";
import {
  pickAxis,
  recapsFrom,
  calibrate,
  dropOnDrown,
  easeEffect,
  drowns,
  type Axis,
  type SessionRecap,
} from "./difficulty";
import {
  SLOW_RATE,
  DENIED_HANDICAP,
  nextStep,
  bannedShape,
  OWN_FALLBACK,
  GIFT_LINE,
  giftStep,
  obeyRepair,
  rewindAct,
  repeatText,
  freshRewind,
  type RewindState,
  type RewindMove,
} from "./rewind";
import {
  waitMs,
  OFFER_LINE,
  praiseGate,
  freshWait,
  armWait as armWaitState,
  onWaitElapsed,
  onSpeechEnd,
  onHold,
  clearWait as clearWaitState,
  type WaitState,
} from "./patience";
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
  recentSignals,
  stampMemoryAsked,
  vocabCounts,
} from "./db";

export interface TalkMsg {
  role: "user" | "ai";
  text: string;
  corrections: Correction[];
  /** Corrections shown under the message right away vs. held back for the reflection. */
  inline: boolean;
  isAsk?: boolean; // a ⌘K question to the coach, not part of the scenario
  /**
   * A praise sentence that survived `praiseGate` (PLAN-032). Rendered beside the
   * coach's reply only when present — a dropped praise never reaches the screen.
   */
  praise?: string;
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
  /**
   * The difficulty axis this session ran with (PLAN-031). Recorded on the day's
   * record, never scored — Coach reads it to see which dimension was manufactured
   * this session. null is normal (a session with no chosen axis).
   */
  axis: Axis | null;
  /** Whether the learner asked for ease this session (PLAN-031) — recorded, never scored. */
  easeRequested: boolean;
  /**
   * The rehearsal this session ran as (PLAN-034), or null for an ordinary
   * conversation. Carries the brief (so a returning learner sees what they were
   * preparing for) and the debrief the coach produced after stepping out.
   * In-role corrections never appear here — there were none to collect.
   */
  rehearsal?: { brief: RehearsalBrief; debrief: Debrief | null };
}

/** One thing the learner actually sent, and whether they found it themselves. */
export interface ProducedTurn {
  text: string;
  fromSuggestion: boolean;
  /** Word count in the learner's own message — the length component of confidence. */
  words: number;
  /** Time from the coach's line landing to the send, in ms; null if unknown. */
  latencyMs: number | null;
  /** How long the coach's audio held the floor before this send, in ms. 0 when silent. */
  speakMs: number;
  /** True when the coach spoke but the duration could not be measured. */
  speakUnknown: boolean;
  /**
   * Model-reported breakdown signals (PLAN-028), shape-checked by `parseTurn`.
   * The observable ones are verified again by `breakdown.ts` before they count.
   */
  missed: string[];
  /** The one word the coach's last line carried the meaning of — checked against this reply. */
  keyWord: string;
  /**
   * The verified breakdown signals this turn carried (PLAN-028 → PLAN-029). The
   * empty array is the normal answer. Ridden onto the turn payload for the record
   * and never read to score anything — a breakdown is arithmetically invisible.
   */
  breakdown: string[];
  /**
   * The verdict this turn earned (PLAN-029): `clear` (the normal answer),
   * `suspect` (one signal, for the record), or `bluff`. Ridden on the turn
   * payload beside `breakdown`; nothing reads it to compute a number the learner
   * sees.
   */
  verdict: "clear" | "suspect" | "bluff";
}

/**
 * The rewind exchange as Talk renders it (PLAN-030): one grouped block, a
 * distinguishable pause. `own` is the coach taking the blame for pace; `repeat`
 * is the same sentence, byte for byte; `unpack` and `gift` fill in only when the
 * learner misses again. `turnIndex` is the produced turn whose verdict "No, I
 * understood" clears.
 */
export interface RewindExchange {
  own: string;
  repeat: string;
  unpack: UnpackResult | null;
  gift: string | null;
  turnIndex: number;
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
export function useTalk(settings: Settings, onSettings?: (patch: Partial<Settings>) => void) {
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
  // How long the coach's audio held the floor before the next send, in ms — and
  // whether it spoke but the duration could not be measured (PLAN-028). Set by
  // `say()` as the *accumulated* sum of every clip that held the floor (a rewind
  // is three clips and the floor is all three); read and drained by `send()` to
  // separate the learner's thinking time from the coach's speaking time. A turn
  // whose speak is unknown is excluded from the baseline and timing signals
  // entirely.
  const spokeMs = useRef(0);
  const spokeUnknown = useRef(false);
  // Bumped whenever a floor is abandoned mid-play (the learner spoke before the
  // coach finished, or speech went off). A clip that resolves after its floor
  // was abandoned must not add its duration to a floor that already moved on.
  const speakGeneration = useRef(0);
  // The per-session rewind budget (PLAN-029): rewinds spent and whether the
  // learner asked not to be interrupted. Held for this session and rebuilt by
  // `start`. `handicap` — the extra signals §3.3's denied rewind demands — lives
  // here too and is never persisted; it expires with the session, because a
  // learner having a sharp day is not a fact about the learner.
  const budget = useRef<SessionBudget>({ used: 0, handicap: 0, off: false });
  // The difficulty axis picked for this session (PLAN-031), and whether the
  // learner asked for ease today. `axis` is null for a session that deliberately
  // manufactures none; ease and a drowning turn both pull it null for the rest.
  // Both are per-session facts, never persisted — a learner having an easy day
  // is not a fact about the learner.
  const axis = useRef<Axis | null>(null);
  // Counts for §5.2's in-session drop: how many of the learner's turns have
  // carried two or more breakdown signals, across how many turns.
  const drownWatch = useRef<{ turns: number; heavy: number }>({ turns: 0, heavy: 0 });
  // Whether the axis was already dropped this session — a second trip must not
  // double-drop or drop below 0.
  const droppedAxis = useRef(false);
  // Whether the learner asked for ease this session — recorded on the day's
  // record so Coach can see the pattern, but never persisted as a switch.
  const easeAsked = useRef(false);
  // Rehearsal mode (PLAN-034): the coach is the other party, not a tutor. A
  // state, not a ref — Talk renders the phase (role vs. debrief) off it and the
  // picker must be able to read it. Null is an ordinary session. The brief is
  // kept beside it: it is shown at the top of the session, so a learner
  // returning to a half-finished rehearsal knows what they were preparing for.
  const [rehearsal, setRehearsal] = useState<{ brief: RehearsalBrief } | null>(null);
  // The mode as the wait machine sees it. `fireOffer` is armed by a timer that
  // captured the closure from the render where the wait was scheduled — reading
  // the `rehearsal` state there would see the value from *that* render, which
  // for the very first rehearsal is still null. A ref is read at fire time, so
  // the gate always sees the current mode. Mirrored on every `setRehearsal`.
  const rehearsalRef = useRef<{ brief: RehearsalBrief } | null>(null);
  // Phase two: the role-play has ended and the debrief has been (or is being)
  // fetched. `inRole` is the one flag the mode's switches read — role-play and
  // feedback are separated across it.
  const [outOfRole, setOutOfRole] = useState(false);
  // The debrief, once it has landed (or null while it is loading / never arrived).
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  // The per-session rewind state (PLAN-030): the gift cap (at most two for the
  // same category, at most one category per session) and the current step. Held
  // for this session and rebuilt by `start`/`resume`.
  const rewind = useRef<RewindState>(freshRewind());
  // The rewind exchange currently on screen, or null. Rendered as one grouped
  // block in Talk; "No, I understood" clears it and the turn's verdict.
  const [rewindExchange, setRewindExchange] = useState<RewindExchange | null>(null);
  // The coach's previous line, kept for the repeat step and for a learner REPEAT.
  const prevCoachLine = useRef<string>("");
  // A rewind queued by the decision block, to be driven after the turn's reply
  // has been spoken. `turnIndex` is the produced turn whose verdict "No, I
  // understood" clears; `line` is the coach's reply to repeat byte for byte;
  // `advance` is true when a rewind is already in progress and this miss moves
  // it repeat → unpack → gift rather than starting over.
  const pendingRewind = useRef<{ turnIndex: number; line: string; advance: boolean } | null>(null);
  // Set when the learner asked SLOW (§12's ninth claim): the next reply is told
  // to shorten its sentences, then the flag clears. The reply is generated before
  // the SLOW is verified, so the instruction lands on the turn after the ask.
  const shortenNext = useRef(false);
  // The learner's measured response baseline and median turn length (PLAN-028),
  // derived from the signals already saved to this language's DB. Built once at
  // session start; the timing signals grade each turn against them.
  const baseline = useRef<ReturnType<typeof baselineFrom>>({ median: 0, mad: 0, sample: 0, ready: false });
  const medianLen = useRef<number | null>(null);
  // How far the session's title has got: 0 unnamed, 1 named off the opening,
  // 2 re-named once the subject settled. Not a rolling rewrite — 2 is the end.
  const titleStage = useRef<0 | 1 | 2>(0);
  // When the coach's last reply finished rendering — the reference point for the
  // next send's latency. null until the first reply has landed.
  const coachReplyAt = useRef<number | null>(null);
  // Patience (PLAN-032): whether the coach is waiting for the learner, and the
  // deadline the wait runs to. `waiting` gates the suggestions render in Talk —
  // while it is true the screen is exactly what it was when the coach finished
  // speaking. It is raised at turn land (not when the queue empties), so the
  // chips stay hidden while the coach speaks. The state machine lives in
  // patience.ts (`WaitState`); this ref is the live copy, and the helpers below
  // drive it through the pure transitions.
  const [waiting, setWaiting] = useState(false);
  const waitState = useRef<WaitState>(freshWait());
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `armDeadline` is defined after `say`, but `say` starts the clock when its
  // queue empties — so it reaches the helper through this ref, which
  // `armDeadline` keeps pointing at itself. No dependency cycle: `say` depends
  // on the ref, `armDeadline` depends on `say` (through `fireOffer`).
  const armDeadlineRef = useRef<() => void>(() => {});
  // Praise (PLAN-032): how many pieces of praise have been shown this session
  // (capped at PRAISE_CAP), and the correction records the model may cite — the
  // labels of this learner's past corrections, read through `signalLabel` from
  // the signals `open()` already loads. Both are per-session, rebuilt by start.
  const praiseUsed = useRef(0);
  const correctionRecords = useRef<string[]>([]);
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

  // The coach's speech is strictly sequential — `speak` resolves when the clip
  // ends, so the next clip does not start until this one has finished (PLAN-030
  // §5.2). Without the queue, two `say` calls fired back-to-back (the rewind's
  // own → repeat, or a REPEAT obey followed by the reply) would start two clips
  // over each other. Every step lines up here and plays in order, and each
  // clip's duration *accumulates* into `spokeMs` — the floor before a send is
  // the sum of every clip that held it (PLAN-028's "how long the coach held the
  // floor"). `send` drains and resets the accumulator when it reads.
  const speakQueue = useRef<{ text: string; rate?: number }[]>([]);
  const speaking = useRef(false);

  const say = useCallback(
    (text: string, rate?: number) => {
      // Speech off: never queue. A line that piles up while silent would all fire
      // the moment speech comes back, so it is dropped here instead. The floor is
      // abandoned: anything still queued is dropped, the flag clears, and the
      // next on-speech `say` starts a fresh run.
      if (!settings.speak || !speech.canSpeak) {
        speakQueue.current = [];
        speaking.current = false;
        speakGeneration.current += 1;
        return;
      }
      const playNext = () => {
        const next = speakQueue.current.shift();
        if (!next) {
          speaking.current = false;
          // The coach has stopped speaking — the wait's clock starts here, and
          // only here (PLAN-032). `waiting` is not touched: it went up when the
          // turn landed and comes down when the wait expires or the learner
          // speaks. `armDeadlineRef` points at the latest `armDeadline`.
          armDeadlineRef.current();
          return;
        }
        const gen = speakGeneration.current;
        // Measure how long this clip held the floor and *add* it to the running
        // sum the send reads (PLAN-028). A TTS failure holds nothing, so it adds
        // nothing and just moves the queue along. A clip that resolves after its
        // floor was abandoned (generation moved on) adds nothing — its floor was
        // already gone.
        void speech
          .speak(next.text, {
            locale: pack?.speech.locale,
            voiceHint: persona?.voiceHint || pack?.speech.voiceHint,
            rate: next.rate,
          })
          .then((ms) => {
            if (gen === speakGeneration.current) spokeMs.current += ms;
            playNext();
          })
          .catch(() => {
            playNext();
          });
      };
      speakQueue.current.push({ text, rate });
      if (!speaking.current) {
        speaking.current = true;
        playNext();
      }
      // Two consecutive clips cannot race: whatever `say` was called first starts
      // playing first, and `spokeMs` is only ever *added to* as clips end, so a
      // later clip can never overwrite an earlier one. A call that arrives while
      // a clip still holds the floor waits its turn and adds to the same sum.
    },
    [settings.speak, speech, pack, persona],
  );

  /**
   * End the wait (PLAN-032): clear the timer and the deadline, and drop the
   * `waiting` flag so the suggestions render again. Called when the learner
   * starts typing or holding the mic — a learner mid-sentence has not stalled —
   * and when a turn lands. Input resets the deadline and ends the wait.
   */
  const clearWait = useCallback(() => {
    if (waitTimer.current) {
      clearTimeout(waitTimer.current);
      waitTimer.current = null;
    }
    waitState.current = clearWaitState(waitState.current);
    setWaiting(false);
  }, []);

  /**
   * Fire one offer (PLAN-032): a coach line like any other, through `say()`, so
   * its duration lands in `spokeMs` and the next turn's latency stays honest. It
   * does not touch `prevCoachLine` — a REPEAT after an offer must repeat the
   * sentence the conversation was about, not the offer. It does not enter
   * `history.current`, is not a message, and produces no signal. Firing the
   * offer ends the wait — the suggestions appear — and re-arms a full `waitMs`
   * for the next offer. At most `OFFER_CAP` per turn; past that the coach is
   * silent until the learner says something.
   *
   * If the coach is still speaking (`speaking.current`), the offer must not
   * interrupt mid-sentence — a rewind's own → repeat is still on the floor. It
   * re-arms a full wait and returns, so the offer waits for the next quiet
   * stretch rather than cutting in.
   */
  const fireOffer = useCallback(() => {
    // PLAN-034: in role the coach does not offer — "want me to start you off?"
    // is the coach teaching, and the coach is not in the room. The wait runs to
    // its end (the silence is the point) and then comes down with the offer:
    // nothing is spoken, and nothing re-arms. Letting it re-arm would only
    // schedule a second timer to be stood down again, and `waiting` gates the
    // suggestion rail, which is empty in role either way.
    //
    // The gate lives here, at the wait, not on the rail — the rail is empty in
    // role anyway, and the offer is what would speak over it. It reads the
    // *ref*, not the state: the timer that fires this captured the closure from
    // the render where the wait was scheduled, and for the first rehearsal that
    // render's state was still null.
    if (rehearsalRef.current) {
      if (waitTimer.current) clearTimeout(waitTimer.current);
      waitTimer.current = null;
      waitState.current = { ...waitState.current, waiting: false, deadline: null };
      setWaiting(false);
      return;
    }
    const ms = waitMs(baseline.current, settings.patience);
    const before = waitState.current;
    const next = onWaitElapsed(before, Date.now(), ms, speaking.current);
    waitState.current = next;
    if (next.deadline === null) {
      if (waitTimer.current) clearTimeout(waitTimer.current);
      waitTimer.current = null;
      setWaiting(false);
      return;
    }
    // An offer actually fired (the count went up): speak it and show the
    // suggestions. If the coach was mid-speech, the state re-armed without
    // firing — nothing is spoken and the wait continues.
    if (next.offerCount > before.offerCount) {
      const packId = pack?.id ?? "en";
      say(OFFER_LINE[packId] ?? OFFER_LINE.en);
      setWaiting(false);
    }
    if (waitTimer.current) clearTimeout(waitTimer.current);
    waitTimer.current = setTimeout(() => {
      waitTimer.current = null;
      fireOffer();
    }, next.deadline - Date.now());
  }, [pack, say, settings.patience]);

  /**
   * Arm the wait at turn land (PLAN-032). The flag, not the clock: the chips are
   * hidden from the moment the reply lands, and the deadline is set later, by
   * `armDeadline`, when the coach actually stops speaking. A `null` wait (no
   * baseline yet) arms nothing — the coach does not interrupt at all.
   */
  const armWait = useCallback(() => {
    const ms = waitMs(baseline.current, settings.patience);
    waitState.current = armWaitState(waitState.current, ms);
    // No deadline is live until the coach falls silent; a timer left over from
    // the previous turn must not fire into this one.
    if (waitTimer.current) clearTimeout(waitTimer.current);
    waitTimer.current = null;
  }, [settings.patience]);

  /**
   * Start the wait's clock (PLAN-032): the coach has stopped speaking, so the
   * learner's silence begins now and the offer is a full `waitMs` away. Called
   * from `say` when the queue empties — a reply, a rewind's own → repeat, an
   * offer's own line all end here — and at turn land when speech is off, since
   * then nothing is ever queued and the coach never "stops speaking".
   *
   * Every wait the learner experiences is therefore a full wait of *silence*,
   * not a wait the coach's own audio has already spent.
   */
  const armDeadline = useCallback(() => {
    const ms = waitMs(baseline.current, settings.patience);
    const next = onSpeechEnd(waitState.current, Date.now(), ms);
    waitState.current = next;
    if (next.deadline === null) return;
    if (waitTimer.current) clearTimeout(waitTimer.current);
    waitTimer.current = setTimeout(() => {
      waitTimer.current = null;
      fireOffer();
    }, next.deadline - Date.now());
  }, [settings.patience, fireOffer]);

  // `say` reaches `armDeadline` through this ref — see its declaration above.
  armDeadlineRef.current = armDeadline;

  /**
   * A verified `HOLD` (PLAN-032): the learner asked for time, so the wait is
   * re-armed at a **full** wait from the moment the HOLD landed, and the turn's
   * offer count is closed — a learner who asked for time is not then offered
   * help. Not "waits a bit more": a full wait again. A second `HOLD` re-arms it
   * again, with no cap. Only a `HOLD` that survived `verifyRepair` counts — the
   * observation in `repairs.current`, not `turn.repair`. A reported move the
   * learner never wrote changes nothing here.
   */
  const resetWaitOnHold = useCallback(() => {
    const ms = waitMs(baseline.current, settings.patience);
    const next = onHold(waitState.current, Date.now(), ms);
    waitState.current = next;
    if (next.deadline === null) return;
    if (waitTimer.current) clearTimeout(waitTimer.current);
    waitTimer.current = setTimeout(() => {
      waitTimer.current = null;
      fireOffer();
    }, next.deadline - Date.now());
  }, [settings.patience, fireOffer]);

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
    async (sc: Scenario, mode: "normal" | "rehearsal" = "normal", brief?: RehearsalBrief, goal?: string) => {
      // PLAN-034: the mode is decided from the *parameters*, not from the
      // `rehearsal` state — `setRehearsal` only lands on the next render, so
      // reading it here would make the first call of a rehearsal behave like an
      // ordinary session. `inRole` is the one flag every switch below reads.
      const inRole = mode === "rehearsal" && !!brief;
      setScenario(sc);
      setPersona(sc.persona);
      setGoalState((sc.goals ?? []).map(() => "pending" as const));
      setMsgs([]);
      setSuggestions([]);
      setReflecting(false);
      setReflection(null);
      setError("");
      setNotice("");
      // Rehearsal mode (PLAN-034): the role starts now, and any previous
      // session's debrief is gone with the rest of it. This is for the next
      // render — the decisions above and below run off `inRole`. The ref is
      // mirrored so the wait machine's gate sees the mode at fire time.
      setRehearsal(inRole && brief ? { brief } : null);
      rehearsalRef.current = inRole && brief ? { brief } : null;
      setOutOfRole(false);
      setDebrief(null);
      titleStage.current = 0;
      coachReplyAt.current = null;
      produced.current = [];
      setProducedVersion((v) => v + 1);
      voice.current = [];
      reveals.current = [];
      repairs.current = [];
      spokeMs.current = 0;
      spokeUnknown.current = false;
      // A fresh session is a fresh floor: nothing queued from the old one may
      // play into the new, and a clip still in flight is abandoned.
      speakQueue.current = [];
      speaking.current = false;
      speakGeneration.current += 1;
      // A new session is a new budget (PLAN-029): the rewind cap and the learner's
      // "don't interrupt" ask belong to the session, not to the app. `handicap` is
      // forgotten here too — a sharp day is not a fact about the learner (§3.3).
      budget.current = { used: 0, handicap: 0, off: false };
      // A new session is a fresh difficulty watch (PLAN-031): the axis, the
      // drowning counts, the ease ask and the drop flag all belong to the session.
      axis.current = null;
      drownWatch.current = { turns: 0, heavy: 0 };
      droppedAxis.current = false;
      easeAsked.current = false;
      rewind.current = freshRewind();
      setRewindExchange(null);
      prevCoachLine.current = "";
      // A new session is a fresh patience state (PLAN-032): no wait pending, no
      // offers fired, no praise spent, and the correction records the model may
      // cite are rebuilt from the signals about to be loaded.
      clearWait();
      waitState.current = freshWait();
      praiseUsed.current = 0;
      correctionRecords.current = [];
      setBusy(true);
      // What earlier conversations left behind. It rides in the system prompt, so
      // every call made off this history — the turns, the wrap-up, the vocabulary
      // capture — is talking to a coach that has read it.
      const memories = await recentMemories(settings.profile.targetLanguage).catch(() => []);
      // The learner's own response baseline (PLAN-028), rebuilt from the signals
      // this language has already recorded — timing signals normalise against it
      // and against nothing else. Unready is the honest first-session state.
      const known = await recentSignals(settings.profile.targetLanguage).catch(() => [] as Awaited<ReturnType<typeof recentSignals>>);
      const nowMs = Date.now();
      baseline.current = baselineFrom(known, nowMs);
      medianLen.current = medianTurnWords(known, nowMs);
      // The correction records the model may cite for praise (PLAN-032): the
      // labels of this learner's past corrections, read through `signalLabel` —
      // the single door `open()` already loads through. No second reader, no new
      // query.
      correctionRecords.current = known
        .filter((s) => s.kind === "correction")
        .map((s) => signalLabel(s))
        .filter((l): l is string => l !== null);
      // The one axis this session is made harder in (PLAN-031) — picked once, at
      // the door, from the learner's readiness and the last sessions' outcomes.
      // `null` is a real answer (a fresh learner, a recovered one, a learner who
      // asked for ease); a `null` session is simply not manufactured.
      // PLAN-034: a rehearsal picks no axis at all — `pickAxis` is not called,
      // because the difficulty axes are off and there is nothing to calibrate
      // against in a dress rehearsal for practice.
      if (!inRole) {
        const recaps = recapsFrom(known);
        axis.current = pickAxis(
          { ready: baseline.current.ready },
          recaps,
          levelOf(settings.profile),
          { ease: false, canSpeak: speech.canSpeak },
        );
      }
      // PLAN-033: the one detail this session may open with, picked at the door
      // from the memory rows and nothing else. `null` is a real answer — a
      // learner with no recent, open-ended, unasked fact gets an opening with no
      // personal detail. When one is chosen it is stamped as asked *now*, the
      // moment it is supplied to the system prompt — not when the model is
      // observed to have used it.
      // PLAN-034: a supplier does not know the learner moved house last month —
      // `openingDetail` is not called in rehearsal, and no memory is stamped.
      const opening = !inRole ? openingDetail(memories, Date.now()) : null;
      if (opening) void stampMemoryAsked(opening.id).catch(() => {});
      const system = inRole
        ? rehearsalSystem(settings, brief!, sc, pack)
        : buildSystem(settings, sc, sc.persona, pack, memories, {
            axis: axis.current,
            step: settings.difficultyStep,
          }, correctionRecords.current, opening) + (goal ? `\nQuietly give the learner practice with: ${goal}.` : "");
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
        // A rehearsal's opening line is parsed by `parseRole`: the in-role turn
        // carries no corrections and no suggestions, and a model that sends them
        // anyway has them ignored, not shown.
        const turn = inRole ? parseRole(raw) : parseTurn(raw);
        history.current.push({ role: "assistant", content: turn.reply });
        if (sessionId.current) await addMessage(sessionId.current, "assistant", turn.reply);
        setStreaming(""); // same commit as the message that replaces it
        setMsgs([{ role: "ai", text: turn.reply, corrections: [], inline: false }]);
        // In role the suggestion rail is empty: "want me to start you off?" is
        // the coach teaching, and the coach is not in the room.
        setSuggestions(inRole ? [] : (turn as { suggestions?: string[] }).suggestions ?? []);
        // The coach's opening line is `prevCoachLine` from the first word — a
        // learner REPEAT on the very first sentence repeats it, not "" (PLAN-030 §5).
        prevCoachLine.current = turn.reply;
        say(turn.reply);
        // The wait begins at turn land (PLAN-032): raise `waiting` so the chips
        // stay hidden while the coach speaks. The clock itself starts when the
        // coach falls silent — `say`'s queue-empty path — except when speech is
        // off, where nothing is ever queued and the silence starts here. A null
        // wait (no baseline yet) raises nothing: a first session never offers.
        if (waitMs(baseline.current, settings.patience) !== null) {
          setWaiting(true);
          armWait();
          if (!settings.speak || !speech.canSpeak) armDeadline();
        }
      } catch (e: unknown) {
        const { say: said, log } = humanError(e);
        console.warn("[talk] start failed:", log);
        setError(said);
      } finally {
        setStreaming(""); // a half-streamed reply is not a turn — it must not linger
        setBusy(false);
      }
    },
    [settings, pack, say, speech, clearWait, armWait, armDeadline],
  );

  /**
   * Rehearsal mode's own entry (PLAN-034): build the synthetic scenario from the
   * brief and start in rehearsal mode. The scenario is never saved to the
   * catalogue — the whole premise is that the conversation the learner needs is
   * not in our catalogue — and the loop is this loop, not a fork of it.
   */
  const startRehearsal = useCallback(
    async (brief: RehearsalBrief) => {
      await start(rehearsalScenario(brief), "rehearsal", brief);
    },
    [start],
  );

  /**
   * The role-play is over (PLAN-034): the learner ended it, the coach steps out
   * ("okay, out of role"), and the debrief arrives as its own block. The
   * conversation history stays untouched from here — the debrief is derived
   * from it, not a turn in it.
   */
  const endRole = useCallback(async () => {
    if (!rehearsal || outOfRole || busy) return;
    setOutOfRole(true);
    setBusy(true);
    setError("");
    try {
      const provider = getProvider(settings);
      const learnerTurns = msgs
        .filter((m) => m.role === "user" && !m.isAsk)
        .map((m) => m.text);
      const raw = await provider.chat(
        [...history.current, { role: "user" as const, content: debriefPrompt(settings, rehearsal.brief, learnerTurns, pack) }],
        { json: true },
      );
      // The transcript handed to the parser is the same list the prompt numbered,
      // so an index the model reports means something — one that does not exist
      // in it is dropped at parse.
      setDebrief(parseDebrief(raw, learnerTurns.length));
    } catch (e: unknown) {
      const { say: said, log } = humanError(e);
      console.warn("[talk] debrief failed:", log);
      setError(said);
    } finally {
      setBusy(false);
    }
  }, [rehearsal, outOfRole, busy, settings, pack, msgs]);

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
        spokeMs.current = 0;
        spokeUnknown.current = false;
        // A resume begins a fresh floor: nothing queued from the old one plays
        // into the resumed conversation.
        speakQueue.current = [];
        speaking.current = false;
        speakGeneration.current += 1;
        // A resumed conversation starts a fresh budget (PLAN-029) — the rewind
        // cap and handicap were never persisted, so they cannot be recovered here
        // and are begun anew with the conversation.
        budget.current = { used: 0, handicap: 0, off: false };
        // A resumed conversation carries no manufactured difficulty (PLAN-031):
        // the axis is picked at *start*, and a resume is not a start — the old
        // session's axis (or none) is forgotten, and nothing new is chosen here.
        axis.current = null;
        drownWatch.current = { turns: 0, heavy: 0 };
        droppedAxis.current = false;
        easeAsked.current = false;
        rewind.current = freshRewind();
        setRewindExchange(null);
        prevCoachLine.current = "";
        // A resumed conversation starts a fresh patience state (PLAN-032): no
        // wait pending, no offers fired, no praise spent. The correction records
        // are rebuilt from the signals about to be loaded.
        clearWait();
        waitState.current = freshWait();
        praiseUsed.current = 0;
        correctionRecords.current = [];
        // A resumed conversation is an ordinary conversation (PLAN-034). The mode
        // belongs to the session, like every other reset above it, and `resume`
        // is the one door into a session that was not opening a rehearsal — left
        // uncleared, a resumed session inherits the last rehearsal: no offer, no
        // corrections shown, no suggestions, its turns parsed as in-role, a
        // `rehearsal` marker written into the record and calibration skipped. The
        // ref is mirrored here for the same reason `start` mirrors it: the wait's
        // timer reads the ref, not the state.
        setRehearsal(null);
        rehearsalRef.current = null;
        setOutOfRole(false);
        setDebrief(null);
        sessionId.current = sessionIdToResume;
        // The provider context is rebuilt from the stored transcript so the next
        // turn continues the conversation rather than starting a new one.
        // The rewind's repeat step and a learner REPEAT both re-speak the coach's
        // most recent line; after a resume that is the last assistant message in
        // the transcript — a REPEAT on the first turn after resuming must repeat
        // it, not "" (PLAN-030 §5).
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].role === "assistant") {
            prevCoachLine.current = rows[i].content;
            break;
          }
        }
        const memories = await recentMemories(settings.profile.targetLanguage).catch(() => []);
        // The response baseline is rebuilt too — the learner's history may have
        // grown since the conversation was left, so the timing signals grade
        // against what is true now.
        const known = await recentSignals(settings.profile.targetLanguage).catch(() => [] as Awaited<ReturnType<typeof recentSignals>>);
        baseline.current = baselineFrom(known, Date.now());
        medianLen.current = medianTurnWords(known, Date.now());
        correctionRecords.current = known
          .filter((s) => s.kind === "correction")
          .map((s) => signalLabel(s))
          .filter((l): l is string => l !== null);
        history.current = [
          { role: "system", content: buildSystem(settings, sc, sc.persona, pack, memories, { axis: null, step: settings.difficultyStep }, correctionRecords.current) },
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
    [settings, pack, clearWait],
  );

  /**
   * Drive the four rewind steps (PLAN-030). The order is the design: own the
   * pace, repeat the same sentence slower, and only then unpack and gift. Each
   * step is a model call or a fixed line; the exchange is rendered as one
   * grouped block in Talk.
   *
   * `advance` is true when the learner missed again after a rewind already
   * started — the flow moves repeat → unpack → gift rather than starting over.
   * Every transition is computed by `nextStep`, the single owner of the order;
   * nothing here hand-writes `repeat → unpack` or `unpack → gift`.
   *
   * `stopAfterRepeat` is PLAN-034's rehearsal cap: in role, `own` and `repeat`
   * are a person saying it again, more slowly — any real supplier does that —
   * but `unpack` explains the sentence and `gift` hands the learner a phrase,
   * and both are teaching. The drive stops after `repeat`; the gift moves to
   * the debrief, where a phrase the learner could have used belongs.
   */
  const driveRewind = useCallback(
    async (turnIndex: number, line: string, advance: boolean, stopAfterRepeat = false) => {
      const packId = pack?.id ?? "en";
      const ex = rewindExchange;

      if (!advance) {
        // Step 1 — own: one short line taking the blame for pace. Produced by the
        // model, gated by bannedShape; a produced line that blames the learner is
        // replaced by the pack's fixed fallback.
        let own = OWN_FALLBACK[packId] ?? OWN_FALLBACK.en;
        try {
          const raw = await getProvider(settings).chat(
            [...history.current, { role: "user", content: rewindOwnPrompt(settings, pack) }],
            { json: true },
          );
          const produced = parseOwnLine(raw);
          if (produced && !bannedShape(produced)) own = produced;
        } catch {
          /* the fallback line stands */
        }
        say(own);

        // Step 2 — repeat: the same sentence, byte for byte, at SLOW_RATE. No model.
        say(repeatText(line), SLOW_RATE);

        // The rewind exchange joins the history so the coach's next reply knows
        // the pace was owned — but it answers what the learner eventually said,
        // not the rewind. Only the "own" line is new; the repeat is the coach's
        // previous line, already in history.
        history.current.push({ role: "assistant", content: own });

        // The rewind is now at repeat: `nextStep("own", _) → repeat` is the one
        // transition a fresh rewind takes, and the four steps that follow are a
        // single interrupted rewind, not four new ones.
        rewind.current.step = "repeat";
        setRewindExchange({ own, repeat: line, unpack: null, gift: null, turnIndex });
        return;
      }

      // The learner missed again. The next step is `nextStep`'s call — a clean
      // turn (`missedAgain: false`) would resume, but advance is true, so a
      // repeat follows an unpack that resolved it, never a gift that skipped it.
      const from = rewind.current.step ?? "repeat";
      // PLAN-034: in role a rewind that already reached `repeat` has nowhere to
      // go — the role broke below it. `nextStep` is not consulted; the exchange
      // simply comes down and the conversation resumes.
      if (stopAfterRepeat) {
        rewind.current.step = null;
        setRewindExchange(null);
        return;
      }
      const to = nextStep(from, true);

      if (to === "unpack") {
        // Step 3 — unpack: break the line up, isolate the key word, gloss it.
        let unpack: UnpackResult = { parts: [], keyWord: "", gloss: "" };
        try {
          const raw = await getProvider(settings).chat(
            [...history.current, { role: "user", content: rewindUnpackPrompt(settings, ex?.repeat ?? "", "", pack) }],
            { json: true },
          );
          unpack = parseUnpack(raw);
        } catch {
          /* an empty unpack is still a pause, not a crash */
        }
        rewind.current.step = "unpack";
        if (ex) setRewindExchange({ ...ex, unpack });
        if (unpack.gloss) history.current.push({ role: "assistant", content: `${unpack.keyWord} — ${unpack.gloss}` });
        return;
      }

      if (to === "gift") {
        // Step 4 — gift: model the repair pattern nextTarget points at, by using
        // it. Capped at two per category, one category per session.
        const target = nextTarget(inventoryFrom(await recentSignals(settings.profile.targetLanguage).catch(() => []), Date.now()));
        if (target) {
          const { step: gs, observation } = giftStep(rewind.current, target);
          if (gs === "gift" && observation) {
            repairs.current.push(observation);
            rewind.current.step = "gift";
            const gift = GIFT_LINE[packId] ?? GIFT_LINE.en;
            if (ex) setRewindExchange({ ...ex, gift });
            history.current.push({ role: "assistant", content: gift });
            return;
          }
        }
        // Capped, or nothing left to teach: fall through to resume.
      }

      // to === "resume" (a gift with the cap hit, or a step already at gift) —
      // the rewind is over. The exchange comes down and the next normal turn
      // continues the conversation.
      rewind.current.step = null;
      setRewindExchange(null);
    },
    [settings, pack, say, rewindExchange],
  );

  /**
   * "No, I understood" (PLAN-030): the learner says the rewind was not needed.
   * Drops the mark from that turn (verdict → clear), raises the handicap to 1
   * for the session, and returns to the conversation with no comment. The spent
   * rewind does not come back — a denied rewind was still an intervention.
   */
  const denyRewind = useCallback(() => {
    const ex = rewindExchange;
    if (!ex) return;
    const turn = produced.current[ex.turnIndex];
    if (turn) turn.verdict = "clear";
    budget.current.handicap = DENIED_HANDICAP;
    rewind.current.step = null;
    setRewindExchange(null);
  }, [rewindExchange]);

  const send = useCallback(
    async (text: string, fromSuggestion = false) => {
      const msg = text.trim();
      if (!msg || busy || !scenario) return;
      setInput("");
      setError("");
      setNotice(""); // last turn's degrade notice is not this turn's news
      setSuggestions([]);
      // The learner is sending — they have not stalled. End the wait and show
      // the suggestions again (PLAN-032).
      clearWait();
      waitState.current = { ...waitState.current, offerCount: 0 };
      const idx = msgs.length;
      setMsgs((m) => [...m, { role: "user", text: msg, corrections: [], inline: false }]);
      // Latency is the time from the coach's line landing to this send. The
      // coach's reply was stamped when it finished rendering; the first turn has
      // no prior reply, so its latency is unknown.
      const latencyMs = coachReplyAt.current ? performance.now() - coachReplyAt.current : null;
      // The coach's speaking time is the learner's thinking time only in the
      // sense that the learner was waiting for it — the baseline strips it out
      // (PLAN-028). A turn whose speak could not be measured is excluded there,
      // never estimated, and never zeroed. When the coach is *still speaking*
      // (the queue has not drained), `spokeMs` holds only part of this turn's
      // floor — a partially-read floor is unmeasured, and §10's rule is that an
      // unmeasured speak is absent, not a smaller number. Such a turn is marked
      // `speakUnknown` and never reaches the timing signals.
      const floorInProgress = speaking.current;
      produced.current.push({
        text: msg,
        fromSuggestion,
        words: words(msg, pack?.speech.locale ?? "en").length,
        latencyMs,
        speakMs: spokeMs.current,
        speakUnknown: spokeUnknown.current || floorInProgress,
        // Filled when the turn's JSON lands (parseTurn below) — the model's
        // breakdown report is patched onto this same turn a moment later, and
        // PLAN-029's verdict with it once the signals are verified.
        missed: [],
        keyWord: "",
        breakdown: [],
        verdict: "clear",
      });
      // The floor is read and drained: this turn owns everything accumulated so
      // far and the counter resets for the next send. The generation is *not*
      // bumped here — nothing cancels the audio on a send, so a clip still
      // playing keeps holding the floor into the next turn's latency window and
      // belongs to that window's sum. Dropping it would under-strip the next
      // turn's latency, which is the direction that invents a `slowResponse`.
      spokeMs.current = 0;
      spokeUnknown.current = false;
      setProducedVersion((v) => v + 1);
      history.current.push({ role: "user", content: msg });
      if (sessionId.current) await addMessage(sessionId.current, "user", msg).catch(() => {});

      setBusy(true);
      try {
        // §12's ninth claim: a learner SLOW asks the coach to shorten sentences
        // for this turn. The instruction rides on the context for this one reply
        // and clears — it is a per-turn ask, not a new standing rule.
        if (shortenNext.current) {
          shortenNext.current = false;
          history.current.push({
            role: "user",
            content: "(The learner asked you to slow down. Keep this reply to one short sentence.)",
          });
        }
        const raw = await getProvider(settings).chat(history.current, {
          json: true,
          maxTokens: TURN_MAX_TOKENS,
          onDelta: live(setStreaming),
        });
        // The in-role turn (PLAN-034) is parsed by `parseRole`: `corrections`,
        // `suggestions`, `goalsMet`, `praise` and `ease` a model sends anyway are
        // ignored, not shown. In role there is no coach to teach with them.
        const turn: RoleTurn & { corrections?: Correction[]; suggestions?: string[]; goalsMet?: number[]; praise?: { for: string; text: string } | null; ease?: boolean } =
          rehearsal ? parseRole(raw) : parseTurn(raw);
        history.current.push({ role: "assistant", content: turn.reply });
        if (sessionId.current) await addMessage(sessionId.current, "assistant", turn.reply).catch(() => {});
        // The coach's reply has landed — stamp it so the next send can measure
        // its latency against it.
        coachReplyAt.current = performance.now();
        const sent = produced.current[produced.current.length - 1];

        // In role (PLAN-034) there are no corrections to show and no rail to fill:
        // the other party does not grade, and "want me to start you off?" is the
        // coach teaching. The wait itself still runs — the silence is the point.
        const worst = rehearsal
          ? undefined
          : ((turn as { corrections?: Correction[] }).corrections ?? []).find((c) => c.severity === "severe") ??
            (turn as { corrections?: Correction[] }).corrections?.[0];
        // Dropped in the same commit the real message lands in — anywhere earlier
        // and the DB write above sits between them as a frame of empty screen.
        setStreaming("");
        setMsgs((m) => {
          const next = [...m];
          if (next[idx])
            next[idx] = {
              ...next[idx],
              corrections: rehearsal ? [] : ((turn as { corrections?: Correction[] }).corrections ?? []),
              inline: rehearsal ? false : shouldShowInline(settings.correctionTiming, worst?.severity),
            };
          next.push({ role: "ai", text: turn.reply, corrections: [], inline: false });
          return next;
        });
        setSuggestions(rehearsal ? [] : (turn as { suggestions?: string[] }).suggestions ?? []);

        // Praise needs a receipt (PLAN-032): the model's praise is shown only when
        // `praiseGate` says its `for` matches a real correction record exactly and
        // the session cap is not spent. The praise sentence lives in `text`,
        // outside `reply`, so a dropped praise really drops — the field is not
        // rendered, and `reply` stands on its own without it.
        // PLAN-034: in role praise is never kept at all — the other party has
        // never seen a correction record to cite. It belongs in the debrief if
        // anywhere.
        let praiseText: string | undefined;
        if (!rehearsal && (turn as { praise?: { for: string; text: string } | null }).praise) {
          const { keep } = praiseGate((turn as { praise: { for: string; text: string } }).praise, correctionRecords.current, praiseUsed.current);
          if (keep) {
            praiseUsed.current += 1;
            praiseText = (turn as { praise: { text: string } }).praise.text;
          }
        }
        if (praiseText) {
          setMsgs((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            if (last && last.role === "ai") next[next.length - 1] = { ...last, praise: praiseText };
            return next;
          });
        }

        // A goal the coach says was just met ticks — and only that one. A returned
        // index moves a pending goal to met and never moves it back; a goal already
        // met is left alone, and an index past the list is ignored.
        // PLAN-034: in role no goal is ever credited — the other party has no
        // goals sheet.
        if (!rehearsal && ((turn as { goalsMet?: number[] }).goalsMet ?? []).length) {
          setGoalState((gs) => {
            const next = [...gs];
            for (const i of (turn as { goalsMet: number[] }).goalsMet) {
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

        // A verified HOLD (PLAN-032): the learner asked for time, so the wait is
        // re-armed at a full `waitMs` from the moment the HOLD landed, and the
        // turn's offer count is closed — a learner who asked for time is not then
        // offered help. Only a HOLD that survived `verifyRepair` counts — the
        // observation in `repairs.current`, not `turn.repair`. A reported move
        // the learner never wrote changes nothing here, exactly as it changes
        // nothing in the inventory (PLAN-027).
        if (repair && repair.category === "HOLD" && repair.by === "learner") {
          resetWaitOnHold();
        }

        // The decision (PLAN-029): verify this turn's signals and turn the list
        // into a verdict. Everything here is arithmetic for the record; the only
        // effect is `verdict`, ridden onto the turn beside `breakdown`. What the
        // verdict does to the rewind budget is `rewindAct`'s call (PLAN-030 §5.1):
        // a `bluff` starts or advances one rewind — and only a `bluff` spends the
        // budget, and only when it starts a rewind rather than advancing one. Any
        // other verdict is the conversation resuming, which also closes an
        // in-flight rewind. A turn's signals never reach `judge` as silence —
        // `send` only runs for a non-empty message, so condition 3 (the
        // conversation continued) is met by construction and silence never becomes
        // a bluff.
        if (sent) {
          sent.missed = turn.missed;
          sent.keyWord = turn.keyWord;
          const signals = turnSignalsFor(sent, baseline.current, {
            reply: msg,
            medianTurnWords: medianLen.current,
          });
          sent.breakdown = signals;
          // `spoke: true` — condition 3 (the conversation continued) is met by
          // construction here: `send` only runs for a non-empty message, so
          // silence never reaches the decision. The check pins the guard.
          const { verdict } = judgeTurn(signals, repair, budget.current, true);
          sent.verdict = verdict;
          const move: RewindMove = rewindAct(
            verdict,
            budget.current.off,
            budget.current.used,
            rewind.current.step,
            produced.current.length - 1,
            turn.reply,
          );
          if (move.kind === "start") {
            // PLAN-030: the interruption is a *new* rewind — the coach stops, owns
            // the pace, and repeats the same sentence slower. Only this spends the
            // budget's `used`: the four steps are one rewind, so advancing one
            // (below) costs nothing more. Fired after the reply is spoken, so the
            // rewind follows the turn it interrupts.
            budget.current.used += 1;
            pendingRewind.current = { turnIndex: move.turnIndex, line: move.line, advance: false };
          } else if (move.kind === "advance") {
            // The learner missed again while a rewind is already in flight: it
            // moves repeat → unpack → gift, and spends nothing — `used` was
            // already spent when the rewind started.
            pendingRewind.current = { turnIndex: produced.current.length - 1, line: turn.reply, advance: true };
          } else {
            // A clean turn — the conversation resumed. Any in-flight rewind is
            // done: the exchange comes down and the next normal turn carries the
            // conversation forward (§5.1 rewind: end).
            rewind.current.step = null;
            setRewindExchange(null);
          }
        }

        // "Do not push me today" (PLAN-031): reachable two ways — the learner said
        // it in the conversation (turn.ease), or via ⌘K → `ease()`. Effect,
        // unconditionally and without a word: the axis goes null for the rest of
        // the session and the rewind budget's `off` is set so nothing interrupts.
        // `difficultyStep` is left byte-identical and nothing persists to settings.
        // PLAN-034: in role there is no coach to ask — `ease` is not read at all.
        if (!rehearsal && (turn as { ease?: boolean }).ease && !easeAsked.current) {
          easeAsked.current = true;
          axis.current = easeEffect(settings.difficultyStep).axis;
          budget.current.off = true;
        }

        // The in-session drop (PLAN-031 §5.2) — the one that does NOT wait for
        // `calibrate`. As the learner drowns, the axis is pulled null and the step
        // drops immediately, both without a word. `drownWatch` tracks this
        // session's turns; once tripped, `droppedAxis` stops a second drop.
        // The watch counts every turn, and the drop does not ask whether an axis
        // is active: the session with no axis is exactly the one `pickAxis` hands
        // a learner whose last session drowned, so gating either on an axis would
        // deny the drop to the learner who drowns twice running.
        if (sent && !droppedAxis.current) {
          drownWatch.current.turns += 1;
          if (sent.breakdown.length >= 2) drownWatch.current.heavy += 1;
          const drop = dropOnDrown(drownWatch.current, settings.difficultyStep, droppedAxis.current);
          if (drop) {
            droppedAxis.current = true;
            axis.current = drop.axis;
            // The drop is a fact about the learner, so it persists — calibration's
            // rise lives in settings.difficultyStep too, so they cannot drift.
            onSettings?.({ difficultyStep: drop.step });
          }
        }

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

        // §12's ninth claim: a learner SLOW/REPEAT is obeyed, not thanked. The
        // reward for asking is that asking worked. SLOW slows this reply and
        // shortens the next; REPEAT re-speaks the previous line first, byte for
        // byte, then replies.
        const obey = obeyRepair(repair, prevCoachLine.current);
        if (obey.kind === "repeat") say(obey.line, SLOW_RATE);
        say(turn.reply, obey.kind === "slow" ? SLOW_RATE : undefined);
        // A praise that survived the gate is spoken, after the reply and as its
        // own clip (PLAN-032). Talk is voice-primary (PLAN-018): a praise the
        // learner can only read is one a learner talking with the coach never
        // receives. It rides `say` like any other coach line, so its duration
        // lands in `spokeMs` and the next turn's latency stays honest, and it
        // does not touch `prevCoachLine` — a REPEAT repeats the reply.
        // PLAN-034: in role no praise is spoken — none was ever kept.
        if (praiseText) say(praiseText);
        if (obey.kind === "slow") shortenNext.current = true;
        prevCoachLine.current = turn.reply;
        // The wait begins at turn land (PLAN-032): raise `waiting` so the chips
        // stay hidden while the coach speaks. The clock itself starts when the
        // coach falls silent — `say`'s queue-empty path — except when speech is
        // off, where nothing is ever queued and the silence starts here. A null
        // wait (no baseline yet) raises nothing: a first session never offers.
        if (waitMs(baseline.current, settings.patience) !== null) {
          setWaiting(true);
          armWait();
          if (!settings.speak || !speech.canSpeak) armDeadline();
        }

        // The rewind, if the decision asked for one: drive the four steps after
        // the turn's reply has been spoken — but only the *new* rewind was queued
        // here; an advanced rewind's own → repeat already ran when it started, so
        // the next step's repeat → unpack → gift is the only thing left to drive.
        // PLAN-034: in role the rewind stops after `repeat` — `unpack` explains
        // the sentence and `gift` hands the learner a phrase to use on the coach,
        // and both are teaching. A gift a rehearsal could have given lands in the
        // debrief instead, where a phrase the learner could have used belongs.
        if (pendingRewind.current) {
          const queued = pendingRewind.current;
          pendingRewind.current = null;
          if (rehearsal && !queued.advance) {
            // A fresh rewind runs only own → repeat: the drive stops there, and
            // the step stays at `repeat` so no later turn can advance past it.
            void driveRewind(queued.turnIndex, queued.line, false, true);
          } else if (rehearsal && queued.advance) {
            // An in-role rewind that already reached `repeat` cannot advance —
            // `unpack` and `gift` are out of role. The exchange stays where it
            // is; the conversation resumes.
            rewind.current.step = null;
            setRewindExchange(null);
          } else {
            void driveRewind(queued.turnIndex, queued.line, queued.advance);
          }
        }
      } catch (e: unknown) {
        const { say: said, log } = humanError(e);
        console.warn("[talk] send failed:", log);
        setError(said);
      } finally {
        setStreaming(""); // a half-streamed reply is not a turn — it must not linger
        setBusy(false);
      }
    },
    [busy, scenario, msgs, settings, say, nameSession, pack, driveRewind, clearWait, armWait, armDeadline, resetWaitOnHold],
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
      // `cancel` stops the coach's audio too. Drop whatever was queued behind it:
      // the learner cut the coach off to speak, and the rest of a rewind is not
      // something to play at them afterwards. The clip that was playing settles
      // with the floor it did hold, so that much is still stripped from the
      // latency — only the unplayed remainder goes away.
      speakQueue.current = [];
      return speech.cancel();
    }
    if (micPhase) return; // a clip is already in flight
    const blocked = listenBlocker(settings);
    if (blocked) return setError(blocked);

    setError("");
    setMicPhase("recording");
    setMicLevel(0);
    // The learner is taking the mic — they have not stalled. End the wait and
    // show the suggestions again (PLAN-032).
    clearWait();
    waitState.current = { ...waitState.current, offerCount: 0 };
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
  }, [busy, micPhase, speech, pack, settings, clearWait]);

  /** Close the session: capture vocabulary, summarise, and record the level signals. */
  const end = useCallback(async () => {
    if (!scenario || busy) return;
    // The session is closing — a pending wait must not fire into the reflection
    // (PLAN-032). End it.
    clearWait();
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
      axis: axis.current,
      easeRequested: easeAsked.current,
      // PLAN-034: a rehearsal rides its brief and its debrief on the reflection —
      // the brief so the wrap-up shows what they were preparing for, the debrief
      // so its phrases can be offered to Memory through the existing vocab save
      // path (the learner chooses; nothing is auto-saved).
      rehearsal: rehearsal ? { brief: rehearsal.brief, debrief } : undefined,
    });
    // Calibration (PLAN-031 §5.2): once, at the end of the session, over the
    // verdicts. The rise needs two consecutive zero-breakdown sessions; the drop
    // already happened in-session, so this only ever moves the step up. The
    // stored signals are re-read so the current session, once the reflection
    // writes it, is the newest of the pair.
    // PLAN-034: a rehearsal is never a calibration session — `end()` skips
    // `calibrate` entirely. `recapsFrom`'s marker rule keeps *later* sessions
    // from counting the stored rehearsal signals as an easy one, but this call is
    // skipped outright: a rehearsal in which the learner never struggled must not
    // be the run's first "easy session".
    if (!rehearsal) {
      try {
        const prior = await recentSignals(settings.profile.targetLanguage).catch(() => [] as Awaited<ReturnType<typeof recentSignals>>);
        // A conversation with no learner turn in it is not a session — the same
        // rule `recapsFrom` applies to the stored batches. It is left out rather
        // than counted as an easy one: an empty conversation is the absence of
        // evidence, not evidence that the level is too low.
        const current: SessionRecap[] =
          produced.current.length === 0
            ? []
            : [
                {
                  axis: axis.current,
                  turns: produced.current.length,
                  drowned: drowns({
                    turns: produced.current.length,
                    heavy: produced.current.filter((t) => t.breakdown.length >= 2).length,
                  }),
                  zero: produced.current.every((t) => t.breakdown.length === 0),
                },
              ];
        const nextStep = calibrate(settings.difficultyStep, [...current, ...recapsFrom(prior)]);
        if (nextStep !== settings.difficultyStep) onSettings?.({ difficultyStep: nextStep });
      } catch {
        /* calibration is best-effort — a store miss should not fail the wrap-up */
      }
    }
  }, [scenario, busy, msgs, settings, pack, onSettings, clearWait, rehearsal, debrief]);

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

  /**
   * "Do not push me today" (PLAN-031): the ⌘K path, so the ask works with no mic
   * and no ambiguity. Effect is identical to the in-conversation ask — the axis
   * goes null for the rest of the session and the rewind budget's `off` is set.
   * Nothing about it persists to settings.
   */
  const ease = useCallback(() => {
    if (easeAsked.current) return;
    easeAsked.current = true;
    axis.current = easeEffect(settings.difficultyStep).axis;
    budget.current.off = true;
  }, [settings.difficultyStep]);

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
    /**
     * Whether the coach is waiting for the learner (PLAN-032). While true, Talk
     * renders nothing new — no suggestions, no hint, no dots — the screen is
     * exactly what it was when the coach finished speaking. Suggestions appear
     * when the wait expires, or at once when the learner has already started
     * typing or holding the mic.
     */
    waiting,
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
    /** PLAN-034: the rehearsal entry — build the scenario, start in role. */
    startRehearsal,
    /** PLAN-034: end the role-play; the coach steps out and the debrief arrives. */
    endRole,
    /**
     * Rehearsal mode (PLAN-034): the brief a session is running as, or null for
     * an ordinary conversation. Talk reads it to render the brief, the phase and
     * the "end the role-play" control.
     */
    rehearsal,
    /** True once the learner ended the role-play (PLAN-034). */
    outOfRole,
    /** The debrief, once it landed (PLAN-034) — null while loading or before. */
    debrief,
    resume,
    send,
    mic,
    end,
    /** The learner asked to see the coach's text — recorded, never scored. */
    reveal,
    ask,
    /** "Do not push me today" — the ⌘K path (PLAN-031). */
    ease,
    /** The rewind exchange on screen (PLAN-030), or null when none. */
    rewindExchange,
    /** "No, I understood" — clear the mark, raise the handicap, carry on. */
    denyRewind,
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

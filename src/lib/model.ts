// Domain model for the activity layer (Today, Talk, Read, Listen, Memory,
// Coach): one shared state, read by every surface.
//
// VocabItem deliberately omits srs.strength: it is a derived value recomputed
// on demand via strength(), so storing it would let the displayed bar drift
// from the schedule it must reflect.
//
// LearnerProfile likewise omits levelEstimate: it is derived from the learner's
// session_metrics scores (levelEstimateFrom in lib/metrics), so storing it would
// let the displayed estimate drift from the scores it must reflect.

// --- Scalars ------------------------------------------------------------------

export type LocalDate = string; // "YYYY-MM-DD"
export type Timestamp = number; // epoch ms
export type ActivityId = string;
export type SignalId = string;
export type WeaknessId = string;

// --- Level — single source of truth (#12 single door) --------------------------

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CEFRLevel = (typeof CEFR_LEVELS)[number];

// ponytail: today targetLang carries an English display name ("Spanish") while
// packId carries a code ("es"). Narrow this to a real BCP-47 union in 11b, when
// the two are actually reconciled.
export type LanguageCode = string;

// --- §1.1 LearnerProfile -------------------------------------------------------

/** Coach's estimate of the learner's level — separate from the operative `level`. */
export type LevelEstimate = {
  value: number; // 0-100 continuous scale
  label: CEFRLevel; // derived from value
  confidence: "low" | "medium" | "high";
  sampleSize: number; // how many sessions it is based on
};

export type LearnerGoal = { id: string; text: string };

export type LearnerProfile = {
  targetLanguage: LanguageCode; // language being learned
  nativeLanguage: LanguageCode; // language of explanations
  level: CEFRLevel; // operative level — the one every surface reads
  interests: string[]; // feeds theme production
  goals: LearnerGoal[];
  weaknesses: Weakness[]; // written by Coach, read by Plan
  createdAt: Timestamp;
  streak: number; // consecutive days
  timezone: string;
};

// --- §1.2 DailyPlan ------------------------------------------------------------

export type ActivityKind = "talk" | "read" | "roleplay" | "listen" | "memory" | "wrapup";

export type PlannedActivity = {
  id: ActivityId;
  kind: ActivityKind;
  title: string;
  rationale: string; // WHY this activity today — shown to the learner
  estimatedMinutes: number;
  status: "pending" | "active" | "completed" | "skipped";
  dependsOn?: ActivityId; // e.g. Read uses Talk's output
  // Spec deviation: the shared model has no field for "which scenario a talk/roleplay
  // opens" nor "the raw drill string handed to the model" — both ride here as optional
  // learn-layer extras until they earn a place in the shared shape.
  scenarioId?: string; // talk/roleplay launch this scenario
  goal?: string; // weak-area drill folded into the activity, handed raw to the model
  readonly producedSignalIds: SignalId[]; // filled in on completion
};

export type DailyPlan = {
  date: LocalDate;
  dayIndex: number; // the learner's nth day
  theme: string; // binds every activity of the day
  targetedWeaknesses: WeaknessRef[]; // which weaknesses this plan addresses
  activities: PlannedActivity[];
  readonly estimatedMinutes: number; // sum of activities — never written separately
};

// --- §1.3 Signal ---------------------------------------------------------------

export type SignalKind =
  | "correction" // a corrected production error
  | "unpromptedTurn" // a turn produced without help
  | "suggestionUsed" // a ready-made suggestion was used
  | "lexicalItem" // a word met or saved
  | "comprehension" // result of a comprehension question
  | "pronunciation" // a pronunciation observation
  | "pace"; // reading/speaking speed

export type Signal = {
  id: SignalId;
  activityId: ActivityId;
  kind: SignalKind;
  observedAt: Timestamp;
  payload: unknown;
};

/**
 * A signal on its way to being written. The id and the timestamp are the store's
 * job: an id must not collide, and `observedAt` is a clock — model.ts has none.
 */
export type SignalDraft = Omit<Signal, "id" | "observedAt">;

/**
 * The one place a payload is read structurally (guarded by signals.check.ts).
 *
 * `payload` is `unknown` in the spec and stays that way, but Coach has to be able
 * to name what a signal was about ("ser vs estar") to group evidence into a
 * Weakness. So every writer puts a `{ label: string }` in there and every reader
 * comes through here; anything else counts signals by `kind` alone. Same shape as
 * levelOf and levelGapNote: loose value, single door.
 */
export function signalLabel(s: Signal): string | null {
  const p = s.payload;
  if (p === null || typeof p !== "object") return null;
  const label = (p as { label?: unknown }).label;
  return typeof label === "string" ? label : null;
}

/**
 * The second — and last — structural payload reader: did this observation go badly?
 *
 * A correction is a miss by its nature. Everything else says so in its payload: a
 * comprehension question answered wrong, a card graded "again". A word merely met
 * is not a miss, which is why `lexicalItem` needs the grade before it counts.
 * Kept here beside signalLabel so the two doors stay in one file (signals.check.ts
 * fails the build if a third one opens elsewhere).
 */
export function signalMiss(s: Signal): boolean {
  if (s.kind === "correction") return true;
  const p = s.payload;
  if (p === null || typeof p !== "object") return false;
  const { correct, grade } = p as { correct?: unknown; grade?: unknown };
  return correct === false || grade === 0;
}

/**
 * The measurement a produced turn carries (§2.6). The third and final structural
 * payload reader, and it lives here for the same reason the other two do: a reader
 * somewhere else is a reader nothing can find.
 *
 * `null` when the payload is not a measured turn — an older row written before
 * turns were measured reads as "no measurement", never as a zero-word turn.
 */
export function turnStats(s: Signal): { words: number; sentences: number; chars: number } | null {
  const p = s.payload;
  if (p === null || typeof p !== "object") return null;
  const { words, sentences, chars } = p as { words?: unknown; sentences?: unknown; chars?: unknown };
  if (typeof words !== "number" || typeof sentences !== "number" || typeof chars !== "number") return null;
  if (sentences <= 0) return null;
  return { words, sentences, chars };
}

// --- §1.4 VocabItem ------------------------------------------------------------

export type VocabItem = {
  id: string;
  lemma: string;
  form: string;
  type: "word" | "phrase" | "phrasalVerb" | "idiom" | "collocation" | "pronunciation";
  gloss: string; // short definition in the native language
  example: string; // the real context it was met in
  sourceRef: { surface: string; sessionId: string }; // where it came from
  capturedBy: "learner" | "coach"; // saved by the user or added by the system
  levelBand: CEFRLevel; // estimated level of the item
  srs: {
    interval: number; // days
    ease: number;
    dueAt: Timestamp;
    reps: number;
    lapses: number;
    // no strength: derived, recomputed via strength()
  };
};

export { strength as vocabStrength } from "./srs.ts";

// --- §1.5 Weakness -------------------------------------------------------------

export type Weakness = {
  id: WeaknessId;
  label: string; // e.g. "unstressed schwa /ə/"
  category: "pronunciation" | "grammar" | "lexis" | "fluency" | "pragmatics";
  evidence: SignalId[]; // at least 3 signals — below that, no weakness is declared
  severity: number;
  addressedBy: ActivityId[]; // planned activities targeting this weakness
  trend: "improving" | "flat" | "worsening" | "new";
};

export type WeaknessRef = WeaknessId;

// --- Helpers -------------------------------------------------------------------

// #16 plan minutes rule: plan.estimatedMinutes always equals the sum of its
// activity minutes, computed here and never stored anywhere else.
export function makePlan(input: Omit<DailyPlan, "estimatedMinutes">): DailyPlan {
  return {
    ...input,
    estimatedMinutes: input.activities.reduce((sum, a) => sum + a.estimatedMinutes, 0),
  };
}

// #17 rationale rule: no "why today" answer, no activity. A fresh activity
// starts pending and produces no signals yet.
export function planActivity(
  input: Omit<PlannedActivity, "status" | "producedSignalIds">,
): PlannedActivity {
  if (input.rationale.trim() === "") {
    throw new Error("planActivity: rationale must not be empty (#17)");
  }
  return { ...input, status: "pending", producedSignalIds: [] };
}

// #12 single door: every surface reads the level from the profile, verbatim.
export const levelOf = (p: LearnerProfile): CEFRLevel => p.level;

/** Map a continuous 0-100 value onto the CEFR scale, inclusive at both ends. */
export function levelLabel(value: number): CEFRLevel {
  return CEFR_LEVELS[Math.min(5, Math.floor((value / 100) * 6))];
}

/** Level progress is only suggested once confidence is not low. */
export const progressionSuggested = (e: LevelEstimate): boolean => e.confidence !== "low";

/**
 * The sentence that makes two different level values legal on one screen
 * (invariant 2). `null` when there is nothing to explain: the values agree, or
 * nothing has been measured yet (that case is the "not yet measured" copy, not a gap).
 */
export function levelGapNote(level: CEFRLevel, e: LevelEstimate): string | null {
  if (e.sampleSize === 0) return null;
  if (e.label === level) return null;
  return `You work at ${level}, but your writing measures at ${e.label} right now.`;
}

/** Under this many sessions the estimate is a guess with a number on it. */
export const MIN_ESTIMATE_SESSIONS = 3;
/** At this many it has seen enough of the learner to argue with their self-report. */
export const CONFIDENT_ESTIMATE_SESSIONS = 8;

export const MIN_WEAKNESS_EVIDENCE = 3;

export const isDeclaredWeakness = (w: Weakness): boolean =>
  w.evidence.length >= MIN_WEAKNESS_EVIDENCE;

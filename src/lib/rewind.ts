// The rewind (PLAN-030): the coach stops, owns the pace, and repeats the same
// sentence slower. Four steps in a fixed order — own, repeat, unpack, gift —
// then resume. The order is the design: the same sentence first (so speed alone
// is tested), simplification only after a second miss, and the repair pattern
// handed over by using it, never by teaching it.
//
// Everything here is pure and importable in a check process: no Tauri, no db,
// no model. The model-facing prompts live in prompts.ts; the strings that must
// never blame the learner live here, beside the scan that guards them.

import type { RepairCategory, RepairObservation } from "./repair.ts";

/** The rate the repeat step speaks at — a step the ear reads as care, not a fault. */
export const SLOW_RATE = 0.75;

/** The four steps, in order, plus `resume`. The order is the design (§4). */
export type RewindStep = "own" | "repeat" | "unpack" | "gift" | "resume";

/** The fixed order the steps run in. `resume` is the end, not a step to advance from. */
export const REWIND_ORDER: readonly RewindStep[] = ["own", "repeat", "unpack", "gift", "resume"];

/**
 * The next step after `step`, given whether the learner missed again.
 * `unpack` is unreachable without a second miss; `gift` without a third.
 */
export function nextStep(step: RewindStep, missedAgain: boolean): RewindStep {
  switch (step) {
    case "own":
      return "repeat";
    case "repeat":
      return missedAgain ? "unpack" : "resume";
    case "unpack":
      return missedAgain ? "gift" : "resume";
    case "gift":
    case "resume":
      return "resume";
  }
}

// --- the banned shapes ---------------------------------------------------------

/**
 * Substrings that blame the learner, in every locale the repo ships. The scan
 * below is case-insensitive; a produced line or a prompt containing any of these
 * is turned away. The list grows as packs land — a new language adds its own
 * second-person + comprehension-verb shapes here.
 */
export const BANNED_SHAPES: readonly string[] = [
  // English
  "you did not understand",
  "you didn't understand",
  "you missed",
  "you didn't catch",
  "you failed to understand",
  "you got it wrong",
  "you misunderstood",
  // Spanish
  "no entendiste",
  "no has entendido",
  "no entendió",
  "te perdiste",
  "se te escapó",
  "no lo captaste",
  // French
  "tu n'as pas compris",
  "vous n'avez pas compris",
  "tu as manqué",
  "vous avez manqué",
  "tu n'as pas saisi",
  // German
  "du hast nicht verstanden",
  "sie haben nicht verstanden",
  "du hast verpasst",
  "du hast es nicht kapiert",
  // Italian
  "non hai capito",
  "non ha capito",
  "hai perso",
  "ti sei perso",
  // Portuguese
  "você não entendeu",
  "você perdeu",
  "não percebeste",
  "não entendeste",
  // Japanese
  "わかりませんでした",
  "聞き逃した",
  "聞き取れなかった",
  "理解できなかった",
  // Turkish
  "anlamadın",
  "anlamadınız",
  "kaçırdın",
  "kaçırdınız",
  "anlayamadın",
  // Indonesian
  "tidak mengerti",
  "kamu tidak paham",
  "anda tidak mengerti",
  "kamu melewatkan",
];

/**
 * True when `text` contains a banned shape — a phrase that blames the learner
 * for not understanding. Case-insensitive. The gate the "own" line passes
 * through before it is shown: a produced line that matches is replaced by the
 * pack's fixed fallback rather than shown.
 */
export function bannedShape(text: string): boolean {
  const t = text.toLowerCase();
  return BANNED_SHAPES.some((s) => t.includes(s.toLowerCase()));
}

// --- the fixed lines -----------------------------------------------------------

/**
 * The fixed fallback for the "own" step, per pack id. Shown when the model's
 * produced line matches a banned shape — the coach still owns the pace, but in
 * words we wrote, not words we had to vet. Each line takes the blame for pace
 * and never points at the learner.
 */
export const OWN_FALLBACK: Record<string, string> = {
  en: "Let me say that again, more slowly.",
  es: "Déjame decirlo otra vez, más despacio.",
  fr: "Laisse-moi le redire, plus lentement.",
  de: "Lass mich das noch einmal langsamer sagen.",
  it: "Lascia che lo ripeta, più lentamente.",
  pt: "Deixa-me dizer isso de novo, mais devagar.",
  ja: "もう一度、ゆっくり言いますね。",
  tr: "Bir daha, daha yavaş söyleyeyim.",
  id: "Biar saya ulangi, lebih pelan.",
};

/**
 * The gift line, per pack id — the coach modelling the repair pattern in its own
 * voice. Never imperative, never a list: it is the coach using the phrase, so
 * the learner can copy it. The example the spec gives is the REPEAT pattern.
 */
export const GIFT_LINE: Record<string, string> = {
  en: 'By the way, you can always tell me — "could you say that again?"',
  es: 'Por cierto, siempre puedes decirme — "¿puedes repetirlo?"',
  fr: 'Au fait, tu peux toujours me dire — "tu peux répéter ?"',
  de: 'Übrigens, du kannst mir immer sagen — "kannst du das wiederholen?"',
  it: 'A proposito, puoi sempre dirmi — "puoi ripeterlo?"',
  pt: 'A propósito, podes sempre dizer-me — "podes repetir?"',
  ja: "ちなみに、いつでも言ってくださいね —「もう一度言ってもらえますか？」",
  tr: 'Bu arada, bana her zaman söyleyebilirsin — "tekrar söyler misin?"',
  id: 'Ngomong-ngomong, kamu selalu bisa bilang — "bisa ulangi?"',
};

// --- the gift cap --------------------------------------------------------------

/**
 * The per-session rewind state (§4.2): the current step of an in-progress
 * rewind, and the gift cap (at most two gifts for the same category, at most
 * one category per session). Held in `useTalk` for the life of a session and
 * rebuilt when a new one starts.
 */
export interface RewindState {
  /** The current step of an in-progress rewind, or null when none. */
  step: RewindStep | null;
  /** The category the gift has been given for this session, or null. */
  giftedCategory: RepairCategory | null;
  /** How many gifts have been given for that category. */
  giftCount: number;
}

export function freshRewind(): RewindState {
  return { step: null, giftedCategory: null, giftCount: 0 };
}

/** At most two gifts for the same category per session. */
export const GIFT_CAP = 2;

/** True when a gift for `category` is still allowed this session. */
export function giftAllowed(state: RewindState, category: RepairCategory): boolean {
  if (state.giftedCategory === null) return true;
  return state.giftedCategory === category && state.giftCount < GIFT_CAP;
}

/** Record a gift for `category`. Call only when `giftAllowed` is true. */
export function recordGift(state: RewindState, category: RepairCategory): void {
  if (state.giftedCategory === null) {
    state.giftedCategory = category;
    state.giftCount = 1;
  } else if (state.giftedCategory === category) {
    state.giftCount += 1;
  }
}

/**
 * The gift step, or `resume` when the cap is hit. A third attempt at the same
 * category — or a second category — skips straight to `resume` and writes no
 * signal. Returns the observation to write when the gift happens.
 */
export function giftStep(
  state: RewindState,
  category: RepairCategory,
): { step: "gift" | "resume"; observation: RepairObservation | null } {
  if (!giftAllowed(state, category)) return { step: "resume", observation: null };
  recordGift(state, category);
  return { step: "gift", observation: giftObservation(category) };
}

/**
 * The coach's gift observation — a `repairMove` with `by: "coach"`, the only
 * thing that ever moves a category to `recognises`. Carries no learner words.
 */
export function giftObservation(category: RepairCategory): RepairObservation {
  return { category, by: "coach", variant: "" };
}

/**
 * The repeat step's text: the coach's previous line, byte for byte. This step
 * calls no model — a regenerated sentence is not the same sentence, and the
 * step's entire purpose is that it is.
 */
export function repeatText(line: string): string {
  return line;
}

// --- obeying the learner (§12, ninth claim) ------------------------------------

/** The handicap a denied rewind raises the session to (§3.3). */
export const DENIED_HANDICAP = 1;

/** What a learner-initiated SLOW/REPEAT asks the coach to do next. */
export type ObeyResult =
  | { kind: "none" }
  | { kind: "slow" } // speak the next reply at SLOW_RATE
  | { kind: "repeat"; line: string }; // re-speak `line` at SLOW_RATE, then reply normally

/**
 * A learner `SLOW` or `REPEAT` is obeyed, not thanked (§12's ninth claim). The
 * reward for asking is that asking worked. `SLOW` slows the next reply; `REPEAT`
 * re-speaks the previous line byte for byte, exactly as step `repeat` does.
 */
export function obeyRepair(repair: RepairObservation | null, prevLine: string): ObeyResult {
  if (!repair || repair.by !== "learner") return { kind: "none" };
  if (repair.category === "SLOW") return { kind: "slow" };
  if (repair.category === "REPEAT") return { kind: "repeat", line: prevLine };
  return { kind: "none" };
}

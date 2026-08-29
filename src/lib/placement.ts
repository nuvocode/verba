import { CEFR_LEVELS, extractJson, type Cefr } from "./level.ts";
import type { Settings } from "./settings.ts";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";

// Reached lazily so this module's pure half stays loadable by plain node
// (placement.check.ts). A static import of the providers would stop the file
// from opening at all.
const provider = async () => (await import("./providers/index.ts")).getProvider;

// The fixed placement stage of onboarding: a short written test the model writes,
// the app grades locally. The learner can always overrule the result — it is a
// starting point for Day 1, not a certificate.

export interface PlacementQ {
  level: Cefr;
  prompt: string; // the question, in the target language
  options: string[]; // exactly 3
  answer: number; // index into options
}

/** One question per level, plus a second at A1/B1 — short enough that people finish it. */
export const PLACEMENT_LADDER: Cefr[] = ["A1", "A1", "A2", "B1", "B1", "B2", "C1", "C2"];

export function placementPrompt(s: Settings, pack?: LanguagePack): string {
  return [
    `Write a ${PLACEMENT_LADDER.length}-question multiple-choice placement test in ${s.profile.targetLanguage}.`,
    // Without the pack the model picks its own script and register — a Japanese
    // A1 question came back in unspaced kanji, which is not an A1 question.
    packGuidance(pack),
    `The questions must follow this CEFR ladder, in order: ${PLACEMENT_LADDER.join(", ")}.`,
    `Each question tests grammar, vocabulary or idiom at exactly its level, has exactly 3 options, and exactly one correct option.`,
    `Write the questions and options in ${s.profile.targetLanguage}; any instruction word goes in ${s.profile.nativeLanguage}.`,
    `Vary which option is correct — do not always use the first.`,
    `Answer with ONLY a JSON object: { "questions": [ { "level": "A1", "prompt": "…", "options": ["…","…","…"], "answer": 0 } ] }`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parsePlacement(raw: string): PlacementQ[] | null {
  const o = extractJson(raw);
  const list = Array.isArray(o) ? o : o?.questions;
  if (!Array.isArray(list)) return null;
  const qs: PlacementQ[] = [];
  for (const q of list) {
    const level = String(q?.level ?? "").toUpperCase();
    const options = Array.isArray(q?.options) ? q.options.map(String) : [];
    const answer = Number(q?.answer);
    if (!CEFR_LEVELS.includes(level as Cefr)) continue;
    if (options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    if (!q?.prompt) continue;
    qs.push({ level: level as Cefr, prompt: String(q.prompt), options, answer });
  }
  return qs.length >= 5 ? qs : null; // fewer than 5 and it isn't a placement, it's a guess
}

/**
 * Ceiling placement: climb the CEFR ladder while each level is at least half right,
 * stop at the first that isn't. Unanswered counts as wrong.
 * ponytail: no item-response theory here — 8 questions can't support it. Upgrade to a
 * weighted model only if placements land visibly wrong.
 */
export function scorePlacement(qs: PlacementQ[], answers: number[]): Cefr {
  let placed: Cefr = "A1";
  for (const lvl of CEFR_LEVELS) {
    const at = qs.map((q, i) => ({ q, i })).filter(({ q }) => q.level === lvl);
    if (!at.length) continue;
    const right = at.filter(({ q, i }) => answers[i] === q.answer).length;
    if (right * 2 < at.length) break;
    placed = lvl;
  }
  return placed;
}

// ---- the test is written in the background, before the learner asks for it ----

let pending: Promise<PlacementQ[] | null> | null = null;

/** Start writing the placement test in the background. Called the moment the model
 *  answers on screen 3 (§5, screen 3): by the time the learner asks for the test on
 *  screen 4 it is already written, and asking twice costs nothing. */
export function primePlacement(s: Settings, pack?: LanguagePack): void {
  if (pending) return;
  pending = (async () => {
    try {
      const raw = await (await provider())(s).chat(
        [{ role: "user", content: placementPrompt(s, pack) }],
        { json: true },
      );
      return parsePlacement(raw);
    } catch {
      // A primed test that throws must never surface as an unhandled rejection
      // while the learner is on another screen — null is the safe answer.
      return null;
    }
  })();
}

/** The test being written, or null when nothing was ever started. */
export function placementPending(): Promise<PlacementQ[] | null> | null {
  return pending;
}

/** Throw the pending test away — the model or the language changed under it. */
export function clearPlacement(): void {
  pending = null;
}

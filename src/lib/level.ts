import type { Settings } from "./settings";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";

// Level estimation v1 — self-reported CEFR (Settings) plus a soft AI signal
// read off the learner's actual messages after a session. Deliberately framed
// as a hint, never an assessment.

import { CEFR_LEVELS, levelOf, type CEFRLevel as Cefr } from "./model.ts";
export { CEFR_LEVELS, type Cefr };

export interface LevelSignal {
  estimate: Cefr;
  confidence: "low" | "medium" | "high";
  rationale: string; // one short sentence in the native language
}

/** Ask the model to estimate the learner's level from the conversation so far. */
export function levelPrompt(s: Settings, pack?: LanguagePack): string {
  return [
    `Estimate the learner's ${s.profile.targetLanguage} level from their own messages in this conversation (ignore your own).`,
    packGuidance(pack),
    // ponytail: the old flat level could be "" (onboarding skipped) — that state is
    // gone, the migration maps "" → "A2", so `levelOf(s.profile)` is always set and the
    // "never reported a level" branch is unreachable until 11b-3 restores the real
    // "not yet measured" condition (levelEstimate.sampleSize).
    levelOf(s.profile)
      ? `Use the CEFR scale: ${CEFR_LEVELS.join(", ")}. Their self-reported level is ${levelOf(s.profile)} — adjust only if the evidence is clear.`
      : `Use the CEFR scale: ${CEFR_LEVELS.join(", ")}. They never reported a level — place them purely on what they wrote.`,
    `Answer with ONLY a JSON object: { "estimate": "one of ${CEFR_LEVELS.join("/")}", "confidence": "low|medium|high", "rationale": "one short sentence in ${s.profile.nativeLanguage}" }.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseLevel(raw: string): LevelSignal | null {
  const o = extractJson(raw);
  if (!o) return null;
  const estimate = String(o.estimate ?? "").toUpperCase();
  if (!CEFR_LEVELS.includes(estimate as Cefr)) return null;
  const confidence = ["low", "medium", "high"].includes(o.confidence) ? o.confidence : "low";
  return { estimate: estimate as Cefr, confidence, rationale: String(o.rationale ?? "") };
}

export function extractJson(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

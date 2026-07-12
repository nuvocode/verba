import type { Settings } from "./settings";

// Level estimation v1 — self-reported CEFR (Settings) plus a soft AI signal
// read off the learner's actual messages after a session. Deliberately framed
// as a hint, never an assessment.

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];

export interface LevelSignal {
  estimate: Cefr;
  confidence: "low" | "medium" | "high";
  rationale: string; // one short sentence in the native language
}

/** Ask the model to estimate the learner's level from the conversation so far. */
export function levelPrompt(s: Settings): string {
  return [
    `Estimate the learner's ${s.targetLang} level from their own messages in this conversation (ignore your own).`,
    `Use the CEFR scale: ${CEFR_LEVELS.join(", ")}. Their self-reported level is ${s.cefr} — adjust only if the evidence is clear.`,
    `Answer with ONLY a JSON object: { "estimate": "one of ${CEFR_LEVELS.join("/")}", "confidence": "low|medium|high", "rationale": "one short sentence in ${s.nativeLang}" }.`,
  ].join("\n");
}

export function parseLevel(raw: string): LevelSignal | null {
  const o = extractJson(raw);
  if (!o) return null;
  const estimate = String(o.estimate ?? "").toUpperCase();
  if (!CEFR_LEVELS.includes(estimate as Cefr)) return null;
  const confidence = ["low", "medium", "high"].includes(o.confidence) ? o.confidence : "low";
  return { estimate: estimate as Cefr, confidence, rationale: String(o.rationale ?? "") };
}

function extractJson(raw: string): any {
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

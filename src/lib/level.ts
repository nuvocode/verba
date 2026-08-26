// The CEFR scale's door for callers that predate lib/model, plus extractJson —
// the scraper every prompt parser uses to get JSON out of a chatty model.
//
// Level estimation v1 (a paid per-session round-trip asking the model to guess a
// band) lived here and is gone: lib/metrics levelEstimateFrom measures the same
// thing from session_metrics for free. The level_signals table keeps its old rows.
import { CEFR_LEVELS, type CEFRLevel as Cefr } from "./model.ts";
export { CEFR_LEVELS, type Cefr };

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

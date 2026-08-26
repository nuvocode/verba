// What each surface observed, as signals (§1.3). One function per surface, all
// pure: they take what the surface already has and return drafts. The ids and the
// clock are stamped later, at the single door (useDay.complete).
//
// `label` is the field Coach groups evidence on, so it carries the thing a
// weakness would end up being named after. Everything else in a payload rides
// along unread — signalLabel (lib/model) is the only structural reader there is.
import type { SignalDraft, ActivityId } from "./model.ts";
import type { Reflection } from "./useTalk.ts";

/**
 * A finished conversation. A correction with no note names nothing, so it is not
 * evidence of anything; the turn count is one signal about the session as a whole.
 */
export function talkSignals(activityId: ActivityId, r: Reflection): SignalDraft[] {
  return [
    ...r.corrections
      .filter((c) => c.note.trim() !== "")
      .map((c) => ({
        activityId,
        kind: "correction" as const,
        payload: { label: c.note, original: c.original, fixed: c.fixed, severity: c.severity },
      })),
    ...r.words.map((w) => ({
      activityId,
      kind: "lexicalItem" as const,
      payload: { label: w.term, translation: w.translation },
    })),
    { activityId, kind: "unpromptedTurn" as const, payload: { label: "turns", count: r.turns } },
  ];
}

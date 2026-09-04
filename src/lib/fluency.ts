// The context every M7 measurement rides with, and the closed set of monitor
// kinds the kill switch can delete. Pure by the same contract difficulty.ts and
// patience.ts hold: no provider, no ./db.ts, no React, no clock — it takes
// values and returns values, so fluency.check.ts can drive it in a bare Node
// process.
//
// Spec: docs/plans/5-verba-akicilik-ve-monitor-katmani-spec.md §2.4, §7.4, §9.
import type { ActivityId, SignalDraft, SignalKind } from "./model.ts";

/**
 * The conditions one session ran under (§2.4). Written once per session, not
 * copied onto every turn: every field here is a property of the session, and a
 * per-turn copy is six fields that can disagree with each other.
 *
 * `modality` is deliberately absent — it is the one condition that varies inside
 * a session, so it rides the turn (`ProducedTurn.spoken`) instead.
 */
export interface MonitorContext {
  mode: "fluency" | "accuracy" | "free";
  planningTimeSec: number; // 0 = no planning
  taskRepetition: 1 | 2 | 3; // which pass over the same content
  interlocutorPressure: "none" | "paced" | "interrupting";
  topicFamiliarity: "prepared" | "novel";
}

/** What an ordinary conversation is: no mode, no planning, first pass, no pressure. */
export const FREE_CONTEXT: MonitorContext = {
  mode: "free",
  planningTimeSec: 0,
  taskRepetition: 1,
  interlocutorPressure: "none",
  topicFamiliarity: "novel",
};

/**
 * The six signal kinds this milestone writes. The kill switch deletes exactly
 * these.
 *
 * Declared here in full even though five of the six kinds have no writer until
 * PLAN-040–042. That is the point: the kill switch has to be able to delete a
 * kind the moment the kind exists, and a list that grows plan by plan is a list
 * that is one plan behind at every moment. `fluency.check.ts` pins it closed.
 */
export const MONITOR_KINDS: readonly SignalKind[] = [
  "sessionContext",
  "timing",
  "selfRepair",
  "abandonedUtterance",
  "l1Fallback",
  "avoidance",
];

/**
 * The session-context signal, the single builder. Written once per session,
 * beside the turn signals at the same stamp so `recapsFrom` groups it into the
 * session it describes.
 */
export function sessionContextSignal(activityId: ActivityId, ctx: MonitorContext): SignalDraft {
  return {
    activityId,
    kind: "sessionContext",
    payload: { ...ctx },
  };
}

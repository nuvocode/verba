import { useCallback, useEffect, useState } from "react";
import type { Settings } from "./settings";
import { getProvider } from "./providers";
import {
  anotherTheme,
  buildDailyPlan,
  nextActivity,
  recapPrompt,
  parseRecap,
  isLegacyPlanShape,
  type DayRecap,
  type Trace,
} from "./learn";
import type { ActivityKind, DailyPlan, LevelEstimate, SignalDraft, Weakness } from "./model";
import { levelEstimateFrom } from "./metrics";
import { weaknessesFrom } from "./weakness";
import { getPack } from "./packs";
import {
  getDailySession,
  saveDailySession,
  saveSignals,
  recentSignals,
  latestRecap,
  previousDay,
  vocabCounts,
  dayNumber,
  recentMetricScores,
} from "./db";

/**
 * 128 random bits, hex. Not a v4 UUID: `crypto.randomUUID` is gated on a secure
 * context, and the packaged app is served over a custom scheme that may not count
 * as one — a signal id is not worth a feature that silently writes nothing there.
 * `getRandomValues` has no such gate.
 */
const signalId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Local YYYY-MM-DD — the day key the plan is stored under. */
export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Day {
  date: string;
  plan: DailyPlan | null;
  /** The learner's measured level (invariant 2 pairs this with settings.profile.level). */
  levelEstimate: LevelEstimate;
  /** The day's weak areas — held here, not on the plan (see K2). */
  focus: string[];
  /**
   * What the signals say the learner is weakest at, strongest first. Derived on every
   * load, never stored — the evidence is the signals table (see lib/weakness).
   */
  weaknesses: Weakness[];
  done: ActivityKind[];
  recap: DayRecap | null;
  /** The session before this one, for Today's closing line. null on day one. */
  trace: Trace | null;
  /** The capped ask — the cards the learner is asked for today. Memory's counter badge reads it. */
  due: number;
  /** The whole backlog behind today's ask — stated separately, never on a button (§2.5). */
  backlog: number;
  loading: boolean;
  isDone(kind: ActivityKind): boolean;
  /** The first activity not yet finished — what ↵ on Today starts. */
  next: ActivityKind | null;
  /**
   * Mark an activity done and answer with what the plan has next — `next` is state, so it is
   * still the activity you just finished for anyone reading it at the same tick. Await this
   * instead. `null` means the day is done and there is nowhere further to send them.
   *
   * This is also the one door signals go through (§1.3): a surface hands over what it
   * observed, the ids and the clock are stamped here, and the plan records which
   * activity produced them.
   */
  complete(kind: ActivityKind, signals?: SignalDraft[]): Promise<ActivityKind | null>;
  /** Ask the coach to close out the day. Marks the wrap-up activity done. */
  wrapUp(): Promise<void>;
  /**
   * Build today again on the next theme in the rotation (§4.2's "başka bir konu").
   *
   * Finished activities stay finished: the learner already spent that time, and
   * erasing a conversation they actually had would be a worse trade than a day
   * whose first half was about something else. A day that is *entirely* finished
   * starts clean instead — carrying every activity over would hand back a plan
   * with nothing left to do in it, which is the dead end §7 exists to prevent.
   */
  changeTopic(): Promise<void>;
}

/**
 * The day's session: one plan per date, persisted so closing the app mid-session
 * resumes exactly where the learner left off. The plan itself is deterministic
 * (lib/learn) — the only AI here is the end-of-day recap.
 */
export function useDay(settings: Settings): Day {
  const date = todayKey();
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [levelEstimate, setLevelEstimate] = useState<LevelEstimate>(() => levelEstimateFrom([]));
  const [done, setDone] = useState<ActivityKind[]>([]);
  const [recap, setRecap] = useState<DayRecap | null>(null);
  const [loading, setLoading] = useState(true);
  // The day's weak areas. Not written to the plan (they stay in PlanContext), so on
  // resume they are re-derived from the latest recap and held here for wrapUp.
  const [focus, setFocus] = useState<string[]>([]);
  const [weaknesses, setWeaknesses] = useState<Weakness[]>([]);
  const [trace, setTrace] = useState<Trace | null>(null);
  // The cards due when the day was built. Held so a regenerated plan is the same
  // day on a different topic, rather than one that quietly forgot the review.
  const [due, setDue] = useState(0);
  // The whole backlog behind today's ask — the plan is built on the capped number,
  // and the backlog is stated separately so the learner is never asked for it all.
  const [backlog, setBacklog] = useState(0);

  // ponytail: the measured estimate only refreshes when this effect re-runs — on
  // date, target-language, or level change. A Talk session writes new session_metrics
  // without touching any of those, so the band here lags until the next reload. A live
  // refresh would need a session counter in the effect key; that is out of scope.
  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const row = await getDailySession(date);
        const prev = await latestRecap(settings.profile.targetLanguage, date);
        const nextFocus = prev?.nextFocus ?? [];
        // The plan's drills and Coach's "what I'll do about it" have to agree, so both
        // read the same derivation. A store with no signals in it yet yields none.
        const declared = weaknessesFrom(await recentSignals(settings.profile.targetLanguage).catch(() => []));
        if (row && row.lang === settings.profile.targetLanguage) {
          const stored = JSON.parse(row.plan);
          // A row saved before the shared model ({blocks:[...]}) is treated as absent:
          // the plan is rebuilt, and the stale row stays on disk until it is overwritten.
          if (!isLegacyPlanShape(stored)) {
            const scores = await recentMetricScores(settings.profile.targetLanguage, 12);
            if (!live) return;
            setLevelEstimate(levelEstimateFrom(scores));
            setPlan(stored);
            setDone(JSON.parse(row.done));
            setRecap(row.recap ? JSON.parse(row.recap) : null);
            setFocus(nextFocus);
            setWeaknesses(declared);
            setTrace(await previousDay(settings.profile.targetLanguage, date));
            const { today, due: backlog } = await vocabCounts(settings.profile.targetLanguage);
            setDue(today);
            setBacklog(backlog);
            return;
          }
        }
        // No plan for today (or the learner switched language, or the row is stale) — build fresh.
        const [{ today, due: backlog }, dayIndex, scores, before] = await Promise.all([
          vocabCounts(settings.profile.targetLanguage),
          dayNumber(settings.profile.targetLanguage),
          recentMetricScores(settings.profile.targetLanguage, 12),
          previousDay(settings.profile.targetLanguage, date),
        ]);
        const levelEstimate = levelEstimateFrom(scores);
        const fresh = buildDailyPlan(settings, { date, dayIndex, dueVocab: today, focus: nextFocus, weaknesses: declared });
        if (!live) return;
        setLevelEstimate(levelEstimate);
        setPlan(fresh);
        setDone([]);
        setRecap(null);
        setFocus(nextFocus);
        setWeaknesses(declared);
        setTrace(before);
        setDue(today);
        setBacklog(backlog);
        await saveDailySession(date, settings.profile.targetLanguage, fresh, [], null);
      } catch {
        // No DB (browser dev, first run) — still give the learner a plan to work from.
        if (live) {
          setLevelEstimate(levelEstimateFrom([]));
          setPlan(buildDailyPlan(settings, { date, dayIndex: 1, dueVocab: 0 }));
          setWeaknesses([]);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [date, settings.profile.targetLanguage, settings.profile.level]);

  /**
   * Stamp the drafts, write them, and hand back the plan that knows about them.
   *
   * Signals are best-effort — a day must not stall because the store is missing
   * (browser dev, first run). But `producedSignalIds` is only filled in once the
   * write succeeded: an id on the plan that has no row behind it would leave Coach
   * chasing evidence that was never written.
   */
  const recordSignals = useCallback(
    async (current: DailyPlan, drafts: SignalDraft[]): Promise<DailyPlan> => {
      const written = drafts.map((d) => ({ ...d, id: signalId(), observedAt: Date.now() }));
      try {
        await saveSignals(settings.profile.targetLanguage, written);
      } catch {
        return current;
      }
      return {
        ...current,
        // producedSignalIds is readonly, so the activity is replaced rather than pushed into.
        activities: current.activities.map((a) => {
          const ids = written.filter((w) => w.activityId === a.id).map((w) => w.id);
          return ids.length ? { ...a, producedSignalIds: [...a.producedSignalIds, ...ids] } : a;
        }),
      };
    },
    [settings.profile.targetLanguage],
  );

  const persist = useCallback(
    async (nextDone: ActivityKind[], nextRecap: DayRecap | null, nextPlan: DailyPlan | null = plan) => {
      if (!nextPlan) return;
      try {
        await saveDailySession(date, settings.profile.targetLanguage, nextPlan, nextDone, nextRecap);
      } catch {
        /* progress is still held in memory if the DB is unavailable */
      }
    },
    [plan, date, settings.profile.targetLanguage],
  );

  const complete = useCallback(
    async (kind: ActivityKind, signals: SignalDraft[] = []) => {
      const nextDone = done.includes(kind) ? done : [...done, kind];
      setDone(nextDone);
      const nextPlan = plan && signals.length ? await recordSignals(plan, signals) : plan;
      if (nextPlan !== plan) setPlan(nextPlan);
      await persist(nextDone, recap, nextPlan);
      // Read off the list we just wrote, not the one on screen: the caller is standing at
      // the end of this activity asking where to go, and `done` won't have re-rendered yet.
      return nextActivity(nextPlan, nextDone);
    },
    [done, plan, persist, recap, recordSignals],
  );

  // wrapup writes no signals on purpose (#15): it observes nothing about the
  // learner, it summarises the day. The recap's nextFocus is the coach's own
  // opinion, and feeding that back as evidence would let a weakness cite itself.
  const wrapUp = useCallback(async () => {
    if (!plan) return;
    let result: DayRecap = {
      recap: `You worked through ${done.length} of ${plan.activities.length} activities on "${plan.theme}".`,
      nextFocus: focus,
    };
    try {
      const raw = await getProvider(settings).chat(
        [{ role: "user", content: recapPrompt(settings, plan, focus, done, getPack(settings.packId)) }],
        { json: true },
      );
      result = parseRecap(raw);
    } catch {
      // Offline or provider down — keep the deterministic fallback recap.
    }
    setRecap(result);
    setDone((d) => {
      const next = d.includes("wrapup") ? d : [...d, "wrapup" as ActivityKind];
      void persist(next, result);
      return next;
    });
  }, [plan, done, focus, settings, persist]);

  const changeTopic = useCallback(async () => {
    if (!plan) return;
    const finished = plan.activities.every((a) => done.includes(a.kind));
    const keep = finished ? [] : done;
    const fresh = buildDailyPlan(settings, {
      date,
      dayIndex: plan.dayIndex,
      dueVocab: due,
      focus,
      weaknesses,
      theme: anotherTheme(plan.theme, settings.profile.interests),
    });
    setPlan(fresh);
    setDone(keep);
    setRecap(null);
    await persist(keep, null, fresh);
  }, [plan, done, due, focus, weaknesses, settings, date, persist]);

  return {
    date,
    plan,
    levelEstimate,
    focus,
    weaknesses,
    done,
    recap,
    trace,
    due,
    backlog,
    loading,
    isDone: (k) => done.includes(k),
    next: nextActivity(plan, done),
    complete,
    wrapUp,
    changeTopic,
  };
}

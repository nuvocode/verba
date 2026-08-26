import { useCallback, useEffect, useState } from "react";
import type { Settings } from "./settings";
import { getProvider } from "./providers";
import {
  buildDailyPlan,
  nextActivity,
  recapPrompt,
  parseRecap,
  isLegacyPlanShape,
  type DayRecap,
} from "./learn";
import type { ActivityKind, DailyPlan } from "./model";
import { getPack } from "./packs";
import { getDailySession, saveDailySession, latestRecap, vocabCounts, dayNumber } from "./db";

/** Local YYYY-MM-DD — the day key the plan is stored under. */
export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Day {
  date: string;
  plan: DailyPlan | null;
  /** The day's weak areas — held here, not on the plan (see K2). */
  focus: string[];
  done: ActivityKind[];
  recap: DayRecap | null;
  loading: boolean;
  isDone(kind: ActivityKind): boolean;
  /** The first activity not yet finished — what ↵ on Today starts. */
  next: ActivityKind | null;
  /**
   * Mark an activity done and answer with what the plan has next — `next` is state, so it is
   * still the activity you just finished for anyone reading it at the same tick. Await this
   * instead. `null` means the day is done and there is nowhere further to send them.
   */
  complete(kind: ActivityKind): Promise<ActivityKind | null>;
  /** Ask the coach to close out the day. Marks the wrap-up activity done. */
  wrapUp(): Promise<void>;
}

/**
 * The day's session: one plan per date, persisted so closing the app mid-session
 * resumes exactly where the learner left off. The plan itself is deterministic
 * (lib/learn) — the only AI here is the end-of-day recap.
 */
export function useDay(settings: Settings): Day {
  const date = todayKey();
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [done, setDone] = useState<ActivityKind[]>([]);
  const [recap, setRecap] = useState<DayRecap | null>(null);
  const [loading, setLoading] = useState(true);
  // The day's weak areas. Not written to the plan (they stay in PlanContext), so on
  // resume they are re-derived from the latest recap and held here for wrapUp.
  const [focus, setFocus] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const row = await getDailySession(date);
        const prev = await latestRecap(settings.profile.targetLanguage, date);
        const nextFocus = prev?.nextFocus ?? [];
        if (row && row.lang === settings.profile.targetLanguage) {
          const stored = JSON.parse(row.plan);
          // A row saved before the shared model ({blocks:[...]}) is treated as absent:
          // the plan is rebuilt, and the stale row stays on disk until it is overwritten.
          if (!isLegacyPlanShape(stored)) {
            if (!live) return;
            setPlan(stored);
            setDone(JSON.parse(row.done));
            setRecap(row.recap ? JSON.parse(row.recap) : null);
            setFocus(nextFocus);
            return;
          }
        }
        // No plan for today (or the learner switched language, or the row is stale) — build fresh.
        const [{ due }, dayIndex] = await Promise.all([
          vocabCounts(settings.profile.targetLanguage),
          dayNumber(),
        ]);
        const fresh = buildDailyPlan(settings, { date, dayIndex, dueVocab: due, focus: nextFocus });
        if (!live) return;
        setPlan(fresh);
        setDone([]);
        setRecap(null);
        setFocus(nextFocus);
        await saveDailySession(date, settings.profile.targetLanguage, fresh, [], null);
      } catch {
        // No DB (browser dev, first run) — still give the learner a plan to work from.
        if (live) setPlan(buildDailyPlan(settings, { date, dayIndex: 1, dueVocab: 0 }));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [date, settings.profile.targetLanguage, settings.profile.level]);

  const persist = useCallback(
    async (nextDone: ActivityKind[], nextRecap: DayRecap | null) => {
      if (!plan) return;
      try {
        await saveDailySession(date, settings.profile.targetLanguage, plan, nextDone, nextRecap);
      } catch {
        /* progress is still held in memory if the DB is unavailable */
      }
    },
    [plan, date, settings.profile.targetLanguage],
  );

  const complete = useCallback(
    async (kind: ActivityKind) => {
      const nextDone = done.includes(kind) ? done : [...done, kind];
      setDone(nextDone);
      await persist(nextDone, recap);
      // Read off the list we just wrote, not the one on screen: the caller is standing at
      // the end of this activity asking where to go, and `done` won't have re-rendered yet.
      return nextActivity(plan, nextDone);
    },
    [done, plan, persist, recap],
  );

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

  return {
    date,
    plan,
    focus,
    done,
    recap,
    loading,
    isDone: (k) => done.includes(k),
    next: nextActivity(plan, done),
    complete,
    wrapUp,
  };
}

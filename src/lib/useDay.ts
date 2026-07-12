import { useCallback, useEffect, useState } from "react";
import type { Settings } from "./settings";
import { getProvider } from "./providers";
import { buildDailyPlan, recapPrompt, parseRecap, type BlockKind, type DailyPlan, type DayRecap } from "./learn";
import { getDailySession, saveDailySession, latestRecap, vocabCounts } from "./db";

/** Local YYYY-MM-DD — the day key the plan is stored under. */
export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Day {
  date: string;
  plan: DailyPlan | null;
  done: BlockKind[];
  recap: DayRecap | null;
  loading: boolean;
  isDone(kind: BlockKind): boolean;
  /** The first block not yet finished — what ↵ on Today starts. */
  next: BlockKind | null;
  complete(kind: BlockKind): Promise<void>;
  /** Ask the coach to close out the day. Marks the summary block done. */
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
  const [done, setDone] = useState<BlockKind[]>([]);
  const [recap, setRecap] = useState<DayRecap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const row = await getDailySession(date);
        if (row && row.lang === settings.targetLang) {
          if (!live) return;
          setPlan(JSON.parse(row.plan));
          setDone(JSON.parse(row.done));
          setRecap(row.recap ? JSON.parse(row.recap) : null);
          return;
        }
        // No plan for today (or the learner switched language) — build a fresh one.
        const [{ due }, prev] = await Promise.all([vocabCounts(), latestRecap(settings.targetLang, date)]);
        const fresh = buildDailyPlan(settings, { date, dueVocab: due, focus: prev?.nextFocus ?? [] });
        if (!live) return;
        setPlan(fresh);
        setDone([]);
        setRecap(null);
        await saveDailySession(date, settings.targetLang, fresh, [], null);
      } catch {
        // No DB (browser dev, first run) — still give the learner a plan to work from.
        if (live) setPlan(buildDailyPlan(settings, { date, dueVocab: 0 }));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [date, settings.targetLang, settings.cefr]);

  const persist = useCallback(
    async (nextDone: BlockKind[], nextRecap: DayRecap | null) => {
      if (!plan) return;
      try {
        await saveDailySession(date, settings.targetLang, plan, nextDone, nextRecap);
      } catch {
        /* progress is still held in memory if the DB is unavailable */
      }
    },
    [plan, date, settings.targetLang],
  );

  const complete = useCallback(
    async (kind: BlockKind) => {
      setDone((d) => {
        if (d.includes(kind)) return d;
        const next = [...d, kind];
        void persist(next, recap);
        return next;
      });
    },
    [persist, recap],
  );

  const wrapUp = useCallback(async () => {
    if (!plan) return;
    let result: DayRecap = {
      recap: `You worked through ${done.length} of ${plan.blocks.length} blocks on "${plan.theme}".`,
      nextFocus: plan.focus,
    };
    try {
      const raw = await getProvider(settings).chat(
        [{ role: "user", content: recapPrompt(settings, plan, done) }],
        { json: true },
      );
      result = parseRecap(raw);
    } catch {
      // Offline or provider down — keep the deterministic fallback recap.
    }
    setRecap(result);
    setDone((d) => {
      const next = d.includes("summary") ? d : [...d, "summary" as BlockKind];
      void persist(next, result);
      return next;
    });
  }, [plan, done, settings, persist]);

  const kinds = plan?.blocks.map((b) => b.kind) ?? [];
  return {
    date,
    plan,
    done,
    recap,
    loading,
    isDone: (k) => done.includes(k),
    next: kinds.find((k) => !done.includes(k)) ?? null,
    complete,
    wrapUp,
  };
}

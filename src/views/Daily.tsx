import { useEffect, useState } from "react";
import type { Settings } from "../lib/settings";
import { getProvider } from "../lib/providers";
import {
  buildDailyPlan,
  recapPrompt,
  parseRecap,
  type DailyPlan,
  type BlockKind,
  type DayRecap,
} from "../lib/learn";
import { weeklyReportPrompt, parseWeeklyReport, drillPrompt, parseDrills, type WeeklyReport, type Drill } from "../lib/coach";
import { getDailySession, saveDailySession, vocabCounts, weekStats } from "../lib/db";

type Tab = "chat" | "reading" | "vocab" | "settings" | "daily";
const today = () => new Date().toISOString().slice(0, 10);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const BLOCK_TAB: Partial<Record<BlockKind, Tab>> = {
  conversation: "chat",
  reading: "reading",
  scenario: "chat",
  vocab: "vocab",
};

export default function Daily({
  settings,
  onNavigate,
}: {
  settings: Settings;
  onNavigate: (tab: Tab) => void;
}) {
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [done, setDone] = useState<BlockKind[]>([]);
  const [recap, setRecap] = useState<DayRecap | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [drills, setDrills] = useState<Drill[] | null>(null);

  // Load (or build) today's plan once.
  useEffect(() => {
    (async () => {
      const date = today();
      const row = await getDailySession(date);
      // Only reuse a saved plan built for the current target language — otherwise
      // the header (live settings) and the blocks (stale plan) disagree on language.
      if (row && row.lang === settings.targetLang) {
        setPlan(JSON.parse(row.plan));
        setDone(JSON.parse(row.done));
        setRecap(row.recap ? JSON.parse(row.recap) : null);
        return;
      }
      const { due } = await vocabCounts();
      const p = buildDailyPlan(settings, { date, dueVocab: due });
      setPlan(p);
      await saveDailySession(date, settings.targetLang, p, [], null);
    })().catch((e) => setError(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(nextDone: BlockKind[], nextRecap: DayRecap | null) {
    if (!plan) return;
    await saveDailySession(plan.date, settings.targetLang, plan, nextDone, nextRecap);
  }

  async function toggle(kind: BlockKind) {
    const next = done.includes(kind) ? done.filter((k) => k !== kind) : [...done, kind];
    setDone(next);
    await persist(next, recap);
  }

  async function finishDay() {
    if (!plan || busy) return;
    setBusy(true);
    setError("");
    try {
      const raw = await getProvider(settings).chat([{ role: "user", content: recapPrompt(settings, plan, done) }], {
        json: true,
      });
      const r = parseRecap(raw);
      setRecap(r);
      await persist(done, r);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function genReport() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const w = await weekStats(settings.targetLang, Date.now() - WEEK_MS);
      const raw = await getProvider(settings).chat(
        [{ role: "user", content: weeklyReportPrompt(settings, { ...w, focusAreas: [] }) }],
        { json: true },
      );
      setReport(parseWeeklyReport(raw));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function genDrills() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const areas = report?.focus ?? [];
      const raw = await getProvider(settings).chat([{ role: "user", content: drillPrompt(settings, areas) }], {
        json: true,
      });
      setDrills(parseDrills(raw));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (!plan) return <div className="daily"><p className="muted">Building today's plan…</p></div>;

  const activities = plan.blocks.filter((b) => b.kind !== "summary");
  const allActivitiesDone = activities.every((b) => done.includes(b.kind));

  return (
    <div className="daily">
      <h1>Today · {plan.theme}</h1>
      <p className="muted">
        A {plan.totalMinutes}-minute {settings.targetLang} session at level {plan.level}. Work through each block, then
        get your recap.
      </p>

      <ol className="plan">
        {plan.blocks.map((b) => (
          <li key={b.kind} className={done.includes(b.kind) ? "block done" : "block"}>
            <label className="row">
              <input type="checkbox" checked={done.includes(b.kind)} onChange={() => toggle(b.kind)} />
              <span className="block-body">
                <strong>{b.title}</strong> <span className="muted">· {b.minutes} min</span>
                <span className="block-detail">{b.detail}</span>
                {b.goal && <span className="block-goal">🎯 {b.goal}</span>}
              </span>
            </label>
            {BLOCK_TAB[b.kind] && (
              <button className="ghost" onClick={() => onNavigate(BLOCK_TAB[b.kind]!)}>
                Go
              </button>
            )}
          </li>
        ))}
      </ol>

      {error && <div className="error">{error}</div>}

      {!recap && (
        <button onClick={finishDay} disabled={busy || !allActivitiesDone}>
          {busy ? "Wrapping up…" : "Finish & get recap"}
        </button>
      )}

      {recap && (
        <div className="summary">
          <h3>Daily recap</h3>
          <p>{recap.recap}</p>
          {recap.nextFocus.length > 0 && (
            <p>
              <strong>Tomorrow:</strong> {recap.nextFocus.join(", ")}
            </p>
          )}
        </div>
      )}

      <section className="coach">
        <h2>Coaching</h2>
        <div className="chat-actions">
          <button className="ghost" onClick={genReport} disabled={busy}>
            Weekly progress report
          </button>
          <button className="ghost" onClick={genDrills} disabled={busy}>
            Weak-area drills
          </button>
        </div>

        {report && (
          <div className="summary">
            <h3>{report.headline}</h3>
            <p>{report.report}</p>
            {report.wins.length > 0 && (
              <p>
                <strong>Wins:</strong> {report.wins.join(", ")}
              </p>
            )}
            {report.focus.length > 0 && (
              <p>
                <strong>Focus:</strong> {report.focus.join(", ")}
              </p>
            )}
          </div>
        )}

        {drills && (
          <div className="drills">
            {drills.length === 0 && <p className="muted">No drills generated — try again.</p>}
            {drills.map((d, i) => (
              <div key={i} className="drill">
                <div className="drill-area">{d.area}</div>
                <div className="drill-prompt">{d.prompt}</div>
                {d.hint && <div className="note">💡 {d.hint}</div>}
                {d.example && <details><summary>Model answer</summary>{d.example}</details>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

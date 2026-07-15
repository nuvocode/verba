import { useEffect, useState } from "react";
import type { Settings } from "../lib/settings";
import type { Day } from "../lib/useDay";
import { getProvider } from "../lib/providers";
import { weeklyReportPrompt, parseWeeklyReport, type WeeklyReport } from "../lib/coach";
import { getPack } from "../lib/packs";
import { CEFR_LEVELS } from "../lib/level";
import { estimateLevelV2, metricsFromRow } from "../lib/metrics";
import { activeDays, latestLevelSignal, recentMemories, recentMetricScores, recentMetrics, weekStats } from "../lib/db";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const weekRange = () => {
  const to = new Date();
  const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(from)} – ${f(to)}`;
};

interface Cells {
  complexity: number;
  coverage: number;
  accuracy: number;
  deltas: { complexity: number; coverage: number; accuracy: number };
  score: number;
}

export default function Coach({ settings, day }: { settings: Settings; day: Day }) {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [cells, setCells] = useState<Cells | null>(null);
  const [days, setDays] = useState<boolean[]>([]);
  const [trend, setTrend] = useState<number[]>([]);
  const [level, setLevel] = useState<string>(settings.cefr);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const since = Date.now() - WEEK_MS;
        const [stats, rows, scores, active, signal, memories] = await Promise.all([
          weekStats(settings.targetLang, since),
          recentMetrics(settings.targetLang, 2),
          recentMetricScores(settings.targetLang, 12),
          activeDays(),
          latestLevelSignal(settings.targetLang).catch(() => null),
          recentMemories(settings.targetLang).catch(() => []),
        ]);
        if (!live) return;

        setDays(active);
        setTrend(scores);
        setLevel(signal?.estimate ?? settings.cefr);

        if (rows[0]) {
          const now = estimateLevelV2(metricsFromRow(rows[0]));
          const prev = rows[1] ? estimateLevelV2(metricsFromRow(rows[1])) : null;
          setCells({
            ...now.components,
            score: now.score,
            deltas: {
              complexity: now.components.complexity - (prev?.components.complexity ?? now.components.complexity),
              coverage: now.components.coverage - (prev?.components.coverage ?? now.components.coverage),
              accuracy: now.components.accuracy - (prev?.components.accuracy ?? now.components.accuracy),
            },
          });
        }

        // The written report is the only AI call here; the numbers above are measured.
        const raw = await getProvider(settings).chat(
          [
            {
              role: "user",
              content: weeklyReportPrompt(
                settings,
                { ...stats, focusAreas: day.plan?.focus ?? [] },
                getPack(settings.packId),
                memories,
              ),
            },
          ],
          { json: true },
        );
        if (live) setReport(parseWeeklyReport(raw));
      } catch (e: any) {
        if (live) setError(String(e?.message ?? e));
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [settings.targetLang, settings.provider, day.plan]);

  const bandIdx = Math.max(0, CEFR_LEVELS.indexOf(level as any));
  // Position on the A1→C2 rail: the band itself, plus how far the composite has
  // carried them through it.
  const within = cells ? ((cells.score % (100 / 6)) / (100 / 6)) * 100 : 0;
  const pct = ((bandIdx + within / 100) / (CEFR_LEVELS.length - 1)) * 100;

  const delta = (n: number) => (n > 0 ? <i>+{n}</i> : n < 0 ? <i style={{ color: "var(--warn)" }}>{n}</i> : null);
  const line =
    trend.length > 1
      ? trend
          .map((s, i) => `${(i / (trend.length - 1)) * 800},${72 - (s / 100) * 60}`)
          .join(" ")
      : "";

  return (
    <div className="coach fade">
      <div className="eyebrow">
        Coach · {weekRange()} · {settings.targetLang}
      </div>
      <h1 className="display">{report?.headline ?? (busy ? "Reading your week…" : "Quiet, steady progress.")}</h1>

      {error && <div className="err">{error}</div>}

      {report?.report && (
        <div className="lede" style={{ maxWidth: 640, marginBottom: 48 }}>
          <div className="bullet" />
          <p style={{ fontSize: 18, fontStyle: "italic", lineHeight: 1.6 }}>{report.report}</p>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--line)", padding: "28px 0", marginBottom: 8 }}>
        <div className="eyebrow" style={{ marginBottom: 22 }}>
          Estimated level
        </div>
        <div className="cefr">
          <i style={{ width: `${Math.min(100, pct)}%` }} />
          <b style={{ left: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="cefr-scale">
          {CEFR_LEVELS.map((l) => (
            <span key={l} className={l === level ? "now" : ""}>
              {l}
            </span>
          ))}
        </div>
      </div>

      {cells ? (
        <div className="mgrid">
          <div className="mcell">
            <div className="h">
              <span>Sentence complexity</span>
              <b>
                {cells.complexity} {delta(cells.deltas.complexity)}
              </b>
            </div>
            <div className="meter">
              <div style={{ width: `${cells.complexity}%`, background: "var(--ink2)" }} />
            </div>
            <div className="mnote">Words per sentence and average word length in what you write.</div>
          </div>
          <div className="mcell">
            <div className="h">
              <span>Accuracy</span>
              <b>
                {cells.accuracy} {delta(cells.deltas.accuracy)}
              </b>
            </div>
            <div className="meter">
              <div style={{ width: `${cells.accuracy}%` }} />
            </div>
            <div className="mnote">How often you self-correct — fewer corrections per message reads as higher accuracy.</div>
          </div>
          <div className="mcell">
            <div className="h">
              <span>Vocabulary depth</span>
              <b>
                {cells.coverage} {delta(cells.deltas.coverage)}
              </b>
            </div>
            <div className="meter">
              <div style={{ width: `${cells.coverage}%`, background: "var(--ink2)" }} />
            </div>
            <div className="mnote">Variety of words you use, plus the size of your studied deck.</div>
          </div>
          <div className="mcell">
            <div className="h">
              <span>Consistency</span>
              <b>
                {days.filter(Boolean).length}
                <span style={{ fontSize: 13, color: "var(--ink3)", fontWeight: 400 }}>/7 days</span>
              </b>
            </div>
            <div className="days">
              {days.map((on, i) => (
                <i key={i} className={i === days.length - 1 ? (on ? "today" : "") : on ? "on" : ""} />
              ))}
            </div>
            <div className="mnote">Days you practiced in the last seven.</div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "28px 0 44px", color: "var(--ink3)", fontSize: 13.5 }}>
          Finish a conversation and your measured signals — complexity, accuracy, vocabulary depth — appear here.
        </div>
      )}

      {report && report.focus.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 18 }}>
            Where you're weakest — and what I'll do about it
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 48 }}>
            {report.focus.slice(0, 4).map((f) => (
              <div className="weak" key={f}>
                <h3>{f}</h3>
                <p>Tomorrow's plan opens with this — the warm-up conversation drills it before anything else.</p>
              </div>
            ))}
          </div>
        </>
      )}

      {report && report.wins.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 14 }}>
            Wins this week
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 48 }}>
            {report.wins.map((w) => (
              <div className="chip" key={w} style={{ cursor: "default" }}>
                {w}
              </div>
            ))}
          </div>
        </>
      )}

      {trend.length > 1 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            Momentum · last {trend.length} sessions
          </div>
          <svg width="100%" height="72" viewBox="0 0 800 72" preserveAspectRatio="none" style={{ display: "block" }}>
            <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
          </svg>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 8 }}>
            {trend[trend.length - 1] >= trend[0]
              ? "Building. Longer unprompted answers, fewer suggestion pickups."
              : "Dipping — a lighter week. The plan will ease back accordingly."}
          </div>
        </>
      )}
    </div>
  );
}

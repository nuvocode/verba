import { useEffect, useState } from "react";
import type { Settings } from "../lib/settings";
import type { Day } from "../lib/useDay";
import { getProvider } from "../lib/providers";
import { weeklyReportPrompt, parseWeeklyReport, type WeeklyReport } from "../lib/coach";
import { getPack } from "../lib/packs";
import { CEFR_LEVELS } from "../lib/level";
import { levelOf, levelGapNote, progressionSuggested, MIN_WEAKNESS_EVIDENCE } from "../lib/model";
import { addressed } from "../lib/weakness";
import { estimateLevelV2, metricsFromRow } from "../lib/metrics";
import { activeDays, recentMemories, recentMetricScores, recentMetrics, weekStats } from "../lib/db";

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
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const since = Date.now() - WEEK_MS;
        const [stats, rows, scores, active, memories] = await Promise.all([
          weekStats(settings.profile.targetLanguage, since),
          recentMetrics(settings.profile.targetLanguage, 2),
          recentMetricScores(settings.profile.targetLanguage, 12),
          activeDays(),
          recentMemories(settings.profile.targetLanguage).catch(() => []),
        ]);
        if (!live) return;

        setDays(active);
        setTrend(scores);

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
                { ...stats, focusAreas: day.focus },
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
  }, [settings.profile.targetLanguage, settings.provider, day.plan]);

  const bandIdx = Math.max(0, CEFR_LEVELS.indexOf(day.levelEstimate.label));
  // Position on the A1→C2 rail: the band itself, plus how far through it the
  // estimate sits. Both come from day.levelEstimate — taking the band from the
  // 12-session mean and the position from the latest session's score would slide
  // the marker on a number that is nowhere on this screen.
  const within = ((day.levelEstimate.value % (100 / 6)) / (100 / 6)) * 100;
  const pct = ((bandIdx + within / 100) / (CEFR_LEVELS.length - 1)) * 100;

  // Measured vs declared: the ray shows what your writing measures at, the `now`
  // marker shows the level you set. When they disagree (and it isn't a low-confidence
  // guess) say so — and, if the measure runs ahead, suggest the next band.
  const measuredIdx = CEFR_LEVELS.indexOf(day.levelEstimate.label);
  const declaredIdx = CEFR_LEVELS.indexOf(levelOf(settings.profile));
  const gapNote = levelGapNote(levelOf(settings.profile), day.levelEstimate);
  const readyForNextBand = measuredIdx > declaredIdx && progressionSuggested(day.levelEstimate);

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
        Coach · {weekRange()} · {settings.profile.targetLanguage}
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
        {day.levelEstimate.sampleSize === 0 ? (
          <div style={{ color: "var(--ink3)", fontSize: 13.5 }}>
            Not measured yet — a few conversations and this appears.
          </div>
        ) : (
          <>
            <div className="cefr">
              <i style={{ width: `${Math.min(100, pct)}%` }} />
              <b style={{ left: `${Math.min(100, pct)}%` }} />
            </div>
            <div className="cefr-scale">
              {CEFR_LEVELS.map((l) => (
                <span key={l} className={l === levelOf(settings.profile) ? "now" : ""}>
                  {l}
                </span>
              ))}
            </div>
            {gapNote && (
              <div style={{ color: "var(--ink3)", fontSize: 13.5, marginTop: 12 }}>{gapNote}</div>
            )}
            {readyForNextBand && (
              <div style={{ color: "var(--ink2)", fontSize: 13.5, marginTop: 8 }}>
                You look ready for the next band.
              </div>
            )}
          </>
        )}
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

      {/*
        Only weaknesses the plan actually does something about (invariant 6). The
        promise in the heading is kept by lib/learn's drill slots, and the sentence
        under each card names the very activities that carry it — a weakness with
        nowhere to go would be a promise this screen cannot keep, so it is not shown.
      */}
      <div className="eyebrow" style={{ marginBottom: 18 }}>
        Where you're weakest — and what I'll do about it
      </div>
      {addressed(day.weaknesses).length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 48 }}>
          {addressed(day.weaknesses).map((w) => (
            <div className="weak" key={w.id}>
              <h3>{w.label}</h3>
              <p>
                {w.evidence.length} slips so far. Tomorrow's plan drills it in{" "}
                {w.addressedBy.map((id) => day.plan?.activities.find((a) => a.id === id)?.title ?? id).join(" and ")}.
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: "4px 0 44px", color: "var(--ink3)", fontSize: 13.5 }}>
          Nothing has gone wrong often enough to name yet — the same slip has to show up{" "}
          {MIN_WEAKNESS_EVIDENCE} times before it earns a place in tomorrow's plan.
        </div>
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

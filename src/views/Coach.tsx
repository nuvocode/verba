import { useEffect, useState } from "react";
import type { Settings } from "../lib/settings";
import type { Day } from "../lib/useDay";
import { getProvider } from "../lib/providers";
import { weeklyReportPrompt, parseWeeklyReport, type WeeklyReport } from "../lib/coach";
import { getPack } from "../lib/packs";
import { CEFR_LEVELS } from "../lib/level";
import { levelOf, levelGapNote, progressionSuggested, MIN_WEAKNESS_EVIDENCE, type Signal } from "../lib/model";
import { addressed } from "../lib/weakness";
import { coachPanel, measured, headline, wins, daySeries, type Metric, type MetricPair } from "../lib/coachmetrics";
import { recentMemories, recentMetricScores, weekStats, signalsSince } from "../lib/db";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const weekRange = () => {
  const to = new Date();
  const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  const f = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${f(from)} – ${f(to)}`;
};

export default function Coach({ settings, day }: { settings: Settings; day: Day }) {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [panel, setPanel] = useState<MetricPair[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
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
        const [stats, scores, memories] = await Promise.all([
          weekStats(settings.profile.targetLanguage, since),
          recentMetricScores(settings.profile.targetLanguage, 12),
          recentMemories(settings.profile.targetLanguage).catch(() => []),
        ]);
        if (!live) return;

        setTrend(scores);

        // The metric grid measures from signals only (§2.6) — two windows back so
        // each metric can be compared against the week before it.
        const signals = await signalsSince(settings.profile.targetLanguage, Date.now() - 2 * WEEK_MS);
        setSignals(signals);
        setPanel(coachPanel(signals, Date.now()));

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

  // ponytail: the two spans below (20 words per sentence, 50 distinct words) are
  // display scales, not thresholds — a bar that fills to its own value would make
  // complexity and vocabulary unreadable next to the percentage metrics.
  const meterWidth = (m: Metric) => {
    if (m.value === null) return 0;
    if (m.id === "consistency") return (m.value / 7) * 100;
    if (m.id === "complexity") return Math.min(100, (m.value / 20) * 100);
    if (m.id === "vocabulary") return Math.min(100, (m.value / 50) * 100);
    return m.value;
  };
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
      <h1 className="display">{busy ? "Reading your week…" : headline(panel)}</h1>

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

      {measured(panel).length > 0 ? (
        <div className="mgrid">
          {measured(panel).map(({ metric, delta, isNew }) => (
            <div className="mcell" key={metric.id} data-delta={delta ?? undefined} data-new={isNew || undefined}>
              <div className="h">
                <span>{metric.label}</span>
                <b>
                  {metric.value}
                  <span className="unit"> {metric.unit}</span>
                  {isNew ? <em className="new">new</em> : delta !== null && delta !== 0 ? (
                    <i style={delta < 0 ? { color: "var(--warn)" } : undefined}>
                      {delta > 0 ? "+" : ""}
                      {delta}
                    </i>
                  ) : null}
                </b>
              </div>
              <div className="meter">
                <div style={{ width: `${meterWidth(metric)}%` }} />
              </div>
              <div className="mnote">{metric.definition}</div>
              {metric.id === "consistency" &&
                (() => {
                  const series = daySeries(signals, Date.now());
                  return (
                    <div className="consistency">
                      <div className="boxes">
                        {series.map((d, i) => (
                          <span key={i} className={d.active ? "on" : ""} />
                        ))}
                      </div>
                      <svg className="spark" viewBox="0 0 7 1" preserveAspectRatio="none">
                        <polyline
                          points={series.map((d, i) => `${i},${1 - Math.min(1, d.count / 5)}`).join(" ")}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="0.12"
                        />
                      </svg>
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: "28px 0 44px", color: "var(--ink3)", fontSize: 13.5 }}>
          Finish a conversation, a passage, or a review and your measured signals — complexity, accuracy, vocabulary depth — appear here.
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

      {wins(panel).length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 14 }}>
            Wins this week
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 48 }}>
            {wins(panel).map((w) => (
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
            Momentum · last {trend.length} sessions · {weekRange()}
          </div>
          <svg width="100%" height="72" viewBox="0 0 800 72" preserveAspectRatio="none" style={{ display: "block" }}>
            <line x1="0" y1="72" x2="800" y2="72" stroke="var(--line)" strokeWidth="1" />
            <text x="0" y="70" className="axis">0</text>
            <text x="0" y="10" className="axis">100</text>
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

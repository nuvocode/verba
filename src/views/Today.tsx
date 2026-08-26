import type { Settings } from "../lib/settings";
import type { ActivityKind } from "../lib/model";
import type { Day } from "../lib/useDay";

function greeting(h = new Date().getHours()): string {
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const dateLine = () =>
  new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).replace(/,/g, " ·");

export default function Today({
  settings,
  day,
  onBegin,
}: {
  settings: Settings;
  day: Day;
  onBegin: (kind: ActivityKind) => void;
}) {
  if (!day.plan)
    return (
      <div className="today fade">
        <div className="eyebrow">{day.loading ? "Planning your day…" : "No plan"}</div>
      </div>
    );

  const { plan } = day;

  return (
    <div className="today fade">
      <div className="eyebrow">
        {dateLine()} · Day {plan.dayIndex} · {settings.profile.targetLanguage}
      </div>
      <h1 className="display">{greeting()}.</h1>

      {/* ponytail: the "not yet measured" banner needs levelEstimate to have a writer — 11b-3 */}

      <div className="lede" style={{ maxWidth: 640, marginBottom: 52 }}>
        <div className="bullet live" />
        <p>
          Today is themed around {plan.theme} — conversation first, then a passage that reuses what you just said.{" "}
          About {plan.estimatedMinutes} minutes in all — press <span className="kbd">↵</span> to begin.
        </p>
      </div>

      <div className="spine">
        {plan.activities.map((b, i) => {
          const done = day.isDone(b.kind);
          const active = day.next === b.kind;
          return (
            <button
              key={b.kind}
              className={`spine-item ${done ? "done" : ""} ${active ? "active" : ""}`}
              onClick={() => onBegin(b.kind)}
            >
              <div className="num">{String(i + 1).padStart(2, "0")}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="title">{b.title}</div>
                <div className="meta">
                  {b.rationale} · ~{b.estimatedMinutes} min
                </div>
              </div>
              <div className="st">{done ? "✓ done" : active ? "up next ↵" : ""}</div>
            </button>
          );
        })}
      </div>

      {day.recap && (
        <div className="lede" style={{ marginTop: 44, maxWidth: 640 }}>
          <div className="bullet" />
          <p style={{ fontStyle: "italic", fontSize: 17 }}>{day.recap.recap}</p>
        </div>
      )}

      {settings.showHints && (
        <div className="hints" style={{ marginTop: 44 }}>
          <span>
            <span className="kbd">↵</span> begin next
          </span>
          <span>
            <span className="kbd">1–6</span> spaces
          </span>
          <span>
            <span className="kbd">⌘K</span> anything — ask, jump, search
          </span>
        </div>
      )}
    </div>
  );
}

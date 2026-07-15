import { useEffect, useState } from "react";
import type { Settings } from "../lib/settings";
import type { BlockKind } from "../lib/learn";
import type { Day } from "../lib/useDay";
import { dayNumber } from "../lib/db";

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
  onBegin: (kind: BlockKind) => void;
}) {
  const [dayNo, setDayNo] = useState<number | null>(null);

  useEffect(() => {
    dayNumber()
      .then(setDayNo)
      .catch(() => {});
  }, [day.plan]);

  if (!day.plan)
    return (
      <div className="today fade">
        <div className="eyebrow">{day.loading ? "Planning your day…" : "No plan"}</div>
      </div>
    );

  const { plan } = day;
  const focus = plan.focus[0];

  return (
    <div className="today fade">
      <div className="eyebrow">
        {dateLine()} · Day {dayNo ?? 1} · {settings.targetLang}
      </div>
      <h1 className="display">{greeting()}.</h1>

      {/* Level was skipped in onboarding — say so, once, until the first conversation places them. */}
      {!settings.cefr && (
        <div className="lede" style={{ maxWidth: 640, marginBottom: 20 }}>
          <div className="bullet" />
          <p style={{ fontSize: 15, color: "var(--ink2)" }}>
            I'll calibrate your level in our first conversation. Session length is {settings.dailyMinutes} min — change
            anytime.
          </p>
        </div>
      )}

      <div className="lede" style={{ maxWidth: 640, marginBottom: 52 }}>
        <div className="bullet live" />
        <p>
          {focus
            ? `Yesterday ${focus.charAt(0).toLowerCase()}${focus.slice(1)} gave you trouble, so today's session drills it in conversation before the reading.`
            : `Today is themed around ${plan.theme} — conversation first, then a passage that reuses what you just said.`}{" "}
          About {plan.totalMinutes} minutes in all — press <span className="kbd">↵</span> to begin.
        </p>
      </div>

      <div className="spine">
        {plan.blocks.map((b, i) => {
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
                  {b.detail} · ~{b.minutes} min{b.goal ? ` · targets: ${b.goal}` : ""}
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

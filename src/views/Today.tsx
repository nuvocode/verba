// Today (spec §4.2). The one screen a learner opens without being sent there, so
// everything on it has to answer a question they actually have: what am I doing,
// how long will it take, where did I stop, and what if I don't fancy today's topic.
//
// Nothing here composes a sentence. Every claim on this page — the summary, the
// progress line, the shortfall, yesterday's trace — is a pure function in lib, so
// what the learner reads is something a check can hold.
import { useEffect, useState } from "react";
import { isLocalProvider, type Settings } from "../lib/settings";
import type { ActivityKind } from "../lib/model";
import type { Day } from "../lib/useDay";
import { todayKey } from "../lib/useDay";
import { activityStatus, buildDailyPlan, daySummary, fallbackNote, progressLine, shortfallNote, tomorrowPreview, traceLine } from "../lib/learn";
import { listModels, modelTrouble, PROVIDERS, prettyModel, type Installed } from "../lib/models";
import { levelOf } from "../lib/model";
import { timeName } from "../lib/choices";
import { headerDate } from "../lib/fmt";
import { AT } from "../lib/rules";
import Hints from "./Hints";

function greeting(h = new Date().getHours()): string {
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** The current date as a header line — weekday first, via the formatter's own
 *  header, so this page reads like a date while every other surface reads like
 *  a moment. */
const dateLine = () => headerDate();

/**
 * §7 row 2: "Model yanıt vermiyor → ana ekranda uyarı + sına düğmesi + model
 * değiştir yolu."
 *
 * Asked on the way in because it is free to ask — a GET to a port on this machine,
 * or the length of a saved key. A cloud provider is never probed with a real
 * request: that costs money to answer a question nobody asked, and Advanced's Test
 * connection is where a learner asks it on purpose.
 */
function ModelWarning({ settings }: { settings: Settings }) {
  const [served, setServed] = useState<Installed[] | null>(null);
  const [asked, setAsked] = useState(false);

  const p = PROVIDERS.find((x) => x.id === settings.provider);
  const host = p?.host ? String(settings[p.host] ?? "") : "";
  const local = isLocalProvider(settings.provider);

  useEffect(() => {
    let live = true;
    setAsked(false);
    if (!local) return setAsked(true);
    if (!host) return setAsked(true);
    void listModels(settings.provider as "ollama" | "lmstudio", host).then((list) => {
      if (!live) return;
      setServed(list);
      setAsked(true);
    });
    return () => {
      live = false;
    };
  }, [settings.provider, host, local]);

  // Nothing is claimed until the question has been answered — a warning that
  // appears for half a second on every open is a warning nobody trusts.
  if (!asked) return null;
  const why = modelTrouble(settings, served);
  if (!why) return null;

  return (
    <div
      className="lede"
      style={{ maxWidth: 640, marginBottom: 34, padding: "14px 16px", background: "var(--surface)", borderLeft: "2px solid var(--sev)" }}
    >
      <div>
        <p style={{ fontSize: 16 }}>{why}</p>
        <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 13 }}>
          <a href={AT.advanced} style={{ color: "var(--accent-ink)" }}>
            Test the connection
          </a>
          <a href={AT.advanced} style={{ color: "var(--accent-ink)" }}>
            Choose another model
          </a>
        </div>
      </div>
    </div>
  );
}

export default function Today({
  settings,
  day,
  onBegin,
  onOpen,
}: {
  settings: Settings;
  day: Day;
  onBegin: (kind: ActivityKind) => void;
  /** Where yesterday's trace goes — the record of what happened lives in Coach. */
  onOpen: (space: "coach") => void;
}) {
  if (!day.plan)
    return (
      <div className="today fade">
        <div className="eyebrow">{day.loading ? "Planning your day…" : "Building a plan…"}</div>
        <p className="sub">
          {day.loading
            ? "Reading what you did last time and what is due today. A few seconds."
            : "One moment — if this stays here, open Settings and check your model."}
        </p>
      </div>
    );

  const { plan } = day;
  const shortfall = shortfallNote(plan, settings.dailyMinutes);
  const trace = traceLine(day.trace);
  const finished = plan.activities.every((a) => day.isDone(a.kind));
  const provider = PROVIDERS.find((p) => p.id === settings.provider);
  const modelId = String(settings[provider?.model ?? "ollamaModel"] ?? "");

  return (
    <div className="today fade">
      <div className="eyebrow">
        {dateLine()} · Day {plan.dayIndex} · {settings.profile.targetLanguage}
      </div>
      <h1 className="display">{greeting()}.</h1>

      <ModelWarning settings={settings} />

      {/* §2.1: a plan built without the day's inputs is named as such, never
          presented as the real thing. Reuses the .dep-note class PLAN-012 added —
          a plan built from nothing and an activity opened out of order are the
          same kind of notice. */}
      {day.planSource === "fallback" && <div className="dep-note">{fallbackNote(plan)}</div>}

      {/* The "your plan is ready" screen, demoted to a line you can open when you
          want it (§5, screen 5). Closed by default — the whole of the folding. */}
      <details className="setup">
        <summary>Your setup</summary>
        <div className="row2">
          <div className="k">Model</div>
          <div>
            {provider?.name} · {prettyModel(modelId)}{" "}
            <a href={AT.advanced} style={{ color: "var(--accent-ink)" }}>
              change
            </a>
          </div>
        </div>
        <div className="row2">
          <div className="k">Learning</div>
          <div>
            {settings.profile.targetLanguage}{" "}
            <a href={AT.learning} style={{ color: "var(--accent-ink)" }}>
              change
            </a>
          </div>
        </div>
        <div className="row2">
          <div className="k">Explained in</div>
          <div>
            {settings.profile.nativeLanguage}{" "}
            <a href={AT.learning} style={{ color: "var(--accent-ink)" }}>
              change
            </a>
          </div>
        </div>
        <div className="row2">
          <div className="k">Level</div>
          <div>
            {levelOf(settings.profile)}{" "}
            <a href={AT.learning} style={{ color: "var(--accent-ink)" }}>
              change
            </a>
          </div>
        </div>
        <div className="row2">
          <div className="k">Each day</div>
          <div>
            {settings.dailyMinutes} minutes · {timeName(settings.dailyMinutes)}{" "}
            <a href={AT.learning} style={{ color: "var(--accent-ink)" }}>
              change
            </a>
          </div>
        </div>
      </details>

      {/* invariant 26: nothing measured is claimed before measurement begins. */}
      {day.levelEstimate.sampleSize === 0 && (
        <div style={{ color: "var(--ink3)", fontSize: 14, marginBottom: 20 }}>
          I'll start measuring your level after a few conversations.
        </div>
      )}

      <div className="lede" style={{ maxWidth: 640, marginBottom: 14 }}>
        <div className="bullet live" />
        <div>
          <p>
            {daySummary(plan, day.weaknesses)} Press <span className="kbd">↵</span> to begin.
          </p>
          {/* §7 row 8: a plan that cannot hit the daily target says why, rather than
              leaving the learner to notice the arithmetic themselves. */}
          {shortfall && (
            <p style={{ fontSize: 14, fontFamily: "var(--sans)", color: "var(--ink3)", marginTop: 10 }}>{shortfall}</p>
          )}
        </div>
      </div>

      {/*
        §4.2 is explicit that this is not in a menu: "Bu, ürünün en sık istenecek
        eylemlerinden biridir ve bir menünün içine gizlenmez." What it does to the
        day is written beside it, because a link that silently discards an hour's
        work is a link nobody presses twice.
      */}
      <div style={{ marginLeft: 22, marginBottom: 46, fontSize: 13, color: "var(--ink3)" }}>
        <button className="linky" onClick={() => void day.changeTopic()}>
          another topic
        </button>
        {" — "}
        {finished
          ? "starts the day over on something else."
          : day.done.length
            ? `keeps the ${day.done.length} you have finished and rebuilds the rest.`
            : "rebuilds today on the next topic in the rotation."}
      </div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {progressLine(plan, day.done)}
      </div>

      <div className="spine">
        {plan.activities.map((b, i) => {
          const st = activityStatus(plan, day.done, b.kind);
          return (
            <button
              key={b.kind}
              className={`spine-item ${st === "done" ? "done" : ""} ${st === "next" ? "active" : ""}`}
              onClick={() => onBegin(b.kind)}
              // A finished row is not a dead row — §4.2 asks that completed sections
              // can be reopened, and the label is what says so before the click.
              title={st === "done" ? `${b.title} — done, click to open it again` : b.title}
            >
              <div className="num">{String(i + 1).padStart(2, "0")}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="title">{b.title}</div>
                <div className="meta">
                  {b.rationale} · ~{b.estimatedMinutes} min
                </div>
              </div>
              <div className="st">{st === "done" ? "✓ done · reopen" : st === "next" ? "up next ↵" : "waiting"}</div>
            </button>
          );
        })}
      </div>

      {/* §2.1: a finished day shows the summary and a preview of tomorrow. The
          recap below is the model's sentence about the day; this is the app's.
          The preview is the real plan for the next date, not a description of
          one — so the line and the day the learner wakes up to cannot disagree.
          buildDailyPlan is pure and cheap, so it is built inline rather than
          memoised (a hook here would sit after the early return above). */}
      {finished && (
        <div className="lede" style={{ marginTop: 40, maxWidth: 640 }}>
          <div className="bullet" />
          <div>
            <p>{daySummary(plan, day.weaknesses)}</p>
            <p style={{ fontSize: 14, color: "var(--ink3)", marginTop: 10 }}>
              {tomorrowPreview(
                buildDailyPlan(settings, {
                  date: todayKey(new Date(Date.now() + 24 * 60 * 60 * 1000)),
                  dayIndex: plan.dayIndex + 1,
                  dueVocab: day.due,
                  weaknesses: day.weaknesses,
                }),
              )}
            </p>
          </div>
        </div>
      )}

      {day.recap && (
        <div className="lede" style={{ marginTop: 44, maxWidth: 640 }}>
          <div className="bullet" />
          <p style={{ fontStyle: "italic", fontSize: 17 }}>{day.recap.recap}</p>
        </div>
      )}

      {/* §4.2's "dünün izi". Absent on day one rather than empty. */}
      {trace && (
        <button className="linky" style={{ marginTop: 40, fontSize: 13, color: "var(--ink3)" }} onClick={() => onOpen("coach")}>
          {trace}
        </button>
      )}

      <div style={{ marginTop: 44 }}>
        <Hints settings={settings} surface="today" />
      </div>
    </div>
  );
}

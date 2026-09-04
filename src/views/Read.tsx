import { useEffect, useState } from "react";
import type { ReadView, Settings } from "../lib/settings";
import type { ActivityKind, SignalDraft } from "../lib/model";
import type { Day } from "../lib/useDay";
import type { Ask, Read as ReadState } from "../lib/useRead";
import { CEFR_LEVELS } from "../lib/level";
import { levelOf } from "../lib/model";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ingest, BROUGHT_MAX_CHARS, type BroughtText } from "../lib/brought";
import { saveBrought, listBrought, getBrought, deleteBrought, type BroughtRow } from "../lib/db";
import AskSheet from "./read/AskSheet";
import Passage from "./read/Passage";
import Prompter from "./read/Prompter";
import ReadingCheck from "./read/ReadingCheck";
import { readSignals, voiceSignals } from "../lib/signals";
import { dependencyMet, dependencyNote } from "../lib/learn";
import { humanError } from "../lib/fmt";
import { Generating, Nothing, Failed, Unusable } from "./States";

/**
 * The reading screen: one passage, two ways to work it.
 *
 * `Passage` is close reading and the default — sentence focus, tappable words, the coach's
 * notes in the margin. `Prompter` is the same sentences moving up the screen at a pace you
 * set, to be read out loud. This is a view over one `useRead`, not two of them: the passage
 * survives the switch, and so does the sentence you were on.
 *
 * What lives here is what the two share — the empty state, the sheet that asks for a new
 * passage, and the handoff back to the day's plan.
 */
export default function Read({
  settings,
  read,
  day,
  onAdvance,
  onCaptureKeys,
  onChange,
  onSettings,
  onBrought,
}: {
  settings: Settings;
  read: ReadState;
  day: Day;
  /** Close out the reading activity and go wherever the day goes next — the plan decides. */
  onAdvance: (kind: ActivityKind, signals?: SignalDraft[]) => void;
  /** The sheet takes the keyboard while it is open — Esc closes it, not the screen. */
  onCaptureKeys: (captured: boolean) => void;
  /** The chosen view and pace are settings: they are meant to outlive the passage. */
  onChange: (patch: Partial<Settings>) => void;
  /** Leave for Settings — the one action that changes the mic state. */
  onSettings: () => void;
  /** Hand a brought text to Talk for discussion (PLAN-035). */
  onBrought: (text: BroughtText) => void;
}) {
  const block = day.plan?.activities.find((b) => b.kind === "read");
  const [asking, setAsking] = useState(false);
  // null = show every level. Only levels actually present in the library get a chip.
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  // Brought content (PLAN-035): the learner's own text, pasted or opened.
  const [broughtList, setBroughtList] = useState<BroughtRow[]>([]);
  const [broughtDraft, setBroughtDraft] = useState("");
  const [broughtTitle, setBroughtTitle] = useState("");
  const [broughtErr, setBroughtErr] = useState("");

  useEffect(() => {
    onCaptureKeys(asking);
    return () => onCaptureKeys(false);
  }, [asking, onCaptureKeys]);

  // The library only shows in the empty state, so only load it there.
  useEffect(() => {
    if (!read.text) void read.loadLibrary();
  }, [read.text, read.loadLibrary]);

  // The brought list shows in the empty state too — reload it there.
  useEffect(() => {
    if (!read.text) void listBrought(settings.profile.targetLanguage).then(setBroughtList).catch(() => setBroughtList([]));
  }, [read.text, settings.profile.targetLanguage]);

  /** Paste a brought text: validate it, save it, and hand it to Talk. */
  const submitBrought = async () => {
    setBroughtErr("");
    let t: BroughtText;
    try {
      t = ingest(broughtDraft, settings.profile.targetLanguage, broughtTitle);
    } catch (e) {
      setBroughtErr(humanError(e).say);
      return;
    }
    const id = await saveBrought(settings.profile.targetLanguage, t.title, t.body).catch(() => 0);
    setBroughtDraft("");
    setBroughtTitle("");
    void listBrought(settings.profile.targetLanguage).then(setBroughtList).catch(() => {});
    onBrought({ ...t, id });
  };

  /** Open a .txt / .md file and hand it to Talk. */
  const openBrought = async () => {
    setBroughtErr("");
    const path = await open({ filters: [{ name: "Text", extensions: ["txt", "md"] }], multiple: false });
    if (!path) return;
    try {
      const contents = await invoke<string>("file_read", { path });
      const t = ingest(contents, settings.profile.targetLanguage);
      const id = await saveBrought(settings.profile.targetLanguage, t.title, t.body).catch(() => 0);
      void listBrought(settings.profile.targetLanguage).then(setBroughtList).catch(() => {});
      onBrought({ ...t, id });
    } catch (e) {
      setBroughtErr(humanError(e).say);
    }
  };

  /** Reopen a saved brought text for discussion. */
  const discussBrought = async (id: number) => {
    const row = await getBrought(id).catch(() => null);
    if (!row) return;
    onBrought({ id, lang: settings.profile.targetLanguage, title: row.title, body: row.body, createdAt: row.created_at, sentTo: row.sent_to });
  };

  /** Delete one brought text. */
  const removeBrought = async (id: number) => {
    await deleteBrought(id).catch(() => {});
    void listBrought(settings.profile.targetLanguage).then(setBroughtList).catch(() => {});
  };

  // Whatever the sheet is asked for, the day's plan is still underneath it: an empty
  // topic falls back to the theme, and the day's weak area is folded in either way.
  const generate = async (ask: Partial<Ask>) => {
    setAsking(false);
    const plan = day.plan;
    const reuse = plan && block?.dependsOn && dependencyMet(plan, day.done, "read") ? await day.carry(block.dependsOn) : [];
    void read.generate({ ...ask, interests: plan?.theme, goal: block?.goal, reuse });
  };

  // Finishing a passage runs the comprehension check first; only when it produces no
  // questions (or the model errors) do we advance straight away — a broken check must
  // never trap the reader on a passage they've finished.
  const finish = async () => {
    if (!(await read.startCheck())) onAdvance("read", signals());
  };

  /**
   * What the read observed: every question that was answered, plus the words saved
   * off the passage. Read here rather than after `finishCheck`, which clears the
   * check — ReadingCheck calls it and `onDone` in the same tick, so this render's
   * `read.check` is the finished one and the next render's is null. An unanswered
   * question (the skip path leaves several) is not an observation.
   */
  const signals = (): SignalDraft[] => {
    if (!block) return [];
    const c = read.check;
    const graded = (c?.questions ?? [])
      .map((q, i) => ({ q, given: c!.answers[i] ?? "", correct: c!.results[i] }))
      .filter((x) => x.correct !== undefined)
      .map((x) => ({ prompt: x.q.prompt, given: x.given, answer: x.q.answer, qKind: x.q.kind, correct: x.correct! }));
    // The teleprompter's measurement (PLAN-024): the voice turn the prompter
    // observed rides the same pace/pronunciation path PLAN-018 established, so
    // Coach reads the read-aloud the same way it reads a spoken talk turn.
    const voice = read.voice ? voiceSignals(block.id, read.voice) : [];
    return [...readSignals(block.id, graded, read.saved), ...voice];
  };

  const setView = (view: ReadView) => onChange({ readView: view });

  const sheet = asking && (
    <AskSheet
      settings={settings}
      ask={read.ask}
      theme={day.plan?.theme}
      onCancel={() => setAsking(false)}
      onGenerate={generate}
    />
  );

  // The comprehension check takes over the screen once a passage is finished — it is
  // the last step of the read, ahead of the passage itself and the empty state.
  if (read.checking || read.check)
    return <ReadingCheck read={read} onDone={() => onAdvance("read", signals())} />;

  // The sheet is a *sibling* of the empty state, never a child of it: `.fade` animates
  // a transform, and a transformed ancestor is the containing block for everything
  // `position: fixed` under it — the scrim would be laid out against the empty state
  // instead of the window, and left behind as a half-painted ghost when it unmounts.
  if (!read.text)
    return (
      <>
        {day.plan && dependencyNote(day.plan, day.done, "read") && (
          <div className="dep-note">{dependencyNote(day.plan, day.done, "read")}</div>
        )}
        <div className="empty fade">
          {/* surface read: loading */}
          {read.busy && (
            <Generating
              what={`Writing you a ${levelOf(settings.profile)} story…`}
              eta="About 20 seconds on this model — it keeps words from your conversations warm."
              step={read.step ?? undefined}
            />
          )}

          {/* surface read: unusable — a passage that failed the gates is never
              shown (PLAN-022). The learner sees that it was turned away, a
              regenerate, and — where one exists — the most recent saved passage
              at the same level. */}
          {!read.busy && read.outcome && !read.outcome.ok && (
            <Unusable
              what={read.outcome.why}
              fallback={
                read.outcome.fallback
                  ? { label: "Read a saved passage instead", onClick: () => void read.openFallback() }
                  : undefined
              }
              regenerate={{ label: "Try again", onClick: () => void generate({}) }}
            />
          )}

          {/* surface read: empty */}
          {!read.busy && !read.error && !read.outcome && (
            <Nothing
              why="The coach writes a story at your level that reuses the words from your conversations."
              action={{ label: `Today's passage — ${day.plan?.theme ?? "everyday life"}`, onClick: () => void generate({}) }}
            />
          )}

          {/* surface read: error */}
          {!read.busy && read.error && (
            <Failed say={read.error} retry={{ label: "Try again", onClick: () => void generate({}) }} />
          )}

          {!read.busy && (
            <button
              className="link"
              title="Off-plan: a passage that is not part of today"
              onClick={() => setAsking(true)}
            >
              Something else
            </button>
          )}

          {!read.busy && read.library.length > 0 && (() => {
            // The chip row only offers levels the library actually has, in CEFR order.
            const levels = CEFR_LEVELS.filter((l) => read.library.some((r) => r.cefr === l));
            const shown = levelFilter ? read.library.filter((r) => r.cefr === levelFilter) : read.library;
            return (
            <div className="readlib">
              <div className="eyebrow">Your library · {shown.length}</div>
              {levels.length > 1 && (
                <div className="readlib-chips">
                  <button className={`chip${levelFilter === null ? " on" : ""}`} onClick={() => setLevelFilter(null)}>
                    All
                  </button>
                  {levels.map((l) => (
                    <button
                      key={l}
                      className={`chip${levelFilter === l ? " on" : ""}`}
                      onClick={() => setLevelFilter(l)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
              <ul>
                {shown.map((r) => (
                  <li key={r.id}>
                    <button className="readlib-item" onClick={() => void read.open(r.id)}>
                      <span className="t">{r.title}</span>
                      <span className="m">
                        {r.length ?? "—"}
                        {r.topic ? ` · ${r.topic}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            );
          })()}

          {/* Brought content (PLAN-035): the learner's own text, pasted or opened.
              It stays local, and it is conversation material — handed to Talk,
              never graded here. */}
          {!read.busy && (
            <div className="readlib" style={{ marginTop: 24 }}>
              <div className="eyebrow">Your own text · {broughtList.length}</div>
              <div className="row2">
                <div className="k">Title (optional)</div>
                <input
                  value={broughtTitle}
                  onChange={(e) => setBroughtTitle(e.target.value)}
                  placeholder="the first line, if you leave this blank"
                />
              </div>
              <textarea
                value={broughtDraft}
                onChange={(e) => setBroughtDraft(e.target.value)}
                placeholder={`Paste an email, an article, a transcript — up to ${BROUGHT_MAX_CHARS} characters. It stays on this machine, and the coach talks about it with you.`}
                rows={5}
                style={{ width: "100%", marginTop: 8 }}
              />
              {broughtErr && <div className="meta" style={{ color: "var(--err)" }}>{broughtErr}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn sm" disabled={!broughtDraft.trim()} onClick={() => void submitBrought()}>
                  Talk about it →
                </button>
                <button className="btn sm ghost" onClick={() => void openBrought()}>
                  Open a .txt or .md file
                </button>
              </div>
              {broughtList.length > 0 && (
                <ul style={{ marginTop: 12 }}>
                  {broughtList.map((r) => (
                    <li key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button className="readlib-item" style={{ flex: 1 }} onClick={() => void discussBrought(r.id)}>
                        <span className="t">{r.title}</span>
                      </button>
                      <button className="model" style={{ color: "var(--ink3)" }} onClick={() => void removeBrought(r.id)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        {sheet}
      </>
    );

  if (settings.readView === "prompter")
    return (
      <>
        <Prompter
          settings={settings}
          read={read}
          view={settings.readView}
          onView={setView}
          onWpm={(prompterWpm) => onChange({ prompterWpm })}
          onDone={finish}
          onSettings={onSettings}
        />
        {sheet}
      </>
    );

  return (
    <Passage
      settings={settings}
      read={read}
      view={settings.readView}
      onView={setView}
      onNewPassage={() => read.close()}
      onDone={finish}
      sheet={sheet}
    />
  );
}

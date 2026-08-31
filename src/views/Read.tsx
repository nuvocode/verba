import { useEffect, useState } from "react";
import type { ReadView, Settings } from "../lib/settings";
import type { ActivityKind, SignalDraft } from "../lib/model";
import type { Day } from "../lib/useDay";
import type { Ask, Read as ReadState } from "../lib/useRead";
import { CEFR_LEVELS } from "../lib/level";
import { levelOf } from "../lib/model";
import AskSheet from "./read/AskSheet";
import Passage from "./read/Passage";
import Prompter from "./read/Prompter";
import ReadingCheck from "./read/ReadingCheck";
import { readSignals } from "../lib/signals";
import { dependencyMet, dependencyNote } from "../lib/learn";
import { Generating, Nothing, Failed } from "./States";

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
}) {
  const block = day.plan?.activities.find((b) => b.kind === "read");
  const [asking, setAsking] = useState(false);
  // null = show every level. Only levels actually present in the library get a chip.
  const [levelFilter, setLevelFilter] = useState<string | null>(null);

  useEffect(() => {
    onCaptureKeys(asking);
    return () => onCaptureKeys(false);
  }, [asking, onCaptureKeys]);

  // The library only shows in the empty state, so only load it there.
  useEffect(() => {
    if (!read.text) void read.loadLibrary();
  }, [read.text, read.loadLibrary]);

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
    return readSignals(block.id, graded, read.saved);
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
            />
          )}

          {/* surface read: empty */}
          {!read.busy && !read.error && (
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

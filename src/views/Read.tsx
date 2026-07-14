import { useEffect, useState } from "react";
import type { ReadView, Settings } from "../lib/settings";
import type { BlockKind } from "../lib/learn";
import type { Day } from "../lib/useDay";
import type { Ask, Read as ReadState } from "../lib/useRead";
import AskSheet from "./read/AskSheet";
import Passage from "./read/Passage";
import Prompter from "./read/Prompter";

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
  onBegin,
  onCaptureKeys,
  onChange,
}: {
  settings: Settings;
  read: ReadState;
  day: Day;
  onBegin: (kind: BlockKind) => void;
  /** The sheet takes the keyboard while it is open — Esc closes it, not the screen. */
  onCaptureKeys: (captured: boolean) => void;
  /** The chosen view and pace are settings: they are meant to outlive the passage. */
  onChange: (patch: Partial<Settings>) => void;
}) {
  const block = day.plan?.blocks.find((b) => b.kind === "reading");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    onCaptureKeys(asking);
    return () => onCaptureKeys(false);
  }, [asking, onCaptureKeys]);

  // Whatever the sheet is asked for, the day's plan is still underneath it: an empty
  // topic falls back to the theme, and the day's weak area is folded in either way.
  const generate = (ask: Ask) => {
    setAsking(false);
    void read.generate({ ...ask, interests: day.plan?.theme, goal: block?.goal });
  };

  const finish = () => {
    void day.complete("reading");
    onBegin(day.next === "reading" ? "vocab" : (day.next ?? "vocab"));
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

  // The sheet is a *sibling* of the empty state, never a child of it: `.fade` animates
  // a transform, and a transformed ancestor is the containing block for everything
  // `position: fixed` under it — the scrim would be laid out against the empty state
  // instead of the window, and left behind as a half-painted ghost when it unmounts.
  if (!read.text)
    return (
      <>
        <div className="empty fade">
          <h2>{read.busy ? "Writing you a passage…" : "Nothing to read yet."}</h2>
          <p>
            {read.busy
              ? `A ${settings.cefr} story about ${read.ask.topic || day.plan?.theme || "everyday life"}, in ${settings.targetLang}.`
              : "The coach writes a story at your level that reuses the words from your conversations."}
          </p>
          {!read.busy && (
            <button className="btn" onClick={() => setAsking(true)}>
              Generate a passage →
            </button>
          )}
          {read.error && <div className="err" style={{ maxWidth: 520, margin: "20px auto 0" }}>{read.error}</div>}
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
      onAsk={() => setAsking(true)}
      onDone={finish}
      sheet={sheet}
    />
  );
}

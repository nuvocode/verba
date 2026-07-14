import type { ReactNode } from "react";
import type { ReadView, Settings } from "../../lib/settings";
import { tokens } from "../../lib/text";
import { bare, type Read as ReadState } from "../../lib/useRead";
import ViewToggle from "./ViewToggle";

/**
 * Close reading: the passage sitting still, a sentence at a time. Click a sentence to
 * see it in your own language, click a word to have it explained and kept, and the
 * coach's notes stand in the margin beside the lines they belong to.
 *
 * This is the reading screen as it has always been — the teleprompter is the other one.
 */
export default function Passage({
  settings,
  read,
  view,
  onView,
  onAsk,
  onDone,
  sheet,
}: {
  settings: Settings;
  read: ReadState;
  view: ReadView;
  onView: (v: ReadView) => void;
  /** Open the sheet that asks what the next passage should be. */
  onAsk: () => void;
  /** Finished with the reading block — mark it done and move the day on. */
  onDone: () => void;
  /** Rendered inside the grid, never inside `.fade`: see the note in Read.tsx. */
  sheet: ReactNode;
}) {
  const { text, focusIdx, popover } = read;
  if (!text) return null;
  const focused = focusIdx >= 0 ? text.sentences[focusIdx] : null;

  return (
    <div className="read" onClick={() => read.closePopover()}>
      <div />
      <div className="fade">
        <div className="topline">
          <div className="eyebrow">
            Generated for you · {settings.cefr} · ~{Math.max(1, Math.round(text.sentences.length / 3))} min
          </div>
          <ViewToggle view={view} onView={onView} />
        </div>
        <h1 dir={read.dir}>{text.title}</h1>
        <div className="cap">Click a sentence to focus it; click a word to have it explained and saved.</div>

        {/* Words are cut by the target language's own rules, and the spaces and
            punctuation between them are rendered as-is — which is the only way a
            script that doesn't use spaces (Japanese, Chinese, Thai) can be both
            readable and tappable. */}
        <div className="passage" dir={read.dir}>
          {text.sentences.map((s, i) => (
            <span
              key={i}
              className={`sent ${focusIdx === i ? "on" : ""}`}
              onClick={() => read.setFocusIdx(focusIdx === i ? -1 : i)}
            >
              {tokens(s.target, read.locale).map((t, wi) =>
                t.word ? (
                  <span
                    key={wi}
                    className={`w ${read.saved.includes(bare(t.text)) ? "saved" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void read.explain(t.text, s.target, e.currentTarget.getBoundingClientRect());
                    }}
                  >
                    {t.text}
                  </span>
                ) : (
                  <span key={wi}>{t.text}</span>
                ),
              )}
              {read.bilingual && (
                <span className="en" dir="auto">
                  {" "}
                  {s.native}{" "}
                </span>
              )}{" "}
            </span>
          ))}
        </div>

        {read.error && <div className="err">{read.error}</div>}

        <div style={{ display: "flex", gap: 12, marginTop: 40 }}>
          <button className="btn sm" onClick={onDone}>
            Done reading →
          </button>
          <button className="btn sm ghost" onClick={() => void read.extend()} disabled={read.busy}>
            {read.busy ? "Writing…" : "Keep reading"}
          </button>
          <button className="btn sm ghost" onClick={onAsk} disabled={read.busy}>
            New passage
          </button>
        </div>

        {settings.showHints && (
          <div className="hints" style={{ marginTop: 44, gap: 20 }}>
            <span>
              <span className="kbd">← →</span> move focus
            </span>
            <span>
              <span className="kbd">T</span> bilingual mode
            </span>
            <span>
              <span className="kbd">P</span> read it out loud
            </span>
            <span>
              <span className="kbd">esc</span> clear focus
            </span>
          </div>
        )}
      </div>

      <div className="notes">
        {read.notes.map(({ i, note }) => (
          <button
            key={i}
            className={`note ${focusIdx === i ? "on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              read.setFocusIdx(i);
            }}
          >
            <div className="h">✳ Coach note</div>
            <div className="b">{note}</div>
          </button>
        ))}
      </div>
      <div />

      {focused && (
        <div className="focusbar" onClick={(e) => e.stopPropagation()}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>
            Sentence {focusIdx + 1} of {text.sentences.length}
          </div>
          <div className="en">{focused.native}</div>
          {focused.note && (
            <div className="nt">
              <span style={{ color: "var(--accent-ink)" }}>✳</span> {focused.note}
            </div>
          )}
        </div>
      )}

      {popover && (
        <div
          className="popover"
          onClick={(e) => e.stopPropagation()}
          style={{
            left: popover.x, // the -50% that centres it on the word lives in CSS, with the animation
            ...(popover.flip ? { bottom: window.innerHeight - popover.y + 10 } : { top: popover.y + 10 }),
          }}
        >
          <div className="t" dir={read.dir}>
            {popover.term}
          </div>
          <div className="g">{popover.gloss}</div>
          {popover.gloss !== "…" && <div className="s">✓ Saved to Memory</div>}
        </div>
      )}

      {sheet}
    </div>
  );
}

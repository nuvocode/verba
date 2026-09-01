import { useEffect, useRef, type ReactNode } from "react";
import type { ReadView, Settings } from "../../lib/settings";
import { levelOf } from "../../lib/model";
import { tokens } from "../../lib/text";
import { bare, type Read as ReadState } from "../../lib/useRead";
import { live } from "../../lib/keys";
import ViewToggle from "./ViewToggle";
import Hints from "../Hints";

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
  onNewPassage,
  onDone,
  sheet,
}: {
  settings: Settings;
  read: ReadState;
  view: ReadView;
  onView: (v: ReadView) => void;
  /** Leave this passage and go back to the library, where a new one can be started. */
  onNewPassage: () => void;
  /** Finished with the reading block — mark it done and move the day on. */
  onDone: () => void;
  /** Rendered inside the grid, never inside `.fade`: see the note in Read.tsx. */
  sheet: ReactNode;
}) {
  const { text, focusIdx, popover } = read;

  // The focused sentence is scrolled into view (PLAN-024) — arrow keys move the
  // focus, and the sentence must be visible to be read. The margin note beside it
  // is highlighted by the same `focusIdx` (see the `.notes` rail below).
  const sentRefs = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    if (focusIdx < 0) return;
    sentRefs.current[focusIdx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusIdx]);

  // Enter keeps the word being explained. Only while a popover with a meaning is
  // open, and never while they are typing — the ask sheet's own Enter is its own.
  const canSave = !!popover && !popover.saved && !!popover.lemma;
  useEffect(() => {
    if (!canSave) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "Enter" || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      if (!live("read", e.key)) return; // the table is the gate
      e.preventDefault();
      void read.saveWord();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSave, read.saveWord]);

  if (!text) return null;
  const focused = focusIdx >= 0 ? text.sentences[focusIdx] : null;

  return (
    <div className="read" onClick={() => read.closePopover()}>
      <div />
      <div className="fade">
        <div className="topline">
          <div className="eyebrow">
            Generated for you · {levelOf(settings.profile)} · ~{Math.max(1, Math.round(text.sentences.length / 3))} min
            {/* The reuse claim is conditional (PLAN-022, invariant 21): it prints
                the gate's hit count, or nothing at all. The copy reads the gate's
                output, never the request. */}
            {read.reusedWords.length > 0 && ` · reuses ${read.reusedWords.length} of your words`}
          </div>
          <ViewToggle view={view} onView={onView} />
        </div>
        <h1 dir={read.dir}>{text.title}</h1>
        <div className="cap">Click a sentence to focus it; click a word to have it explained — keep the ones worth learning.</div>

        {/* Words are cut by the target language's own rules, and the spaces and
            punctuation between them are rendered as-is — which is the only way a
            script that doesn't use spaces (Japanese, Chinese, Thai) can be both
            readable and tappable. */}
        <div className="passage" dir={read.dir}>
          {text.sentences.map((s, i) => (
            <span
              key={i}
              ref={(el) => {
                sentRefs.current[i] = el;
              }}
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
              {read.bilingual && read.canBilingual && (
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
          <button className="btn sm ghost" onClick={onNewPassage} disabled={read.busy}>
            New passage
          </button>
        </div>

        <div style={{ marginTop: 44 }}>
          <Hints settings={settings} surface="read" has={[read.canBilingual ? "bilingual" : "", canSave ? "save" : ""]} />
        </div>
      </div>

      <div className="notes">
        {read.notes.map((n) => (
          <button
            key={n.sentence}
            className={`note ${focusIdx === n.sentence ? "on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              read.setFocusIdx(n.sentence);
            }}
          >
            <div className="h">✳ Coach note</div>
            <div className="b">{n.body}</div>
          </button>
        ))}
        {/* A failed notes call is not a failed passage (PLAN-023): the passage
            stands, with a quiet line and a retry that asks only for notes. */}
        {read.notesFailed && (
          <div className="note quiet">
            <div className="b">Notes did not come back.</div>
            <button className="btn sm ghost" onClick={() => void read.retryNotes()} disabled={read.notesBusy}>
              {read.notesBusy ? "Asking…" : "Try notes again"}
            </button>
          </div>
        )}
      </div>
      <div />

      {focused && (
        <div className="focusbar" onClick={(e) => e.stopPropagation()}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>
            Sentence {focusIdx + 1} of {text.sentences.length}
          </div>
          {/* invariant 25: a note lives in the margin rail, never here. This bar
              keeps only what the margin lacks — the counter and the translation.
              Focusing a sentence highlights its note beside it; repeating it here
              would show the same fact twice. */}
          {read.canBilingual && <div className="en">{focused.native}</div>}
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
          {/* Understanding a word and choosing to learn it are two different acts. Only
              a word whose meaning actually came back can be filed. */}
          {popover.saved ? (
            <div className="s">✓ In Memory</div>
          ) : (
            popover.lemma && (
              <button className="save" onClick={() => void read.saveWord()}>
                + Add to Memory <span className="kbd">⏎</span>
              </button>
            )
          )}
        </div>
      )}

      {sheet}
    </div>
  );
}

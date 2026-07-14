import { useEffect, useRef, useState } from "react";
import type { Settings } from "../lib/settings";
import type { BlockKind } from "../lib/learn";
import type { Day } from "../lib/useDay";
import { tokens } from "../lib/text";
import { LENGTHS, type PassageLength } from "../lib/reading";
import { bare, type Ask, type Read as ReadState } from "../lib/useRead";

const ORDER: PassageLength[] = ["short", "medium", "long"];
const BLURB: Record<PassageLength, string> = {
  short: "a few minutes",
  medium: "a sitting",
  long: "a proper read",
};

export default function Read({
  settings,
  read,
  day,
  onBegin,
  onCaptureKeys,
}: {
  settings: Settings;
  read: ReadState;
  day: Day;
  onBegin: (kind: BlockKind) => void;
  /** The sheet takes the keyboard while it is open — Esc closes it, not the screen. */
  onCaptureKeys: (captured: boolean) => void;
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

  const sheet = asking && (
    <AskSheet settings={settings} ask={read.ask} theme={day.plan?.theme} onCancel={() => setAsking(false)} onGenerate={generate} />
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

  const { text, focusIdx, popover } = read;
  const focused = focusIdx >= 0 ? text.sentences[focusIdx] : null;

  return (
    <div className="read" onClick={() => read.closePopover()}>
      <div />
      <div className="fade">
        <div className="eyebrow">
          Generated for you · {settings.cefr} · ~{Math.max(1, Math.round(text.sentences.length / 3))} min
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
          <button
            className="btn sm"
            onClick={() => {
              void day.complete("reading");
              onBegin(day.next === "reading" ? "vocab" : (day.next ?? "vocab"));
            }}
          >
            Done reading →
          </button>
          <button className="btn sm ghost" onClick={() => void read.extend()} disabled={read.busy}>
            {read.busy ? "Writing…" : "Keep reading"}
          </button>
          <button className="btn sm ghost" onClick={() => setAsking(true)} disabled={read.busy}>
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
            ...(popover.flip
              ? { bottom: window.innerHeight - popover.y + 10 }
              : { top: popover.y + 10 }),
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

/**
 * What the passage should be, asked before it is written: how long, and what about.
 * A prompt sheet, not a settings dialog — it opens on the last answer, the topic line
 * has the caret, and Enter takes the defaults. Level is not here on purpose: that is
 * `settings.cefr`, and it is not a per-passage decision.
 */
function AskSheet({
  settings,
  ask,
  theme,
  onCancel,
  onGenerate,
}: {
  settings: Settings;
  ask: Ask;
  theme?: string;
  onCancel: () => void;
  onGenerate: (ask: Ask) => void;
}) {
  const [length, setLength] = useState<PassageLength>(ask.length);
  const [topic, setTopic] = useState(ask.topic);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  // The sheet owns every key it handles: stopping propagation is what keeps Esc from
  // reaching App and walking off the screen behind us.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      return onCancel();
    }
    if (e.key === "Enter") {
      e.stopPropagation();
      e.preventDefault(); // …and a focused length button never turns Enter into a click
      return onGenerate({ length, topic });
    }
    // Arrows rove the lengths. The topic line starts empty and holds the caret, so
    // there is nothing there for an arrow to move through — but the moment they type,
    // the arrows go back to meaning what they have always meant, and Tab reaches the
    // lengths instead.
    const caretInText = e.target === input.current && topic.length > 0;
    if (!caretInText && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.stopPropagation();
      e.preventDefault();
      const i = ORDER.indexOf(length) + (e.key === "ArrowRight" ? 1 : -1);
      setLength(ORDER[Math.min(Math.max(i, 0), ORDER.length - 1)]);
    }
  };

  return (
    <div className="scrim" onClick={onCancel}>
      <div className="palette ask" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="head">
          <div className="eyebrow">New passage</div>
          <h2>What should it be about?</h2>
        </div>
        <input
          ref={input}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={theme ? `Leave it empty for today's theme — ${theme}` : "Leave it empty and the coach picks"}
        />
        <div className="lengths">
          {ORDER.map((l) => (
            <button key={l} className={`len ${length === l ? "on" : ""}`} onClick={() => setLength(l)}>
              <div className="t">{l[0].toUpperCase() + l.slice(1)}</div>
              <div className="n">
                ~{LENGTHS[l]} sentences · {BLURB[l]}
              </div>
            </button>
          ))}
        </div>
        <div className="foot">
          <span>↵ generate</span>
          <span>← → length</span>
          <span>esc cancel</span>
          <span style={{ marginLeft: "auto" }}>
            {settings.cefr} · {settings.targetLang}
          </span>
        </div>
      </div>
    </div>
  );
}

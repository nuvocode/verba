import type { Settings } from "../lib/settings";
import type { BlockKind } from "../lib/learn";
import type { Day } from "../lib/useDay";
import { bare, type Read as ReadState } from "../lib/useRead";

export default function Read({
  settings,
  read,
  day,
  onBegin,
}: {
  settings: Settings;
  read: ReadState;
  day: Day;
  onBegin: (kind: BlockKind) => void;
}) {
  const block = day.plan?.blocks.find((b) => b.kind === "reading");

  if (!read.text)
    return (
      <div className="empty fade">
        <h2>{read.busy ? "Writing you a passage…" : "Nothing to read yet."}</h2>
        <p>
          {read.busy
            ? `A ${settings.cefr} story about ${day.plan?.theme ?? "everyday life"}, in ${settings.targetLang}.`
            : "The coach writes a story at your level that reuses the words from your conversations."}
        </p>
        {!read.busy && (
          <button className="btn" onClick={() => void read.generate({ interests: day.plan?.theme, goal: block?.goal })}>
            Generate a passage →
          </button>
        )}
        {read.error && <div className="err" style={{ maxWidth: 520, margin: "20px auto 0" }}>{read.error}</div>}
      </div>
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
        <h1>{text.title}</h1>
        <div className="cap">Click a sentence to focus it; click a word to have it explained and saved.</div>

        <div className="passage">
          {text.sentences.map((s, i) => (
            <span
              key={i}
              className={`sent ${focusIdx === i ? "on" : ""}`}
              onClick={() => read.setFocusIdx(focusIdx === i ? -1 : i)}
            >
              {s.target.split(" ").map((w, wi) => (
                <span
                  key={wi}
                  className={`w ${read.saved.includes(bare(w)) ? "saved" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void read.explain(w, s.target, e.currentTarget.getBoundingClientRect());
                  }}
                >
                  {w}
                </span>
              )).reduce((acc: any[], el, i) => (i ? [...acc, " ", el] : [el]), [])}
              {read.bilingual && <span className="en"> {s.native} </span>}{" "}
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
          <button
            className="btn sm ghost"
            onClick={() => void read.generate({ interests: day.plan?.theme, goal: block?.goal })}
            disabled={read.busy}
          >
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
            left: popover.x,
            transform: "translateX(-50%)",
            ...(popover.flip
              ? { bottom: window.innerHeight - popover.y + 10 }
              : { top: popover.y + 10 }),
          }}
        >
          <div className="t">{popover.term}</div>
          <div className="g">{popover.gloss}</div>
          {popover.gloss !== "…" && <div className="s">✓ Saved to Memory</div>}
        </div>
      )}
    </div>
  );
}

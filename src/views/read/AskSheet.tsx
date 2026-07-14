import { useEffect, useRef, useState } from "react";
import type { Settings } from "../../lib/settings";
import { LENGTHS, type PassageLength } from "../../lib/reading";
import type { Ask } from "../../lib/useRead";

const ORDER: PassageLength[] = ["short", "medium", "long"];
const BLURB: Record<PassageLength, string> = {
  short: "a few minutes",
  medium: "a sitting",
  long: "a proper read",
};

/**
 * What the passage should be, asked before it is written: how long, and what about.
 * A prompt sheet, not a settings dialog — it opens on the last answer, the topic line
 * has the caret, and Enter takes the defaults. Level is not here on purpose: that is
 * `settings.cefr`, and it is not a per-passage decision.
 */
export default function AskSheet({
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

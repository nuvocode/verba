import type { Question } from "../lib/questions";
import type { ListenOption } from "../lib/listening";

/**
 * One comprehension question — a multiple choice or a fill-in-the-blank — with its
 * after-answer state. Shared by every activity that runs the check (listening,
 * reading), so the question looks and behaves the same wherever it appears.
 *
 * Listening passes `options` as `ListenOption[]` (text + why) and `hideMiss` to
 * render its own richer miss panel (PLAN-026) below the card; reading uses the
 * built-in answer + line.
 */
export default function QuestionCard({
  q,
  value,
  result,
  dir,
  onChange,
  hideMiss = false,
}: {
  /** A shared question, or a listening question whose options carry `why` labels. */
  q: Question | (Omit<Question, "options"> & { options?: ListenOption[] });
  value: string;
  result: boolean | undefined; // undefined until the answer is checked
  dir: string;
  onChange: (v: string) => void;
  /** Suppress the built-in miss display — the caller renders its own panel. */
  hideMiss?: boolean;
}) {
  const done = result !== undefined;
  const opts = q.options as ListenOption[] | undefined;
  return (
    <div className={`listen-q ${done ? (result ? "ok" : "miss") : ""}`}>
      <div className="listen-q-prompt" dir={q.kind === "cloze" ? dir : undefined}>
        {q.prompt}
      </div>

      {q.kind === "mcq" ? (
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {opts?.map((opt) => (
            <button
              key={opt.text}
              className={`chip ${value === opt.text ? "on" : ""}`}
              disabled={done}
              onClick={() => onChange(opt.text)}
            >
              {opt.text}
            </button>
          ))}
        </div>
      ) : (
        <input
          className="listen-input"
          dir={dir}
          value={value}
          disabled={done}
          placeholder="Type the missing word…"
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {done && !result && !hideMiss && (
        <div className="listen-fix">
          <div>
            Answer: <strong dir={dir}>{q.answer}</strong>
          </div>
          {q.line && (
            <div className="listen-line" dir={dir}>
              “{q.line}”
            </div>
          )}
        </div>
      )}
      {done && result && <div className="listen-good">✓ Correct</div>}
    </div>
  );
}

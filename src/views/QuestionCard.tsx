import type { Question } from "../lib/questions";

/**
 * One comprehension question — a multiple choice or a fill-in-the-blank — with its
 * after-answer state. Shared by every activity that runs the check (listening,
 * reading), so the question looks and behaves the same wherever it appears.
 */
export default function QuestionCard({
  q,
  value,
  result,
  dir,
  onChange,
}: {
  q: Question;
  value: string;
  result: boolean | undefined; // undefined until the answer is checked
  dir: string;
  onChange: (v: string) => void;
}) {
  const done = result !== undefined;
  return (
    <div className={`listen-q ${done ? (result ? "ok" : "miss") : ""}`}>
      <div className="listen-q-prompt" dir={q.kind === "cloze" ? dir : undefined}>
        {q.prompt}
      </div>

      {q.kind === "mcq" ? (
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {q.options?.map((opt) => (
            <button
              key={opt}
              className={`chip ${value === opt ? "on" : ""}`}
              disabled={done}
              onClick={() => onChange(opt)}
            >
              {opt}
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

      {done && !result && (
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

import type { Read as ReadState } from "../../lib/useRead";
import QuestionCard from "../QuestionCard";

/**
 * The comprehension check the reader takes after finishing a passage. It owns no
 * question logic — it walks `useRead`'s check state, which runs on the shared question
 * layer (lib/questions), the same one listening uses. One question at a time; a missed
 * cloze word is already in the SRS by the time it's shown, and the score feeds the level
 * signal on the way out.
 */
export default function ReadingCheck({
  read,
  onDone,
}: {
  read: ReadState;
  /** Leave the check and go wherever the day goes next. */
  onDone: () => void;
}) {
  if (!read.check)
    return (
      <div className="empty fade">
        <h2>A couple of questions…</h2>
        <p>Checking what stuck. One moment.</p>
      </div>
    );

  const c = read.check;
  const qs = c.questions;
  const step = c.step;
  const stepChecked = c.results[step] !== undefined;
  const currentAnswered = (c.answers[step] ?? "").trim().length > 0;
  const lastStep = step >= qs.length - 1;

  return (
    <div className="listen fade">
      <div className="listen-head">
        <div className="eyebrow">Comprehension check · Question {step + 1} of {qs.length}</div>
      </div>

      <div className="listen-qs">
        <QuestionCard
          q={qs[step]}
          value={c.answers[step] ?? ""}
          result={c.results[step]}
          dir={read.dir}
          onChange={(v) => read.answerCheck(step, v)}
        />
      </div>

      {!stepChecked ? (
        <button className="btn" disabled={!currentAnswered} onClick={() => void read.gradeCheck()}>
          Check answer
        </button>
      ) : !lastStep ? (
        <button className="btn" onClick={read.nextCheckQuestion}>
          Next question →
        </button>
      ) : (
        <div className="listen-after">
          <p style={{ color: "var(--ink2)" }}>
            You got <strong>{read.checkScore.correct}</strong> of {read.checkScore.total} — that accuracy feeds your level
            signal.
          </p>
          <button
            className="btn"
            onClick={() => {
              void read.finishCheck();
              onDone();
            }}
          >
            Back to today →
          </button>
        </div>
      )}

      {!(stepChecked && lastStep) && (
        <div style={{ marginTop: 20 }}>
          <button
            className="btn ghost sm"
            onClick={() => {
              read.skipCheck();
              onDone();
            }}
          >
            Skip check
          </button>
        </div>
      )}
    </div>
  );
}

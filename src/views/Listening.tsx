import type { Settings } from "../lib/settings";
import type { BlockKind } from "../lib/learn";
import type { Day } from "../lib/useDay";
import type { Listening as ListeningState } from "../lib/useListening";
import type { Question } from "../lib/questions";

/**
 * The listening screen: a chaptered story you hear, not read, with a comprehension
 * check after each chapter. The transcript stays locked until you've answered — before
 * that, it is a listening exercise. A wrong answer opens the line it sat in.
 *
 * This is a view over one `useListening`: generation, playback and scoring all live in
 * the hook. What lives here is the empty state, the per-chapter panel, and the handoff
 * back to the day's plan.
 */
export default function Listening({
  settings,
  listening,
  day,
  onAdvance,
}: {
  settings: Settings;
  listening: ListeningState;
  day: Day;
  /** Close out the listening block and go wherever the day goes next. */
  onAdvance: (kind: BlockKind) => void;
}) {
  const block = day.plan?.blocks.find((b) => b.kind === "listening");
  const start = () => void listening.generate({ interests: day.plan?.theme, goal: block?.goal });

  if (!listening.piece)
    return (
      <div className="empty fade">
        <h2>{listening.busy ? listening.status || "Writing you a story…" : "Nothing to listen to yet."}</h2>
        <p>
          {listening.busy
            ? `A short ${settings.cefr} story in ${settings.targetLang}, in chapters — you'll hear each one, then answer what you caught.`
            : "The coach writes a short story in chapters. You hear each chapter, then answer a couple of questions about what mattered."}
        </p>
        {!listening.busy && (
          <button className="btn" onClick={start}>
            Generate a story →
          </button>
        )}
        {listening.error && <div className="err" style={{ maxWidth: 520, margin: "20px auto 0" }}>{listening.error}</div>}
      </div>
    );

  if (listening.finished)
    return (
      <div className="empty fade">
        <h2>Session complete.</h2>
        <p>
          You caught <strong>{listening.score.correct}</strong> of {listening.score.total} — that accuracy feeds your
          level signal.
        </p>
        <button className="btn" onClick={() => onAdvance("listening")}>
          Back to today →
        </button>
      </div>
    );

  const { chapter, chapterIdx, chapterCount, progress } = listening;
  if (!chapter) return null;
  const answered = chapter.questions.every((_, i) => (progress.answers[i] ?? "").trim());
  const last = chapterIdx >= chapterCount - 1;

  return (
    <div className="listen fade">
      <div className="listen-head">
        <div className="eyebrow">
          {listening.piece.title} · Chapter {chapterIdx + 1} of {chapterCount}
        </div>
        {progress.submitted && <div className="listen-title">{chapter.title}</div>}
      </div>

      {/* Playback — the whole point is hearing it, so the button is the loud thing on the screen. */}
      <div className="listen-play">
        {listening.canSpeak ? (
          listening.playing ? (
            <button className="btn ghost" onClick={listening.stop}>
              ◼ Stop
            </button>
          ) : (
            <button className="btn" onClick={() => void listening.play()}>
              ▶ {progress.submitted ? "Replay chapter" : "Play chapter"}
            </button>
          )
        ) : (
          <div className="err" style={{ maxWidth: 480 }}>
            No voice is available to play this. Turn one on in Settings → Speech — until then, the transcript below is your only way in.
          </div>
        )}
      </div>

      {/* The check. Hidden nothing extra: the questions are the exercise, the transcript stays locked. */}
      <div className="listen-qs">
        {chapter.questions.map((q, i) => (
          <QuestionCard
            key={i}
            q={q}
            value={progress.answers[i] ?? ""}
            result={progress.submitted ? progress.results[i] : undefined}
            dir={listening.dir}
            onChange={(v) => listening.setAnswer(i, v)}
          />
        ))}
        {chapter.questions.length === 0 && (
          <p style={{ color: "var(--ink2)" }}>This chapter came without questions — listen, then move on.</p>
        )}
      </div>

      {!progress.submitted ? (
        <button className="btn" disabled={!answered} onClick={() => void listening.submit()}>
          Check answers
        </button>
      ) : (
        <div className="listen-after">
          {!progress.revealed ? (
            <button className="btn ghost" onClick={listening.reveal}>
              Show transcript
            </button>
          ) : (
            <div className="listen-transcript" dir={listening.dir}>
              {chapter.lines.map((l, i) => (
                <p key={i}>
                  <span>{l.target}</span>
                  {l.native && <span className="tr-native"> — {l.native}</span>}
                </p>
              ))}
            </div>
          )}
          <button className="btn" onClick={listening.next}>
            {last ? "Finish →" : "Next chapter →"}
          </button>
        </div>
      )}
    </div>
  );
}

/** One question — a multiple choice or a fill-in-the-blank — with its after-answer state. */
function QuestionCard({
  q,
  value,
  result,
  dir,
  onChange,
}: {
  q: Question;
  value: string;
  result: boolean | undefined; // undefined until the chapter is checked
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

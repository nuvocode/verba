import type { Settings } from "../lib/settings";
import type { BlockKind } from "../lib/learn";
import type { Day } from "../lib/useDay";
import type { Listening as ListeningState } from "../lib/useListening";
import QuestionCard from "./QuestionCard";

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

  const { chapter, chapterIdx, chapterCount, progress, dir } = listening;
  if (!chapter) return null;
  const qs = chapter.questions;
  const last = chapterIdx >= chapterCount - 1;
  // With no voice the chapter can't be heard, so the gate would dead-end — let those
  // learners straight through to the questions (the transcript is their only way in).
  const gated = listening.canSpeak && !progress.heard;

  const step = progress.step;
  const stepChecked = qs.length > 0 && progress.results[step] !== undefined;
  const currentAnswered = (progress.answers[step] ?? "").trim().length > 0;
  const allChecked = qs.length === 0 || (step >= qs.length - 1 && progress.results[qs.length - 1] !== undefined);

  return (
    <div className="listen fade">
      <div className="listen-head">
        <div className="eyebrow">
          {listening.piece.title} · Chapter {chapterIdx + 1} of {chapterCount}
        </div>
        {allChecked && !gated && <div className="listen-title">{chapter.title}</div>}
      </div>

      {/* Playback — the whole point is hearing it, so it is the loud thing on the screen. */}
      <div className="listen-play">
        {!listening.canSpeak ? (
          <div className="err" style={{ maxWidth: 480 }}>
            No voice is available to play this. Turn one on in Settings → Speech — until then, the transcript is your only
            way in.
          </div>
        ) : listening.playing ? (
          <div className="speaking">
            <em>Playing chapter {chapterIdx + 1}…</em>
            <i />
            <i />
            <i />
            <i />
            <i />
            <button className="btn ghost sm" style={{ marginLeft: 14 }} onClick={listening.stop}>
              Stop
            </button>
          </div>
        ) : (
          <button className="btn" onClick={() => void listening.play()}>
            ▶ {progress.heard ? "Replay chapter" : "Play chapter"}
          </button>
        )}
      </div>

      {gated ? (
        <p className="listen-hint">The chapter is read aloud — press play. The questions appear once it has finished.</p>
      ) : qs.length === 0 ? (
        <div className="listen-after">
          <p style={{ color: "var(--ink2)" }}>This chapter came without questions — listen, then move on.</p>
          <button className="btn" onClick={listening.next}>
            {last ? "Finish →" : "Next chapter →"}
          </button>
        </div>
      ) : (
        <>
          {/* One question, one answer at a time — the check is a walk through the chapter, not a wall of it. */}
          <div className="eyebrow listen-count">
            Question {step + 1} of {qs.length}
          </div>
          <div className="listen-qs">
            <QuestionCard
              q={qs[step]}
              value={progress.answers[step] ?? ""}
              result={progress.results[step]}
              dir={dir}
              onChange={(v) => listening.setAnswer(step, v)}
            />
          </div>

          {!stepChecked ? (
            <button className="btn" disabled={!currentAnswered} onClick={() => void listening.check()}>
              Check answer
            </button>
          ) : !allChecked ? (
            <button className="btn" onClick={listening.nextQuestion}>
              Next question →
            </button>
          ) : (
            <div className="listen-after">
              {!progress.revealed ? (
                <button className="btn ghost" onClick={listening.reveal}>
                  Show transcript
                </button>
              ) : (
                <div className="listen-transcript" dir={dir}>
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
        </>
      )}
    </div>
  );
}

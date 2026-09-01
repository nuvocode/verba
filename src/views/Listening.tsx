import type { Settings } from "../lib/settings";
import type { ActivityKind, SignalDraft } from "../lib/model";
import type { Day } from "../lib/useDay";
import { listenSignals } from "../lib/signals";
import type { Listening as ListeningState } from "../lib/useListening";
import QuestionCard from "./QuestionCard";
import Hints from "./Hints";
import { Generating, Nothing, Failed } from "./States";

/** Seconds → "1:23"; the bar's ticks need a stable, short readout. */
function fmtTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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
  /** Close out the listening activity and go wherever the day goes next. */
  onAdvance: (kind: ActivityKind, signals?: SignalDraft[]) => void;
}) {
  const block = day.plan?.activities.find((b) => b.kind === "listen");
  const start = () => void listening.generate({ interests: day.plan?.theme, goal: block?.goal });

  // The four content states (§3.2): loading renders Generating (status names the
  // chapter), an absent piece renders Nothing, a failed generation renders Failed.
  // The four content states (§3.2): loading renders Generating (status names the
  // chapter), an absent piece renders Nothing, a failed generation renders Failed.
  if (!listening.piece)
    return (
      <div className="empty fade">
        {/* surface listen: loading */}
        {listening.busy && (
          <Generating
            what="Writing you a story…"
            eta="Three or four short chapters, each one a couple of sentences you'll hear twice."
            step={listening.status || undefined}
          />
        )}

        {!listening.busy && listening.error && (
          /* surface listen: error */
          <Failed say={listening.error} retry={{ label: "Try again", onClick: start }} />
        )}

        {!listening.busy && !listening.error && (
          /* surface listen: empty */
          <Nothing why="The coach writes a short story in chapters. You hear each chapter, then answer a couple of questions about what mattered." action={{ label: "Generate a story", onClick: start }} />
        )}
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
        <button
          className="btn"
          onClick={() => onAdvance("listen", block ? listenSignals(block.id, listening.graded) : [])}
        >
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

      {/* Playback — the whole point is hearing it, so it is the loud thing on the screen.
          On a seekable voice the transport is a real timeline (play/pause, back-10s, a
          position bar and speed); on the OS-voice tier it is play/pause and a note saying
          why there is no more — a control that cannot work is not shown. */}
      <div className="listen-play">
        {!listening.canSpeak ? (
          <div className="err" style={{ maxWidth: 480 }}>
            No voice is available to play this. Turn one on in Settings → Speech and listening — until then, the transcript is your only
            way in.
          </div>
        ) : listening.preparing ? (
          <div className="speaking">
            <em>Preparing chapter {chapterIdx + 1}…</em>
            <i />
            <i />
            <i />
            <i />
            <i />
            <span className="model" style={{ color: "var(--ink3)", marginLeft: 10 }}>
              {listening.prepText}
            </span>
          </div>
        ) : listening.seekable ? (
          <div className="listen-transport">
            <div className="listen-row">
              <button className="btn" onClick={listening.toggle}>
                {listening.playing ? "Pause" : "▶ Play"}
              </button>
              <button className="btn ghost sm" onClick={listening.back10} disabled={!listening.playing}>
                ⟲ 10s
              </button>
              <div className="listen-rate" role="group" aria-label="Playback speed">
                {[0.75, 1, 1.25].map((r) => (
                  <button
                    key={r}
                    className={listening.rate === r ? "active" : ""}
                    onClick={() => listening.setRate(r)}
                  >
                    {r === 1 ? "1×" : `${r}×`}
                  </button>
                ))}
              </div>
            </div>
            <div className="listen-row">
              <input
                className="listen-bar"
                type="range"
                min={0}
                max={listening.duration || 1}
                step={0.1}
                value={Math.min(listening.position, listening.duration || 1)}
                onChange={(e) => listening.seekTo(Number(e.target.value))}
              />
              <span className="listen-time">
                {fmtTime(listening.position)} / {fmtTime(listening.duration)}
              </span>
            </div>
          </div>
        ) : (
          <div className="listen-transport">
            <div className="listen-row">
              <button className="btn" onClick={listening.toggle}>
                {listening.playing ? "Pause" : "▶ Play"}
              </button>
              {listening.playing && (
                <button className="btn ghost sm" onClick={listening.stop}>
                  Stop
                </button>
              )}
            </div>
            {/* No fake bar: this voice can't be scrubbed, so there is nothing to draw — the
                control that cannot work is simply absent (§3.3). */}
            <p className="listen-note">
              This voice can't be scrubbed. Switch to a downloaded voice in Settings → Speech for the full controls.
            </p>
          </div>
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
            <>
              <button className="btn" disabled={!currentAnswered} onClick={() => void listening.check()}>
                Check answer
              </button>
              {/* Not a silent disabled (#42): the question is unanswered, so there is nothing to check yet. */}
              {!currentAnswered && (
                <span className="model" style={{ color: "var(--ink3)", marginLeft: 8 }}>
                  Answer the question first
                </span>
              )}
            </>
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

      {/* Listening is a media surface: Space plays and stops the chapter. The label
          says what it does — "stop", not "pause", because the surface stops (§6). */}
      <Hints settings={settings} surface="listening" has={[listening.playing ? "playing" : "idle"]} />
    </div>
  );
}

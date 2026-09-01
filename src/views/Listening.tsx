import type { Settings } from "../lib/settings";
import type { ActivityKind, SignalDraft } from "../lib/model";
import type { Day } from "../lib/useDay";
import { listenSignals } from "../lib/signals";
import type { Listening as ListeningState } from "../lib/useListening";
import { shuffledOptions, type ListenQuestion } from "../lib/listening";
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

/** One line explaining why the chosen option was wrong, from its `why`. */
function whyText(why: string): string {
  switch (why) {
    case "wrongSubject":
      return "That happened, but to someone else — not the person the question asks about.";
    case "wrongTense":
      return "That is the right thing, but at the wrong time — the question is about a different moment.";
    case "irrelevantDetail":
      return "That is true, but it does not answer the question — it is a detail that does not decide the outcome.";
    default:
      return "";
  }
}

/**
 * The listening screen: a chaptered story you hear, not read, with a comprehension
 * check after each chapter. The transcript toggles from the start of a chapter,
 * closed by default; opening it marks that chapter's comprehension signals assisted
 * (recorded, never scored). A wrong answer explains the right one and replays the
 * line it came from.
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

  if (listening.finished) {
    // The end-of-session line reports accuracy and, where any chapter was assisted,
    // says so as a plain fact beside it — no warning, no colour, no count.
    const assisted = listening.graded.some((g) => g.assisted);
    return (
      <div className="empty fade">
        <h2>Session complete.</h2>
        <p>
          You caught <strong>{listening.score.correct}</strong> of {listening.score.total} — that accuracy feeds your
          level signal.
          {assisted && " You had the transcript open for part of it."}
        </p>
        <button
          className="btn"
          onClick={() => onAdvance("listen", block ? listenSignals(block.id, listening.graded) : [])}
        >
          Back to today →
        </button>
      </div>
    );
  }

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

  // The question in front of the learner, with its options shuffled deterministically
  // per question so the correct one is not always first.
  const q: ListenQuestion | undefined = qs[step];
  const shownOptions = q ? shuffledOptions(q) : [];
  const chosen = progress.answers[step] ?? "";
  const chosenWhy = q?.options?.find((o) => o.text === chosen)?.why;

  return (
    <div className="listen fade">
      {/* head — the chapter's place in the piece, the primary progress element */}
      <div className="listen-head">
        <div className="eyebrow">
          {listening.piece.title} · Chapter {chapterIdx + 1} of {chapterCount}
        </div>
        {allChecked && !gated && <div className="listen-title">{chapter.title}</div>}
      </div>

      {/* player — the transport, vertically centred in its row. The transcript
          toggle lives here, one labelled key, available from the start of a chapter. */}
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
              <span className="spacer" />
              <button
                className={`btn ghost sm ${progress.revealed ? "active" : ""}`}
                onClick={listening.reveal}
                title="Show or hide the transcript (T)"
              >
                {progress.revealed ? "Transcript on" : "Transcript off"}
              </button>
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
              <span className="spacer" />
              <button
                className={`btn ghost sm ${progress.revealed ? "active" : ""}`}
                onClick={listening.reveal}
                title="Show or hide the transcript (T)"
              >
                {progress.revealed ? "Transcript on" : "Transcript off"}
              </button>
            </div>
            {/* No fake bar: this voice can't be scrubbed, so there is nothing to draw — the
                control that cannot work is simply absent (§3.3). */}
            <p className="listen-note">
              This voice can't be scrubbed. Switch to a downloaded voice in Settings → Speech for the full controls.
            </p>
          </div>
        )}
      </div>

      {/* work — the question block, growing into the space rather than the page
          ending halfway down. The transcript, when open, sits here too. */}
      <div className="listen-work">
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
              {q && (
                <QuestionCard
                  q={{ ...q, options: shownOptions }}
                  value={chosen}
                  result={progress.results[step]}
                  dir={dir}
                  hideMiss
                  onChange={(v) => listening.setAnswer(step, v)}
                />
              )}
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
                <button className="btn" onClick={listening.next}>
                  {last ? "Finish →" : "Next chapter →"}
                </button>
              </div>
            )}

            {/* The miss panel (PLAN-026): the right answer, why the chosen one was
                wrong, a replay of the line it came from, and the source line only if
                the transcript is open. A closed transcript is not opened by a miss —
                that is the learner's choice, not the app's. */}
            {stepChecked && progress.results[step] === false && q && (
              <div className="listen-miss">
                <div className="listen-fix">
                  <div>
                    Answer: <strong dir={dir}>{q.answer}</strong>
                  </div>
                  {chosenWhy && chosenWhy !== "correct" && (
                    <div className="listen-why">{whyText(chosenWhy)}</div>
                  )}
                </div>
                <button className="btn ghost sm" onClick={() => listening.replayRange(q.lineIdx)}>
                  ⟲ Replay that part
                </button>
                {progress.revealed && q.line && (
                  <div className="listen-line" dir={dir}>
                    “{q.line}”
                  </div>
                )}
              </div>
            )}

            {/* The transcript, when open — available from the start of a chapter. */}
            {progress.revealed && (
              <div className="listen-transcript" dir={dir}>
                {chapter.lines.map((l, i) => (
                  <p key={i}>
                    <span>{l.target}</span>
                    {l.native && <span className="tr-native"> — {l.native}</span>}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Listening is a media surface: Space plays and stops the chapter. The label
          says what it does — "stop", not "pause", because the surface stops (§6). */}
      <Hints
        settings={settings}
        surface="listening"
        has={[
          listening.playing ? "playing" : "idle",
          ...(stepChecked && progress.results[step] === false ? ["replay"] : []),
        ]}
      />
    </div>
  );
}


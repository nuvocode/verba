import { useEffect, useRef, useState } from "react";
import type { Settings } from "../lib/settings";
import type { BlockKind } from "../lib/learn";
import type { Day } from "../lib/useDay";
import type { Talk as TalkState } from "../lib/useTalk";
import { listSessions, sessionMessages, type SessionRow } from "../lib/db";
import Face from "./talk/Face";

// Where the reflection sends them, named by what the plan has next. The wording is the
// day's, not this screen's — Talk never decides that reading (or anything) comes after.
const CONTINUE: Record<BlockKind, string> = {
  conversation: "Continue to the conversation →",
  reading: "Continue to reading →",
  scenario: "Continue to the role-play →",
  vocab: "Continue to your words →",
  listening: "Continue to listening →",
  summary: "Wrap up the day →",
};

export default function Talk({
  settings,
  talk,
  day,
  onAdvance,
}: {
  settings: Settings;
  talk: TalkState;
  day: Day;
  /** Close out a talking block and go wherever the day goes next — the plan decides. */
  onAdvance: (kind: BlockKind) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState<SessionRow[]>([]);
  const [open, setOpen] = useState<SessionRow | null>(null);
  const [transcript, setTranscript] = useState<{ role: string; content: string }[]>([]);

  // The picker is also the archive — reload it whenever we come back to it.
  useEffect(() => {
    if (!talk.started) void listSessions().then(setPast).catch(() => {});
  }, [talk.started, talk.reflection]);

  useEffect(() => {
    if (open) void sessionMessages(open.id).then(setTranscript).catch(() => setTranscript([]));
  }, [open]);

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
    // `streaming` is in here so a reply that outgrows the viewport as it arrives
    // keeps its last line in view, rather than scrolling once it has finished.
  }, [talk.msgs.length, talk.busy, talk.streaming]);

  // Which of the day's talking blocks this conversation closes out. Matched on the scenario
  // actually being practised — the plan's role-play names one, the conversation block is
  // "free" — so finishing the role-play can't tick the conversation off in its place. A
  // scenario the plan never asked for still closes whatever talking block is outstanding.
  const talking = (day.plan?.blocks ?? []).filter((b) => b.kind === "conversation" || b.kind === "scenario");
  const closes =
    talking.find((b) => b.scenarioId === talk.scenario?.id)?.kind ??
    talking.find((b) => !day.isDone(b.kind))?.kind ??
    null;

  // A finished conversation closes out that block even if the learner walks away from the
  // reflection without pressing anything.
  useEffect(() => {
    if (talk.reflection && closes && !day.isDone(closes)) void day.complete(closes);
  }, [talk.reflection]);

  // What the plan hands them next. Computed by skipping `closes` rather than reading
  // `day.next`, so the button is right on the reflection's first paint — before the effect
  // above has landed in state — and after it.
  const upNext = (day.plan?.blocks ?? []).find((b) => b.kind !== closes && !day.isDone(b.kind))?.kind ?? null;

  // ---- replaying an old conversation ----
  if (!talk.started && open)
    return (
      <div className="refl">
        <div className="eyebrow">
          {new Date(open.started_at).toLocaleString()} · {talk.scenarioById(open.scenario).title}
        </div>
        <h1 className="display">Looking back.</h1>

        {open.summary && (
          <div className="lede" style={{ maxWidth: 600, marginBottom: 40 }}>
            <div className="bullet" />
            <p style={{ fontSize: 17, fontStyle: "italic" }}>{open.summary}</p>
          </div>
        )}

        {transcript.map((m, i) => (
          <div className={`msg ${m.role === "user" ? "user" : "ai"}`} key={i}>
            <div className="who">{m.role === "user" ? "YOU" : "COACH"}</div>
            <div className="text">{m.content}</div>
          </div>
        ))}

        <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
          <button className="btn sm" onClick={() => void talk.start(talk.scenarioById(open.scenario))}>
            Practise this again →
          </button>
          <button className="btn sm ghost" onClick={() => setOpen(null)}>
            Back to scenarios
          </button>
        </div>
      </div>
    );

  // ---- no conversation open yet: pick a scenario ----
  if (!talk.started)
    return (
      <div className="today fade">
        <div className="eyebrow">Talk · {settings.targetLang}</div>
        <h1 className="display" style={{ fontSize: 40, margin: "12px 0 10px" }}>
          What are we practising?
        </h1>
        <p style={{ fontSize: 14, color: "var(--ink2)", maxWidth: 560, lineHeight: 1.6, marginBottom: 40 }}>
          The coach plays the other side. Speak or type — corrections are collected as you go and handed back at the
          end, so you never lose the thread mid-sentence.
        </p>
        <div className="grid3">
          {talk.scenarios.map((sc) => (
            <button key={sc.id} className="pick" onClick={() => void talk.start(sc)}>
              <div className="big">
                {sc.emoji} {sc.title}
              </div>
              <div className="small">{sc.level ? `${sc.level[0]}–${sc.level[1]}` : "any level"}</div>
            </button>
          ))}
        </div>
        {talk.error && <div className="err">{talk.error}</div>}

        {past.length > 0 && (
          <>
            <div className="eyebrow" style={{ margin: "48px 0 14px" }}>
              Past conversations
            </div>
            <div className="spine">
              {past.map((s) => {
                const sc = talk.scenarioById(s.scenario);
                return (
                  <button className="spine-item" key={s.id} onClick={() => setOpen(s)}>
                    <div style={{ flex: 1 }}>
                      {/* Sessions from before titles existed — and any whose title call
                          failed — still answer to their scenario's name. */}
                      <div className="title">
                        {sc.emoji} {s.title || sc.title}
                      </div>
                      <div className="meta">{s.summary ?? "no summary — ended early"}</div>
                    </div>
                    <div className="st">{new Date(s.started_at).toLocaleDateString()}</div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );

  // ---- reflection ----
  if (talk.reflecting) {
    const r = talk.reflection;
    return (
      <div className="refl">
        <div className="eyebrow">Reflection · {talk.scenario?.title}</div>
        <h1 className="display">{talk.busy ? "Looking back…" : "That went well."}</h1>

        {talk.error && <div className="err">{talk.error}</div>}

        {!r && talk.busy && <p style={{ color: "var(--ink3)" }}>Capturing vocabulary and writing your summary…</p>}

        {r && (
          <>
            <div className="stats">
              <div>
                <b>{r.turns}</b>
                <span>turns spoken</span>
              </div>
              <div>
                <b>{r.corrections.length}</b>
                <span>things to revisit</span>
              </div>
              <div>
                <b>{r.words.length}</b>
                <span>words captured</span>
              </div>
              <div>
                <b>
                  {talk.confidence}
                  {talk.confDelta > 0 && <i style={{ fontSize: 15, color: "var(--good)" }}> +{talk.confDelta}</i>}
                </b>
                <span>confidence</span>
              </div>
            </div>

            {r.corrections.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginBottom: 16 }}>
                  Worth revisiting
                </div>
                <div style={{ marginBottom: 36 }}>
                  {r.corrections.map((c, i) => (
                    <div className="fix-row" key={i}>
                      <span className={`d ${c.severity === "severe" ? "severe" : ""}`} />
                      <div style={{ flex: 1 }}>
                        <div className="l">
                          <s>{c.original}</s> → <b>{c.fixed}</b>
                        </div>
                        {c.note && <div className="n">{c.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {r.words.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginBottom: 14 }}>
                  Kept in memory · drop the ones you already know
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 40 }}>
                  {r.words.map((w) => (
                    <div className="wchip" key={w.term}>
                      {w.term} <span>— {w.translation}</span>
                      <button className="x" title="Remove from Memory" onClick={() => void talk.dropWord(w.term)}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {r.summary && (
              <div className="lede" style={{ maxWidth: 600, marginBottom: 40 }}>
                <div className="bullet" />
                <p style={{ fontSize: 17, fontStyle: "italic" }}>{r.summary}</p>
              </div>
            )}

            {r.focus.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginBottom: 14 }}>
                  Focus next
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 40 }}>
                  {r.focus.map((f) => (
                    <div className="chip" key={f} style={{ cursor: "default" }}>
                      {f}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          {closes && (
            <button className="btn sm" onClick={() => onAdvance(closes)}>
              {upNext ? CONTINUE[upNext] : "Back to today →"}
            </button>
          )}
          <button className="btn sm ghost" onClick={talk.exitReflection}>
            Back to the conversation
          </button>
          <button className="btn sm ghost" onClick={talk.reset}>
            New scenario
          </button>
        </div>
      </div>
    );
  }

  // ---- live conversation ----
  const goals = talk.scenario?.goals ?? [];

  return (
    <div className="talk">
      <div className="talk-grid">
        <div className="stream">
          <div className="stream-scroll" ref={scroll}>
            <div className="stream-inner">
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                Scenario · {settings.cefr}
              </div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 30, fontWeight: 500, marginBottom: 34 }}>
                {talk.scenario?.title}
              </div>

              {talk.msgs.map((m, i) => (
                <div className={`msg ${m.role}`} key={i}>
                  <div className="who">{m.role === "ai" ? (m.isAsk ? "COACH · ASIDE" : "COACH") : "YOU"}</div>
                  {/* A ⌘K aside is answered in the learner's own language, so it
                      keeps the app's direction; everything else is target text. */}
                  <div className="text" dir={m.isAsk ? undefined : talk.dir}>
                    {m.text}
                  </div>

                  {m.inline &&
                    m.corrections.map((c, j) => (
                      <div className="corr" key={j}>
                        <div className="star">✳</div>
                        <div className="body">
                          <b>{c.fixed}</b> — {c.note}
                        </div>
                      </div>
                    ))}
                  {!m.inline && m.corrections.length > 0 && (
                    <div className="noted">
                      <i />
                      noted — we'll revisit after the session
                    </div>
                  )}
                </div>
              ))}

              {/* The reply as it lands. It carries no corrections yet — those
                  arrive with the rest of the turn, and this bubble is replaced
                  by the real message the moment they do. */}
              {talk.streaming && (
                <div className="msg ai">
                  <div className="who">COACH</div>
                  <div className="text" dir={talk.dir}>
                    {talk.streaming}
                  </div>
                </div>
              )}

              {talk.busy && !talk.streaming && <div className="typing">…</div>}
              {talk.error && <div className="err">{talk.error}</div>}
              {/* A degraded turn, not a broken one — the conversation kept going. The
                  fix is always one panel away, so say where. */}
              {talk.notice && (
                <div className="err" style={{ borderColor: "var(--ink3)", color: "var(--ink3)" }}>
                  {talk.notice} <a href="#settings/speech">Speech settings</a>
                </div>
              )}
            </div>
          </div>

          <div className="composer">
            <div className="bar">
              <div className="wrap">
                <input
                  dir={talk.dir}
                  value={talk.input}
                  onChange={(e) => talk.setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void talk.send(talk.input);
                    // The composer is the whole screen — Esc ends the session rather than
                    // just leaving the box (App blurs first for every other input).
                    if (e.key === "Escape" && !talk.busy) {
                      e.stopPropagation();
                      void talk.end();
                    }
                  }}
                  placeholder={`Answer in ${settings.targetLang}…`}
                  autoFocus
                />
                {talk.listening && (
                  <div className="listening">
                    <em>{talk.micPhase === "transcribing" ? "Transcribing…" : "Listening… (click ◉ when done)"}</em>
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                )}
              </div>
              <button
                className={`mic ${talk.listening ? "on" : ""}`}
                onClick={() => void talk.mic()}
                title="Speak instead of typing"
              >
                ◉
              </button>
              <button className="send" onClick={() => void talk.send(talk.input)} disabled={talk.busy || !talk.input.trim()}>
                Send
              </button>
            </div>
            {settings.showHints && (
              <div style={{ maxWidth: 640, margin: "10px auto 0", fontSize: 11, color: "var(--ink3)" }}>
                Type freely, press <span style={{ fontFamily: "var(--mono)" }}>1–3</span> to use a suggestion, or click ◉
                to speak. <span style={{ fontFamily: "var(--mono)" }}>Esc</span> to end the session.
              </div>
            )}
          </div>
        </div>

        <div className="rail">
          {/* The face reacts to what the session is already doing — every one of
              these is a count or a flag useTalk keeps anyway. See talk/face/. */}
          <Face
            typing={talk.input.trim() !== ""}
            corrections={talk.msgs.reduce((n, m) => n + m.corrections.length, 0)}
            goalsHit={Math.min(talk.userTurns, goals.length)}
            goalsTotal={goals.length}
          />

          {goals.length > 0 && (
            <>
              <div className="lbl">Scenario goals</div>
              <div style={{ marginBottom: 30 }}>
                {goals.map((g, i) => {
                  // ponytail: goals tick off by turn count. Real per-goal detection
                  // needs another model call per turn — not worth it for a side rail.
                  const hit = talk.userTurns > i;
                  return (
                    <div className={`goal ${hit ? "hit" : ""}`} key={g}>
                      <span className="mk">{hit ? "✓" : "○"}</span>
                      <span>{g}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {talk.suggestions.length > 0 && (
            <>
              <div className="lbl">If you're stuck</div>
              <div style={{ marginBottom: 30 }}>
                {talk.suggestions.map((s, i) => (
                  <button className="sugg" key={i} onClick={() => void talk.send(s, true)}>
                    <span className="k">{i + 1}</span>
                    <span className="t">{s}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="lbl">Confidence</div>
          <div className="conf">
            <b>{talk.confidence}</b>
            {talk.confDelta > 0 && <i>+{talk.confDelta}</i>}
          </div>
          <div className="meter" style={{ marginBottom: 8 }}>
            <div style={{ width: `${talk.confidence}%` }} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.5 }}>
            How steadily you're producing language without help. Not a score — a signal.
          </div>

          <button
            className="btn sm ghost"
            style={{ marginTop: 30, width: "100%", justifyContent: "center" }}
            onClick={() => void talk.end()}
            disabled={talk.busy}
          >
            End session → reflection
          </button>
        </div>
      </div>
    </div>
  );
}

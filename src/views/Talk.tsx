import { useEffect, useRef, useState } from "react";
import type { Settings } from "../lib/settings";
import { levelOf } from "../lib/model";
import type { ActivityKind } from "../lib/model";
import type { Day } from "../lib/useDay";
import type { Talk as TalkState } from "../lib/useTalk";
import { talkSignals } from "../lib/signals";
import { getPack } from "../lib/packs";
import type { RehearsalBrief } from "../lib/rehearsal";
import { sessionGroups, sessionMessages, addVocab, type SessionDay, type SessionRow } from "../lib/db";
import { when } from "../lib/fmt";
import type { CorrectionCategory } from "../lib/prompts";
import {
  bandSplit,
  duplicateScenario,
  removeImportedScenario,
  saveScenario,
  scenarioRegistry,
  type Scenario,
} from "../lib/scenarios";
import Face from "./talk/Face";
import Hints from "./Hints";
import { Generating, Nothing, Failed, Unusable } from "./States";
import { linkish } from "./settings/parts";

// The reflection groups corrections by category, in this fixed order, with a
// count per group. An empty group is not rendered. The set is Talk's own schema
// (PLAN-020) — Read defines its own and the two never share a type.
const CORRECTION_GROUPS: { category: CorrectionCategory; label: string }[] = [
  { category: "grammar", label: "Grammar" },
  { category: "vocabulary", label: "Vocabulary" },
  { category: "wordOrder", label: "Word order" },
  { category: "register", label: "Register" },
  { category: "pronunciation", label: "Pronunciation" },
];

// Where the reflection sends them, named by what the plan has next. The wording is the
// day's, not this screen's — Talk never decides that reading (or anything) comes after.
const CONTINUE: Record<ActivityKind, string> = {
  talk: "Continue to the conversation →",
  read: "Continue to reading →",
  roleplay: "Continue to the role-play →",
  memory: "Continue to your words →",
  listen: "Continue to listening →",
  wrapup: "Wrap up the day →",
};

export default function Talk({
  settings,
  talk,
  day,
  onAdvance,
  onChange,
  rehearsalDraft = false,
  onCloseRehearsalDraft,
}: {
  settings: Settings;
  talk: TalkState;
  day: Day;
  /** Close out a talking activity and go wherever the day goes next — the plan decides. */
  onAdvance: (kind: ActivityKind) => void;
  /** The one door settings are written through — the subtitles toggle uses it. */
  onChange: (patch: Partial<Settings>) => void;
  /** PLAN-034: the rehearsal brief form is open (⌘K / Today's overflow asked for it). */
  rehearsalDraft?: boolean;
  /** Close the brief form without starting. */
  onCloseRehearsalDraft?: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [past, setPast] = useState<SessionDay[]>([]);
  const [open, setOpen] = useState<SessionRow | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [transcript, setTranscript] = useState<{ role: string; content: string }[]>([]);
  // The rehearsal brief (PLAN-034): three short questions, one screen. Free text,
  // no list of scenarios to pick from — the conversation the learner needs is not
  // in our catalogue. Held here, and handed to `startRehearsal` in one go.
  const [brief, setBrief] = useState<RehearsalBrief>({ who: "", about: "", formality: "neutral" });
  // Which coach lines the learner has revealed while subtitles are off (PLAN-021).
  // A revealed line shows its text; the rest show the "Coach spoke · Show this
  // line" bar. Reset when a new conversation starts.
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  // The inline edit panel over the picker grid — the same pattern Settings uses,
  // no route, no modal library. `editing` is the scenario being edited; null is
  // the closed panel. `confirming` is the id of the scenario awaiting a delete.
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [, bump] = useState(0); // scenarios live in localStorage — re-read after a change

  // The picker is also the archive — reload it whenever we come back to it.
  useEffect(() => {
    if (!talk.started) void sessionGroups().then(setPast).catch(() => {});
  }, [talk.started, talk.reflection]);

  useEffect(() => {
    if (open) void sessionMessages(open.id).then(setTranscript).catch(() => setTranscript([]));
  }, [open]);

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: "smooth" });
    // `streaming` is in here so a reply that outgrows the viewport as it arrives
    // keeps its last line in view, rather than scrolling once it has finished.
  }, [talk.msgs.length, talk.busy, talk.streaming]);

  // A new conversation opens with the curtain closed (PLAN-021): the reveal set
  // is per-session, so starting or resuming a scenario resets it. The picker
  // (started false) and the live conversation (started true) both land here.
  useEffect(() => {
    setRevealed(new Set());
  }, [talk.started]);

  // The streaming bubble's reveal is keyed to -1. When the stream empties — the
  // turn lands and the bubble is replaced by the real message — that reveal must
  // not linger, or the next streamed reply would start already shown. Each
  // streamed bubble carries its own curtain.
  useEffect(() => {
    if (talk.streaming) return;
    setRevealed((s) => {
      if (!s.has(-1)) return s;
      const next = new Set(s);
      next.delete(-1);
      return next;
    });
  }, [talk.streaming]);

  // The draft lands in the box focused, cursor at the end — the learner edits it
  // in place rather than hunting for the caret. Fires when the final text drops
  // (the mic leaves "recording"), not on every keystroke.
  useEffect(() => {
    if (talk.micPhase === "" && talk.input) {
      inputRef.current?.focus();
      const el = inputRef.current;
      if (el) {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    }
  }, [talk.micPhase, talk.input]);

  // Which of the day's talking blocks this conversation closes out. Matched on the scenario
  // actually being practised — the plan's role-play names one, the conversation block is
  // "free" — so finishing the role-play can't tick the conversation off in its place. A
  // scenario the plan never asked for still closes whatever talking block is outstanding.
  const talking = (day.plan?.activities ?? []).filter((b) => b.kind === "talk" || b.kind === "roleplay");
  const closes =
    talking.find((b) => b.scenarioId === talk.scenario?.id)?.kind ??
    talking.find((b) => !day.isDone(b.kind))?.kind ??
    null;

  // A finished conversation closes out that block even if the learner walks away from the
  // reflection without pressing anything — and hands over what it observed on the way out.
  // No activity to hang them on means no signals: an invented ActivityId would quietly
  // cut the evidence loose from the plan that produced it.
  const closing = (day.plan?.activities ?? []).find((b) => b.kind === closes);
  useEffect(() => {
    if (talk.reflection && closes && !day.isDone(closes))
      void day.complete(closes, closing ? talkSignals(closing.id, talk.reflection, getPack(settings.packId)?.speech.locale ?? "en") : []);
  }, [talk.reflection]);

  // What the plan hands them next. Computed by skipping `closes` rather than reading
  // `day.next`, so the button is right on the reflection's first paint — before the effect
  // above has landed in state — and after it.
  const upNext = (day.plan?.activities ?? []).find((b) => b.kind !== closes && !day.isDone(b.kind))?.kind ?? null;

  // ---- replaying an old conversation ----
  if (!talk.started && open)
    return (
      <div className="refl">
        <div className="eyebrow">
          {when(open.started_at, undefined, undefined, true)} · {talk.scenarioById(open.scenario).title}
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
  if (!talk.started) {
    const registry = scenarioRegistry();
    const byId = new Map(registry.map((r) => [r.scenario.id, r.origin]));
    const { main, easier } = bandSplit(talk.scenarios, levelOf(settings.profile));

    // The rehearsal brief (PLAN-034): one screen, three questions. `who` is the
    // only one that is required — "a customer at work" is enough to build a
    // person; the rest refine.
    if (rehearsalDraft) {
      const canStart = brief.who.trim().length > 0;
      return (
        <div className="today fade">
          <div className="eyebrow">Rehearsal · {settings.profile.targetLanguage}</div>
          <Nothing
            title="What do you have to walk into?"
            why="The coach plays the other side — in role, no corrections — and then steps out to talk it through. Name the person and the moment."
          />
          <div style={{ maxWidth: 640 }}>
            <div className="row2">
              <div className="k">Who are you talking to?</div>
              <input
                autoFocus
                value={brief.who}
                onChange={(e) => setBrief((b) => ({ ...b, who: e.target.value }))}
                placeholder="my landlord"
              />
            </div>
            <div className="row2">
              <div className="k">About what?</div>
              <input
                value={brief.about}
                onChange={(e) => setBrief((b) => ({ ...b, about: e.target.value }))}
                placeholder="the boiler that has not been fixed"
              />
            </div>
            <div className="row2">
              <div className="k">How will you speak?</div>
              <div style={{ display: "flex", gap: 8 }}>
                {(["casual", "neutral", "formal"] as const).map((f) => (
                  <button key={f} className={`chip ${brief.formality === f ? "" : "ghost"}`} onClick={() => setBrief((b) => ({ ...b, formality: f }))}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
            <button className="btn sm" disabled={!canStart || talk.busy} onClick={() => { onCloseRehearsalDraft?.(); void talk.startRehearsal(brief); }}>
              Begin the rehearsal →
            </button>
            <button className="btn sm ghost" onClick={onCloseRehearsalDraft}>
              Back to scenarios
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="today fade">
        <div className="eyebrow">Talk · {settings.profile.targetLanguage}</div>
        {/* surface talk: empty — the picker *is* the empty state. It says what it
            is in `Nothing`'s own headline and then offers the grid below. */}
        <Nothing
          title="What are we practising?"
          why="The coach plays the other side. Pick a scenario — speak or type, and corrections are collected as you go and handed back at the end."
        />
        {talk.error && (
          /* surface talk: error */
          <Failed say={talk.error} retry={{ label: "Try again", onClick: () => talk.scenarios[0] && void talk.start(talk.scenarios[0]) }} />
        )}

        {editing && (
          <ScenarioEditor
            scenario={editing}
            onSave={(next) => {
              saveScenario(next);
              setEditing(null);
              bump((n) => n + 1);
            }}
            onCancel={() => setEditing(null)}
          />
        )}

        <div className="grid3">
          {main.map((sc) => (
            <div className="pick-wrap" key={sc.id}>
              <button className="pick" onClick={() => void talk.start(sc)}>
                <div className="big">
                  {sc.emoji} {sc.title}
                </div>
                <div className="small">{sc.level ? `${sc.level[0]}–${sc.level[1]}` : "any level"}</div>
              </button>
              {byId.get(sc.id) === "imported" && (
                <span className="tag" title="Added by you — nobody reviewed it">
                  yours
                </span>
              )}
              {byId.get(sc.id) === "imported" && (
                <div className="pick-actions">
                  <button className="model" style={linkish} onClick={() => setEditing(sc)}>
                    Edit
                  </button>
                  <button
                    className="model"
                    style={linkish}
                    onClick={() => {
                      // A duplicate of a bundled scenario is an import — it is
                      // saved to the same key, and the bundled original is left
                      // untouched. It shows up in the picker like any other.
                      saveScenario(duplicateScenario(sc));
                      bump((n) => n + 1);
                    }}
                  >
                    Duplicate
                  </button>
                  {confirming === sc.id ? (
                    <span className="pick-confirm">
                      <button className="model" style={linkish} onClick={() => { removeImportedScenario(sc.id); setConfirming(null); bump((n) => n + 1); }}>
                        Delete
                      </button>
                      <button className="model" style={linkish} onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button className="model" style={linkish} onClick={() => setConfirming(sc.id)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {easier.length > 0 && (
          <details className="setup" style={{ marginTop: 20 }}>
            <summary>Easier — below your level</summary>
            <div className="grid3" style={{ marginTop: 12 }}>
              {easier.map((sc) => (
                <div className="pick-wrap" key={sc.id}>
                  <button className="pick" onClick={() => void talk.start(sc)}>
                    <div className="big">
                      {sc.emoji} {sc.title}
                    </div>
                    <div className="small">{sc.level ? `${sc.level[0]}–${sc.level[1]}` : "any level"}</div>
                  </button>
                  {byId.get(sc.id) === "imported" && (
                    <span className="tag" title="Added by you — nobody reviewed it">
                      yours
                    </span>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {past.length > 0 && (
          <>
            <div className="eyebrow" style={{ margin: "48px 0 14px" }}>
              Past conversations
            </div>
            <div className="spine">
              {past.map((day) => (
                <div key={day.day} style={{ marginBottom: 8 }}>
                  <div className="meta" style={{ fontSize: 12, color: "var(--ink3)", margin: "10px 0 4px" }}>
                    {when(day.at)}
                  </div>
                  {day.groups.map((g) => {
                    const sc = talk.scenarioById(g.scenarioId);
                    const key = `${day.day}:${g.scenarioId}`;
                    const isOpen = expanded.has(key);
                    return (
                      <div key={key}>
                        <button
                          className="spine-item"
                          onClick={() => {
                            if (g.count > 1) {
                              setExpanded((s) => {
                                const next = new Set(s);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              });
                            } else {
                              setOpen(g.sessions[0]);
                            }
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div className="title">
                              {sc.emoji} {g.title}
                              {g.count > 1 && <span style={{ color: "var(--ink3)", fontSize: 12 }}> · {g.count} sessions</span>}
                            </div>
                            <div className="meta">{g.sessions[0].summary ?? "no summary — ended early"}</div>
                          </div>
                          <div className="st">{when(g.lastAt)}</div>
                        </button>
                        {isOpen &&
                          g.sessions.map((s) => (
                            <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0 4px 20px" }}>
                              <button className="linky" style={{ fontSize: 13 }} onClick={() => setOpen(s)}>
                                {when(s.started_at)}
                              </button>
                              <button className="linky" style={{ fontSize: 13 }} onClick={() => void talk.resume(s.id)}>
                                Resume
                              </button>
                              <button className="linky" style={{ fontSize: 13 }} onClick={() => void talk.start(sc)}>
                                Restart
                              </button>
                            </div>
                          ))}
                        {g.count === 1 && (
                          <div style={{ display: "flex", gap: 8, padding: "4px 0 4px 20px" }}>
                            <button className="linky" style={{ fontSize: 13 }} onClick={() => void talk.resume(g.sessions[0].id)}>
                              Resume
                            </button>
                            <button className="linky" style={{ fontSize: 13 }} onClick={() => void talk.start(sc)}>
                              Restart
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ---- reflection ----
  if (talk.reflecting) {
    const r = talk.reflection;
    return (
      <div className="refl">
        <div className="eyebrow">Reflection · {talk.scenario?.title}</div>
        {/* surface talk: loading — the summary is content the model is still
            writing; it gets Generating's shape until the reflection lands. */}
        {!r && talk.busy && (
          <Generating
            what="Looking back…"
            eta="About 10 seconds — it is capturing your vocabulary and writing your summary."
          />
        )}

        {!r && !talk.busy && (
          <h1 className="display">
            {talk.scenario?.title} · {when(Date.now())}
          </h1>
        )}

        {talk.error && (
          /* surface talk: error */
          <Failed say={talk.error} retry={{ label: "Keep the conversation", onClick: talk.exitReflection }} />
        )}

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
              {/* PLAN-016's rule: a value that cannot be computed is not displayed.
                  Confidence is null until MEASURES_AT turns exist — render nothing. */}
              {talk.confidence && (
                <div>
                  <b>{talk.confidence.value}</b>
                  <span>confidence</span>
                </div>
              )}
            </div>

            {/* The goal scorecard (PLAN-017's goalState, rendered). Each goal, its
                final state, and one line of total — a missed goal is stated, not
                scolded (same copy gate as PLAN-019). */}
            {talk.goalState.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginBottom: 16 }}>
                  Goals
                </div>
                <div style={{ marginBottom: 36 }}>
                  {talk.goalState.map((st, i) => {
                    const g = talk.scenario?.goals?.[i];
                    if (!g) return null;
                    const mark = st === "met" ? "✓" : st === "missed" ? "✗" : "○";
                    return (
                      <div className={`goal ${st}`} key={i}>
                        <span className="mk">{mark}</span>
                        <span>{g}</span>
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 10, fontSize: 13, color: "var(--ink3)" }}>
                    {talk.goalState.filter((s) => s === "met").length} of {talk.goalState.length} met
                  </div>
                </div>
              </>
            )}

            {r.corrections.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginBottom: 16 }}>
                  Worth revisiting
                </div>
                <div style={{ marginBottom: 36 }}>
                  {/* Corrections are grouped by category, in a fixed order, with a
                      count per group. An empty group is not rendered — the count is
                      the group's headline, so a learner sees what there is to work
                      on and how much of it. */}
                  {CORRECTION_GROUPS.map(({ category, label }) => {
                    const group = r.corrections.filter((c) => c.category === category);
                    if (group.length === 0) return null;
                    return (
                      <div key={category} style={{ marginBottom: 22 }}>
                        <div className="meta" style={{ fontSize: 12, color: "var(--ink3)", margin: "0 0 8px" }}>
                          {label} · {group.length}
                        </div>
                        {group.map((c, i) => (
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
                    );
                  })}
                </div>
              </>
            )}

            {r.words.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginBottom: 14 }}>
                  Words to keep · drop the ones you already know, then keep the rest
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  {r.words.map((w) => (
                    <div className="wchip" key={w.term}>
                      {w.term} <span>— {w.translation}</span>
                      <button className="x" title="Remove from Memory" onClick={() => void talk.dropWord(w.term)}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button className="btn sm" onClick={() => void talk.keepWords(r.words.map((w) => w.term))}>
                  Keep these {r.words.length} →
                </button>
              </>
            )}

            {/* A failed summary renders Unusable (PLAN-020): the write-up didn't
                come back, everything else is saved, and regenerate is offered. */}
            {!r.summary && (
              <div className="empty fade" style={{ textAlign: "left", marginBottom: 40 }}>
                {/* surface talk: unusable — the reflection's summary came back
                    unusable, so the write-up is turned away and regenerate is
                    the way out. Everything else from the session is saved. */}
                <Unusable
                  what="The write-up didn't come back. Everything else from this session is saved."
                  regenerate={{ label: "Try the write-up again", onClick: () => void talk.regenerateSummary() }}
                />
              </div>
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
  // What the coach has said in the scenario, in order. The face reads the count
  // (the first one is the greeting) and the last line (for the marks a pleased
  // coach uses). ⌘K asides are left out: they are the coach stepping out of the
  // roleplay, and a smile belongs to the conversation, not to a footnote.
  const coachSaid = talk.msgs.filter((m) => m.role === "ai" && !m.isAsk).map((m) => m.text);

  return (
    <div className="talk">
      <div className="talk-grid">
        <div className="stream">
          <div className="stream-scroll" ref={scroll}>
            <div className="stream-inner">
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                {talk.rehearsal ? "Rehearsal" : "Scenario"} · {levelOf(settings.profile)}
              </div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 30, fontWeight: 500, marginBottom: 34 }}>
                {talk.scenario?.title}
              </div>

              {/* The brief, at the top of the session (PLAN-034): a learner
                  returning to a half-finished rehearsal knows what they were
                  preparing for. Shown once, above the conversation, never repeated
                  per turn. */}
              {talk.rehearsal && (
                <div style={{ marginBottom: 30, fontSize: 13, color: "var(--ink3)" }}>
                  Rehearsing with <b style={{ color: "var(--ink)" }}>{talk.rehearsal.brief.who}</b>
                  {talk.rehearsal.brief.about.trim() ? <> about {talk.rehearsal.brief.about}</> : null} · {talk.rehearsal.brief.formality}
                </div>
              )}

              {/* The debrief (PLAN-034): its own block, after the coach steps out.
                  "stuck" names real turns; the phrases are offered to Memory
                  through the existing vocab save path — the learner chooses,
                  nothing is auto-saved. */}
              {talk.rehearsal && talk.outOfRole && (
                <div className="debrief fade" style={{ borderLeft: "2px solid var(--line)", paddingLeft: 18, marginBottom: 30 }}>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>
                    Out of role · how it went
                  </div>
                  {talk.debrief?.stuck.map((st) => (
                    <div key={st.turn} style={{ marginBottom: 10, fontSize: 15 }}>
                      <div className="meta" style={{ color: "var(--ink3)", fontSize: 12 }}>
                        turn {st.turn + 1}
                      </div>
                      <div>{st.moment}</div>
                      {st.why && <div style={{ fontSize: 13, color: "var(--ink3)" }}>{st.why}</div>}
                    </div>
                  ))}
                  {talk.debrief && talk.debrief.stuck.length === 0 && (
                    <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 10 }}>
                      No moment where you ran aground — the rehearsal went through.
                    </div>
                  )}
                  {talk.debrief && talk.debrief.phrases.length > 0 && (
                    <>
                      <div className="meta" style={{ color: "var(--ink3)", fontSize: 12, margin: "16px 0 8px" }}>
                        Phrases that would have helped · tap to keep the ones you want
                      </div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {talk.debrief.phrases.map((p) => (
                          <div className="wchip" key={p}>
                            {p}
                            <button
                              className="x add"
                              title="Keep in Memory"
                              onClick={() => {
                                // The existing vocab save path — the learner chooses;
                                // nothing is auto-saved. The debrief's own "why" for the
                                // turn it came from is the closest meaning on file; a
                                // phrase without one carries itself.
                                const from = talk.debrief?.stuck.find((st) => st.moment.includes(p));
                                void addVocab(
                                  settings.profile.targetLanguage,
                                  { term: p, translation: from?.why || p, example: "", type: "phrase", levelBand: null },
                                  { capturedBy: "learner", surface: "talk", learnerLevel: levelOf(settings.profile) },
                                  "kept",
                                ).catch(() => {});
                              }}
                            >
                              +
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {talk.busy && !talk.debrief && <div className="typing">…</div>}
                </div>
              )}

              {talk.msgs.map((m, i) => (
                <div className={`msg ${m.role}`} key={i}>
                  <div className="who">{m.role === "ai" ? (m.isAsk ? "COACH · ASIDE" : "COACH") : "YOU"}</div>
                  {/* A ⌘K aside is answered in the learner's own language, so it
                      keeps the app's direction; everything else is target text. */}
                  {m.role === "ai" && !m.isAsk && !settings.subtitles && !revealed.has(i) ? (
                    /* Subtitles off (PLAN-021): the coach's line is a curtain, not
                        a mode. The learner's own messages, the composer, corrections,
                        suggestions, persona and goals are never hidden — only the
                        coach's text is. Revealing is free: recorded, never scored. */
                    <button
                      className="reveal-bar"
                      onClick={() => {
                        setRevealed((s) => new Set(s).add(i));
                        talk.reveal("line");
                      }}
                    >
                      Coach spoke · Show this line
                    </button>
                  ) : (
                    <div className="text" dir={m.isAsk ? undefined : talk.dir}>
                      {m.text}
                    </div>
                  )}

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
                  {/* Praise (PLAN-032): the sentence that survived praiseGate,
                      rendered beside the reply. A dropped praise never reaches
                      the screen — the field is absent, and the reply stands on
                      its own without it. It is the coach's own text in the target
                      language, so it sits inside PLAN-021's curtain: with
                      subtitles off it stays hidden until the line is revealed,
                      and it is spoken either way. */}
                  {m.praise && (settings.subtitles || revealed.has(i)) && (
                    <div className="praise" dir={talk.dir}>
                      {m.praise}
                    </div>
                  )}
                </div>
              ))}

              {/* The rewind (PLAN-030): a distinguishable pause, not a warning.
                  One grouped block with a quiet left rule and more vertical space
                  than a normal turn. No colour outside the neutral ramp, no
                  number, no text that blames the learner. */}
              {talk.rewindExchange && (
                <div className="rewind">
                  <div className="rewind-own">{talk.rewindExchange.own}</div>
                  <div className="rewind-repeat" dir={talk.dir}>
                    {talk.rewindExchange.repeat}
                  </div>
                  {talk.rewindExchange.unpack && (
                    <div className="rewind-unpack">
                      {talk.rewindExchange.unpack.parts.length > 0 && (
                        <div className="rewind-parts">
                          {talk.rewindExchange.unpack.parts.map((p, i) => (
                            <span key={i}>{p}</span>
                          ))}
                        </div>
                      )}
                      {talk.rewindExchange.unpack.keyWord && talk.rewindExchange.unpack.gloss && (
                        <div className="rewind-gloss">
                          <b>{talk.rewindExchange.unpack.keyWord}</b> — {talk.rewindExchange.unpack.gloss}
                        </div>
                      )}
                    </div>
                  )}
                  {talk.rewindExchange.gift && <div className="rewind-gift">{talk.rewindExchange.gift}</div>}
                  <button className="rewind-deny" onClick={talk.denyRewind}>
                    No, I understood
                  </button>
                </div>
              )}

              {/* The reply as it lands. It carries no corrections yet — those
                  arrive with the rest of the turn, and this bubble is replaced
                  by the real message the moment they do. */}
              {talk.streaming && (
                <div className="msg ai">
                  <div className="who">COACH</div>
                  {settings.subtitles || revealed.has(-1) ? (
                    <div className="text" dir={talk.dir}>
                      {talk.streaming}
                    </div>
                  ) : (
                    /* The streaming bubble is the coach's text too — hidden the
                        same way, with the same free reveal. Its curtain is keyed
                        to -1, and it is dropped the moment the stream empties, so
                        the next streamed reply starts closed again. */
                    <button
                      className="reveal-bar"
                      onClick={() => {
                        setRevealed((s) => new Set(s).add(-1));
                        talk.reveal("line");
                      }}
                    >
                      Coach spoke · Show this line
                    </button>
                  )}
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

          {/* Subtitles off (PLAN-021): the global reveal. One press shows every
              coach line at once — the same free action as "Show this line", never
              a penalty. It only appears while there is something hidden to show. */}
          {!settings.subtitles && (
            <button
              className="reveal-all"
              onClick={() => {
                setRevealed((s) => {
                  const next = new Set(s);
                  talk.msgs.forEach((m, i) => {
                    if (m.role === "ai" && !m.isAsk) next.add(i);
                  });
                  next.add(-1); // the streaming bubble
                  return next;
                });
                talk.reveal("all");
              }}
            >
              Show all
            </button>
          )}

          <div className="composer">
            <div className="bar">
              <div className="wrap">
                <input
                  ref={inputRef}
                  dir={talk.dir}
                  value={talk.input}
                  onChange={(e) => {
                    // Typing during a recording stops it — the learner is taking
                    // the box back, and the mic must not fight for it.
                    if (talk.micPhase === "recording") void talk.mic();
                    talk.setInput(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void talk.send(talk.input);
                    // The composer is the whole screen — Esc ends the session rather than
                    // just leaving the box (App blurs first for every other input).
                    if (e.key === "Escape" && !talk.busy) {
                      e.stopPropagation();
                      void talk.end();
                    }
                  }}
                  placeholder={`Answer in ${settings.profile.targetLanguage}…`}
                  autoFocus
                />
                {/* The transcribing box covers the input only while the clip is in
                    flight. During recording the box stays open — the meter below is
                    the recording's sign, and the learner can still see their draft. */}
                {talk.micPhase === "transcribing" && (
                  <div className="listening">
                    <em>Transcribing…</em>
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
              {/* Subtitles (PLAN-021): the live control, permanently visible beside
                  the mic. A labelled toggle, not a bare icon — the same fact as the
                  Settings → Learning row, one home each. Toggling writes the setting
                  immediately. */}
              <button
                className="subtitles-toggle"
                onClick={() => onChange({ subtitles: !settings.subtitles })}
                title="Show or hide the coach's text"
              >
                Subtitles {settings.subtitles ? "on" : "off"}
              </button>
              {/* Both disabled reasons are covered, not silent (#42): the label
                  says the in-flight one, this line says the empty-box one. */}
              {!talk.busy && !talk.input.trim() && (
                <span className="model" style={{ color: "var(--ink3)", fontSize: 11, marginRight: 8 }}>
                  type a line first
                </span>
              )}
              <button className="send" onClick={() => void talk.send(talk.input)} disabled={talk.busy || !talk.input.trim()}>
                {talk.busy ? "Sending…" : "Send"}
              </button>
            </div>
            {/* The live level meter while the mic is open — the recording is real,
                and the bar says so. It gets its own class (no width transition):
                the confidence meter below eases its bar, but a live level meter
                that lags behind the voice reads as a broken one. */}
            {talk.micPhase === "recording" && (
              <div className="meter live" style={{ margin: "8px auto 0", maxWidth: 640, height: 4 }}>
                <div style={{ width: `${Math.round(talk.micLevel * 100)}%` }} />
              </div>
            )}
            <div style={{ maxWidth: 640, margin: "10px auto 0", fontSize: 11, color: "var(--ink3)" }}>
              <Hints
                settings={settings}
                surface="talk"
                // 1–3 are announced only while there is something to pick with them.
                // While the coach is waiting (PLAN-032) nothing is announced — the
                // screen is exactly what it was when the coach finished speaking.
                has={talk.suggestions.length > 0 && !talk.reflecting && !talk.waiting ? ["suggestions"] : []}
              />
              {settings.showHints && (
                <span style={{ marginLeft: 22 }}>
                  {talk.micPhase === "recording" && talk.partials ? (
                    "speak — the text appears as you go"
                  ) : (
                    <>
                      or click <span style={{ fontFamily: "var(--mono)" }}>◉</span> to speak
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rail">
          {/* The face reacts to what the session is already doing — every one of
              these is a count or a flag useTalk keeps anyway. See talk/face/.
              Goals are deliberately not among them: a goal is a real signal now
              (the coach reports it), but the face's smiles are earned by the
              opening, a pleased emoji, and confidence — not by a checklist. */}
          <Face
            typing={talk.input.trim() !== ""}
            mic={talk.micPhase === "recording"}
            waiting={talk.busy}
            corrections={talk.msgs.reduce((n, m) => n + m.corrections.length, 0)}
            confidence={talk.confidence?.value}
            coachTurns={coachSaid.length}
            coachSaid={coachSaid[coachSaid.length - 1] ?? ""}
            personaEmoji={talk.persona?.emoji}
            personaName={talk.persona?.name}
          />

          {goals.length > 0 && (
            <>
              <div className="lbl">Scenario goals</div>
              <div style={{ marginBottom: 30 }}>
                {goals.map((g, i) => {
                  const st = talk.goalState[i] ?? "pending";
                  const mark = st === "met" ? "✓" : st === "missed" ? "✗" : "○";
                  const label = st === "met" ? "met" : st === "missed" ? "missed" : "pending";
                  return (
                    <div className={`goal ${st}`} key={g}>
                      <span className="mk" title={label}>
                        {mark}
                      </span>
                      <span>{g}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Suggestions (PLAN-032): while the coach is waiting, nothing renders —
              the screen is exactly what it was when the coach finished speaking.
              The array stays as it is (it is data, and PLAN-021's reveal machinery
              reads it); only the render is gated on `waiting`. Suggestions appear
              when the wait expires, or at once when the learner has already started
              typing or holding the mic (input ends the wait). */}
          {talk.suggestions.length > 0 && !talk.waiting && (
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
          {talk.confidence ? (
            <>
              <div className="conf">
                <b>{talk.confidence.value}</b>
              </div>
              <div className="meter" style={{ marginBottom: 8 }}>
                <div style={{ width: `${talk.confidence.value}%` }} />
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.5 }}>
                Your unprompted-production rate over {talk.confidence.turns} turns. A signal, not a score.
              </div>
            </>
          ) : (
            <>
              <div className="conf">
                <b>—</b>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.5 }}>
                Measuring. Three turns in, this starts reporting.
              </div>
            </>
          )}

          {/* PLAN-034: in role, the learner decides when it is over — one control,
              and the rail's own button says exactly what it does. Once out of role
              the session still ends as any other, straight into the reflection. */}
          {talk.rehearsal && !talk.outOfRole ? (
            <button
              className="btn sm ghost"
              style={{ marginTop: 30, width: "100%", justifyContent: "center" }}
              onClick={() => void talk.endRole()}
              disabled={talk.busy || talk.msgs.filter((m) => m.role === "user" && !m.isAsk).length === 0}
            >
              Okay, out of role — debrief
            </button>
          ) : (
            <button
              className="btn sm ghost"
              style={{ marginTop: 30, width: "100%", justifyContent: "center" }}
              onClick={() => void talk.end()}
              disabled={talk.busy}
            >
              End session → reflection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The inline edit form over the picker grid — the same pattern Settings uses,
 * no route, no modal library. Edits title, emoji, setup, goals (max 5), band and
 * persona; saving writes the edited copy over the original via `saveScenario`.
 * A bundled scenario is never edited in place — the caller duplicates it first.
 */
function ScenarioEditor({
  scenario,
  onSave,
  onCancel,
}: {
  scenario: Scenario;
  onSave: (next: Scenario) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(scenario.title);
  const [emoji, setEmoji] = useState(scenario.emoji);
  const [setup, setSetup] = useState(scenario.setup);
  const [goals, setGoals] = useState<string[]>((scenario.goals ?? []).slice(0, 5));
  const [level, setLevel] = useState<[string, string] | undefined>(scenario.level);
  const [name, setName] = useState(scenario.persona.name);
  const [role, setRole] = useState(scenario.persona.role);
  const [pEmoji, setPEmoji] = useState(scenario.persona.emoji);
  const [voiceHint, setVoiceHint] = useState(scenario.persona.voiceHint ?? "");
  const [err, setErr] = useState("");

  const setGoal = (i: number, v: string) => setGoals((g) => g.map((x, j) => (j === i ? v : x)));
  const addGoal = () => setGoals((g) => (g.length < 5 ? [...g, ""] : g));
  const dropGoal = (i: number) => setGoals((g) => g.filter((_, j) => j !== i));

  const save = () => {
    const trimmed = goals.map((g) => g.trim()).filter(Boolean);
    if (!title.trim() || !setup.trim() || !name.trim() || !role.trim() || !pEmoji.trim()) {
      setErr("Title, setup, and the persona's name, role and emoji are all required.");
      return;
    }
    if (trimmed.length > 5) {
      setErr("A scenario can have at most 5 goals.");
      return;
    }
    onSave({
      ...scenario,
      title: title.trim(),
      emoji: emoji.trim() || "💬",
      setup: setup.trim(),
      goals: trimmed.length ? trimmed : undefined,
      level,
      persona: { name: name.trim(), role: role.trim(), emoji: pEmoji.trim(), voiceHint: voiceHint.trim() || undefined },
    });
  };

  return (
    <div className="scenario-editor" style={{ border: "1px solid var(--line)", borderRadius: 11, padding: 18, marginBottom: 20 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        Edit scenario
      </div>
      <div className="field">
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>Emoji</label>
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} />
      </div>
      <div className="field">
        <label>Setup</label>
        <textarea value={setup} onChange={(e) => setSetup(e.target.value)} />
      </div>
      <div className="field">
        <label>Goals (max 5)</label>
        {goals.map((g, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input value={g} onChange={(e) => setGoal(i, e.target.value)} placeholder={`Goal ${i + 1}`} />
            <button className="model" style={linkish} onClick={() => dropGoal(i)}>
              remove
            </button>
          </div>
        ))}
        {goals.length < 5 && (
          <button className="model" style={linkish} onClick={addGoal}>
            + add goal
          </button>
        )}
      </div>
      <div className="field">
        <label>Band (min–max, e.g. A2–B2)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={level?.[0] ?? ""}
            onChange={(e) => setLevel((l) => [e.target.value.toUpperCase(), l?.[1] ?? ""])}
            placeholder="min"
          />
          <input
            value={level?.[1] ?? ""}
            onChange={(e) => setLevel((l) => [l?.[0] ?? "", e.target.value.toUpperCase()])}
            placeholder="max"
          />
        </div>
      </div>
      <div className="field">
        <label>Persona — name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Persona — role</label>
        <input value={role} onChange={(e) => setRole(e.target.value)} />
      </div>
      <div className="field">
        <label>Persona — emoji</label>
        <input value={pEmoji} onChange={(e) => setPEmoji(e.target.value)} />
      </div>
      <div className="field">
        <label>Persona — voice hint (optional)</label>
        <input value={voiceHint} onChange={(e) => setVoiceHint(e.target.value)} />
      </div>
      {err && <div className="err">{err}</div>}
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <button className="btn sm" onClick={save}>
          Save →
        </button>
        <button className="btn sm ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

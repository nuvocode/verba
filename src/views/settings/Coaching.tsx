// Settings → Coaching (spec §7.4). The rows that shape how the coach teaches —
// when corrections appear, how long it waits, its voice, whether it may rewind —
// and the two rows that control the fluency layer's measurement: the switch that
// stops it, and the action that deletes what it has measured.
//
// The four rows that moved here from Learning are a move, not a redesign: their
// markup is byte-for-byte what Learning rendered, so a diff that also rewrote
// them would be a diff that cannot be reviewed.
import { useEffect, useState } from "react";
import { type CoachStyle, type CorrectionTiming, type Patience } from "../../lib/settings";
import { countMonitorSignals, deleteMonitorSignals } from "../../lib/db";
import { linkish, ToggleRow, type SectionProps } from "./parts";

/**
 * The three answers to "how long should the coach wait before offering", each
 * with a sketch of what it looks like. What differs between them is *how much
 * extra room* the coach gives on top of the learner's own average — so the
 * sketch shows the room, not a fixed number of seconds.
 */
const PATIENCE: [Patience, string, string][] = [
  [
    "quick",
    "Quick",
    "The coach offers after barely longer than your own average pause.",
  ],
  [
    "normal",
    "Normal",
    "The coach waits noticeably longer than your own average pause before offering.",
  ],
  [
    "patient",
    "Patient",
    "The coach gives you a long beat before offering — the most room to think.",
  ],
];

/**
 * The three answers to "how should the coach speak to me" (PLAN-033 §6.4). What
 * differs is the voice, not the content — `direct` means fewer softeners, never
 * harder material. The sketch shows the tone without a sentence in any one
 * language, which would be wrong for every learner not studying that one.
 */
const STYLES: [CoachStyle, string, string][] = [
  ["warm", "Warm", "Friendly, supportive, and unhurried — the default."],
  ["neutral", "Neutral", "A steady, plain tone — neither effusive nor clipped."],
  ["direct", "Direct", "Fewer softeners, no padding — says what it means plainly."],
];

/**
 * The three answers to "when do I want correcting", each with a sketch of what
 * it looks like. What differs between them is *timing*, not wording, so the
 * sketch shows the timing — and shows it without a sentence in any one language,
 * which would be wrong for every learner not studying that one.
 */
const TIMINGS: [CorrectionTiming, string, string, string][] = [
  [
    "adaptive",
    "Adaptive",
    "Interrupt only for mistakes that break meaning; the rest wait for the reflection.",
    "your last sentence ✎ shown now — it changed what you meant · a small slip waits for the end",
  ],
  [
    "live",
    "Live",
    "Show every correction the moment it happens.",
    "your last sentence ✎ shown now — and so is the next one, and the one after",
  ],
  [
    "delayed",
    "Delayed",
    "Never interrupt. Everything is handed back at the end of the session.",
    "your last sentence — nothing now · every note together when the session ends",
  ],
];

export default function Coaching({ settings, onChange }: SectionProps) {
  // The count of monitor records for this language, read before the delete asks
  // (PLAN-039 §7.4). `null` until it has loaded — a confirm that guesses a count
  // is a confirm that can lie.
  const [monitorCount, setMonitorCount] = useState<number | null>(null);
  // The delete's own dialog, open — holding what is about to be lost, counted.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let live = true;
    void countMonitorSignals(settings.profile.targetLanguage)
      .then((n) => live && setMonitorCount(n))
      .catch(() => live && setMonitorCount(0)); // no DB (browser dev server) reads as nothing recorded
    return () => {
      live = false;
    };
  }, [settings.profile.targetLanguage]);

  /** The delete, once the learner has confirmed it. */
  const doDelete = async () => {
    await deleteMonitorSignals(settings.profile.targetLanguage).catch(() => {});
    setMonitorCount(0);
    setConfirmingDelete(false);
  };

  return (
    <>
      <div className="sec">Coaching</div>
      <div data-setting="coaching">
        {TIMINGS.map(([id, name, desc, sketch]) => (
          <button key={id} className="srow" onClick={() => onChange({ correctionTiming: id })}>
            <div className={`radio ${settings.correctionTiming === id ? "on" : ""}`} />
            <div style={{ flex: 1 }}>
              <div className="name">{name}</div>
              <div className="desc">{desc}</div>
              {/* What it looks like, so the choice can be understood without trying it. */}
              <div
                className="desc"
                style={{ marginTop: 6, padding: "7px 10px", background: "var(--accent-soft)", borderRadius: 7, maxWidth: 440 }}
              >
                {sketch}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="sec" style={{ marginTop: 44 }}>Patience</div>
      <div data-setting="patience">
        {PATIENCE.map(([id, name, desc]) => (
          <button key={id} className="srow" onClick={() => onChange({ patience: id })}>
            <div className={`radio ${settings.patience === id ? "on" : ""}`} />
            <div style={{ flex: 1 }}>
              <div className="name">{name}</div>
              <div className="desc">{desc}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="sec" style={{ marginTop: 44 }}>Coach's voice</div>
      <div data-setting="coach-style">
        {STYLES.map(([id, name, desc]) => (
          <button key={id} className="srow" onClick={() => onChange({ coachStyle: id })}>
            <div className={`radio ${settings.coachStyle === id ? "on" : ""}`} />
            <div style={{ flex: 1 }}>
              <div className="name">{name}</div>
              <div className="desc">{desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* PLAN-037, §10 row 5: the learner says rewinds bother them. A standing
          preference — it stops the interruption, never the measurement. It feeds
          the same SessionBudget.off gate PLAN-031's ease() sets, so there is one
          door, not two. */}
      <div className="sec" style={{ marginTop: 44 }}>Rewinds</div>
      <div data-setting="rewinds">
        <ToggleRow
          title="Let the coach rewind"
          desc="When you miss something, the coach stops, owns the pace, and says the same line again, slower. Turn this off if the interruption bothers you — you'll still be measured, just never interrupted."
          on={settings.rewinds}
          onClick={() => onChange({ rewinds: !settings.rewinds })}
        />
      </div>

      {/* PLAN-039, §7.4: the fluency layer's off switch. Off stops the measuring,
          not the display — no `sessionContext` signal is written, and every later
          plan gates its own writer on this same field. Past data is removed by
          the action below, never by this switch alone. */}
      <div className="sec" style={{ marginTop: 44 }}>Measure what slows you down</div>
      <div data-setting="monitor-load">
        <ToggleRow
          title="Measure what slows you down"
          desc="Time your pauses and self-corrections while you speak. Everything is worked out on this computer and stays here. Off stops the measuring, not just the showing."
          on={settings.monitorLoad}
          onClick={() => onChange({ monitorLoad: !settings.monitorLoad })}
        />
      </div>

      {/* PLAN-039, §7.4: the delete action. Destructive, so it follows the house
          pattern the two existing ones set (delete-everything, forget-everything):
          it says what would be lost, with a count, before it does anything. */}
      <div className="sec" style={{ marginTop: 44 }}>Delete what has been measured</div>
      <div data-setting="monitor-data">
        <button
          className="model"
          style={linkish}
          onClick={() => setConfirmingDelete(true)}
          disabled={monitorCount === 0}
        >
          {monitorCount === null
            ? "Counting…"
            : monitorCount === 0
              ? "Nothing measured yet"
              : `Delete ${monitorCount} timing and self-correction record${monitorCount === 1 ? "" : "s"}`}
        </button>
      </div>

      {confirmingDelete && (
        <div className="scrim" onClick={() => setConfirmingDelete(false)}>
          <div className="palette confirm" onClick={(e) => e.stopPropagation()}>
            <h2>Delete what has been measured?</h2>
            <p>
              This removes <strong>{monitorCount ?? 0} timing and self-correction record{monitorCount === 1 ? "" : "s"}</strong> for{" "}
              {settings.profile.targetLanguage}. Your conversations, words and corrections are untouched.
            </p>
            <p>It cannot be undone.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn sm ghost" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
              <button className="btn sm" autoFocus onClick={() => void doDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

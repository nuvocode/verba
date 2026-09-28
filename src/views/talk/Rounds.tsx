// The 4/3/2 card (§5.2, PLAN-044 §2): shown after round 3, three rounds side by
// side. Two measured numbers per round — words per minute (`speechRate`) and
// words per run (`meanLengthOfRun`) — and the accuracy row is gated on
// `FALSE_ALARM_ON_SCREEN`: the `falseAlarmRepair` metric is withheld — PLAN-041's
// hand sample found it reliable on one model and not another — so the card says
// the third claim is the one it cannot show yet rather than inventing it.
//
// A round whose `timing` signal is missing — nothing spoken, no envelope —
// renders **empty, not zero**: an unmeasured round did not score nothing, it was
// not measured. Every number carries its unit and its definition (invariant 12).
import { FALSE_ALARM_ON_SCREEN, FOUR_THREE_TWO_MINUTES } from "../../lib/fluency";
import type { RoundTiming } from "../../lib/fluency";

/**
 * The 4/3/2 side-by-side card. Takes the three rounds' timing measurements (one
 * per round, or `null` when that round was not measured) and renders them as
 * rows. The expected result is stated as what the exercise is testing, not as
 * what happened: speed up, pause less, and accuracy does not fall.
 */
export default function Rounds({
  rounds,
  onClose,
}: {
  /** The three rounds, in order. `null` means the round was not measured — nothing spoken, no envelope. */
  rounds: (RoundTiming | null)[];
  /** Dismiss the card — a finished exercise stays until the learner closes it. */
  onClose: () => void;
}) {
  return (
    <div className="today fade">
      <div className="eyebrow">4/3/2 · three rounds, one topic</div>
      <h2 className="display">The same story, told three times.</h2>
      <p style={{ color: "var(--ink3)", fontStyle: "italic" }}>What this tests: speed up, pause less, and accuracy does not fall.</p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24 }}>
        <thead>
          <tr>
            <th style={th}> </th>
            {[0, 1, 2].map((i) => (
              <th key={i} style={th}>
                Round {i + 1} · {FOUR_THREE_TWO_MINUTES[i]} min
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={td}>words per minute</td>
            {rounds.map((r, i) => (
              <td key={i} style={td}>
                {r ? `${Math.round(r.speechRate)}` : "—"}
              </td>
            ))}
          </tr>
          <tr>
            <td style={td}>words per run</td>
            {rounds.map((r, i) => (
              <td key={i} style={td}>
                {r ? `${Math.round(r.meanLengthOfRun)}` : "—"}
              </td>
            ))}
          </tr>
          <tr>
            <td style={td}>accuracy</td>
            {rounds.map((_, i) => (
              <td key={i} style={td}>
                {FALSE_ALARM_ON_SCREEN ? "–" : "withheld"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p style={{ color: "var(--ink3)", fontSize: 12, marginTop: 8 }}>
        words per minute = words over the round's speaking length, pauses included · words per run = mean words between pauses over 250 ms · a “—” round was not measured, not zero.
      </p>
      {!FALSE_ALARM_ON_SCREEN && (
        <p style={{ color: "var(--ink3)", fontStyle: "italic", marginTop: 12 }}>
          The accuracy row is withheld for now — it is not yet reliable enough to show.
        </p>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
        <button className="btn sm ghost" onClick={onClose}>
          Back to scenarios
        </button>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--line)" };
const td: React.CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" };

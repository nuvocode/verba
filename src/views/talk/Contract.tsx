// The fluency contract (PLAN-043 §7, §4.1): one screen, one paragraph, one
// button. It is the *only* way into fluency mode — `fluencyContext` is called
// from this file and nowhere else (ledger row 6 pins that by source scan), so
// the mode is unreachable without the contract, and there is no "don't show
// this again", no settings row, no persisted key (ledger row 5).
//
// The screen is built last, after the seven rules of §4.2 are true, because it
// is a promise and a promise that cannot yet be kept must not be rendered.
//
// §4.1's English rendering: "For the next five minutes, mistakes are free. I
// won't stop you, I won't correct you, and nothing on this screen will turn
// red. At the end I'll say at most three things. The goal isn't to speak
// correctly — it's to keep speaking."
import { fluencyContext, CONTRACT_TEXT, FLUENCY_MINUTES } from "../../lib/fluency";
import type { MonitorContext } from "../../lib/fluency";
import { Nothing } from "../States";

/**
 * The contract screen. It is bound to the scenario the learner picked with the
 * fluency mode armed, and `onStart` hands that scenario's session the one
 * fluency context — built here, by the only caller — starting the mode. Accepting
 * is the single path to `fluencyContext`; a screen cannot be skipped because no
 * other code builds the mode.
 */
export default function Contract({
  scenarioTitle,
  scenarioEmoji,
  onCancel,
  onStart,
}: {
  /** The scenario the fluency session will run on — the contract sits over the picker. */
  scenarioTitle: string;
  scenarioEmoji: string;
  onCancel: () => void;
  /** Accept the contract and start the mode: the only path to `fluencyContext`. */
  onStart: (ctx: MonitorContext) => void;
}) {
  return (
    <div className="today fade">
      <div className="eyebrow">Fluency mode · {FLUENCY_MINUTES} minutes</div>
      <Nothing
        title={`${scenarioEmoji} ${scenarioTitle}`}
        why={CONTRACT_TEXT}
      />
      <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
        <button className="btn sm" onClick={() => onStart(fluencyContext())}>
          I understand — begin →
        </button>
        <button className="btn sm ghost" onClick={onCancel}>
          Back to scenarios
        </button>
      </div>
    </div>
  );
}

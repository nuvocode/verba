import type { ReadView } from "../../lib/settings";

const LABEL: Record<ReadView, string> = { passage: "Close reading", prompter: "Teleprompter" };

/**
 * The one control that says the reading screen has two of them. It sits in the same
 * place in both views, so switching is a click in the same spot, twice.
 */
export default function ViewToggle({ view, onView }: { view: ReadView; onView: (v: ReadView) => void }) {
  return (
    <div className="vtoggle" title="P">
      {(Object.keys(LABEL) as ReadView[]).map((v) => (
        <button key={v} className={view === v ? "on" : ""} onClick={() => onView(v)}>
          {LABEL[v]}
        </button>
      ))}
    </div>
  );
}

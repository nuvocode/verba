// The pieces more than one settings section needs. Anything used by exactly one
// section lives in that section's own file — this is not a lobby.
import type { Settings } from "../../lib/settings";
import type { Gate } from "../../lib/rules";

/** What every section is handed: the record, and the one door that writes it. */
export interface SectionProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/**
 * The reason a closed control owes the learner (#42), rendered the one way.
 * A closed control stays on screen and says which setting closed it — a missing
 * option reads as a missing feature, a closed one reads as a switch you flipped.
 */
export function Because({ gate, link = true }: { gate: Gate; link?: boolean }) {
  return (
    <span style={{ color: "var(--ink3)" }}>
      {" · "}
      {gate.why} —{" "}
      {link ? (
        <a href={gate.exit.href} style={{ color: "inherit" }}>
          {gate.exit.label}
        </a>
      ) : (
        // Inside a control: an anchor here would fire the control's own click as
        // well. The row itself is the way through — picking it raises the
        // refusal, and the refusal carries the link.
        gate.exit.label
      )}
    </span>
  );
}

/** A switch with the sentence that says what it does. Every setting has one (§5.2). */
export function ToggleRow({
  title,
  desc,
  on,
  onClick,
}: {
  title: string;
  desc: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 20,
        padding: "16px 4px",
        borderBottom: "1px solid var(--line2)",
        marginBottom: 36,
      }}
    >
      <div>
        <div className="name">{title}</div>
        <div className="desc" style={{ maxWidth: 440, lineHeight: 1.5 }}>
          {desc}
        </div>
      </div>
      {/* §5.5: the state is readable as a word, not only as a colour. Here rather
          than in one section, because a switch that only a sighted-in-colour
          learner can read is the same bug wherever it appears. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="desc" style={{ minWidth: 22, textAlign: "right" }}>
          {on ? "On" : "Off"}
        </span>
        <button className={`toggle ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on} aria-label={title}>
          <span />
        </button>
      </div>
    </div>
  );
}

export const linkish = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
  textDecoration: "underline",
} as const;

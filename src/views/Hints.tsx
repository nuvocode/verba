// The one hint line. It reads the key table (lib/keys) for the surface it is
// given, so a shortcut that is not in the table cannot be announced — the
// "announced == working" promise is a structure, not a claim. It reads
// `settings.showHints` itself, so a caller only names the surface.
import type { Settings } from "../lib/settings";
import { keysFor, labelFor, type Surface } from "../lib/keys";

export default function Hints({
  settings,
  surface,
  has = [],
}: {
  settings: Settings;
  surface: Surface;
  /** Conditional flags a shortcut's `when` can ask for (e.g. "bilingual"). */
  has?: string[];
}) {
  if (!settings.showHints) return null;
  const keys = keysFor(surface, has);
  if (!keys.length) return null; // a surface with nothing to say says nothing
  return (
    <div className="hints">
      {keys.map((k) => (
        <span key={k.does}>
          <span className="kbd">{labelFor(k, has)}</span> {k.does}
        </span>
      ))}
    </div>
  );
}

// The four content states every surface can land in, and nothing else (PLAN-016 §3.2).
//
// One component per state, each taking exactly what it needs to be specific — a
// generic "Loading…" fails §3.2, so `Generating` is told what is being made and for
// how long, `Nothing` why the surface is empty and the one thing that changes it,
// `Failed` what happened (a sentence from humanError) and the retry, and `Unusable`
// that generated content was turned away and how to get more.
//
// These are content-only: the *surface* owns the surrounding container (its `.empty
// fade` or `.today fade` / `.refl`), because the sheet and the rail sit outside that
// wrapper. A component here must not wrap itself — the caller decides the layout.
//
// Style follows PLAN-015: 2-space indent, double quotes, ~120 columns, no formatter.

/** What is being made, and roughly how long. Never a bare spinner. */
export function Generating({
  what,
  eta,
  step,
}: {
  what: string;
  /** A string the caller composes from what it knows — not a live countdown. */
  eta: string;
  /** The finer-grained stage ("Writing chapter 2 of 3…"). Optional. */
  step?: string;
}) {
  return (
    <>
      <h2>{what}</h2>
      {step && (
        <p className="gstep" style={{ color: "var(--ink3)", fontSize: 13, margin: "0 0 8px" }}>
          {step}
        </p>
      )}
      <p>{eta}.</p>
    </>
  );
}

/** Why there is nothing here, and the one thing that changes it. */
export function Nothing({
  title = "Nothing here yet.",
  why,
  action,
}: {
  /** The headline — a surface names its own emptiness ("What are we practising?"). */
  title?: string;
  why: string;
  action?: { label: string; onClick(): void };
}) {
  return (
    <>
      <h2>{title}</h2>
      <p>{why}</p>
      {action && (
        <button className="btn" onClick={action.onClick}>
          {action.label} →
        </button>
      )}
    </>
  );
}

/** What happened (one sentence from humanError), what the learner can do, and a retry. */
export function Failed({
  say,
  retry,
}: {
  say: string;
  retry?: { label: string; onClick(): void };
}) {
  return (
    <>
      <h2>That didn't work.</h2>
      <p>{say}</p>
      {retry && (
        <button className="btn" onClick={retry.onClick}>
          {retry.label} →
        </button>
      )}
    </>
  );
}

/**
 * Generated content that failed a quality gate. The learner never sees what was
 * rejected — they see that it was, and the way out (regenerate, or a fallback
 * when the surface can offer one).
 */
export function Unusable({
  what,
  fallback,
  regenerate,
}: {
  what: string;
  fallback?: { label: string; onClick(): void };
  regenerate: { label: string; onClick(): void };
}) {
  return (
    <>
      <h2>That got turned away.</h2>
      <p>{what} It didn't pass the check, so it never reached you — and it won't be shown half-built.</p>
      <div className="states-actions" style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        {fallback && (
          <button className="btn ghost" onClick={fallback.onClick}>
            {fallback.label}
          </button>
        )}
        <button className="btn" onClick={regenerate.onClick}>
          {regenerate.label} →
        </button>
      </div>
    </>
  );
}

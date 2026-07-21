import { useCallback, useEffect, useState } from "react";
import type { Settings } from "../lib/settings";
import type { Day } from "../lib/useDay";
import { allVocab, deleteVocab, reviewVocab, type VocabRow } from "../lib/db";
import { getPack } from "../lib/packs";
import { strength, type Grade } from "../lib/srs";
import { suspect } from "../lib/vocab";

const GRADES: [string, Grade, string][] = [
  ["Slipped", 0, "1"],
  ["Got it", 1, "2"],
  ["Easy", 2, "3"],
];

export default function Memory({
  settings,
  day,
  autoReview,
  onFinish,
  onCaptureKeys,
}: {
  settings: Settings;
  day: Day;
  autoReview: number;
  onFinish: () => void;
  onCaptureKeys: (on: boolean) => void;
}) {
  const [words, setWords] = useState<VocabRow[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [queue, setQueue] = useState<VocabRow[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [error, setError] = useState("");

  // The deck belongs to the language it was met in — switching language must not
  // resurface the last one's cards.
  const dir = getPack(settings.packId)?.direction ?? "ltr";

  const load = useCallback(async () => {
    try {
      setWords(await allVocab(settings.targetLang));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, [settings.targetLang]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  // Cards the old, looser capture let in: a time, a name, a card with no meaning on
  // the back. They are pulled out of the deck's own groups and shown together, because
  // the honest thing to do with a card that cannot be reviewed is offer to delete it —
  // not quietly keep resurfacing it.
  const junk = words.filter((w) => suspect(w) !== null);
  const good = words.filter((w) => suspect(w) === null);
  const due = good.filter((w) => w.due <= now);
  const settled = good.filter((w) => w.due > now);

  /** Drop a card. Optimistic — the row leaves the list before the delete lands. */
  const drop = useCallback(async (id: number) => {
    setWords((ws) => ws.filter((w) => w.id !== id));
    setQueue((q) => q.filter((c) => c.id !== id));
    await deleteVocab(id).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  /** Clear the whole "needs a look" group in one go. */
  const dropAllJunk = useCallback(async () => {
    const ids = junk.map((w) => w.id);
    setWords((ws) => ws.filter((w) => !ids.includes(w.id)));
    for (const id of ids) await deleteVocab(id).catch(() => {});
  }, [junk]);

  const start = useCallback(() => {
    // Only reviewable cards are queued: a card with no meaning has no back to reveal.
    const q = words.filter((w) => w.due <= Date.now() && suspect(w) === null);
    if (!q.length) return;
    setQueue(q);
    setIdx(0);
    setRevealed(false);
    setGrades([]);
    setReviewing(true);
  }, [words]);

  // ⌘K → "resurface due" and the Today spine both land here.
  useEffect(() => {
    if (autoReview > 0 && words.length) start();
  }, [autoReview, words.length]);

  useEffect(() => {
    onCaptureKeys(reviewing);
    return () => onCaptureKeys(false);
  }, [reviewing, onCaptureKeys]);

  const grade = useCallback(
    async (g: Grade) => {
      const card = queue[idx];
      if (!card) return;
      setGrades((gs) => [...gs, g]);
      setIdx((i) => i + 1);
      setRevealed(false);
      await reviewVocab(card, g).catch((e) => setError(String(e?.message ?? e)));
      if (idx + 1 >= queue.length) {
        void day.complete("vocab");
        void load();
      }
    },
    [queue, idx, day, load],
  );

  /**
   * Let go of the card in front of them, mid-review.
   *
   * `drop` filters it out of the queue, which slides the next card into the same
   * index — so there is nothing to advance. Dropping the last one still closes the
   * block out: they did the session, they just ended it by pruning.
   */
  const dropCard = useCallback(async () => {
    const card = queue[idx];
    if (!card) return;
    setRevealed(false);
    await drop(card.id);
    if (idx + 1 >= queue.length) void day.complete("vocab");
  }, [queue, idx, drop, day]);

  // Review-mode keys. App stands down while this is mounted (onCaptureKeys).
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setReviewing(false);
      if (e.key === " ") {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        return;
      }
      if (revealed && /^[1-3]$/.test(e.key)) {
        const g = GRADES[Number(e.key) - 1];
        if (g) void grade(g[1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewing, revealed, grade]);

  // ---- review mode ----
  if (reviewing) {
    const card = queue[idx];
    const clean = grades.filter((g) => g > 0).length;
    return (
      <div className="mem">
        <div className="review">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 34 }}>
            <div className="eyebrow">Resurfacing · {card ? `${idx + 1} of ${queue.length}` : "complete"}</div>
            <button style={{ fontSize: 12, color: "var(--ink3)" }} onClick={() => setReviewing(false)}>
              esc to exit
            </button>
          </div>

          {card ? (
            <>
              <div style={{ fontSize: 12.5, color: "var(--ink3)", marginBottom: 14 }}>
                You met this {card.reps > 0 ? `${card.reps} review(s) ago` : "for the first time recently"}.
              </div>

              {/* The card asks one thing: what does this mean? The sentence it was met
                  in stands underneath as context — it is not what is being tested, and
                  the meaning stays behind the reveal, where an answer belongs. */}
              <div className="q" dir={dir}>
                {card.term}
              </div>
              {card.example && (
                <div className="ctx" dir={dir}>
                  “{card.example}”
                </div>
              )}

              {!revealed ? (
                <button className="btn ghost" onClick={() => setRevealed(true)}>
                  Reveal the meaning <span className="kbd">space</span>
                </button>
              ) : (
                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 24, animation: "vfade .25s ease both" }}>
                  <div className="a">{card.translation}</div>
                  <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
                    {GRADES.map(([label, g, kbd]) => (
                      <button key={g} className={`grade ${g === 0 ? "miss" : ""}`} onClick={() => void grade(g)}>
                        {label} <span className="k">{kbd}</span>
                      </button>
                    ))}
                  </div>
                  {/* Judging a card is only half of reviewing it: a word they'll never
                      need is not a word to grade harder, it is one to let go of. */}
                  <button className="drop" onClick={() => void dropCard()}>
                    Drop this card
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <div className="display" style={{ fontSize: 36, marginBottom: 12 }}>
                All resurfaced.
              </div>
              <div style={{ fontSize: 14, color: "var(--ink2)", marginBottom: 34 }}>
                {clean} of {grades.length} recalled cleanly. The ones that slipped come back tomorrow morning.
              </div>
              <button
                className="btn"
                onClick={() => {
                  setReviewing(false);
                  onFinish();
                }}
              >
                Back to Today →
              </button>
            </div>
          )}
          {error && <div className="err">{error}</div>}
        </div>
      </div>
    );
  }

  // ---- the collection ----
  const groups = [
    { label: `Due for resurfacing · ${due.length}`, words: due, junk: false },
    { label: "Settled — resting in long-term memory", words: settled, junk: false },
    { label: `Needs a look · ${junk.length}`, words: junk, junk: true },
  ].filter((g) => g.words.length);

  return (
    <div className="mem fade">
      <div className="mem-head">
        <div>
          <div className="eyebrow">
            Memory · {good.length} {good.length === 1 ? "word" : "words"} · {settings.targetLang}
          </div>
          <h1 className="display">Everything you've met, in context.</h1>
        </div>
        {due.length > 0 && (
          <button className="btn sm" onClick={start} style={{ whiteSpace: "nowrap" }}>
            Resurface {due.length} due <span className="kbd">R</span>
          </button>
        )}
      </div>
      <div className="intro">
        Nothing here was typed into a list, and nothing lands here on its own — a word arrives because you kept it while
        reading, or left it in place after a conversation. Each one resurfaces just before you'd forget it.
      </div>

      {error && <div className="err">{error}</div>}

      {!words.length && (
        <div className="empty">
          <h2>Empty — for now.</h2>
          <p>Have a conversation or read a passage; the words you meet land here on their own.</p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 40 }}>
          <div className="sec" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span>{g.label}</span>
            {g.junk && (
              <button style={{ font: "inherit", letterSpacing: "inherit", color: "var(--sev)" }} onClick={() => void dropAllJunk()}>
                Remove all {g.words.length}
              </button>
            )}
          </div>
          {g.junk && (
            <div style={{ fontSize: 13, color: "var(--ink2)", padding: "12px 4px 4px", lineHeight: 1.6 }}>
              These were captured before Verba was choosy about what a card is — a time from a story, a name, a card with
              no meaning on the back. They aren't resurfaced.
            </div>
          )}
          {g.words.map((w) => {
            const str = strength(w);
            return (
              <div className="wrow" key={w.id}>
                <div className="term" dir={dir}>
                  {w.term}
                </div>
                <div className="gloss">{g.junk ? <em>{suspect(w)}</em> : w.translation}</div>
                <div className="ctx" dir={dir}>
                  “{w.example}”
                </div>
                {/* Rendered empty rather than omitted for a junk row: the strength rail
                    is what holds the × in the same column all the way down the list. */}
                <div className="bar">
                  {!g.junk && <div className={str < 0.4 ? "weak" : ""} style={{ width: `${Math.round(str * 100)}%` }} />}
                </div>
                <button className="x" title="Remove from Memory" onClick={() => void drop(w.id)}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

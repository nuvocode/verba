import { useCallback, useEffect, useState } from "react";
import type { Settings } from "../lib/settings";
import type { Day } from "../lib/useDay";
import { allVocab, reviewVocab, type VocabRow } from "../lib/db";
import { cloze, strength, type Grade } from "../lib/srs";

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

  const load = useCallback(async () => {
    try {
      setWords(await allVocab());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  const due = words.filter((w) => w.due <= now);
  const settled = words.filter((w) => w.due > now);

  const start = useCallback(() => {
    const q = words.filter((w) => w.due <= Date.now());
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
              <div className="cloze">{cloze(card.term, card.example)}</div>
              <div style={{ fontSize: 14, color: "var(--ink2)", marginBottom: 34 }}>
                meaning: <span style={{ fontStyle: "italic" }}>{card.translation || "—"}</span>
              </div>

              {!revealed ? (
                <button className="btn ghost" onClick={() => setRevealed(true)}>
                  Reveal <span className="kbd">space</span>
                </button>
              ) : (
                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 24, animation: "vfade .25s ease both" }}>
                  <div className="term">{card.term}</div>
                  <div style={{ fontSize: 14, color: "var(--ink2)", marginBottom: 28 }}>{card.example}</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {GRADES.map(([label, g, kbd]) => (
                      <button key={g} className={`grade ${g === 0 ? "miss" : ""}`} onClick={() => void grade(g)}>
                        {label} <span className="k">{kbd}</span>
                      </button>
                    ))}
                  </div>
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
    { label: `Due for resurfacing · ${due.length}`, words: due },
    { label: "Settled — resting in long-term memory", words: settled },
  ].filter((g) => g.words.length);

  return (
    <div className="mem fade">
      <div className="mem-head">
        <div>
          <div className="eyebrow">
            Memory · {words.length} {words.length === 1 ? "word" : "words"} · {settings.targetLang}
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
        Nothing here was typed into a list. Words arrive from your conversations and reading, and resurface exactly when
        you're about to forget them.
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
          <div className="sec">{g.label}</div>
          {g.words.map((w) => {
            const str = strength(w);
            return (
              <div className="wrow" key={w.id}>
                <div className="term">{w.term}</div>
                <div className="gloss">{w.translation}</div>
                <div className="ctx">“{w.example}”</div>
                <div className="bar">
                  <div className={str < 0.4 ? "weak" : ""} style={{ width: `${Math.round(str * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

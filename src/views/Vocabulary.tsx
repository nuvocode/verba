import { useEffect, useState } from "react";
import { allVocab, dueVocab, reviewVocab, type VocabRow } from "../lib/db";
import type { Grade } from "../lib/srs";

export default function Vocabulary() {
  const [queue, setQueue] = useState<VocabRow[]>([]);
  const [all, setAll] = useState<VocabRow[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  async function refresh() {
    setQueue(await dueVocab());
    setAll(await allVocab());
  }
  useEffect(() => {
    refresh();
  }, []);

  const card = queue[0];

  async function grade(g: Grade) {
    if (!card) return;
    await reviewVocab(card, g);
    setRevealed(false);
    const rest = queue.slice(1);
    setQueue(rest);
    if (rest.length === 0) {
      setReviewing(false);
      refresh();
    }
  }

  if (reviewing && card) {
    return (
      <div className="vocab review">
        <p className="muted">{queue.length} card(s) left</p>
        <div className="flashcard" onClick={() => setRevealed(true)}>
          <div className="term">{card.term}</div>
          {revealed ? (
            <>
              <div className="translation">{card.translation}</div>
              {card.example && <div className="example">“{card.example}”</div>}
            </>
          ) : (
            <div className="muted">click to reveal</div>
          )}
        </div>
        {revealed ? (
          <div className="grades">
            <button className="again" onClick={() => grade(0)}>
              Again
            </button>
            <button className="good" onClick={() => grade(1)}>
              Good
            </button>
            <button className="easy" onClick={() => grade(2)}>
              Easy
            </button>
          </div>
        ) : (
          <button onClick={() => setRevealed(true)}>Reveal</button>
        )}
      </div>
    );
  }

  return (
    <div className="vocab">
      <h1>Vocabulary</h1>
      <div className="vocab-stats">
        <div>
          <strong>{all.length}</strong> words
        </div>
        <div>
          <strong>{queue.length}</strong> due
        </div>
      </div>
      <button
        className="primary"
        disabled={queue.length === 0}
        onClick={() => {
          setRevealed(false);
          setReviewing(true);
        }}
      >
        {queue.length ? `Review ${queue.length} card(s)` : "Nothing due 🎉"}
      </button>

      <table className="vocab-table">
        <thead>
          <tr>
            <th>Term</th>
            <th>Meaning</th>
            <th>Reps</th>
          </tr>
        </thead>
        <tbody>
          {all.map((v) => (
            <tr key={v.id}>
              <td>{v.term}</td>
              <td>{v.translation}</td>
              <td>{v.reps}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {all.length === 0 && <p className="muted">Finish a conversation and end it to capture vocabulary here.</p>}
    </div>
  );
}

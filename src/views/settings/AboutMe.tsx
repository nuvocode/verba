// Settings → About me (spec §5.6). The learner's record of what the machine
// believes about them. Everything is on show, because a wrong line quietly
// steering every future prompt is the failure this page exists to prevent — and
// the only way to see it is to look.
//
// One concept, one name: the words being studied are Memory up in the nav; what
// the coach has learned about the learner is this page. Two things called the
// same thing would need a paragraph to tell apart, and that paragraph is the bug.
import { useEffect, useState } from "react";
import { allMemories, deleteMemory, MEMORY_BUDGET, type MemoryRow } from "../../lib/db";
import { memoryDate } from "../../lib/prompts";
import { linkish, type SectionProps } from "./parts";

export default function AboutMe({ settings }: SectionProps) {
  // Read on open — nothing else in Settings needs it, and it changes behind our
  // back every time a conversation ends.
  const [memories, setMemories] = useState<MemoryRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void allMemories(settings.profile.targetLanguage)
      .then((rows) => live && setMemories(rows))
      .catch(() => live && setMemories([])); // no DB (browser dev server) reads as nothing recorded
    return () => {
      live = false;
    };
  }, [settings.profile.targetLanguage]);

  /** Strike a line out. The row goes, and with it whatever it was steering. */
  const forget = async (m: MemoryRow) => {
    await deleteMemory(m.id).catch(() => {});
    setMemories((ms) => (ms ?? []).filter((x) => x.id !== m.id));
  };

  return (
    <>
      <div className="desc" style={{ maxWidth: 480, lineHeight: 1.5, margin: "0 4px 8px" }} data-setting="about-me">
        What the coach has picked up about you while you talked, and reads back before every session — so it can
        ask after the trip you mentioned last week, and set your reading in your own city. Written at the end of a
        conversation, never anywhere else. Delete anything wrong, stale, or none of its business: a line struck out
        here stops steering the prompts at once.
      </div>
      <div className="desc" style={{ maxWidth: 480, lineHeight: 1.5, margin: "0 4px 18px" }}>
        This is your record, kept for <strong>{settings.profile.targetLanguage}</strong>. The words you're studying live in
        Memory, up in the nav — that's the other one.
      </div>

      {memories === null ? (
        <div className="desc" style={{ padding: "4px" }}>Reading…</div>
      ) : memories.length === 0 ? (
        <div className="desc" style={{ padding: "4px", maxWidth: 480, lineHeight: 1.5 }}>
          Nothing recorded yet. Have a conversation and tell the coach something about yourself — what you do, why
          you're learning {settings.profile.targetLanguage}, who's in your life. It writes down what's worth keeping when the
          session ends.
        </div>
      ) : (
        <>
          {memories.map((m) => (
            <div key={m.id} className="srow">
              <div style={{ flex: 1 }}>
                <div className="name">{m.fact}</div>
                <div className="desc">{memoryDate(m.created_at)}</div>
              </div>
              <button className="model" style={linkish} onClick={() => void forget(m)}>
                forget
              </button>
            </div>
          ))}
          <div className="desc" style={{ padding: "14px 4px", maxWidth: 480, lineHeight: 1.5 }}>
            {memories.length} fact{memories.length === 1 ? "" : "s"} on file.{" "}
            {memories.length > MEMORY_BUDGET
              ? `The ${MEMORY_BUDGET} most recent go into each prompt — the local models have no room for more, and the oldest facts are the ones you're least likely to be asked about.`
              : "All of them go into every prompt the coach writes."}
          </div>
        </>
      )}
    </>
  );
}

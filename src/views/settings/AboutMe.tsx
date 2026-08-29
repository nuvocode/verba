// Settings → About me (spec §5.6). The learner's record of what the machine
// believes about them. Everything is on show, because a wrong line quietly
// steering every future session is the failure this page exists to prevent — and
// the only way to see it is to look.
//
// One concept, one name: the words being studied are Memory up in the nav; what
// the coach has learned about the learner is this page. Two things called the
// same thing would need a paragraph to tell apart, and that paragraph is the bug.
import { useEffect, useState } from "react";
import {
  addMemory,
  allMemories,
  clearMemories,
  deleteMemory,
  updateMemory,
  MEMORY_BUDGET,
  type MemoryRow,
} from "../../lib/db";
import { memoryDate } from "../../lib/prompts";
import { linkish, ToggleRow, type SectionProps } from "./parts";

export default function AboutMe({ settings, onChange }: SectionProps) {
  // Read on open — nothing else in Settings needs it, and it changes behind our
  // back every time a conversation ends.
  const [memories, setMemories] = useState<MemoryRow[] | null>(null);
  const [draft, setDraft] = useState(""); // the "add a fact" box
  const [editing, setEditing] = useState<number | null>(null); // the row being rewritten
  const [editText, setEditText] = useState("");
  const [notice, setNotice] = useState<string | null>(null); // what the last add did
  const [confirmingForget, setConfirmingForget] = useState(false); // the wipe's own dialog

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

  /** The learner's own line, written by hand rather than left to a conversation.
   *  Every outcome is said out loud: a line that was already on file is not a
   *  silent no-op, and a write that failed does not clear the list. */
  const add = async () => {
    const fact = draft.trim();
    if (!fact) {
      setNotice("Type something first.");
      return;
    }
    try {
      const affected = await addMemory(settings.profile.targetLanguage, fact);
      setDraft("");
      if (affected === 0) {
        setNotice("That's already on file.");
        return;
      }
      setNotice(null);
      const rows = await allMemories(settings.profile.targetLanguage).catch(() => null);
      if (rows) setMemories(rows);
    } catch {
      // No DB (browser dev server): the write failed, so the list is left as it
      // was rather than being cleared by a reload that reads nothing.
      setNotice("Couldn't save that.");
    }
  };

  /** Rewrite a line in place. The date stays the original — that is when the
   *  coach learned it, and the edit is a correction, not a new fact. */
  const saveEdit = async (m: MemoryRow) => {
    const fact = editText.trim();
    if (!fact) return;
    await updateMemory(m.id, fact).catch(() => {});
    setEditing(null);
    setMemories((ms) => (ms ?? []).map((x) => (x.id === m.id ? { ...x, fact } : x)));
  };

  /** The wipe's own dialog, not the browser's — the app's confirmations speak
   *  the app's language, and count what is lost before they ask. */
  const doForgetAll = async () => {
    const n = memories?.length ?? 0;
    if (n === 0) return;
    await clearMemories(settings.profile.targetLanguage).catch(() => {});
    setMemories([]);
    setConfirmingForget(false);
  };

  return (
    <>
      <div className="desc" style={{ maxWidth: 480, lineHeight: 1.5, margin: "0 4px 8px" }} data-setting="about-me">
        What the coach has picked up about you while you talked, and reads back before every session. Delete anything
        wrong, stale, or none of its business — a line struck out here stops steering what the coach says from the next
        session on.
      </div>
      <div className="desc" style={{ maxWidth: 480, lineHeight: 1.5, margin: "0 4px 18px" }}>
        This is your record, kept for <strong>{settings.profile.targetLanguage}</strong>. The words you're studying live in
        Memory, up in the nav — that's the other one.
      </div>

      <div data-setting="keep-learning">
        <ToggleRow
          title="Keep learning about me"
          desc="While this is on, the coach writes down new things you tell it. Turn it off to keep what's here but stop adding to it."
          on={!settings.memoryPaused}
          onClick={() => onChange({ memoryPaused: !settings.memoryPaused })}
        />
      </div>

      {memories === null ? (
        <div className="desc" style={{ padding: "4px" }}>Reading…</div>
      ) : (
        <>
          {memories.length === 0 ? (
            <div className="desc" style={{ padding: "4px", maxWidth: 480, lineHeight: 1.5 }}>
              Nothing recorded yet. Tell the coach something about yourself — what you do, why you're learning{" "}
              {settings.profile.targetLanguage}, who's in your life — or add a line yourself below.
            </div>
          ) : (
            <>
              {memories.map((m) => (
                <div key={m.id} className="srow">
                  {editing === m.id ? (
                    <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void saveEdit(m)}
                        autoFocus
                        style={{ flex: 1 }}
                      />
                      <button className="model" style={linkish} onClick={() => void saveEdit(m)}>
                        save
                      </button>
                      <button className="model" style={linkish} onClick={() => setEditing(null)}>
                        cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <div className="name">{m.fact}</div>
                        <div className="desc">{memoryDate(m.created_at)}</div>
                      </div>
                      <button
                        className="model"
                        style={linkish}
                        onClick={() => {
                          setEditing(m.id);
                          setEditText(m.fact);
                        }}
                      >
                        edit
                      </button>
                      <button className="model" style={linkish} onClick={() => void forget(m)}>
                        forget
                      </button>
                    </>
                  )}
                </div>
              ))}
              <div className="desc" style={{ padding: "14px 4px", maxWidth: 480, lineHeight: 1.5 }}>
                {memories.length} fact{memories.length === 1 ? "" : "s"} on file.{" "}
                {memories.length > MEMORY_BUDGET
                  ? `The ${MEMORY_BUDGET} most recent go into every conversation and reading — the local models have no room for more, and the oldest facts are the ones you're least likely to be asked about.`
                  : "All of them go into every conversation and reading."}
              </div>
            </>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px", marginBottom: 4 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="Add a fact about yourself…"
              style={{ flex: 1 }}
              data-setting="add-fact"
            />
            <button className="model" style={linkish} onClick={() => void add()}>
              add
            </button>
          </div>
          {notice && (
            <div className="desc" style={{ padding: "0 4px 12px", color: "var(--ink3)" }}>
              {notice}
            </div>
          )}

          {memories.length > 0 && (
            <button
              className="model"
              style={linkish}
              onClick={() => setConfirmingForget(true)}
              data-setting="forget-everything"
            >
              Forget all {memories.length} fact{memories.length === 1 ? "" : "s"}
            </button>
          )}
        </>
      )}

      {confirmingForget && (
        <div className="scrim" onClick={() => setConfirmingForget(false)}>
          <div className="palette confirm" onClick={(e) => e.stopPropagation()}>
            <h2>Forget everything about you?</h2>
            <p>
              This removes <strong>{memories?.length ?? 0} fact{memories?.length === 1 ? "" : "s"}</strong> about you in{" "}
              {settings.profile.targetLanguage}. The coach will stop knowing them from the next session on.
            </p>
            <p>It cannot be undone.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn sm ghost" onClick={() => setConfirmingForget(false)}>
                Cancel
              </button>
              <button className="btn sm" autoFocus onClick={() => void doForgetAll()}>
                Forget everything
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


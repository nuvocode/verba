// Settings → Learning (spec §5.3). Everything set up during onboarding lives
// here, in the same order and under the same names — a learner looking for a
// value they were asked about on day one finds it where they left it.
import { useState } from "react";
import { CEFR_LEVELS, type CEFRLevel } from "../../lib/model";
import { type CorrectionTiming } from "../../lib/settings";
import { listPacks, originLabel, packDocs, packOrigin, removeImportedPack } from "../../lib/packs";
import { ToggleRow, type SectionProps } from "./parts";

const TIMINGS: [CorrectionTiming, string, string][] = [
  ["adaptive", "Adaptive", "Interrupt only for mistakes that break meaning; the rest wait for the reflection."],
  ["live", "Live", "Show every correction the moment it happens."],
  ["delayed", "Delayed", "Never interrupt. Everything is handed back at the end of the session."],
];

export default function Learning({ settings, onChange }: SectionProps) {
  const [openDoc, setOpenDoc] = useState(""); // slug of the language doc being read
  const [, bump] = useState(0); // packs live in localStorage — force a re-read after a removal

  const packs = listPacks();
  // An imported pack shadows the in-tree pack of the same id, docs included — so
  // say so, or "I pasted my es pack and the guide vanished" reads as a bug.
  const packShadowed = packOrigin(settings.packId) === "imported";
  const docs = packShadowed ? [] : packDocs(settings.packId);

  return (
    <>
      <div className="sec">Language</div>
      {packs.map((p) => {
        const origin = packOrigin(p.id);
        return (
          <button key={p.id} className="srow" onClick={() => onChange({ packId: p.id, profile: { ...settings.profile, targetLanguage: p.name } })}>
            <div className={`radio ${settings.packId === p.id ? "on" : ""}`} />
            <div style={{ flex: 1 }}>
              <div className="name">
                {p.emoji} {p.name} — {p.nativeName}
                <span>{origin ? originLabel(origin) : ""}</span>
              </div>
              <div className="desc">
                {p.grammar.length} grammar notes, {p.pronunciation.length} pronunciation notes · voice{" "}
                {p.speech.locale}
              </div>
            </div>
            {origin === "imported" && (
              <span
                className="model"
                onClick={(e) => {
                  e.stopPropagation();
                  removeImportedPack(p.id);
                  bump((n) => n + 1);
                }}
              >
                remove
              </span>
            )}
          </button>
        );
      })}

      {/* The selected language's markdown docs — the long-form guide a pack's three
          bullet points have no room for. Docs marked for the tutor also ride along
          on every model call, so the learner is told which ones those are. */}
      {packShadowed && packDocs(settings.packId).length > 0 && (
        <div className="desc" style={{ marginTop: 16 }}>
          You imported your own <strong>{settings.profile.targetLanguage}</strong> pack, so it replaces the built-in one — the
          bundled language guide is hidden and the tutor follows your pack's instructions only. Remove the imported
          pack to get the built-in guide back.
        </div>
      )}

      {docs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="desc" style={{ marginBottom: 8 }}>
            Language guide — {docs.length} document{docs.length > 1 ? "s" : ""} shipped with this pack.
          </div>
          {docs.map((d) => (
            <div key={d.slug}>
              <button className="srow" onClick={() => setOpenDoc(openDoc === d.slug ? "" : d.slug)}>
                <div style={{ flex: 1 }}>
                  <div className="name">
                    {d.title}
                    {d.prompt && <span>Tutor reads this</span>}
                  </div>
                  <div className="desc">{d.slug}.md</div>
                </div>
                <span className="model">{openDoc === d.slug ? "close" : "read"}</span>
              </button>
              {/* ponytail: markdown rendered as its own source — it is written to be
                  read plain, and this ships no parser and no XSS surface. Add a
                  renderer when a doc needs tables or images to land. */}
              {openDoc === d.slug && (
                <pre
                  className="desc"
                  style={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.6,
                    maxHeight: 420,
                    overflow: "auto",
                    padding: "4px 4px 16px",
                    margin: 0,
                    fontFamily: "inherit",
                  }}
                >
                  {d.body}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="field" style={{ marginTop: 10 }}>
        <label>I speak</label>
        <input value={settings.profile.nativeLanguage} onChange={(e) => onChange({ profile: { ...settings.profile, nativeLanguage: e.target.value } })} />
      </div>
      <div className="field">
        <label>My level</label>
        <select
          value={settings.profile.level}
          onChange={(e) => onChange({ profile: { ...settings.profile, level: e.target.value as CEFRLevel } })}
        >
          {CEFR_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Minutes a day</label>
        <input
          type="number"
          min={5}
          max={180}
          value={settings.dailyMinutes}
          onChange={(e) => onChange({ dailyMinutes: Number(e.target.value) || 45 })}
        />
      </div>

      <div className="sec" style={{ marginTop: 44 }}>Coaching</div>
      {TIMINGS.map(([id, name, desc]) => (
        <button key={id} className="srow" onClick={() => onChange({ correctionTiming: id })}>
          <div className={`radio ${settings.correctionTiming === id ? "on" : ""}`} />
          <div style={{ flex: 1 }}>
            <div className="name">{name}</div>
            <div className="desc">{desc}</div>
          </div>
        </button>
      ))}

      <div className="sec" style={{ marginTop: 44 }}>Interface</div>
      <ToggleRow
        title="Keyboard hints"
        desc="The small shortcut lines under each screen."
        on={settings.showHints}
        onClick={() => onChange({ showHints: !settings.showHints })}
      />
    </>
  );
}

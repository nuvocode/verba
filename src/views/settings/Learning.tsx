// Settings → Learning (spec §5.3). Everything set up during onboarding lives
// here, in the same order and under the same names — a learner looking for a
// value they were asked about on day one finds it where they left it, phrased
// the way it was phrased then. The two menus themselves come from lib/choices,
// so setup and this page cannot describe the same choice differently.
import { useEffect, useMemo, useState } from "react";
import { LEVELS, TIMES } from "../../lib/choices";
import { languages } from "../../lib/langs";
import { progressByLang } from "../../lib/db";
import { type CorrectionTiming } from "../../lib/settings";
import { listPacks, originLabel, packDocs, packOrigin, removeImportedPack } from "../../lib/packs";
import { linkish, ToggleRow, type SectionProps } from "./parts";

/**
 * The three answers to "when do I want correcting", each with a sketch of what
 * it looks like. What differs between them is *timing*, not wording, so the
 * sketch shows the timing — and shows it without a sentence in any one language,
 * which would be wrong for every learner not studying that one.
 */
const TIMINGS: [CorrectionTiming, string, string, string][] = [
  [
    "adaptive",
    "Adaptive",
    "Interrupt only for mistakes that break meaning; the rest wait for the reflection.",
    "your last sentence ✎ shown now — it changed what you meant · a small slip waits for the end",
  ],
  [
    "live",
    "Live",
    "Show every correction the moment it happens.",
    "your last sentence ✎ shown now — and so is the next one, and the one after",
  ],
  [
    "delayed",
    "Delayed",
    "Never interrupt. Everything is handed back at the end of the session.",
    "your last sentence — nothing now · every note together when the session ends",
  ],
];

/**
 * What official and community packs actually mean, in the learner's terms. Shown
 * behind a help marker rather than inline: it answers a question, and a paragraph
 * of it on every row would bury the languages (§5.3).
 */
const ORIGIN_HELP: Record<string, string> = {
  official:
    "Put together by the Verba team. Carries grammar and pronunciation notes the coach reads before every reply, plus a written language guide.",
  community:
    "Contributed by volunteers. Usually thinner than an official pack — fewer notes, sometimes no guide — and nobody on the team has reviewed it.",
  imported: "You pasted this one in yourself. Nobody has reviewed it, and it replaces any built-in pack with the same id.",
};

/** The learner's own language as a code, so a language can be named in it. */
const codeOf = (name: string): string | undefined =>
  languages().find((l) => l.name.toLowerCase() === name.trim().toLowerCase())?.code;

export default function Learning({
  settings,
  onChange,
  onLevelTest,
}: SectionProps & { onLevelTest: () => void }) {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const [openDoc, setOpenDoc] = useState(""); // slug of the language doc being read
  const [filter, setFilter] = useState("");
  const [help, setHelp] = useState(""); // which origin label has its explanation open
  const [, bump] = useState(0); // packs live in localStorage — force a re-read after a removal

  // Days shown up and words saved, per language. The point of the numbers is that
  // switching language visibly deletes nothing, so they are read for every pack,
  // not just the current one. No DB (a browser dev server) reads as no history.
  const [progress, setProgress] = useState<Record<string, { days: number; words: number }>>({});
  useEffect(() => {
    let live = true;
    void progressByLang()
      .then((p) => live && setProgress(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const packs = listPacks();
  // An imported pack shadows the in-tree pack of the same id, docs included — so
  // say so, or "I pasted my own pack and the guide vanished" reads as a bug.
  const packShadowed = packOrigin(settings.packId) === "imported";
  const docs = packShadowed ? [] : packDocs(settings.packId);

  // Every language named in the language the learner reads in. `langName` answers
  // in English; this answers in theirs, and falls back to English when the
  // platform has no names for their locale.
  const inMyLanguage = useMemo(() => {
    const code = codeOf(settings.profile.nativeLanguage);
    try {
      const names = new Intl.DisplayNames([code ?? "en"], { type: "language" });
      return (packId: string) => names.of(packId) ?? "";
    } catch {
      return () => "";
    }
  }, [settings.profile.nativeLanguage]);

  const q = filter.trim().toLowerCase();
  // The language you already speak is not one you are learning, and vice versa
  // (§3). Neither list offers the other's answer, so the refusal in lib/rules
  // stays a backstop for routes this page does not own.
  const offered = packs.filter((p) => !same(p.name, settings.profile.nativeLanguage));
  const shown = offered.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.nativeName.toLowerCase().includes(q) ||
      inMyLanguage(p.id).toLowerCase().includes(q),
  );

  /** What a pack gives the coach, in a sentence. A count on its own is not information. */
  const packSupport = (p: (typeof packs)[number]) => {
    const notes = p.grammar.length + p.pronunciation.length;
    const guide = packOrigin(p.id) === "imported" ? 0 : packDocs(p.id).length;
    return [
      notes ? "Grammar and pronunciation notes the coach reads before every reply" : "No language notes yet",
      guide ? "a written guide you can read yourself" : null,
      "a voice that reads it aloud",
    ]
      .filter(Boolean)
      .join(", ");
  };

  /** Day count and word count for a language, or nothing when there is no history. */
  const progressLine = (name: string) => {
    const p = progress[name];
    if (!p || (!p.days && !p.words)) return null;
    return `Day ${p.days} · ${p.words} word${p.words === 1 ? "" : "s"} saved`;
  };

  return (
    <>
      <div className="sec">Language</div>

      <div className="field" style={{ marginTop: 10 }} data-setting="native-language">
        <label>I speak</label>
        <select
          value={settings.profile.nativeLanguage}
          onChange={(e) => onChange({ profile: { ...settings.profile, nativeLanguage: e.target.value } })}
        >
          {languages()
            .filter((l) => !same(l.name, settings.profile.targetLanguage))
            .map((l) => (
              <option key={l.code} value={l.name}>
                {l.name}
              </option>
            ))}
        </select>
      </div>
      <div className="desc" style={{ margin: "0 4px 26px", maxWidth: 480, lineHeight: 1.5 }}>
        Corrections and explanations are written in this language.
      </div>

      <div className="sec">I'm learning</div>
      {/* Past five entries the list stops being scannable, so it gets a filter (§5.3). */}
      {offered.length > 5 && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>Find</label>
          <input
            value={filter}
            placeholder="Type a language"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      {shown.map((p) => {
        const origin = packOrigin(p.id);
        const label = origin ? originLabel(origin) : "";
        const mine = inMyLanguage(p.id);
        const line = progressLine(p.name);
        return (
          <div key={p.id} data-setting="target-language">
            <button
              className="srow"
              style={{ borderBottom: "none" }}
              onClick={() => onChange({ packId: p.id, profile: { ...settings.profile, targetLanguage: p.name } })}
            >
              <div className={`radio ${settings.packId === p.id ? "on" : ""}`} />
              <div style={{ flex: 1 }}>
                <div className="name">
                  {p.emoji} {p.nativeName}
                  {mine && mine !== p.nativeName ? ` — ${mine}` : ""}
                  {label && (
                    <span>
                      {label}{" "}
                      <span
                        role="button"
                        tabIndex={0}
                        title={`What does ${label} mean?`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setHelp(help === origin ? "" : (origin ?? ""));
                        }}
                        style={{ cursor: "help", textDecoration: "underline" }}
                      >
                        ?
                      </span>
                    </span>
                  )}
                </div>
                {settings.packId === p.id && <div className="desc">{packSupport(p)}.</div>}
                {/* The proof that switching language deletes nothing: the other
                    language's history is still there to be counted (§5.3). */}
                {line && <div className="desc">{line}</div>}
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
            {help && help === origin && (
              <div
                className="desc"
                style={{ padding: "0 4px 14px 26px", maxWidth: 480, lineHeight: 1.5 }}
              >
                <strong>{label}</strong> — {ORIGIN_HELP[origin]}
              </div>
            )}
            <div style={{ borderBottom: "1px solid var(--line2)" }} />
          </div>
        );
      })}
      {shown.length === 0 && (
        <div className="desc" style={{ padding: "16px 4px" }}>
          No language here matches “{filter.trim()}”. Language packs can be added under Advanced.
        </div>
      )}

      {/* The selected language's markdown docs — the long-form guide a pack's three
          bullet points have no room for. Docs marked for the tutor also ride along
          on every model call, so the learner is told which ones those are. */}
      {packShadowed && packDocs(settings.packId).length > 0 && (
        <div className="desc" style={{ marginTop: 16, maxWidth: 480, lineHeight: 1.5 }}>
          You imported your own <strong>{settings.profile.targetLanguage}</strong> pack, so it replaces the built-in
          one — the bundled language guide is hidden and the tutor follows your pack's instructions only. Remove the
          imported pack to get the built-in guide back.
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

      <div className="sec" style={{ marginTop: 44 }}>My level</div>
      {LEVELS.map(([l, title, desc]) => (
        <button
          key={l}
          className="srow"
          data-setting="level"
          onClick={() => onChange({ profile: { ...settings.profile, level: l } })}
        >
          <div className={`radio ${settings.profile.level === l ? "on" : ""}`} />
          <div style={{ flex: 1 }}>
            <div className="name">
              {title} <span>{l}</span>
            </div>
            <div className="desc">{desc}</div>
          </div>
        </button>
      ))}
      <div className="desc" style={{ padding: "14px 4px 0" }}>
        <button className="model" style={linkish} onClick={onLevelTest}>
          I'm not sure — take a short test
        </button>
      </div>

      <div className="sec" style={{ marginTop: 44 }}>Minutes a day</div>
      {TIMES.map(([n, name, desc]) => (
        <button key={n} className="srow" data-setting="daily-minutes" onClick={() => onChange({ dailyMinutes: n })}>
          <div className={`radio ${settings.dailyMinutes === n ? "on" : ""}`} />
          <div style={{ flex: 1 }}>
            <div className="name">
              {name} <span>about {n} minutes</span>
            </div>
            <div className="desc">{desc}</div>
          </div>
        </button>
      ))}

      <div className="sec" style={{ marginTop: 44 }}>Coaching</div>
      {TIMINGS.map(([id, name, desc, sketch]) => (
        <button key={id} className="srow" data-setting="coaching" onClick={() => onChange({ correctionTiming: id })}>
          <div className={`radio ${settings.correctionTiming === id ? "on" : ""}`} />
          <div style={{ flex: 1 }}>
            <div className="name">{name}</div>
            <div className="desc">{desc}</div>
            {/* What it looks like, so the choice can be understood without trying it. */}
            <div
              className="desc"
              style={{ marginTop: 6, padding: "7px 10px", background: "var(--accent-soft)", borderRadius: 7, maxWidth: 440 }}
            >
              {sketch}
            </div>
          </div>
        </button>
      ))}

      <div className="sec" style={{ marginTop: 44 }}>Interface</div>
      <div data-setting="keyboard-hints">
        <ToggleRow
          title="Keyboard hints"
          desc="The small shortcut lines under each screen."
          on={settings.showHints}
          onClick={() => onChange({ showHints: !settings.showHints })}
        />
      </div>
    </>
  );
}

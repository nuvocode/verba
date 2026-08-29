// The settings shell: the five sections, the one that is open, and the sentence
// the last change left behind. Nothing else — every setting lives in the section
// that owns it (src/views/settings/).
//
// Spec: docs/plans/2-verba-ana-ekran-ve-ayarlar-spec.md §5.1. The sections are
// named after the learner's questions, not the system's components, which is why
// there is no "Provider" section and no "Offline" one.
import { useEffect, useState } from "react";
import type { Settings } from "../lib/settings";
import { AT, type Applied } from "../lib/rules";
import { pending as pendingUpdate } from "../lib/update";
import { live } from "../lib/keys";
import { SETTINGS_INDEX } from "../lib/settingsIndex";
import { linkish } from "./settings/parts";
import Learning from "./settings/Learning";
import Speech from "./settings/Speech";
import Privacy from "./settings/Privacy";
import AboutMe from "./settings/AboutMe";
import Advanced from "./settings/Advanced";
import Hints from "./Hints";

/**
 * The five sections, in nav order, each labelled with the question it answers.
 * The id is also the hash: #settings/speech opens Speech and listening.
 */
const NAV = [
  ["learning", "Learning"],
  ["speech", "Speech and listening"],
  ["privacy", "Privacy and data"],
  ["about", "About me"],
  ["advanced", "Advanced"],
] as const;

export type Tab = (typeof NAV)[number][0];

const TAB_KEY = "verba.settingsTab";
const isTab = (s: string): s is Tab => NAV.some(([id]) => id === s);

/** Where the old eight panels went, so a link or a stored tab from 0.4 still lands. */
const MOVED: Record<string, Tab> = {
  language: "learning",
  coaching: "learning",
  offline: "privacy",
  data: "privacy",
  memory: "about",
  provider: "advanced",
  extensions: "advanced",
};

const resolve = (s: string): Tab | undefined => (isTab(s) ? s : MOVED[s]);

/** The section a `#settings/<tab>` hash names, if it names one we have. */
export function tabFromHash(): Tab | undefined {
  const t = /^#settings\/(\w+)/.exec(window.location.hash)?.[1];
  return t ? resolve(t) : undefined;
}

/** The row a `#settings/<tab>@<id>` hash names, if it names one. The id rides
 *  the hash so the palette and the search land on the same row — a link is the
 *  one thing both can hand to Settings. Ids carry hyphens (delete-everything),
 *  so the id class is `[\w-]`, not `\w`. */
function rowFromHash(): string | undefined {
  return /^#settings\/\w+@([\w-]+)/.exec(window.location.hash)?.[1];
}

/** Deep link first, then wherever they were last. A learner who left Settings on
 *  Speech comes back to Speech. */
function initialTab(): Tab {
  return tabFromHash() ?? resolve(localStorage.getItem(TAB_KEY) ?? "") ?? "learning";
}

export default function SettingsView({
  settings,
  onChange,
  notice,
  onDismissNotice,
  onLevelTest,
  appVersion,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** What the last change did, or why it did not happen (lib/rules). */
  notice: Applied | null;
  onDismissNotice: () => void;
  /** Hand the learner to the setup placement test and take the answer back (§5.3). */
  onLevelTest: () => void;
  /** Stamped into every backup and snapshot, so a file says which Verba wrote it. */
  appVersion: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // The search box (§5.2). A query matches a row's name *and* its description,
  // and picking a result opens the owning section and highlights the row in
  // place — not a separate results page, the target row scrolled to and marked.
  const [query, setQuery] = useState("");
  // The row currently being highlighted, by its index id.
  const [highlight, setHighlight] = useState("");

  // The tab is the URL: reload lands back here, and #settings/speech is a link
  // anything in the app can hand out.
  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
    if (tabFromHash() !== tab) window.history.replaceState(null, "", `#settings/${tab}`);
  }, [tab]);

  // …and a link followed while Settings is already open still moves the panel.
  // A `@<id>` suffix names a row to highlight — the palette and the search both
  // hand it over this way, so both land on the same row.
  useEffect(() => {
    const onHash = () => {
      const t = tabFromHash();
      if (t) setTab(t);
      const id = rowFromHash();
      if (id) setHighlight(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // A search result was picked: open its section, then scroll the row into view
  // and mark it for a moment. The highlight is a transient class, not a route —
  // the row is found by the same id the index keys on.
  useEffect(() => {
    if (!highlight) return;
    const el = document.querySelector(`[data-setting="${highlight}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("hl");
      const t = setTimeout(() => el.classList.remove("hl"), 1800);
      return () => clearTimeout(t);
    }
  }, [highlight]);

  const q = query.trim().toLowerCase();
  const hits = q
    ? SETTINGS_INDEX.filter((r) => (r.title + " " + r.desc).toLowerCase().includes(q))
    : [];
  // The result the arrow keys point at — the search box is a list like the
  // palette's, so it is driven the same way (§9: keyboard and mouse both work).
  const [active, setActive] = useState(0);

  const jump = (id: string, panel: keyof typeof AT) => {
    setQuery("");
    setTab(panel);
    setHighlight(id);
    // The id rides the hash, so the palette's link to the same row lands here
    // too — one way in, one arrival.
    window.history.replaceState(null, "", `#settings/${panel}@${id}`);
  };

  // The search box's own keys: ↑↓ move the highlight, Enter opens the row it
  // points at. The section-walk keys below stand down while a query is up, so
  // the two lists never fight over the same arrows.
  useEffect(() => {
    if (!q) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "") || el?.isContentEditable) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, hits.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const r = hits[Math.min(active, hits.length - 1)];
        if (r) jump(r.id, r.panel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, hits, active]);

  // Up/down or [ ] walks the sections — the same keys the palette uses, and Esc
  // still leaves for Today (App owns that). Typing in a field is never a shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "") || el?.isContentEditable) return;
      if (!live("settings", e.key)) return; // the table is the gate
      const step = e.key === "ArrowDown" || e.key === "]" ? 1 : e.key === "ArrowUp" || e.key === "[" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const i = NAV.findIndex(([id]) => id === tab);
      setTab(NAV[(i + step + NAV.length) % NAV.length][0]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const section = { settings, onChange };

  return (
    <div className="set fade">
      <nav className="setnav">
        {NAV.map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
            {/* What the quiet launch check found — the only place an update
                announces itself, and it waits here until Settings is opened. */}
            {id === "privacy" && pendingUpdate() && (
              <span className="badge" title={`Verba ${pendingUpdate()?.version} is available`} />
            )}
          </button>
        ))}
      </nav>

      {/* §5.2: a search field. It matches a setting's name and its description,
          and a result opens the section and highlights the row in place. */}
      <div className="field search" style={{ maxWidth: 480, margin: "0 4px 20px" }}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight("");
            setActive(0);
          }}
          placeholder="Search settings — voice, microphone, delete, language…"
          aria-label="Search settings"
        />
        {hits.length > 0 && (
          <div className="search-results">
            {hits.map((r, i) => (
              <button
                key={r.id}
                className={`pitem ${i === active ? "on" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => jump(r.id, r.panel)}
              >
                <span>{r.title}</span>
                <span className="desc">{r.desc}</span>
              </button>
            ))}
          </div>
        )}
        {/* §6: a query that matches nothing has a designed answer, not a silent
            box. The section walk is the way out — every setting is one key away. */}
        {q && hits.length === 0 && (
          <div className="search-results">
            <div className="pitem" style={{ cursor: "default" }}>
              <span>No setting matches “{query.trim()}”.</span>
              <span className="desc">Try a word from a setting's name or description.</span>
            </div>
          </div>
        )}
      </div>

      {/* The page title is the section you are in — §5.2. The product's tagline
          belongs on the way in, not on every settings page. Every section starts
          at this same line, so switching between them moves nothing. */}
      <h1 className="display">{NAV.find(([id]) => id === tab)?.[1]}</h1>

      {/* A change that was refused, and the doors out of it. Nothing was written;
          the learner picks which of the two they meant to move (#35). */}
      {notice?.refused && (
        <div className="err">
          {notice.refused.reason}
          <div style={{ marginTop: 8, display: "flex", gap: 16 }}>
            {notice.refused.exits.map((e) => (
              <a key={e.label} href={e.href} onClick={onDismissNotice} style={{ color: "inherit" }}>
                {e.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* A change that reached past its own row says what it did, and stays
          undoable while the sentence is on screen (#33). */}
      {notice?.consequence && (
        <div className="err" style={{ borderColor: "var(--line)", color: "var(--ink2)" }}>
          {notice.consequence}
          {notice.undo && (
            <div style={{ marginTop: 8 }}>
              <button
                style={{ ...linkish, padding: 0 }}
                onClick={() => {
                  onChange(notice.undo!);
                  onDismissNotice();
                }}
              >
                Undo
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "learning" && <Learning {...section} onLevelTest={onLevelTest} />}
      {tab === "speech" && <Speech {...section} />}
      {tab === "privacy" && <Privacy {...section} appVersion={appVersion} />}
      {tab === "about" && <AboutMe {...section} />}
      {tab === "advanced" && <Advanced {...section} />}

      {/* The section walk is a shortcut like any other — announced here, from the
          same table, so a key that works is a key that is shown. */}
      <Hints settings={settings} surface="settings" />
    </div>
  );
}

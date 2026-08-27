// The settings shell: the five sections, the one that is open, and the sentence
// the last change left behind. Nothing else — every setting lives in the section
// that owns it (src/views/settings/).
//
// Spec: docs/plans/2-verba-ana-ekran-ve-ayarlar-spec.md §5.1. The sections are
// named after the learner's questions, not the system's components, which is why
// there is no "Provider" section and no "Offline" one.
import { useEffect, useState } from "react";
import type { Settings } from "../lib/settings";
import type { Applied } from "../lib/rules";
import { pending as pendingUpdate } from "../lib/update";
import { linkish } from "./settings/parts";
import Learning from "./settings/Learning";
import Speech from "./settings/Speech";
import Privacy from "./settings/Privacy";
import AboutMe from "./settings/AboutMe";
import Advanced from "./settings/Advanced";

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

  // The tab is the URL: reload lands back here, and #settings/speech is a link
  // anything in the app can hand out.
  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
    if (tabFromHash() !== tab) window.history.replaceState(null, "", `#settings/${tab}`);
  }, [tab]);

  // …and a link followed while Settings is already open still moves the panel.
  useEffect(() => {
    const onHash = () => {
      const t = tabFromHash();
      if (t) setTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Up/down or [ ] walks the sections — the same keys the palette uses, and Esc
  // still leaves for Today (App owns that). Typing in a field is never a shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "") || el?.isContentEditable) return;
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
    </div>
  );
}

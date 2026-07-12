import { useCallback, useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings, isLocalProvider, type Settings } from "./lib/settings";
import type { BlockKind } from "./lib/learn";
import { useDay } from "./lib/useDay";
import { useTalk } from "./lib/useTalk";
import { useRead } from "./lib/useRead";
import Onboarding from "./views/Onboarding";
import Today from "./views/Today";
import Talk from "./views/Talk";
import Read from "./views/Read";
import Memory from "./views/Memory";
import Coach from "./views/Coach";
import SettingsView from "./views/Settings";
import "./theme.css";

export type Space = "onboarding" | "today" | "talk" | "read" | "memory" | "coach" | "settings";

const NAV: [string, Space, string][] = [
  ["Today", "today", "1"],
  ["Talk", "talk", "2"],
  ["Read", "read", "3"],
  ["Memory", "memory", "4"],
  ["Coach", "coach", "5"],
];

const PROVIDER_NAMES: Record<string, string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

interface PaletteItem {
  section?: string;
  label: string;
  kbd?: string;
  run: () => void;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [space, setSpace] = useState<Space>(() => (loadSettings().onboarded ? "today" : "onboarding"));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pIdx, setPIdx] = useState(0);
  const [reviewSignal, setReviewSignal] = useState(0);
  // A view (Memory's review) can claim the keyboard; global shortcuts stand down.
  const [captured, setCaptured] = useState(false);

  const day = useDay(settings);
  const talk = useTalk(settings);
  const read = useRead(settings);
  const paletteInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.dataset.vtheme = settings.theme;
  }, [settings.theme]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const go = useCallback((s: Space) => {
    setSpace(s);
    setPaletteOpen(false);
  }, []);

  /** Launch a block from the day's plan — each kind knows which space it opens. */
  const begin = useCallback(
    (kind: BlockKind) => {
      const block = day.plan?.blocks.find((b) => b.kind === kind);
      setPaletteOpen(false);
      switch (kind) {
        case "conversation":
        case "scenario":
          go("talk");
          if (!talk.started || talk.reflection) void talk.start(talk.scenarioById(block?.scenarioId), block?.goal);
          break;
        case "reading":
          go("read");
          if (!read.text && !read.busy) void read.generate({ interests: day.plan?.theme, goal: block?.goal });
          break;
        case "vocab":
          go("memory");
          setReviewSignal((n) => n + 1);
          break;
        case "summary":
          go("coach");
          void day.wrapUp();
          break;
      }
    },
    [day, talk, read, go],
  );

  const paletteItems = useCallback((): PaletteItem[] => {
    const items: PaletteItem[] = [
      { section: "Go to", label: "Today — your session plan", kbd: "1", run: () => go("today") },
      { label: "Talk — conversation with the coach", kbd: "2", run: () => go("talk") },
      { label: "Read — a passage at your level", kbd: "3", run: () => go("read") },
      { label: "Memory — everything you've met", kbd: "4", run: () => go("memory") },
      { label: "Coach — your weekly report", kbd: "5", run: () => go("coach") },
      { label: "Settings — providers, packs, offline", kbd: ",", run: () => go("settings") },
      {
        section: "Do",
        label: "Begin the next activity in today's session",
        kbd: "↵",
        run: () => day.next && begin(day.next),
      },
      { label: "Resurface the words that are due", kbd: "R", run: () => begin("vocab") },
      {
        label: "Generate a new reading passage",
        run: () => {
          go("read");
          void read.generate({ interests: day.plan?.theme });
        },
      },
      {
        label: `Switch to ${settings.theme === "dark" ? "light" : "dark"} theme`,
        run: () => update({ theme: settings.theme === "dark" ? "light" : "dark" }),
      },
      { label: "Replay onboarding", run: () => go("onboarding") },
    ];

    const q = query.trim();
    if (!q) return items;
    const hits: PaletteItem[] = items
      .filter((i) => i.label.toLowerCase().includes(q.toLowerCase()))
      .map((i) => ({ ...i, section: undefined }));
    // Anything the palette can't route becomes a question for the coach.
    hits.push({
      section: hits.length ? "Ask the coach" : undefined,
      label: `Ask the coach: “${q}”`,
      kbd: "AI",
      run: () => {
        setPaletteOpen(false);
        go("talk");
        void talk.ask(q);
      },
    });
    return hits;
  }, [query, go, begin, day, read, talk, settings.theme, update]);

  // ---- keyboard: every screen is reachable without the mouse ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "") || !!el?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        setQuery("");
        setPIdx(0);
        return;
      }
      if (paletteOpen) {
        const items = paletteItems();
        if (e.key === "Escape") return setPaletteOpen(false);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          return setPIdx((i) => Math.min(i + 1, items.length - 1));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          return setPIdx((i) => Math.max(i - 1, 0));
        }
        if (e.key === "Enter") {
          e.preventDefault();
          items[Math.min(pIdx, items.length - 1)]?.run();
        }
        return;
      }
      if (e.key === "Escape") {
        if (read.popover) return read.closePopover();
        if (space === "read" && read.focusIdx >= 0) return read.setFocusIdx(-1);
        if (space === "talk" && talk.started && !talk.reflecting) return void talk.end();
        return;
      }
      if (typing || captured || space === "onboarding") return;

      if (space === "talk" && !talk.reflecting && /^[1-3]$/.test(e.key)) {
        const s = talk.suggestions[Number(e.key) - 1];
        if (s) return void talk.send(s, true);
      }
      if (space === "read" && read.text) {
        const last = read.text.sentences.length - 1;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          return read.setFocusIdx(Math.min(read.focusIdx + 1, last));
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          return read.setFocusIdx(Math.max(read.focusIdx - 1, 0));
        }
        if (e.key.toLowerCase() === "t") return read.toggleBilingual();
      }
      if (space === "today" && e.key === "Enter" && day.next) return begin(day.next);

      const nav: Record<string, Space> = {
        "1": "today",
        "2": "talk",
        "3": "read",
        "4": "memory",
        "5": "coach",
        ",": "settings",
      };
      if (nav[e.key]) go(nav[e.key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [space, paletteOpen, pIdx, paletteItems, talk, read, day, begin, go, captured]);

  useEffect(() => {
    if (paletteOpen) paletteInput.current?.focus();
  }, [paletteOpen]);

  if (space === "onboarding")
    return (
      <div className="shell">
        <Onboarding
          settings={settings}
          onDone={(patch) => {
            update({ ...patch, onboarded: true });
            go("today");
          }}
          onSkip={() => {
            update({ onboarded: true });
            go("today");
          }}
        />
      </div>
    );

  const local = isLocalProvider(settings.provider);
  const items = paletteItems();
  const active = Math.min(pIdx, items.length - 1);

  return (
    <div className="shell">
      <div className="topbar">
        <button className="logo" onClick={() => go("today")}>
          Speaksy<b>.</b>
        </button>
        <div className="nav">
          {NAV.map(([label, key, kbd]) => (
            <button key={key} className={`nav-item ${space === key ? "on" : ""}`} onClick={() => go(key)}>
              <span>{label}</span>
              <span className="k">{kbd}</span>
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="dots" title="Today's session">
          {(day.plan?.blocks ?? []).map((b) => (
            <div
              key={b.kind}
              className={`dot ${day.isDone(b.kind) ? "done" : ""}`}
              title={`${b.title}${day.isDone(b.kind) ? " — done" : ""}`}
            />
          ))}
        </div>
        <button className="status" onClick={() => go("settings")} title="Where the AI runs — open Settings">
          <span className={`led ${local ? "" : "cloud"}`} />
          <span>
            {PROVIDER_NAMES[settings.provider] ?? settings.provider} · {local ? "local" : "cloud"}
          </span>
        </button>
        <button
          className="icon-btn"
          onClick={() => update({ theme: settings.theme === "dark" ? "light" : "dark" })}
          title="Toggle theme"
        >
          {settings.theme === "dark" ? "☀" : "☾"}
        </button>
        <button
          className="anything"
          onClick={() => {
            setPaletteOpen(true);
            setQuery("");
            setPIdx(0);
          }}
        >
          <span>Anything</span>
          <span className="k">⌘K</span>
        </button>
      </div>

      <div className="body">
        {space === "today" && <Today settings={settings} day={day} onBegin={begin} />}
        {space === "talk" && <Talk settings={settings} talk={talk} day={day} onBegin={begin} />}
        {space === "read" && <Read settings={settings} read={read} day={day} onBegin={begin} />}
        {space === "memory" && (
          <Memory
            settings={settings}
            day={day}
            autoReview={reviewSignal}
            onFinish={() => go("today")}
            onCaptureKeys={setCaptured}
          />
        )}
        {space === "coach" && <Coach settings={settings} day={day} />}
        {space === "settings" && <SettingsView settings={settings} onChange={update} />}
      </div>

      {paletteOpen && (
        <div className="scrim" onClick={() => setPaletteOpen(false)}>
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <input
              ref={paletteInput}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPIdx(0);
              }}
              placeholder={`Jump anywhere, start anything, or ask about ${settings.targetLang}…`}
            />
            <div className="list">
              {items.map((item, i) => (
                <div key={item.label}>
                  {item.section && <div className="sect">{item.section}</div>}
                  <button
                    className={`pitem ${i === active ? "on" : ""}`}
                    onMouseEnter={() => setPIdx(i)}
                    onClick={item.run}
                  >
                    <span style={{ flex: 1 }}>{item.label}</span>
                    <span className="k">{item.kbd}</span>
                  </button>
                </div>
              ))}
            </div>
            <div className="foot">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

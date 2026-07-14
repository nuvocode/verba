import { useCallback, useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings, isLocalProvider, onboardingReset, type Settings } from "./lib/settings";
import { installed } from "./lib/bundled";
import { pruneBundled } from "./lib/speech";
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

const isSettingsHash = () => window.location.hash.startsWith("#settings");

interface PaletteItem {
  section?: string;
  label: string;
  kbd?: string;
  run: () => void;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [space, setSpace] = useState<Space>(() =>
    !loadSettings().onboarded ? "onboarding" : isSettingsHash() ? "settings" : "today",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pIdx, setPIdx] = useState(0);
  const [reviewSignal, setReviewSignal] = useState(0);
  // A view (Memory's review) can claim the keyboard; global shortcuts stand down.
  const [captured, setCaptured] = useState(false);
  // Replaying onboarding throws away the current setup — never on one stray click.
  const [confirmReplay, setConfirmReplay] = useState(false);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const day = useDay(settings);
  // Talk can write a level back: if onboarding was skipped, the first conversation places them.
  const talk = useTalk(settings, update);
  const read = useRead(settings);
  const paletteInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.dataset.vtheme = settings.theme;
  }, [settings.theme]);

  // A bundled model id in settings is a claim about the disk, and the disk can be
  // cleared behind the app's back. Check it once, on the way in: a model that is gone
  // has to stop winning the precedence race *before* the first turn, not on it. The
  // settings are patched through the same setter as everything else, so the Speech
  // panel and the adapter read the same corrected truth.
  useEffect(() => {
    void installed().then((list) => {
      if (!list) return; // could not look — leave the learner's choice alone
      const onDisk = new Set(list.map((m) => m.id));
      setSettings((s) => {
        const patch = pruneBundled(s, onDisk);
        if (!Object.keys(patch).length) return s;
        const next = { ...s, ...patch };
        saveSettings(next);
        return next;
      });
    });
  }, []);

  const go = useCallback((s: Space) => {
    setSpace(s);
    setPaletteOpen(false);
    // #settings/speech names a panel, not a place to come back to — leaving Settings
    // drops it, or the next reload would land on Settings instead of Today.
    if (s !== "settings" && isSettingsHash()) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // A link to #settings/<panel> — the speech fallback notice is one — opens Settings.
  // Which panel is Settings' own business; it reads the same hash.
  useEffect(() => {
    const onHash = () => isSettingsHash() && setSpace("settings");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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
        label: "Read the passage out loud — the teleprompter",
        kbd: "P",
        run: () => {
          go("read");
          update({ readView: "prompter" });
        },
      },
      {
        label: `Switch to ${settings.theme === "dark" ? "light" : "dark"} theme`,
        run: () => update({ theme: settings.theme === "dark" ? "light" : "dark" }),
      },
      {
        label: "Replay onboarding — clears your setup",
        run: () => {
          setPaletteOpen(false);
          setConfirmReplay(true);
        },
      },
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

  // The one thing Esc does on this screen. The key and the visible pill run it, so nobody
  // has to know the shortcut exists. Memory's review owns its own Esc while it's captured.
  const escape: { label: string; run: () => void } | null = captured
    ? null
    : read.popover
      ? { label: "close the word", run: () => read.closePopover() }
      : space === "read" && settings.readView === "passage" && read.focusIdx >= 0
        ? { label: "clear focus", run: () => read.setFocusIdx(-1) }
        : space === "talk" && talk.started && !talk.reflecting
          ? { label: "end the session", run: () => void talk.end() }
          : space !== "today" && space !== "onboarding"
            ? { label: "back to Today", run: () => go("today") }
            : null;

  // ---- keyboard: every screen is reachable without the mouse ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "") || !!el?.isContentEditable;

      if (confirmReplay) {
        if (e.key === "Escape") setConfirmReplay(false);
        if (e.key === "Enter") {
          update({ ...onboardingReset() });
          setConfirmReplay(false);
          go("onboarding");
        }
        return;
      }
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
        if (typing) return (el as HTMLInputElement).blur(); // out of the field first, then out of the screen
        escape?.run();
        return;
      }
      if (typing || captured || space === "onboarding") return;

      if (space === "talk" && !talk.reflecting && /^[1-3]$/.test(e.key)) {
        const s = talk.suggestions[Number(e.key) - 1];
        if (s) return void talk.send(s, true);
      }
      if (space === "read" && read.text) {
        // P is the door between the two views, and it is open from both sides.
        if (e.key.toLowerCase() === "p")
          return update({ readView: settings.readView === "prompter" ? "passage" : "prompter" });
        // Everything else on this screen belongs to close reading. The teleprompter is
        // moving text with its own keys (space, +, −, arrows) — it takes them itself, and
        // these stand down for as long as it is up.
        if (settings.readView === "passage") {
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
  }, [
    space,
    paletteOpen,
    pIdx,
    paletteItems,
    talk,
    read,
    day,
    begin,
    go,
    captured,
    escape,
    confirmReplay,
    update,
    settings.readView,
  ]);

  useEffect(() => {
    if (paletteOpen) paletteInput.current?.focus();
  }, [paletteOpen]);

  if (space === "onboarding")
    return (
      <div className="shell">
        <Onboarding
          settings={settings}
          onDone={(patch, dest = "today") => {
            update({ ...patch, onboarded: true });
            go(dest);
          }}
          // Only a learner who already finished setup has somewhere to escape to.
          onExit={settings.onboarded ? () => go("today") : undefined}
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
          Verba<b>.</b>
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
        {space === "read" && (
          <Read
            settings={settings}
            read={read}
            day={day}
            onBegin={begin}
            onCaptureKeys={setCaptured}
            onChange={update}
          />
        )}
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

      {escape && !paletteOpen && !confirmReplay && (
        <button className="escape" onClick={escape.run}>
          <span className="kbd">esc</span> {escape.label}
        </button>
      )}

      {confirmReplay && (
        <div className="scrim" onClick={() => setConfirmReplay(false)}>
          <div className="palette confirm" onClick={(e) => e.stopPropagation()}>
            <h2>Start setup over?</h2>
            <p>
              Your language, level, daily rhythm and interests are cleared, and Verba walks you through setup from the
              first screen. Your saved words, conversations and progress are <strong>not</strong> touched — neither is
              your AI provider.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn sm ghost" onClick={() => setConfirmReplay(false)}>
                <span className="kbd">esc</span> Keep my setup
              </button>
              <button
                className="btn sm"
                autoFocus
                onClick={() => {
                  update({ ...onboardingReset() });
                  setConfirmReplay(false);
                  go("onboarding");
                }}
              >
                <span className="kbd">↵</span> Clear it and replay
              </button>
            </div>
          </div>
        </div>
      )}

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

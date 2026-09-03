import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSettings, saveSettings, isLocalProvider, onboardingReset, type Settings } from "./lib/settings";
import { applyPatch, type Applied } from "./lib/rules";
import { catalogModel, installed } from "./lib/bundled";
import { prunedNote, pruneBundled } from "./lib/speech";
import type { ActivityKind, SignalDraft } from "./lib/model";
import { useDay } from "./lib/useDay";
import { useTalk } from "./lib/useTalk";
import { useRead } from "./lib/useRead";
import { useListening } from "./lib/useListening";
import { live as keyLive, navLive } from "./lib/keys";
import { PROVIDERS } from "./lib/models";
import { SETTINGS_INDEX, hashOf } from "./lib/settingsIndex";
import Onboarding from "./views/Onboarding";
import Today from "./views/Today";
import Talk from "./views/Talk";
import Read from "./views/Read";
import Listening from "./views/Listening";
import Memory from "./views/Memory";
import Coach from "./views/Coach";
import SettingsView from "./views/Settings";
import { ConflictDialog } from "./views/DataPanel";
import { checkOnLaunch } from "./lib/update";
import { configure as configureVault, flush, type Conflict, type SyncResult } from "./lib/vault";
import "./theme.css";

export type Space = "onboarding" | "today" | "talk" | "read" | "listening" | "memory" | "coach" | "settings";

// Listen sits next to Read — the two input skills, and the two that share the
// question layer — so the six keys read 1-6 down the bar rather than bolting the
// newcomer on at the end.
const NAV: [string, Space, string][] = [
  ["Today", "today", "1"],
  ["Talk", "talk", "2"],
  ["Read", "read", "3"],
  ["Listen", "listening", "4"],
  ["Memory", "memory", "5"],
  ["Coach", "coach", "6"],
];

/** Which planned activity a space carries. Coach, Today and Settings carry none. */
const SPACE_ACTIVITY: Partial<Record<Space, ActivityKind>> = {
  talk: "talk",
  read: "read",
  listening: "listen",
  memory: "memory",
};

const isSettingsHash = () => window.location.hash.startsWith("#settings");

interface PaletteItem {
  section?: string;
  label: string;
  /** A searchable description — the settings rows carry theirs from the index. */
  desc?: string;
  kbd?: string;
  run: () => void;
}

export default function App({ appVersion, boot }: { appVersion: string; boot: SyncResult & { error?: string } }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [space, setSpace] = useState<Space>(() =>
    !loadSettings().onboarded ? "onboarding" : isSettingsHash() ? "settings" : "today",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pIdx, setPIdx] = useState(0);
  const [reviewSignal, setReviewSignal] = useState(0);
  // PLAN-034: the rehearsal brief form, opened from ⌘K ("Rehearse a conversation
  // you have to have") and from Today's overflow. It is a form over the Talk
  // surface, not a route — Talk renders it, App only decides whether it is open.
  const [rehearsalDraft, setRehearsalDraft] = useState(false);
  // A view (Memory's review) can claim the keyboard; global shortcuts stand down.
  const [captured, setCaptured] = useState(false);
  // Replaying onboarding throws away the current setup — never on one stray click.
  const [confirmReplay, setConfirmReplay] = useState(false);
  // Two machines edited the same sync folder. Raised by the launch reconcile in
  // main.tsx, or by a push that found the folder had moved under it.
  const [conflict, setConflict] = useState<Conflict | null>(boot.conflict ?? null);
  const [syncErr, setSyncErr] = useState(boot.error ?? "");

  // The one door every settings write goes through. lib/rules decides what a
  // patch is allowed to do, so setup and Settings cannot disagree about a rule —
  // and a refused change never reaches disk. The ref is what lets this stay a
  // stable callback: half the app takes `update` as a dependency.
  const live = useRef(settings);
  live.current = settings;
  const [notice, setNotice] = useState<Applied | null>(null);
  const [levelTest, setLevelTest] = useState(false);

  const update = useCallback((patch: Partial<Settings>) => {
    const applied = applyPatch(live.current, patch);
    setNotice(applied.refused || applied.consequence ? applied : null);
    if (applied.refused) return;
    // Ahead of the re-render, so a second update in the same tick reads this
    // change rather than the one it replaced.
    live.current = applied.next;
    saveSettings(applied.next);
    setSettings(applied.next);
  }, []);

  const day = useDay(settings);
  // Talk can write a level back: if onboarding was skipped, the first conversation places them.
  const talk = useTalk(settings, update);
  const read = useRead(settings);
  const listening = useListening(settings, update);
  const paletteInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.dataset.vtheme = settings.theme;
  }, [settings.theme]);

  /**
   * Hand the vault its two outbound edges: which version stamps a snapshot, and
   * where a background failure or a clash is allowed to appear. Everything that
   * *triggers* a push is already wired — every DB write goes through one door in
   * lib/db.ts, and settings save through `update` below.
   *
   * The extra push when the window is hidden is the one that matters most in
   * practice: the debounce is four seconds, and closing the lid on a finished
   * conversation is exactly the moment a learner expects it to have been saved.
   */
  useEffect(() => {
    configureVault(appVersion, { error: (e) => setSyncErr(String((e as any)?.message ?? e)), conflict: setConflict });
    // One quiet check per launch. It contacts nothing under offline mode, says
    // nothing on failure, and shows up only as a badge in Settings.
    void checkOnLaunch(settings.offline, settings.betaUpdates);
    const onHide = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [appVersion]);

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
        // §7 row 3: the falling back is half the answer. A voice that was cleared
        // without a word is a voice that appears to have stopped working on its
        // own — so this rides the same notice every other wide change uses, and
        // its link lands on the panel that can download the model again.
        const note = prunedNote(s, patch, (id) => catalogModel(id)?.label ?? id);
        if (note) setNotice({ next, consequence: note });
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

  /** Launch an activity from the day's plan — each kind knows which space it opens. */
  const begin = useCallback(
    (kind: ActivityKind) => {
      const activity = day.plan?.activities.find((a) => a.kind === kind);
      setPaletteOpen(false);
      switch (kind) {
        case "talk":
        case "roleplay":
          go("talk");
          if (!talk.started || talk.reflection) void talk.start(talk.scenarioById(activity?.scenarioId), "normal", undefined, activity?.goal);
          break;
        case "read":
          go("read");
          if (!read.text && !read.busy)
            void day.carry(activity?.dependsOn ?? "").then((reuse) =>
              read.generate({ interests: day.plan?.theme, goal: activity?.goal, reuse }),
            );
          break;
        case "listen":
          go("listening");
          if (!listening.piece && !listening.busy)
            void listening.resume().then((resumed) => {
              if (!resumed) void listening.generate({ interests: day.plan?.theme, goal: activity?.goal });
            });
          break;
        case "memory":
          go("memory");
          setReviewSignal((n) => n + 1);
          break;
        case "wrapup":
          go("coach");
          void day.wrapUp();
          break;
        default: {
          // Compile-time exhaustiveness: a new ActivityKind without a case fails here.
          const _exhaustive: never = kind;
          void _exhaustive;
        }
      }
    },
    [day, talk, read, listening, go],
  );

  /**
   * Entering a surface from the nav (§2.1). A surface that is on today's plan and
   * not yet finished opens *its* activity, with the plan's theme, scenario and
   * goal — not a blank screen that invents its own content. Everything else is a
   * plain move.
   */
  const enter = useCallback(
    (s: Space) => {
      const kind = SPACE_ACTIVITY[s];
      const activity = kind && day.plan?.activities.find((a) => a.kind === kind);
      if (activity && !day.isDone(activity.kind)) return begin(activity.kind);
      go(s);
    },
    [day, begin, go],
  );

  /**
   * Finish a block and hand the learner to whatever the plan actually has next — on a
   * normal day, reading hands off to the role-play. Only the plan decides; no screen gets
   * to guess. Nothing left to do means the day is over, and the honest place to land is
   * Today, where they can see that.
   */
  const advance = useCallback(
    async (kind: ActivityKind, signals?: SignalDraft[]) => {
      const next = await day.complete(kind, signals);
      if (next) begin(next);
      else go("today");
    },
    [day, begin, go],
  );

  const paletteItems = useCallback((): PaletteItem[] => {
    const q = query.trim();
    const items: PaletteItem[] = [
      { section: "Go to", label: "Today — your session plan", kbd: "1", run: () => go("today") },
      { label: "Talk — conversation with the coach", kbd: "2", run: () => enter("talk") },
      { label: "Read — a passage at your level", kbd: "3", run: () => enter("read") },
      { label: "Listen — a chaptered story to hear", kbd: "4", run: () => enter("listening") },
      { label: "Memory — everything you've met", kbd: "5", run: () => enter("memory") },
      { label: "Coach — your weekly report", kbd: "6", run: () => go("coach") },
      { label: "Settings — providers, packs, offline", kbd: ",", run: () => go("settings") },
      // PLAN-034: the rehearsal. Not a planned activity and not an ActivityKind —
      // something the learner reaches for when life demands it, entered when it
      // is asked for, never scheduled.
      {
        label: "Rehearse a conversation you have to have",
        desc: "The coach plays the other side, then steps out and talks it through",
        run: () => {
          go("talk");
          if (talk.rehearsal && !talk.outOfRole) return; // a role-play is already running
          setRehearsalDraft(true);
        },
      },
      // Every settings row, from the one index — the same list the Settings
      // search reads, so the palette and the search cannot describe a setting
      // differently (#29). They join only once a query is typed: the palette is
      // a launcher, and a bare ⌘K should not dump the whole settings catalog
      // (§4.4). Picking one opens Settings on its section.
      ...(q
        ? SETTINGS_INDEX.map((row) => ({
            section: "Settings",
            label: row.title,
            desc: row.desc,
            run: () => {
              go("settings");
              // The id rides the hash so Settings highlights the row, not just
              // the section — the same arrival the search box gives (#29).
              window.location.hash = `${hashOf(row)}@${row.id}`;
            },
          }))
        : []),
      {
        section: "Do",
        label: "Begin the next activity in today's session",
        kbd: "↵",
        run: () => day.next && begin(day.next),
      },
      // No R badge: there is no global R — Memory's own R is a surface key, and a
      // badge here would announce a shortcut that does not work from this screen.
      { label: "Resurface the words that are due", run: () => begin("memory") },
      {
        label: "Generate a new reading passage",
        run: () => {
          go("read");
          void read.generate({ interests: day.plan?.theme });
        },
      },
      {
        label: "Start a listening session",
        run: () => {
          go("listening");
          if (!listening.piece && !listening.busy)
            void listening.resume().then((resumed) => {
              if (!resumed) void listening.generate({ interests: day.plan?.theme });
            });
        },
      },
      {
        label: "Read the passage out loud — the teleprompter",
        // P is a Read surface key, so the badge only shows where it works.
        kbd: space === "read" ? "P" : undefined,
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
        // PLAN-031: "Do not push me today" — the ⌘K path to the same ask the
        // learner can make in the conversation, so it works with no mic and no
        // ambiguity. Unconditional for the rest of the session; forgotten
        // tomorrow. Named as the ask itself — nothing about difficulty is ever
        // announced on a surface.
        label: "Don't push me today",
        desc: "Ask the coach for a gentle session today",
        run: () => {
          setPaletteOpen(false);
          go("talk");
          talk.ease();
        },
      },
      {
        label: "Replay onboarding — clears your setup",
        run: () => {
          setPaletteOpen(false);
          setConfirmReplay(true);
        },
      },
    ];

    if (!q) return items;
    const hits: PaletteItem[] = items
      .filter((i) => (i.label + " " + (i.desc ?? "")).toLowerCase().includes(q.toLowerCase()))
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
  }, [query, go, enter, begin, day, read, talk, listening, settings.theme, update, space]);

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

  // What a surface key is claiming from navigation right now. Talk's 1–3 send a
  // suggestion only while suggestions are on screen; the scenario picker and the
  // reflection offer none, so there the numbers are the nav numbers again. The
  // topbar badge and the handler read this same value, so they cannot disagree.
  const claimed = useMemo(
    () => (space === "talk" && !talk.reflecting && talk.suggestions.length > 0 ? ["suggestions"] : []),
    [space, talk.reflecting, talk.suggestions.length],
  );

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

      // From here down the table is the gate (#30): a key lib/keys does not list
      // on this surface does nothing at all. Esc and ⌘K sit above this line on
      // purpose — they are global, and the escape pill and the Anything button
      // announce them, not the hint line.
      if (!keyLive(space, e.key)) return;

      // A chord is not a bare key. ⌘K is handled above; anything else held with a
      // modifier (⌘, ⌃, ⌥) must not trip a single-letter shortcut — the learner
      // is reaching for a browser or OS chord, not the app's table.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (space === "talk" && !talk.reflecting && /^[1-3]$/.test(e.key)) {
        const s = talk.suggestions[Number(e.key) - 1];
        if (s) return void talk.send(s, true);
      }
      // Subtitles (PLAN-021): `s` toggles the coach's text. The composer has
      // focus while the learner is typing, so `live()` already stands it down
      // there — this only fires when the box is not the target.
      if (space === "talk" && e.key.toLowerCase() === "s") {
        e.preventDefault();
        return update({ subtitles: !settings.subtitles });
      }
      // The rehearsal's "end the role-play" (PLAN-034): the learner decides when
      // it is over, and the key says the same thing the button does.
      if (space === "talk" && e.key.toLowerCase() === "e" && talk.rehearsal && !talk.outOfRole) {
        e.preventDefault();
        return void talk.endRole();
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
          // From no focus, down/right focuses the first sentence; otherwise the
          // arrows walk the focus one sentence at a time.
          const next = read.focusIdx < 0 ? 0 : Math.min(read.focusIdx + 1, last);
          const prev = read.focusIdx < 0 ? 0 : Math.max(read.focusIdx - 1, 0);
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            return read.setFocusIdx(next);
          }
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            return read.setFocusIdx(prev);
          }
          if (e.key.toLowerCase() === "t") return read.toggleBilingual();
        }
      }
      if (space === "today" && e.key === "Enter" && day.next) return begin(day.next);

      // Memory's R starts the resurfacing — the same action the "Resurface due"
      // button promises, so the badge and the key agree. Review mode owns its own
      // keys (App stands down while it is captured), so this is the collection only.
      if (space === "memory" && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setReviewSignal((n) => n + 1);
        return;
      }

      // Listening is a media surface: Space plays and stops the chapter. The label
      // says what it does — "stop", not "pause", because the surface stops (§6).
      if (space === "listening" && e.key === " ") {
        e.preventDefault();
        if (listening.playing) listening.stop();
        else void listening.play();
        return;
      }
      // The transcript toggle (PLAN-026): `t` opens or closes it. Opening it once
      // marks the chapter assisted — recorded, never scored.
      if (space === "listening" && e.key.toLowerCase() === "t") {
        e.preventDefault();
        listening.reveal();
        return;
      }
      // Replay the line a wrong answer came from (PLAN-026): `r` plays
      // spans[lineIdx] and stops at its end. Only live while a miss panel is
      // showing the replay button — the hint line announces it only then.
      if (space === "listening" && e.key.toLowerCase() === "r") {
        const q = listening.chapter?.questions[listening.progress.step];
        const miss = listening.progress.results[listening.progress.step] === false;
        if (q && miss) {
          e.preventDefault();
          listening.replayRange(q.lineIdx);
          return;
        }
      }

      // The nav keys come from the one table, and only where they are actually
      // live: on Talk, 1–3 are suggestions *while suggestions are on screen*, and
      // plain nav keys before and after that.
      if (navLive(space, e.key, claimed)) {
        const dest: Record<string, Space> = {
          "1": "today",
          "2": "talk",
          "3": "read",
          "4": "listening",
          "5": "memory",
          "6": "coach",
          ",": "settings",
        };
        const to = dest[e.key];
        if (to) enter(to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    space,
    claimed,
    paletteOpen,
    pIdx,
    paletteItems,
    talk,
    read,
    listening,
    day,
    begin,
    go,
    enter,
    captured,
    escape,
    confirmReplay,
    update,
    settings.readView,
  ]);
  useEffect(() => {
    if (paletteOpen) paletteInput.current?.focus();
  }, [paletteOpen]);

  // Rendered from both branches: a clash found at launch has to be answerable
  // even by someone who is still in setup, having just pointed a fresh install
  // at a folder that turned out to have moved.
  const conflictDialog = conflict && (
    <ConflictDialog remote={conflict.remote} appVersion={appVersion} onDone={() => setConflict(null)} />
  );

  // Settings → Learning sends the learner here for "I'm not sure — take a short
  // test": the setup test, run on its own and handed straight back, rather than a
  // second placement test living in Settings with its own idea of the answer.
  if (levelTest)
    return (
      <div className="shell">
        <Onboarding
          settings={settings}
          only={{ step: 4, back: "settings" }}
          onDone={(patch) => {
            update(patch);
            setLevelTest(false);
          }}
          onExit={() => setLevelTest(false)}
        />
        {conflictDialog}
      </div>
    );

  if (space === "onboarding")
    return (
      <div className="shell">
        <Onboarding
          settings={settings}
          onDone={(patch, dest = "today") => {
            update({ ...patch, onboarded: true });
            go(dest);
          }}
          // Persist every answer as setup progresses, so closing the app resumes
          // where it left off rather than starting over (§6). Not passed on the
          // single-step level-test run — that answers one question and returns.
          onSave={(patch) => update(patch)}
          // Only a learner who already finished setup has somewhere to escape to.
          onExit={settings.onboarded ? () => go("today") : undefined}
        />
        {conflictDialog}
      </div>
    );

  const local = isLocalProvider(settings.provider);
  const items = paletteItems();
  const active = Math.min(pIdx, items.length - 1);
  // The provider's name, host and model are the detail behind the status — the
  // badge itself says only where the AI runs (§4.3: the commercial name does not
  // sit in the bar, it is a hover away).
  const provider = PROVIDERS.find((p) => p.id === settings.provider);
  const statusTitle = provider
    ? `${provider.name} · ${local ? "runs on this computer" : "online"} · ${String(settings[provider.model] ?? "")}`
    : "Where the AI runs — open Settings";

  return (
    <div className="shell">
      <div className="topbar">
        <button className="logo" onClick={() => go("today")}>
          Verba<b>.</b>
        </button>
        <div className="nav">
          {NAV.map(([label, key, kbd]) => (
            <button key={key} className={`nav-item ${space === key ? "on" : ""}`} onClick={() => enter(key)}>
              <span>{label}</span>
              {/* The badge is the shortcut, and only where the shortcut is live: on
                  Talk, 1–3 are suggestions, so the bar shows no numbers there. */}
              {navLive(space, kbd, claimed) && <span className="k">{kbd}</span>}
              {/* Memory's due count is a *counter*, not a shortcut — a separate badge
                  that says what it counts, so a bare number never stands alone. */}
              {key === "memory" && day.due > 0 && (
                <span className="count" title={`${day.due} ${day.due === 1 ? "word" : "words"} due for resurfacing`}>
                  {day.due}
                </span>
              )}
            </button>
          ))}
          {/* Settings is not one of the six sections, so it sits apart from them —
              a separate entry at the end of the bar, not a seventh nav item. */}
          <button className={`nav-item ${space === "settings" ? "on" : ""}`} onClick={() => go("settings")}>
            <span>Settings</span>
            {navLive(space, ",", claimed) && <span className="k">,</span>}
          </button>
        </div>
        <div className="spacer" />
        {/* The day's plan, as a sentence — Today already says it; a second, unlabelled
            strip would be a second language for the same fact (§4.3). */}
        <button className="status" onClick={() => go("settings")} title={statusTitle}>
          <span className={`led ${local ? "" : "cloud"}`} />
          <span>{local ? "On this computer" : "Online"}</span>
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
        {space === "today" && <Today settings={settings} day={day} onBegin={begin} onOpen={go} onRehearse={() => { go("talk"); setRehearsalDraft(true); }} />}
        {space === "talk" && (
          <Talk
            settings={settings}
            talk={talk}
            day={day}
            onAdvance={advance}
            onChange={update}
            rehearsalDraft={rehearsalDraft}
            onCloseRehearsalDraft={() => setRehearsalDraft(false)}
          />
        )}
        {space === "read" && (
          <Read
            settings={settings}
            read={read}
            day={day}
            onAdvance={advance}
            onCaptureKeys={setCaptured}
            onChange={update}
            onSettings={() => go("settings")}
            onBrought={(text) => {
              go("talk");
              void talk.startBrought(text);
            }}
          />
        )}
        {space === "listening" && (
          <Listening settings={settings} listening={listening} day={day} onAdvance={advance} />
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
        {space === "settings" && (
          <SettingsView
            settings={settings}
            onChange={update}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            onLevelTest={() => setLevelTest(true)}
            appVersion={appVersion}
          />
        )}
      </div>

      {/* A folder that couldn't be reached. Said once, dismissable, and never a
          reason to stop working — the data is on this machine either way. */}
      {syncErr && !conflict && (
        <button className="escape" onClick={() => setSyncErr("")} title={syncErr}>
          <span className="kbd">sync</span> Your sync folder couldn't be reached
        </button>
      )}

      {conflictDialog}

      {escape && !paletteOpen && !confirmReplay && !conflict && (
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
              placeholder={`Jump anywhere, start anything, or ask about ${settings.profile.targetLanguage}…`}
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
                    <span style={{ flex: 1 }}>
                      {item.label}
                      {item.desc && <span className="desc">{item.desc}</span>}
                    </span>
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

// The one keyboard map. Every shortcut the app answers to lives here, and a
// shortcut that is not here cannot fire — `live` is the gate every handler
// stands behind, and `keysFor` is the only source the hint lines read. One
// table, so "announced" and "working" are the same list by construction.
//
// Spec: docs/plans/2-verba-ana-ekran-ve-ayarlar-spec.md §3.1. Issues #28, #30.

export type Surface =
  | "today" | "talk" | "read" | "prompter" | "listening"
  | "memory" | "review" | "coach" | "settings" | "onboarding";

export interface Shortcut {
  /** The KeyboardEvent.key values that trigger this — a shortcut can answer to
   *  several (the prompter's "+" and "=" are the same action). */
  keys: string[];
  /** The key as the hint line shows it ("↵", "1–6", "space"). A function lets a
   *  label depend on the surface's state (onboarding's real option count). */
  label: string | ((has: string[]) => string);
  /** What it does, one verb phrase ("begin next", "play the chapter"). */
  does: string;
  /** The surfaces this shortcut is live on. */
  on: Surface[];
  /** A navigation key — rendered as a topbar badge, not in the hint line. */
  nav?: boolean;
  /** A chord (⌘K) or a key handled above the surface blocks — never a bare-key
   *  gate, so `live` ignores it. Still announced by `keysFor`. */
  global?: boolean;
  /** Only shown in the hint line when the named flag is in `keysFor`'s `has`. */
  when?: string;
}

// Navigation works on every screen except Talk (where 1–3 are suggestions) and
// the flows that own their keys (onboarding, review). The comma → Settings is
// not a suggestion on Talk, so it stays live there.
const NAV: Surface[] = ["today", "read", "prompter", "listening", "memory", "coach", "settings"];
const NAV_ALL: Surface[] = [...NAV, "talk"];
const SURFACES: Surface[] = [
  "today", "talk", "read", "prompter", "listening",
  "memory", "review", "coach", "settings", "onboarding",
];

export const KEYS: Shortcut[] = [
  // ---- navigation — the topbar badges ----
  { keys: ["1"], label: "1", does: "Today", on: NAV, nav: true },
  { keys: ["2"], label: "2", does: "Talk", on: NAV, nav: true },
  { keys: ["3"], label: "3", does: "Read", on: NAV, nav: true },
  { keys: ["4"], label: "4", does: "Listen", on: NAV, nav: true },
  { keys: ["5"], label: "5", does: "Memory", on: NAV, nav: true },
  { keys: ["6"], label: "6", does: "Coach", on: NAV, nav: true },
  { keys: [","], label: ",", does: "Settings", on: NAV_ALL, nav: true },

  // ---- today ----
  { keys: ["Enter"], label: "↵", does: "begin next", on: ["today"] },
  // ⌘K is a chord, handled above every surface block — it is not a bare `k`, and
  // it works on every screen, so it is global and lives on all of them.
  { keys: ["k"], label: "⌘K", does: "anything — ask, jump, search", on: SURFACES, global: true },

  // ---- talk ----
  { keys: ["1", "2", "3"], label: "1–3", does: "use a suggestion", on: ["talk"] },
  { keys: ["Enter"], label: "↵", does: "send", on: ["talk"] },
  { keys: ["Escape"], label: "esc", does: "end the session", on: ["talk"] },

  // ---- read (close reading) ----
  { keys: ["ArrowRight", "ArrowLeft"], label: "← →", does: "move focus", on: ["read"] },
  { keys: ["t"], label: "T", does: "bilingual mode", on: ["read"], when: "bilingual" },
  { keys: ["p"], label: "P", does: "read it out loud", on: ["read"] },
  { keys: ["Escape"], label: "esc", does: "clear focus", on: ["read"] },
  { keys: ["Enter"], label: "↵", does: "keep the word", on: ["read"], when: "save" },

  // ---- prompter ----
  { keys: [" "], label: "space", does: "start", on: ["prompter"], when: "idle" },
  { keys: [" "], label: "space", does: "pause", on: ["prompter"], when: "running" },
  { keys: ["+", "=", "-", "_"], label: "+ −", does: "speed", on: ["prompter"] },
  { keys: ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"], label: "← →", does: "skip a line", on: ["prompter"] },
  { keys: ["r"], label: "R", does: "from the top", on: ["prompter"] },
  { keys: ["p"], label: "P", does: "back to close reading", on: ["prompter"] },

  // ---- listening ----
  { keys: [" "], label: "space", does: "play the chapter", on: ["listening"], when: "idle" },
  { keys: [" "], label: "space", does: "stop", on: ["listening"], when: "playing" },

  // ---- memory (the collection) ----
  { keys: ["r"], label: "R", does: "resurface due", on: ["memory"] },

  // ---- review (Memory's review mode) ----
  { keys: ["Enter"], label: "↵", does: "reveal the meaning", on: ["review"] },
  { keys: ["1", "2", "3"], label: "1–3", does: "grade", on: ["review"] },
  { keys: ["Escape"], label: "esc", does: "exit", on: ["review"] },

  // ---- settings ----
  { keys: ["]", "[", "ArrowDown", "ArrowUp"], label: "[ ] ↑ ↓", does: "move between sections", on: ["settings"] },

  // ---- onboarding ----
  // The option count is real, not a fixed 1–9: a step with three choices must not
  // announce six keys that do nothing. `picks` is the count of live options.
  { keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], label: (has) => `1–${Math.min(Number(has.find((h) => h.startsWith("picks:"))?.slice(6) ?? 0) || 1, 9)}`, does: "choose", on: ["onboarding"], when: "picks" },
  { keys: ["Enter"], label: "↵", does: "continue", on: ["onboarding"], when: "enter" },
  // Esc on the first step of a fresh install has nothing to go back to — it
  // leaves the field instead. The label follows the state.
  { keys: ["Escape"], label: "esc", does: "leave a field", on: ["onboarding"], when: "field" },
  { keys: ["Escape"], label: "esc", does: "back", on: ["onboarding"], when: "back" },
];

/** The shortcuts live on a surface — the hint line's source. `has` names the
 *  conditional flags a shortcut's `when` can ask for. Nav keys are topbar
 *  badges, not hint-line items, so they are excluded. */
export function keysFor(surface: Surface, has: string[] = []): Shortcut[] {
  return KEYS.filter((k) => !k.nav && k.on.includes(surface) && (!k.when || has.includes(k.when)));
}

/** The label a hint line shows — a function label is resolved against `has`. */
export function labelFor(s: Shortcut, has: string[] = []): string {
  return typeof s.label === "function" ? s.label(has) : s.label;
}

/** The gate every handler stands behind: a key that is not in the table does
 *  nothing. `when` is a display concern, so it does not gate the handler, and
 *  `global` shortcuts are chords handled above the surface blocks, so a bare
 *  keypress never fires them. */
export function live(surface: Surface, key: string): boolean {
  const k = key.toLowerCase();
  return KEYS.some((s) => !s.global && s.on.includes(surface) && s.keys.some((x) => x.toLowerCase() === k));
}

/** Is this key a live *navigation* shortcut on the surface? The topbar badge
 *  and the nav handler both ask this — a key that is a suggestion on Talk is
 *  not a nav key there, whatever `live` says. */
export function navLive(surface: Surface, key: string): boolean {
  const k = key.toLowerCase();
  return KEYS.some((s) => s.nav && s.on.includes(surface) && s.keys.some((x) => x.toLowerCase() === k));
}

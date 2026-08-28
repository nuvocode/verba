// The one index of every settings row: its name, its description, and where it
// lives. Two features read it — the Settings search (§5.2) and the command
// palette (#29) — so a setting is described once and both find it, and a row
// that cannot be described is a row that cannot be in the main flow (§5.2).
//
// This is metadata for finding and jumping, nothing more. The values live in
// Settings, and the one door that writes them stays applyPatch (lib/rules).
// Spec: docs/plans/2-verba-ana-ekran-ve-ayarlar-spec.md §5.2. Issues #29, #32.
import { AT } from "./rules.ts";

export interface SettingRow {
  /** Stable id — the search result and the highlight both key on it. */
  id: string;
  /** The setting's name, as the learner sees it. */
  title: string;
  /** What it does, in the learner's language — the search matches here too. */
  desc: string;
  /** The section that owns it. `AT` maps the panel to its hash. */
  panel: keyof typeof AT;
}

/** The hash a row's panel routes to — `AT` is the one panel→hash map. */
export const hashOf = (row: SettingRow): string => AT[row.panel];

export const SETTINGS_INDEX: SettingRow[] = [
  // ---- Learning (§5.3) ----
  { id: "native-language", title: "I speak", desc: "The language corrections and explanations are written in.", panel: "learning" },
  { id: "target-language", title: "I'm learning", desc: "The language you are studying, and the pack that teaches it.", panel: "learning" },
  { id: "level", title: "My level", desc: "How hard the passages, corrections and role-plays are pitched.", panel: "learning" },
  { id: "daily-minutes", title: "Minutes a day", desc: "How long a session should be — the plan is built to about this.", panel: "learning" },
  { id: "coaching", title: "Coaching", desc: "When corrections appear: as they happen, only when meaning breaks, or at the end.", panel: "learning" },
  { id: "keyboard-hints", title: "Keyboard hints", desc: "The small shortcut lines under each screen.", panel: "learning" },

  // ---- Speech and listening (§5.4) ----
  { id: "speak", title: "Read replies aloud", desc: "The coach speaks each turn as it arrives.", panel: "speech" },
  { id: "voice", title: "Voice", desc: "How Verba speaks — pick a voice and hear it before you keep it.", panel: "speech" },
  { id: "dictation", title: "Dictation", desc: "How Verba hears you — the model that turns your speech into words.", panel: "speech" },
  { id: "microphone", title: "Microphone", desc: "Which microphone Verba records from, and the test that proves it hears you.", panel: "speech" },

  // ---- Privacy and data (§5.5) ----
  { id: "offline", title: "Use this computer only", desc: "Close the network options and keep everything on this machine.", panel: "privacy" },
  { id: "data-location", title: "Where your data is", desc: "The folder on this computer that holds everything, and how to open it.", panel: "privacy" },
  { id: "export", title: "A copy you keep", desc: "Export everything to one file, or import a file back.", panel: "privacy" },
  { id: "sync-folder", title: "Sync folder", desc: "A folder your own sync service watches, where Verba keeps a copy.", panel: "privacy" },
  { id: "delete-everything", title: "Delete everything", desc: "Empty this machine and start over — it counts what you would give up first.", panel: "privacy" },

  // ---- About me (§5.6) ----
  { id: "about-me", title: "About me", desc: "What the coach has written down about you, and what you have told it yourself.", panel: "about" },

  // ---- Advanced (§5.7) ----
  { id: "model", title: "Model", desc: "Which model answers, where it runs, and whether it answers at all.", panel: "advanced" },
  { id: "thinking", title: "Let the model think first", desc: "Better answers from reasoning models, at the cost of a longer pause.", panel: "advanced" },
  { id: "speech-engine", title: "Speech engine", desc: "Where the voice comes from — the machinery under the voice you picked.", panel: "advanced" },
  { id: "dictation-engine", title: "Dictation engine", desc: "What turns your speech into words — the machinery under dictation.", panel: "advanced" },
  { id: "language-packs", title: "Language packs", desc: "The packs you have added yourself, and how to add another.", panel: "advanced" },
  { id: "role-plays", title: "Role-plays", desc: "The role-plays you have added, and how to add another.", panel: "advanced" },
];

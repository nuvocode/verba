// Scenario system v2 — structured, versioned, bundled + importable. Kept as a
// small typed record with its own validator (same trust-boundary story as
// language packs). ponytail: JSON-in / hand validator, not YAML + Zod — swap
// when community scenarios ship as .yaml.
import { SayError } from "./fmt.ts";

export const SCENARIO_FORMAT_VERSION = 1;

/** The coach's identity for a scenario — the name, the role it is attached to,
 *  the avatar (an emoji until there is art), and a hint for the TTS tier. */
export interface Persona {
  name: string; // "Marta"
  role: string; // "waiter" — the role the name is attached to
  emoji: string; // the avatar, until there is art
  /** Substring passed to the TTS tier; "" means the pack's default. */
  voiceHint?: string;
}

export interface Scenario {
  formatVersion?: number; // optional on bundled literals; required for imports
  id: string;
  title: string;
  emoji: string;
  /** The role the AI plays and the situation — appended to the system prompt. */
  setup: string;
  /** What the learner should manage to do; shown as objectives. */
  goals?: string[];
  /** Soft CEFR range this scenario suits, e.g. ["A2", "B2"]. */
  level?: [string, string];
  /** The coach's identity — required on bundled literals, validated on import. */
  persona: Persona;
}

export const BUNDLED_SCENARIOS: Scenario[] = [
  {
    formatVersion: SCENARIO_FORMAT_VERSION,
    id: "free",
    title: "Free conversation",
    emoji: "💬",
    setup: "This is an open, free-flowing conversation. Pick friendly everyday topics and follow the learner's lead.",
    goals: ["Keep a conversation going", "Talk about everyday topics"],
    persona: { name: "Marta", role: "a friendly conversation partner", emoji: "🧑‍🏫" },
  },
  {
    formatVersion: SCENARIO_FORMAT_VERSION,
    id: "restaurant",
    title: "Restaurant",
    emoji: "🍽️",
    setup: "You are a waiter at a restaurant. The learner is a customer. Greet them, take their order, answer questions about the menu, and handle the bill.",
    goals: ["Order food and drink", "Ask about the menu", "Ask for the bill"],
    level: ["A1", "B1"],
    persona: { name: "Marco", role: "a waiter", emoji: "👨‍🍳", voiceHint: "warm" },
  },
  {
    formatVersion: SCENARIO_FORMAT_VERSION,
    id: "airport",
    title: "Airport",
    emoji: "✈️",
    setup: "You are an airline check-in / gate agent. Help the learner check in, ask about baggage, seats, boarding, and answer travel questions.",
    goals: ["Check in", "Talk about baggage and seats", "Understand boarding info"],
    level: ["A2", "B2"],
    persona: { name: "Sofia", role: "a check-in agent", emoji: "👩‍✈️", voiceHint: "clear" },
  },
  {
    formatVersion: SCENARIO_FORMAT_VERSION,
    id: "hotel",
    title: "Hotel",
    emoji: "🏨",
    setup: "You are a hotel receptionist. Help the learner check in, explain amenities, handle requests and any small problems with their room.",
    goals: ["Check in", "Ask about amenities", "Report a problem politely"],
    level: ["A2", "B2"],
    persona: { name: "Elena", role: "a hotel receptionist", emoji: "🧑‍💼", voiceHint: "calm" },
  },
  {
    formatVersion: SCENARIO_FORMAT_VERSION,
    id: "interview",
    title: "Job interview",
    emoji: "💼",
    setup: "You are a hiring manager interviewing the learner for a job. Ask common interview questions one at a time and react naturally to their answers.",
    goals: ["Introduce yourself", "Describe experience", "Ask about the role"],
    level: ["B1", "C1"],
    persona: { name: "David", role: "a hiring manager", emoji: "👔", voiceHint: "professional" },
  },
];

export interface ScenarioValidation {
  ok: boolean;
  errors: string[];
  scenario?: Scenario;
}

export function validateScenario(raw: unknown): ScenarioValidation {
  const errors: string[] = [];
  const o = raw as any;
  if (o?.formatVersion !== SCENARIO_FORMAT_VERSION)
    errors.push(`"formatVersion" must be ${SCENARIO_FORMAT_VERSION}`);
  for (const k of ["id", "title", "emoji", "setup"]) {
    if (typeof o?.[k] !== "string" || !o[k].trim()) errors.push(`"${k}" must be a non-empty string`);
  }
  if (o?.goals != null && (!Array.isArray(o.goals) || o.goals.some((x: any) => typeof x !== "string")))
    errors.push(`"goals" must be an array of strings`);
  if (Array.isArray(o?.goals) && o.goals.length > 5)
    errors.push(`"goals" may have at most 5 entries, got ${o.goals.length}`);
  if (o?.level != null && (!Array.isArray(o.level) || o.level.length !== 2))
    errors.push(`"level" must be a [min, max] pair`);
  // The persona is the coach's identity — a scenario without one has no one to
  // play the other side. Every field is required; a partial persona is a broken
  // one, and the import dialog shows the field it is missing.
  const p = o?.persona;
  if (!p || typeof p !== "object") {
    errors.push(`"persona" is required — the coach needs a name, a role and an emoji`);
  } else {
    for (const k of ["name", "role", "emoji"]) {
      if (typeof p[k] !== "string" || !p[k].trim()) errors.push(`"persona.${k}" must be a non-empty string`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], scenario: o as Scenario };
}

// ---- importable scenarios (localStorage; same rationale as packs) ----

const KEY = "verba.scenarios";

function imported(): Scenario[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    // Records written before the persona existed have no one to play the other
    // side. Backfill a neutral identity rather than dropping them — a learner's
    // own scenario is theirs, and a persona is the one field a machine can fill
    // without pretending to know what they meant. The backfill is read-only: the
    // stored record is left as it is, and the next save writes a real persona.
    return arr.map((s: any) =>
      s && typeof s === "object" && !s.persona
        ? { ...s, persona: { name: s.title ?? "Coach", role: "your conversation partner", emoji: s.emoji ?? "🧑‍🏫" } }
        : s,
    );
  } catch {
    return [];
  }
}

/**
 * Where a scenario came from. The same distinction packs make (lib/packs/registry),
 * and for the same reason: §5.7 says the installed list names each one's origin,
 * because "you pasted this in yourself and nobody reviewed it" is the whole
 * difference between the two.
 */
export type ScenarioOrigin = "bundled" | "imported";

export interface RegisteredScenario {
  scenario: Scenario;
  origin: ScenarioOrigin;
}

/** Every scenario with its provenance. An import shadows a bundled one of the same id. */
export function scenarioRegistry(): RegisteredScenario[] {
  const byId = new Map<string, RegisteredScenario>();
  for (const scenario of BUNDLED_SCENARIOS) byId.set(scenario.id, { scenario, origin: "bundled" });
  for (const scenario of imported()) byId.set(scenario.id, { scenario, origin: "imported" });
  return [...byId.values()];
}

/** Drop one imported scenario. A bundled id is not removable and is left alone. */
export function removeImportedScenario(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(imported().filter((s) => s.id !== id)));
}

export function listScenarios(): Scenario[] {
  const byId = new Map<string, Scenario>();
  for (const s of BUNDLED_SCENARIOS) byId.set(s.id, s);
  for (const s of imported()) byId.set(s.id, s);
  return [...byId.values()];
}

export function importScenario(jsonText: string): Scenario {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e: any) {
    throw new SayError(`Not valid JSON: ${e?.message ?? e}`);
  }
  const res = validateScenario(raw);
  if (!res.ok || !res.scenario) throw new SayError(res.errors.join("; "));
  const next = imported().filter((s) => s.id !== res.scenario!.id);
  next.push(res.scenario);
  localStorage.setItem(KEY, JSON.stringify(next));
  return res.scenario;
}

/**
 * Write a scenario to the same `verba.scenarios` key `importScenario` uses,
 * replacing by id. This is how an edit lands: the edited copy is saved over the
 * original, and a bundled scenario is never touched in place — the caller
 * duplicates it first, and the duplicate is an import like any other.
 */
export function saveScenario(s: Scenario): void {
  const next = imported().filter((x) => x.id !== s.id);
  next.push(s);
  localStorage.setItem(KEY, JSON.stringify(next));
}

/**
 * A fresh copy of a scenario, safe to edit. New id (`${s.id}-copy-${n}`), title
 * suffixed, `formatVersion` set. A duplicate of a bundled scenario is an import:
 * it is written to the same key, and the bundled original is left untouched.
 */
export function duplicateScenario(s: Scenario): Scenario {
  const existing = new Set(imported().map((x) => x.id));
  let n = 1;
  let id = `${s.id}-copy-${n}`;
  while (existing.has(id)) {
    n += 1;
    id = `${s.id}-copy-${n}`;
  }
  return {
    ...s,
    id,
    title: `${s.title} (copy)`,
    formatVersion: SCENARIO_FORMAT_VERSION,
  };
}

/** The CEFR scale, ordered — a scenario's band is compared against it. */
const BAND_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * The catalogue, split for a learner at `level`: the scenarios at or above it in
 * `main`, and the easier ones in `easier`, in that order. A scenario is "easier"
 * when the top of its band is below the learner's level; one with no band is
 * always `main`.
 */
export function bandSplit(all: Scenario[], level: string): { main: Scenario[]; easier: Scenario[] } {
  const main: Scenario[] = [];
  const easier: Scenario[] = [];
  const at = BAND_ORDER.indexOf(level);
  for (const s of all) {
    const top = s.level?.[1];
    const topAt = top ? BAND_ORDER.indexOf(top) : -1;
    // No band, or a band whose top is at or above the learner's level → main.
    if (topAt === -1 || at === -1 || topAt >= at) main.push(s);
    else easier.push(s);
  }
  return { main, easier };
}

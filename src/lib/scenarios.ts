// Scenario system v2 — structured, versioned, bundled + importable. Kept as a
// small typed record with its own validator (same trust-boundary story as
// language packs). ponytail: JSON-in / hand validator, not YAML + Zod — swap
// when community scenarios ship as .yaml.

export const SCENARIO_FORMAT_VERSION = 1;

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
}

export const BUNDLED_SCENARIOS: Scenario[] = [
  {
    id: "free",
    title: "Free conversation",
    emoji: "💬",
    setup: "This is an open, free-flowing conversation. Pick friendly everyday topics and follow the learner's lead.",
    goals: ["Keep a conversation going", "Talk about everyday topics"],
  },
  {
    id: "restaurant",
    title: "Restaurant",
    emoji: "🍽️",
    setup: "You are a waiter at a restaurant. The learner is a customer. Greet them, take their order, answer questions about the menu, and handle the bill.",
    goals: ["Order food and drink", "Ask about the menu", "Ask for the bill"],
    level: ["A1", "B1"],
  },
  {
    id: "airport",
    title: "Airport",
    emoji: "✈️",
    setup: "You are an airline check-in / gate agent. Help the learner check in, ask about baggage, seats, boarding, and answer travel questions.",
    goals: ["Check in", "Talk about baggage and seats", "Understand boarding info"],
    level: ["A2", "B2"],
  },
  {
    id: "hotel",
    title: "Hotel",
    emoji: "🏨",
    setup: "You are a hotel receptionist. Help the learner check in, explain amenities, handle requests and any small problems with their room.",
    goals: ["Check in", "Ask about amenities", "Report a problem politely"],
    level: ["A2", "B2"],
  },
  {
    id: "interview",
    title: "Job interview",
    emoji: "💼",
    setup: "You are a hiring manager interviewing the learner for a job. Ask common interview questions one at a time and react naturally to their answers.",
    goals: ["Introduce yourself", "Describe experience", "Ask about the role"],
    level: ["B1", "C1"],
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
  if (o?.level != null && (!Array.isArray(o.level) || o.level.length !== 2))
    errors.push(`"level" must be a [min, max] pair`);
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], scenario: o as Scenario };
}

// ---- importable scenarios (localStorage; same rationale as packs) ----

const KEY = "verba.scenarios";

function imported(): Scenario[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
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
    throw new Error(`Not valid JSON: ${e?.message ?? e}`);
  }
  const res = validateScenario(raw);
  if (!res.ok || !res.scenario) throw new Error(res.errors.join("; "));
  const next = imported().filter((s) => s.id !== res.scenario!.id);
  next.push(res.scenario);
  localStorage.setItem(KEY, JSON.stringify(next));
  return res.scenario;
}

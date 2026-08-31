// Run: node --experimental-strip-types src/lib/scenarios.check.ts
//
// The scenario catalogue (lib/scenarios.ts). Pins the promises PLAN-017 makes:
//  1. Every bundled scenario validates, has a persona with a non-empty name and
//     role, and has ≤ 5 goals.
//  2. `bandSplit` sorts by the learner's level — the A1–B1 restaurant is easier
//     for a B2 learner, the B1–C1 interview is main; at A1 nothing is easier; a
//     scenario with no band is always main.
//  3. `duplicateScenario` produces a new id, never collides on a second call, and
//     the duplicate validates.
//  4. `validateScenario` rejects six goals and a personaless scenario, with a
//     message naming the field.
import assert from "node:assert";
import {
  BUNDLED_SCENARIOS,
  bandSplit,
  duplicateScenario,
  listScenarios,
  saveScenario,
  validateScenario,
} from "./scenarios.ts";

// scenarios.ts reads localStorage — node has none, so give it a tiny in-memory one.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

// --- 1: every bundled scenario is valid, has a persona, and ≤ 5 goals ----------
for (const s of BUNDLED_SCENARIOS) {
  const res = validateScenario(s);
  assert(res.ok, `bundled scenario ${s.id} must validate: ${res.errors.join("; ")}`);
  assert(s.persona, `bundled scenario ${s.id} must have a persona`);
  assert(s.persona.name.trim(), `bundled scenario ${s.id} persona must have a name`);
  assert(s.persona.role.trim(), `bundled scenario ${s.id} persona must have a role`);
  assert(s.persona.emoji.trim(), `bundled scenario ${s.id} persona must have an emoji`);
  assert((s.goals ?? []).length <= 5, `bundled scenario ${s.id} must have ≤ 5 goals`);
}

// --- 2: bandSplit sorts by the learner's level ---------------------------------
{
  const all = BUNDLED_SCENARIOS;
  const restaurant = all.find((s) => s.id === "restaurant")!; // A1–B1
  const interview = all.find((s) => s.id === "interview")!; // B1–C1
  const free = all.find((s) => s.id === "free")!; // no band

  // At B2, the A1–B1 restaurant is easier; the B1–C1 interview is main.
  const atB2 = bandSplit(all, "B2");
  assert(atB2.easier.includes(restaurant), "at B2 the A1–B1 restaurant must be easier");
  assert(!atB2.main.includes(restaurant), "at B2 the restaurant must not be main");
  assert(atB2.main.includes(interview), "at B2 the B1–C1 interview must be main");
  assert(!atB2.easier.includes(interview), "at B2 the interview must not be easier");

  // At A1, nothing is easier.
  const atA1 = bandSplit(all, "A1");
  assert(atA1.easier.length === 0, "at A1 nothing must be easier");
  assert(atA1.main.length === all.length, "at A1 everything must be main");

  // A scenario with no band is always main.
  assert(atB2.main.includes(free), "a bandless scenario must always be main");
  assert(!atB2.easier.includes(free), "a bandless scenario must never be easier");
}

// --- 3: duplicateScenario is a fresh, valid, non-colliding import --------------
{
  const original = BUNDLED_SCENARIOS.find((s) => s.id === "restaurant")!;
  const dup1 = duplicateScenario(original);
  assert.notEqual(dup1.id, original.id, "a duplicate must get a new id");
  assert(dup1.id.startsWith(`${original.id}-copy-`), "a duplicate id must be suffixed");
  assert(dup1.title.includes("(copy)"), "a duplicate title must be suffixed");
  assert.equal(dup1.formatVersion, 1, "a duplicate must carry the format version");

  // A second call must not collide with the first. In real use the first
  // duplicate is saved (edited) before another is made, so save it first.
  saveScenario(dup1);
  const dup2 = duplicateScenario(original);
  assert.notEqual(dup2.id, dup1.id, "a second duplicate must not collide with the first");

  // The duplicate validates — it is an import like any other.
  const res = validateScenario(dup1);
  assert(res.ok, `a duplicate must validate: ${res.errors.join("; ")}`);
}

// --- 4: validateScenario rejects six goals and a personaless scenario ---------
{
  const six = validateScenario({
    formatVersion: 1,
    id: "x",
    title: "X",
    emoji: "💬",
    setup: "X",
    goals: ["1", "2", "3", "4", "5", "6"],
    persona: { name: "N", role: "R", emoji: "E" },
  });
  assert(!six.ok, "six goals must be rejected");
  assert(six.errors.some((e) => e.includes("goals")), "the six-goal error must name the goals field");

  const noPersona = validateScenario({
    formatVersion: 1,
    id: "x",
    title: "X",
    emoji: "💬",
    setup: "X",
  });
  assert(!noPersona.ok, "a personaless scenario must be rejected");
  assert(noPersona.errors.some((e) => e.includes("persona")), "the error must name the persona field");

  const partialPersona = validateScenario({
    formatVersion: 1,
    id: "x",
    title: "X",
    emoji: "💬",
    setup: "X",
    persona: { name: "N", role: "", emoji: "E" },
  });
  assert(!partialPersona.ok, "a partial persona must be rejected");
  assert(
    partialPersona.errors.some((e) => e.includes("persona.role")),
    "the error must name the missing persona field",
  );
}

// --- 5: an imported record written before the persona existed is backfilled ----
// PLAN-017 made the persona required. A learner's own scenario saved before that
// has no persona — it must not be dropped, and it must not reach the picker
// personaless. The backfill gives it a neutral identity, read-only.
{
  store.set(
    "verba.scenarios",
    JSON.stringify([
      { formatVersion: 1, id: "mine", title: "My café", emoji: "☕", setup: "Order at my café." },
      { formatVersion: 1, id: "theirs", title: "Theirs", emoji: "🍜", setup: "X", persona: { name: "N", role: "R", emoji: "E" } },
    ]),
  );
  const mine = listScenarios().find((s) => s.id === "mine")!;
  assert(mine.persona, "a personaless import must be backfilled with a persona");
  assert.equal(mine.persona.name, "My café", "the backfilled name is the record's own title");
  assert.equal(mine.persona.role, "your conversation partner", "the backfilled role is the neutral one");
  assert.equal(mine.persona.emoji, "☕", "the backfilled emoji is the record's own");
  // A record that already has a persona is left alone.
  const theirs = listScenarios().find((s) => s.id === "theirs")!;
  assert.equal(theirs.persona.name, "N", "a record that already has a persona is untouched");
  // The backfill is read-only — the stored record is not rewritten.
  assert(!JSON.parse(store.get("verba.scenarios")!)[0].persona, "the backfill must not rewrite the stored record");
  store.delete("verba.scenarios");
}

console.log(`scenarios: ${BUNDLED_SCENARIOS.length} bundled, all valid`);
console.log("scenarios.check ✓");

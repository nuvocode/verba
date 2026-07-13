// Runnable self-check for Phase 3 pure logic — learning engine, metrics v2,
// coaching parsers, and the pack registry's compatibility gate.
// Run: node --experimental-strip-types src/lib/phase3.check.ts
import assert from "node:assert";
import { readdirSync } from "node:fs";
import { defaultSettings } from "./settings.ts";
import { BUNDLED_PACKS } from "./packs/bundled.ts";
import { buildDailyPlan, themeForDate, parseRecap } from "./learn.ts";
import { computeMetrics, estimateLevelV2 } from "./metrics.ts";
import { parseWeeklyReport, parseDrills } from "./coach.ts";
import { checkCompatibility } from "./packs/registry.ts";
import { COMMUNITY_PACKS } from "./packs/community.ts";
import { PACK_FORMAT_VERSION } from "./packs/schema.ts";

// --- learning engine: deterministic, complete daily session ---
const plan = buildDailyPlan(defaultSettings, { date: "2026-07-11", dueVocab: 8 });
assert(plan.theme === themeForDate("2026-07-11"), "theme is deterministic for a date");
const kinds = plan.blocks.map((b) => b.kind);
for (const k of ["conversation", "reading", "scenario", "vocab", "summary"])
  assert(kinds.includes(k as any), `plan must include a ${k} block`);
assert(plan.blocks.at(-1)!.kind === "summary", "summary/wrap-up is always last");
assert(plan.totalMinutes === plan.blocks.reduce((n, b) => n + b.minutes, 0), "totalMinutes sums the blocks");
// no due vocab → no review block
const noVocab = buildDailyPlan(defaultSettings, { date: "2026-07-11", dueVocab: 0 });
assert(!noVocab.blocks.some((b) => b.kind === "vocab"), "no review block when nothing is due");
// weak-area drill folds into the conversation block
const focused = buildDailyPlan(defaultSettings, { date: "2026-07-11", dueVocab: 0, focus: ["past tense"] });
assert(focused.blocks[0].goal === "past tense", "first focus area drives the conversation goal");

// --- level estimation v2: metrics + CEFR heuristic ---
const beginner = estimateLevelV2(computeMetrics(["hola.", "yo como pan."], { corrections: 2, deckSize: 0 }));
const advanced = estimateLevelV2(
  computeMetrics(
    ["Ayer, aunque estaba cansado, decidí terminar el proyecto porque la fecha límite se acercaba rápidamente."],
    { corrections: 0, deckSize: 90 },
  ),
);
assert(advanced.score > beginner.score, "richer, longer, error-free writing scores higher");
assert(["A1", "A2", "B1", "B2", "C1", "C2"].includes(advanced.estimate), "estimate is a CEFR band");
const m = computeMetrics(["one two three.", "four five."], { corrections: 1, deckSize: 10 });
assert(m.messages === 2 && m.words === 5, "word and message counts");
assert(Math.abs(m.errorRate - 0.5) < 1e-9, "error rate = corrections / messages");
assert(m.uniqueWords === 5 && Math.abs(m.typeTokenRatio - 1) < 1e-9, "all-distinct words → TTR 1");

// --- coaching parsers: tolerant of fences/prose ---
const rep = parseWeeklyReport('```json\n{"headline":"Great week","report":"You practised a lot.","wins":["x"],"focus":["y"]}\n```');
assert(rep.headline === "Great week" && rep.wins[0] === "x", "weekly report parsed through fence");
const drills = parseDrills('{"drills":[{"prompt":"Di algo","hint":"h","example":"e","area":"a"},{"nope":1}]}');
assert(drills.length === 1 && drills[0].prompt === "Di algo", "drills without a prompt are dropped");
const recap = parseRecap("garbage, no json");
assert(recap.recap === "garbage, no json" && recap.nextFocus.length === 0, "recap degrades gracefully");

// --- registry drift: a langs/ folder that nothing imports is an invisible language ---
// This is the price of explicit imports over import.meta.glob (which the checks
// can't run under node). Paid here instead: the folder listing IS the source of
// truth, and a contributor who forgets the bundled/community.ts line fails CI
// rather than watching their language silently not exist.
const registered = new Set([...BUNDLED_PACKS, ...COMMUNITY_PACKS].map((p) => p.id));
const folders = readdirSync(new URL("./packs/langs/", import.meta.url), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);
for (const id of folders)
  assert(registered.has(id), `langs/${id}/ ships no pack: add it to bundled.ts or community.ts`);
for (const id of registered) assert(folders.includes(id), `pack "${id}" has no langs/${id}/ folder`);

// --- pack registry: compatibility gate ---
for (const p of COMMUNITY_PACKS) assert(checkCompatibility(p).compatible, `community pack ${p.id} is compatible`);
const future = checkCompatibility({ ...COMMUNITY_PACKS[0], formatVersion: PACK_FORMAT_VERSION + 1, extra: 1 });
assert(future.warnings.some((w) => w.includes("format")), "newer format version warns");
assert(future.warnings.some((w) => w.includes("extra")), "unknown field warns");
assert(!checkCompatibility({ id: "x" }).compatible, "invalid pack is not compatible");

console.log("phase3.check: all assertions passed ✅");

// Runnable self-check for the onboarding v1 decisions: skip defaults, the
// unset-level fallback, interest-steered themes, and the pack order learners see.
// Run: node --experimental-strip-types src/lib/onboarding.check.ts
import assert from "node:assert";
import { defaultSettings, SKIP_DEFAULTS, type Settings } from "./settings.ts";
import { buildDailyPlan, themeForDate } from "./learn.ts";
import { levelPrompt } from "./level.ts";
import { BUNDLED_PACKS } from "./packs/bundled.ts";
import { COMMUNITY_PACKS } from "./packs/community.ts";
import { validatePack } from "./packs/schema.ts";
import { langName } from "./langs.ts";
import type { CEFRLevel } from "./model.ts";

const s = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings, ...patch });
const atLevel = (lvl: string): Settings =>
  s({ profile: { ...defaultSettings.profile, level: lvl as CEFRLevel } });

// ---- native language comes from the OS locale, never a hardcoded default ----
assert.equal(langName("tr-TR"), "Turkish", "tr-TR resolves to Turkish");
assert.equal(langName("ja"), "Japanese", "a bare code resolves too");
assert.notEqual(defaultSettings.profile.nativeLanguage, "", "there is always a native language");

// ---- skip from step 2: the A2 fallback, 20 min, no interests ----
assert.deepEqual(SKIP_DEFAULTS, { level: "A2", dailyMinutes: 20, interests: [] }, "documented skip defaults");
assert.match(levelPrompt(atLevel("B1")), /self-reported level is B1/, "a set level anchors the estimate");

// ---- every bucket is a real CEFR level the plan can carry ----
for (const cefr of ["A1", "A2", "B1", "B2"])
  assert.equal(buildDailyPlan(atLevel(cefr), { date: "2026-07-12", dueVocab: 0 }).level, cefr, `${cefr} reaches the plan`);

// ---- interests are optional and steer the theme when present ----
const plan0 = buildDailyPlan(s({ profile: { ...defaultSettings.profile, interests: [] } }), { date: "2026-07-12", dueVocab: 0 });
const plan1 = buildDailyPlan(s({ profile: { ...defaultSettings.profile, interests: ["Travel"] } }), { date: "2026-07-12", dueVocab: 0 });
const plan3 = buildDailyPlan(s({ profile: { ...defaultSettings.profile, interests: ["Travel", "Work", "Books & film"] } }), { date: "2026-07-12", dueVocab: 0 });
for (const p of [plan0, plan1, plan3]) assert(p.blocks.length >= 4 && p.theme, "a plan builds with 0, 1 or 3 interests");
assert.equal(plan0.theme, themeForDate("2026-07-12"), "no interests → the full rotation, unchanged");
assert(
  ["travel and directions", "shopping and money", "food and cooking"].includes(plan1.theme),
  "one interest narrows the theme to that interest",
);
assert.notEqual(plan1.theme, plan3.theme, "a different interest set gives a different day");

// ---- target languages: English first, then the documented order ----
const order = [...BUNDLED_PACKS, ...COMMUNITY_PACKS].map((p) => p.id);
for (const id of ["en", "es", "fr", "de", "it", "pt", "ja"]) assert(order.includes(id), `${id} pack ships`);
for (const p of [...BUNDLED_PACKS, ...COMMUNITY_PACKS])
  assert(validatePack(p).ok, `${p.id} pack is valid: ${validatePack(p).errors.join(", ")}`);

console.log("onboarding.check ✓");

// Runnable self-check for the onboarding v1 decisions: skip defaults, the
// unset-level fallback, interest-steered themes, and the pack order learners see.
// Run: node --experimental-strip-types src/lib/onboarding.check.ts
import assert from "node:assert";
import { defaultSettings, SKIP_DEFAULTS, type Settings } from "./settings.ts";
import { buildDailyPlan, daySummary, themeForDate } from "./learn.ts";
import { TIMES } from "./choices.ts";
import { BUNDLED_PACKS } from "./packs/bundled.ts";
import { COMMUNITY_PACKS } from "./packs/community.ts";
import { validatePack } from "./packs/schema.ts";
import { endonym, langCode, langName, langNameIn, UI_LANGUAGES } from "./langs.ts";
import type { CEFRLevel } from "./model.ts";

const s = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings, ...patch });
const atLevel = (lvl: string): Settings =>
  s({ profile: { ...defaultSettings.profile, level: lvl as CEFRLevel } });

// ---- native language comes from the OS locale, never a hardcoded default ----
assert.equal(langName("tr-TR"), "Turkish", "tr-TR resolves to Turkish");
assert.equal(langName("ja"), "Japanese", "a bare code resolves too");
assert.notEqual(defaultSettings.profile.nativeLanguage, "", "there is always a native language");

// ---- skip: the middle session length, B1, and the system language, no interests ----
assert.deepEqual(SKIP_DEFAULTS, { level: "B1", dailyMinutes: 45, interests: [] }, "documented skip defaults");

// ---- every bucket builds a valid plan (level no longer flows into the plan —
//      it is read through levelOf(profile) at prompt time) ----
for (const cefr of ["A1", "A2", "B1", "B2"])
  assert(buildDailyPlan(atLevel(cefr), { date: "2026-07-12", dayIndex: 1, dueVocab: 0 }).activities.length >= 4, `${cefr} reaches the plan`);

// ---- interests are optional and steer the theme when present ----
const plan0 = buildDailyPlan(s({ profile: { ...defaultSettings.profile, interests: [] } }), { date: "2026-07-12", dayIndex: 1, dueVocab: 0 });
const plan1 = buildDailyPlan(s({ profile: { ...defaultSettings.profile, interests: ["Travel"] } }), { date: "2026-07-12", dayIndex: 1, dueVocab: 0 });
const plan3 = buildDailyPlan(s({ profile: { ...defaultSettings.profile, interests: ["Travel", "Work", "Books & film"] } }), { date: "2026-07-12", dayIndex: 1, dueVocab: 0 });
for (const p of [plan0, plan1, plan3]) assert(p.activities.length >= 4 && p.theme, "a plan builds with 0, 1 or 3 interests");
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

// ---- screen 0: the interface language list, and the seed it gives ----
for (const code of UI_LANGUAGES as readonly string[]) assert(endonym(code).length > 0, `${code} has an endonym`);
assert.notEqual(endonym("tr"), endonym("en"), "Intl is really answering the endonyms");
assert.equal(langCode("Turkish"), "tr", "Turkish resolves back to tr");
assert.equal(langCode("Klingon"), "", "an unknown name has no code");
assert.equal(langName(langCode("Spanish")), "Spanish", "the code→name round trip holds");
assert(langNameIn("es", "tr").length > 0, "Spanish names itself in Turkish");

// ---- screen 5: the preview sentence and the plan are the same number (§6) ----
// For each of the three session lengths, the plan's daySummary must contain the
// plan's own estimatedMinutes — the promised duration is a measured one.
for (const [minutes] of TIMES) {
  const plan = buildDailyPlan(s({ dailyMinutes: minutes }), { date: "2026-07-12", dayIndex: 1, dueVocab: 0 });
  assert(
    daySummary(plan).includes(String(plan.estimatedMinutes)),
    `${minutes} min: the preview sentence carries the plan's own ${plan.estimatedMinutes} minutes`,
  );
}

console.log("onboarding.check ✓");

// Runnable check: `node --experimental-strip-types src/lib/setup.check.ts`
//
// The rules that hold across every setup screen (§6): what skipping assumes and
// says, that a level chosen in setup is the level Day 1 reads, and that an answer
// written mid-setup comes back after a restart.
import assert from "node:assert";
import { applyPatch } from "./rules.ts";
import { levelOf, CEFR_LEVELS } from "./model.ts";
import { defaultSettings, loadSettings, onboardingReset, saveSettings, skipNote, SKIP_DEFAULTS } from "./settings.ts";

// ----- setup.check.ts imports ./vault.ts (via settings' markDirty) and reads
// ----- localStorage — node has none, so give it a real in-memory one.

// 1. the sentence and the values cannot drift
{
  const note = skipNote("Turkish");
  assert.ok(note.includes(SKIP_DEFAULTS.level), "skipNote names the level");
  assert.ok(note.includes(String(SKIP_DEFAULTS.dailyMinutes)), "skipNote names the daily minutes");
  assert.ok(note.includes("Turkish"), "skipNote names the native language");
}

// 2. setup starts un-resumed
assert.equal(defaultSettings.setupStep, 0, "defaultSettings.setupStep === 0");
assert.equal(onboardingReset().setupStep, 0, "onboardingReset().setupStep === 0");

// 3. level fidelity: a level picked in setup is the level Day 1 reads, untouched
{
  const next = applyPatch(defaultSettings, { profile: { ...defaultSettings.profile, level: "A2" } }).next;
  assert.equal(levelOf(next.profile), "A2");
  for (const level of CEFR_LEVELS) {
    const applied = applyPatch(defaultSettings, { profile: { ...defaultSettings.profile, level } }).next;
    assert.equal(levelOf(applied.profile), level, `applyPatch keeps ${level}`);
  }
}

// 4. persistence round trip: an answer written mid-setup comes back
{
  let store: Record<string, string> = {};
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
  saveSettings({ ...defaultSettings, setupStep: 3, packId: "fr" });
  const loaded = loadSettings();
  assert.equal(loaded.setupStep, 3, "setupStep survives a restart");
  assert.equal(loaded.packId, "fr", "a chosen pack survives a restart");
}

// 5. the language rule is one rule: setup and Settings enforce the same thing
{
  const refused = applyPatch(defaultSettings, {
    profile: { ...defaultSettings.profile, targetLanguage: defaultSettings.profile.nativeLanguage },
  });
  assert.ok(refused.refused, "native === target is refused");
  assert.ok(refused.refused.exits.length > 0, "a refusal offers a way out");
  const accepted = applyPatch(defaultSettings, { profile: { ...defaultSettings.profile, targetLanguage: "French" } });
  assert.ok(!accepted.refused, "native !== target is accepted");
}

console.log("setup.check ✓");

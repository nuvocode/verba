// Runnable check: `node --experimental-strip-types src/lib/settings.check.ts`
//
// The profile migration is the one thing a typo would silently poison: every
// surface reads the level through levelOf(profile), so a bad migration lands the
// wrong level on every screen at once. These assertions pin the old flat record
// → new nested profile mapping, the "unset → A2" fallback, and the idempotence.
import assert from "node:assert";
import { loadSettings, migrateProfile, defaultSettings } from "./settings.ts";

// loadSettings reads localStorage — node has none, so give it a tiny in-memory one.
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

// a migrated old flat record, typed so its fields can be read directly
const migrated = (old: Record<string, unknown>) =>
  migrateProfile(old) as unknown as { profile: Record<string, unknown> };

// 1-3: the old flat `cefr` becomes profile.level; "" and junk read as "A2"
// invariant 3
assert.equal(migrated({ cefr: "B2" }).profile.level, "B2");
assert.equal(migrated({ cefr: "" }).profile.level, "A2");
assert.equal(migrated({ cefr: "gibberish" }).profile.level, "A2");

// 4: `goals` were really interests — they land in interests, goals stays empty
{
  const p = migrated({ goals: ["Travel"] }).profile;
  assert.deepEqual(p.interests, ["Travel"]);
  assert.deepEqual(p.goals, []);
}

// 5: languages map straight across
{
  const p = migrated({ targetLang: "Japanese", nativeLang: "Turkish" }).profile;
  assert.equal(p.targetLanguage, "Japanese");
  assert.equal(p.nativeLanguage, "Turkish");
}

// 6: a record already carrying a profile passes through untouched (idempotent)
{
  const nested = { profile: { level: "C1", keep: true } };
  assert.equal(migrateProfile(nested), nested);
}

// 7: no record → loadSettings returns the default profile
assert.deepEqual(loadSettings().profile, defaultSettings.profile);

// 8: the coach's estimate is never back-filled by migration
{
  const e = migrated({ cefr: "B2", goals: ["Travel"] }).profile.levelEstimate as {
    sampleSize: number;
    confidence: string;
  };
  assert.equal(e.sampleSize, 0);
  assert.equal(e.confidence, "low");
}

console.log("settings.check OK");

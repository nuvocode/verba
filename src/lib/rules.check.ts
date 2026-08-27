// Runnable check: `node --experimental-strip-types src/lib/rules.check.ts`
//
// The settings write door (lib/rules.ts). What is pinned here is the part a
// typo poisons silently: a rule that stops firing does not throw anywhere — the
// contradiction just appears on screen and nobody notices for a release.
// Spec §3, §5.2, §7. Issues #33, #35, #42, #43.
import assert from "node:assert";
import { applyPatch, cloudGate, AT, type Applied } from "./rules.ts";
import { defaultSettings, isLocalProvider, type Settings } from "./settings.ts";

// settings.ts reaches localStorage through markDirty on save; nothing here saves,
// but the module graph still wants the global to exist.
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const withProfile = (s: Settings, p: Partial<Settings["profile"]>): Settings => ({
  ...s,
  profile: { ...s.profile, ...p },
});

// A learner mid-flight: learning one language, explained in another, lock off.
const base: Settings = withProfile({ ...defaultSettings, offline: false, provider: "openai" }, {
  targetLanguage: "Klingon",
  nativeLanguage: "Sindarin",
});

// --- state 5: target = native is refused, by every route ----------------------

// Moving the native language onto the target language.
{
  const r = applyPatch(base, { profile: { ...base.profile, nativeLanguage: "Klingon" } });
  assert(r.refused, "native → target must not apply");
  assert.equal(r.next, base, "a refused change leaves settings untouched");
  assert(r.refused.exits.length >= 1, "a refusal always offers a way out");
  assert(r.refused.exits.every((e) => e.href.startsWith("#settings/")), "…and it is a place you can go");
}

// The other direction, and the same rule.
{
  const r = applyPatch(base, { profile: { ...base.profile, targetLanguage: "Sindarin" } });
  assert(r.refused, "target → native must not apply either");
}

// Case and padding are not a way around it — "  klingon " is the same language.
{
  const r = applyPatch(base, { profile: { ...base.profile, nativeLanguage: "  klingon " } });
  assert(r.refused, "case and padding must not open a route to an equal pair");
}

// A both-at-once patch (what a restore or an import writes) is caught too: the
// rule reads the *result*, not the keys that moved.
{
  const r = applyPatch(base, {
    profile: { ...base.profile, targetLanguage: "Quenya", nativeLanguage: "Quenya" },
  });
  assert(r.refused, "an equal pair written in one patch is still an equal pair");
}

// And a legitimate language change still goes through.
{
  const r = applyPatch(base, { profile: { ...base.profile, targetLanguage: "Quenya" } });
  assert(!r.refused, "two different languages must apply");
  assert.equal(r.next.profile.targetLanguage, "Quenya");
}

// --- state 1: the offline lock and a cloud pick never stand together ----------

// The lock going on carries the cloud selections with it, and says so.
{
  const r = applyPatch({ ...base, ttsTier: "cloud", sttTier: "cloud" }, { offline: true });
  assert(!r.refused, "turning the lock on is always allowed");
  assert(isLocalProvider(r.next.provider), "…and the cloud provider goes local with it");
  assert.notEqual(r.next.ttsTier, "cloud", "…as do the cloud voices");
  assert.notEqual(r.next.sttTier, "cloud");
  assert(r.consequence, "a change with that reach must say what it did");
}

// Picking a cloud provider while the lock is on is refused, and names the lock.
{
  const locked: Settings = { ...base, offline: true, provider: "ollama" };
  const r = applyPatch(locked, { provider: "anthropic" });
  assert(r.refused, "a cloud provider must not be selectable under the lock");
  assert.equal(r.next, locked);
  assert.equal(r.refused.exits[0].href, AT.privacy, "the way out is the setting that closed it");
}

// The same for a cloud voice.
{
  const locked: Settings = { ...base, offline: true, provider: "ollama" };
  assert(applyPatch(locked, { ttsTier: "cloud" }).refused, "nor a cloud voice");
  assert(applyPatch(locked, { sttTier: "cloud" }).refused, "nor cloud dictation");
}

// A local provider under the lock is ordinary business.
{
  const locked: Settings = { ...base, offline: true, provider: "ollama" };
  assert(!applyPatch(locked, { provider: "lmstudio" }).refused, "local providers stay open under the lock");
}

// --- §5.2: instant apply, a consequence for reach, undo that reverts ----------

// A narrow change writes no sentence — the control itself is the confirmation.
{
  const r = applyPatch(base, { showHints: false });
  assert(!r.consequence, "a narrow change must not write a consequence line");
  assert(!r.undo, "…and needs no undo: its own control puts it back");
  assert.equal(r.next.showHints, false, "it applies immediately all the same");
}

// Each wide change writes one, and every one of them comes with an undo.
const wide: [string, Partial<Settings>][] = [
  ["target language", { profile: { ...base.profile, targetLanguage: "Quenya" } }],
  ["native language", { profile: { ...base.profile, nativeLanguage: "Quenya" } }],
  ["level", { profile: { ...base.profile, level: "C1" } }],
  ["offline lock", { offline: true }],
  ["daily minutes", { dailyMinutes: 10 }],
];
for (const [name, patch] of wide) {
  const r = applyPatch(base, patch);
  assert(!r.refused, `${name} must apply`);
  assert(r.consequence, `${name} reaches past its own row, so it must say what happened`);
  assert(r.undo, `${name} must offer undo`);
}

// Undo is not a label: applying it has to land back on exactly what we started from.
for (const [name, patch] of wide) {
  const r = applyPatch(base, patch);
  const back = applyPatch(r.next, r.undo!);
  assert(!back.refused, `undoing ${name} must not itself be refused`);
  assert.deepEqual(back.next, base, `undoing ${name} must restore every key it moved`);
}

// The consequence never asserts what it cannot know. Switching language says the
// old language is kept, so it has to name it — a generic sentence would be the
// same words for a learner who has ten days of history and one who has none.
{
  const r = applyPatch(base, { profile: { ...base.profile, targetLanguage: "Quenya" } });
  assert(r.consequence!.includes("Klingon"), "the sentence names what was kept");
  assert(r.consequence!.includes("Quenya"), "…and what is now current");
}

// --- #42: a closed control names its reason and the setting that closed it ----
{
  assert.equal(cloudGate({ ...base, offline: false }), null, "with the lock off nothing is closed");
  const g = cloudGate({ ...base, offline: true });
  assert(g, "under the lock, a network option is closed");
  assert(g.why.trim().length > 0, "and it says why");
  assert.equal(g.exit.href, AT.privacy, "and links to the setting that closed it");
}

// --- the checks must be able to fail --------------------------------------------
// A door that returns `{ next }` for everything would pass every "must apply"
// assertion above. Prove the refusal path is reachable and distinguishable.
const shapes: Applied[] = [
  applyPatch(base, { profile: { ...base.profile, nativeLanguage: "Klingon" } }),
  applyPatch(base, { showHints: false }),
];
assert(shapes[0].refused && !shapes[1].refused, "refused and applied must not be the same shape");

console.log("rules.check ✓");

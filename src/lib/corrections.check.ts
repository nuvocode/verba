// Runnable self-check for the correction gate (PLAN-038): a model may say what was
// wrong with the learner's words, but it may never correct words the learner did not
// just write. `verifyCorrections` is the gate that turns reported corrections into
// believed ones — the same bargain as `verifyRepair` (repair.ts).
// Run: node --experimental-strip-types src/lib/corrections.check.ts
import assert from "node:assert";
import { verifyCorrections, buildSystem, type Correction } from "./prompts.ts";
import { defaultSettings, type Settings } from "./settings.ts";
import { BUNDLED_SCENARIOS } from "./scenarios.ts";

const s: Settings = { ...defaultSettings, profile: { ...defaultSettings.profile, targetLanguage: "Spanish", nativeLanguage: "English" } };
const scenario = BUNDLED_SCENARIOS[0];
const persona = scenario.persona;

const c = (original: string, fixed = "the fixed version", severity: "minor" | "severe" = "minor"): Correction => ({
  original,
  fixed,
  note: "a note",
  severity,
  category: "grammar",
});

// --- a correction whose `original` is in the message survives ---
const msg = "I went to the doctor yesterday.";
const kept = verifyCorrections([c("I went to the doctor")], msg, "en");
assert(kept.length === 1, "a correction of what the learner just wrote survives");

// --- the same pair reported twice in one turn survives once ---
const dup = verifyCorrections([c("I went to the doctor"), c("I went to the doctor")], msg, "en");
assert(dup.length === 1, "one mistake is one correction, even reported twice");

// --- a correction quoting a sentence from an earlier turn (not in `msg`) is dropped ---
const stale = verifyCorrections([c("I went to the doctor")], "I am feeling better now.", "en");
assert(stale.length === 0, "a re-correction of an earlier turn is dropped");

// --- case and punctuation do not decide it ---
const folded = verifyCorrections([c("I went to doctor.")], "i went to doctor", "en");
assert(folded.length === 1, "case and punctuation fold away before the match");

// --- an empty `original` is dropped ---
const empty = verifyCorrections([c("   ")], msg, "en");
assert(empty.length === 0, "an empty original is never a correction");

// --- the prompt actually says it: the model is told to correct only the last message ---
const sys = buildSystem(s, scenario, persona);
assert(sys.includes("Correct ONLY the learner's LAST message"), "the prompt scopes corrections to the last message");
assert(sys.includes("Never re-correct wording from an earlier turn"), "…and names the re-correction it forbids");

console.log("corrections.check.ts — all assertions passed");

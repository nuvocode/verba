// Runnable self-check for Phase 2 pure logic — validators and JSON parsers.
// Run: node --experimental-strip-types src/lib/phase2.check.ts
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { validatePack, PACK_FORMAT_VERSION } from "./packs/schema.ts";
import { BUNDLED_PACKS } from "./packs/bundled.ts";
import { parseDoc, DOC_KEYS, PROMPT_DOC_BUDGET } from "./packs/doc.ts";
import { validateScenario, BUNDLED_SCENARIOS, SCENARIO_FORMAT_VERSION } from "./scenarios.ts";
import { parseReading } from "./reading.ts";
import { parseLevel } from "./level.ts";

// --- language pack validation ---
for (const p of BUNDLED_PACKS) assert(validatePack(p).ok, `bundled pack ${p.id} should validate`);
assert(BUNDLED_PACKS.length >= 3, "need at least 3 bundled packs (done-when: 3 languages)");

const badPack = validatePack({ formatVersion: PACK_FORMAT_VERSION, id: "x", direction: "sideways" });
assert(!badPack.ok, "invalid direction + missing fields must fail");
assert(
  badPack.errors.some((e) => e.includes("direction")),
  "should report the bad direction",
);

// --- language docs: frontmatter is optional, prompt docs opt in explicitly ---
const full = parseDoc("./langs/es/register.md", "---\ntitle: Register\nprompt: true\n---\n\n# Ignored\n\nUse tú.");
assert(full.lang === "es" && full.slug === "register", "lang and slug come from the path");
assert(full.title === "Register" && full.prompt, "frontmatter title and prompt flag are read");
assert(full.body === "# Ignored\n\nUse tú.", "frontmatter is stripped from the body");

const bare = parseDoc("./langs/fr/grammar.md", "# Grammaire\n\nDeux genres.");
assert(bare.title === "Grammaire", "no frontmatter → title falls back to the first heading");
assert(!bare.prompt, "a doc never reaches the tutor prompt unless it says prompt: true");
assert(parseDoc("./langs/de/notes.md", "just text").title === "notes", "no heading either → the slug");
assert(!parseDoc("./langs/de/x.md", "---\nprompt: yes\n---\nhi").prompt, "only prompt: true opts in");
assert(
  parseDoc("./langs/de/01-cases.md", "no heading").title === "cases",
  "an ordering prefix is a folder hint, not part of the title",
);
assert(
  parseDoc("./langs/de/x.md", "---\ntitle: T\nauthor: me\n---\nhi").unknownKeys.join() === "author",
  "unknown frontmatter keys are reported, not silently swallowed (as with unknown pack fields)",
);

// --- the docs actually on disk: unknown keys, and the tutor-prompt token bill ---
// Every prompt-marked doc is pasted into EVERY model call. One short doc looks
// harmless; nobody sees the total until a language has three of them.
const LANGS = new URL("./packs/langs/", import.meta.url);
for (const lang of readdirSync(LANGS)) {
  const dir = new URL(`${lang}/`, LANGS);
  const docs = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseDoc(`./langs/${lang}/${f}`, readFileSync(new URL(f, dir), "utf8")));

  // Every language says which variety it teaches and who stands behind it —
  // official packs included, or contributors copy the exemption, not the example.
  assert(
    docs.some((d) => d.slug === "README"),
    `langs/${lang}/ needs a README.md naming the variety it targets and who verified it`,
  );

  for (const d of docs)
    if (d.unknownKeys.length)
      console.warn(`  ⚠️  ${lang}/${d.slug}.md: unknown frontmatter ${d.unknownKeys.join(", ")} (known: ${DOC_KEYS.join(", ")})`);

  const promptDocs = docs.filter((d) => d.prompt);
  const chars = promptDocs.reduce((n, d) => n + d.body.length, 0);
  console.log(
    `  ${lang}: ${docs.length} doc(s), ${promptDocs.length} in the tutor prompt (~${chars} chars${promptDocs.length ? ": " + promptDocs.map((d) => d.slug).join(", ") : ""})`,
  );
  if (chars > PROMPT_DOC_BUDGET)
    console.warn(
      `  ⚠️  ${lang}: ${chars} chars of prompt-marked docs exceeds the ${PROMPT_DOC_BUDGET}-char budget — this rides on every model call. Trim, or move detail to a learner-facing doc.`,
    );
}

// --- scenario validation (bundled literals omit formatVersion; imports require it) ---
for (const s of BUNDLED_SCENARIOS) {
  const withVersion = { ...s, formatVersion: SCENARIO_FORMAT_VERSION };
  assert(validateScenario(withVersion).ok, `scenario ${s.id} should validate with a version`);
}
assert(!validateScenario({ formatVersion: SCENARIO_FORMAT_VERSION, id: "" }).ok, "empty id must fail");

// --- reading parse: aligned sentences, tolerant of fences/prose ---
const fenced = '```json\n{"title":"Un día","sentences":[{"target":"Hola.","native":"Merhaba."}]}\n```';
const r = parseReading(fenced);
assert(r.title === "Un día", "title parsed through code fence");
assert(r.sentences.length === 1 && r.sentences[0].native === "Merhaba.", "sentence pair aligned");
assert(parseReading("garbage").sentences.length === 0, "garbage yields no sentences, not a throw");

// --- level parse: normalises case, rejects out-of-scale ---
const lvl = parseLevel('{"estimate":"b2","confidence":"high","rationale":"iyi"}');
assert(lvl && lvl.estimate === "B2" && lvl.confidence === "high", "level normalised to B2");
assert(parseLevel('{"estimate":"Z9"}') === null, "out-of-scale estimate rejected");

console.log("phase2.check: all assertions passed ✅");

// Runnable check: `node --experimental-strip-types src/lib/voices.check.ts`
//
// The voice list's promises (§5.4): every voice can be heard before it is kept,
// the language being learned leads, no heading contradicts what is under it, and
// "recommended" is on exactly one option at a time.
import assert from "node:assert";
import { CATALOG, noVoiceNote, oneRecommended, sampleLine, voiceList, voicesFor } from "./bundled.ts";
import { listPacks } from "./packs/index.ts";

const packs = listPacks();
assert(packs.length > 0, "there must be packs to check against");

for (const pack of packs) {
  const { mine, rest, recommended } = voiceList(pack.id, pack.speech.recommendedVoices ?? []);

  // The two headings. `mine` sits under the language being learned and `rest`
  // under "other languages" — so each row must belong where it was put, or the
  // heading is lying about its contents.
  for (const m of mine) assert(m.langs.includes(pack.id), `${m.id} is under ${pack.id}'s heading without speaking it`);
  for (const m of rest) assert(!m.langs.includes(pack.id), `${m.id} speaks ${pack.id} and is filed under "other languages"`);

  // Nothing is dropped on the way: a voice missing from both groups is a voice
  // that cannot be found at all.
  assert.equal(mine.length + rest.length, CATALOG.filter((m) => m.half === "tts").length, "every voice is in one group");

  // Exactly one badge, and it is on a row the learner can actually see first.
  const badged = [...mine, ...rest].filter((m) => m.id === recommended);
  assert(badged.length <= 1, `${pack.id} must not recommend more than one voice`);
  if (recommended) {
    assert.equal(mine[0]?.id, recommended, `${pack.id}'s recommendation must lead its own group`);
    assert(mine[0].langs.includes(pack.id), "…and must be a voice that speaks the language being learned");
  }

  // A pack whose language no bundled voice speaks is allowed — but then the panel
  // owes a sentence, because an empty heading is a hole a learner has to guess at.
  assert.equal(
    noVoiceNote(mine, "this language") === null,
    mine.length > 0,
    `${pack.id}: a group is either populated or explained, never empty and silent`,
  );

  // Every voice on this page can be auditioned, which means every voice has a line
  // to read. A silent preview button is worse than none.
  for (const m of [...mine, ...rest])
    for (const v of m.voices) assert(sampleLine(v.lang).trim().length > 0, `${m.id}/${v.name} has nothing to say`);
}

// A pack listing two good voices still gets one badge — the pack's order decides.
assert.equal(oneRecommended(["piper-es", "kokoro"]), "piper-es", "the pack's first shipped voice is the recommendation");
// …and a pack naming a voice this build dropped falls through rather than badging
// nothing visible or crashing.
assert.equal(oneRecommended(["piper-xx", "kokoro"]), "kokoro", "an unshipped id is skipped, not honoured");
assert.equal(oneRecommended([]), "", "a pack with no opinion gets no badge");
assert.equal(oneRecommended(["piper-xx"]), "", "…and neither does one whose only pick is gone");

// ---- inside a model ----

const kokoro = CATALOG.find((m) => m.id === "kokoro")!;
const inEs = voicesFor(kokoro, "es");
assert(inEs.mine.length > 0, "Kokoro has Spanish voices and they must lead when Spanish is being learned");
for (const v of inEs.mine) assert.equal(v.lang, "es", "the leading group is the language being learned");
for (const g of inEs.others) for (const v of g.voices) assert.equal(v.lang, g.lang, "a group's heading is true of every voice in it");
assert(!inEs.others.some((g) => g.lang === "es"), "…and the language being learned is not repeated below");
assert.equal(
  inEs.mine.length + inEs.others.reduce((n, g) => n + g.voices.length, 0),
  kokoro.voices.length,
  "every voice is reachable",
);

// A language the model does not speak leaves the first group empty rather than
// filling it with voices that would be lying about the heading over them.
const inTr = voicesFor(kokoro, "tr");
assert.equal(inTr.mine.length, 0, "Kokoro speaks no Turkish and must not pretend to");
assert.equal(inTr.others.reduce((n, g) => n + g.voices.length, 0), kokoro.voices.length, "…but every voice is still there");

// Piper carries one voice, so there is no picker to open.
const piper = CATALOG.find((m) => m.id === "piper-tr")!;
assert.equal(piper.voices.length, 1, "a Piper model is one voice");

// ---- dictation is a trade, not a model name (§5.4) ----
const stt = CATALOG.filter((m) => m.half === "stt");
assert(stt.length > 1, "there must be a choice to make");
for (const m of stt) assert(m.tradeoff?.trim(), `${m.id} must say what choosing it costs and buys`);
assert.equal(new Set(stt.map((m) => m.tradeoff)).size, stt.length, "two rows reading the same thing is not a choice");

// A sample exists for every language a voice claims, and an unknown one still
// speaks rather than playing silence.
assert(sampleLine("zz").trim().length > 0, "an unlisted language falls back to a line, never to nothing");

// The one pack with no bundled voice today names what speaks instead, rather than
// leaving the learner in front of an empty heading.
const silent = voiceList("id", []);
assert.equal(silent.mine.length, 0, "no bundled voice speaks Indonesian — if one lands, this check is the reminder");
const note = noVoiceNote(silent.mine, "Indonesian")!;
assert.match(note, /system voice/, "…so the note names what reads the replies instead");
assert.match(note, /still yours to hear/, "…and does not pretend the rest of the list is closed");
assert.equal(silent.rest.length, CATALOG.filter((m) => m.half === "tts").length, "every voice is still offered");

console.log(`voices.check ✓ ${packs.length} packs, ${CATALOG.length} models`);

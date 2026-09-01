// Runnable self-check for §PLAN-023 the note contract: shape, anchoring, cap,
// priority, and schema separation from Talk's corrections.
// Run: node --experimental-strip-types src/lib/notes.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { validateNotes, type ReadNote } from "./notes.ts";
import type { ReadingText } from "./reading.ts";

const t = (sentences: string[], title = "A passage"): ReadingText => ({
  title,
  sentences: sentences.map((target) => ({ target, native: "" })),
});

// invariant 17 — a note whose anchor is absent from the passage is dropped,
// including the near miss ("run out" when the text says "ran out").
{
  const text = t(["We ran out of bread at the market."]);
  const notes = validateNotes(
    [
      { type: "lexis", anchor: "ran out of", body: "a phrasal verb meaning to have none left" },
      { type: "lexis", anchor: "run out", body: "the near miss — inflected differently, must drop" },
    ],
    text,
    "en",
    5,
  );
  assert.equal(notes.length, 1, "the exact anchor survives");
  assert.equal(notes[0].anchor, "ran out of", "…and the near miss is dropped");
}

// invariant 17 — case and punctuation do not cause a drop: "Run out of," anchors
// to "run out of".
{
  const text = t(["We run out of bread at the market."]);
  const notes = validateNotes([{ type: "lexis", anchor: "Run out of,", body: "a phrasal verb meaning to have none left" }], text, "en", 5);
  assert.equal(notes.length, 1, "case and punctuation do not drop a real anchor");
  assert.equal(notes[0].sentence, 0, "the sentence is filled from where the anchor was found");
}

// invariant 18 — 10 sentences, 9 valid notes returned → exactly 5 survive.
{
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
  const sentences = words.map((w) => `The ${w} market opened early this morning.`);
  const text = t(sentences);
  const raw = words.slice(0, 9).map((w) => ({
    type: "lexis",
    anchor: w,
    body: `a note about the word ${w} that is long enough to keep`,
  }));
  const notes = validateNotes(raw, text, "en", 5);
  assert.equal(notes.length, 5, "the cap is half the sentence count");
}

// invariant 18 — 6 sentences, 1 note → 1 survives; 6 sentences, 0 notes → [],
// no error.
{
  const text = t(["One two three four five six seven eight nine ten.", "A second sentence with enough words in it."]);
  const one = validateNotes([{ type: "structure", anchor: "One two three", body: "a note long enough to be kept" }], text, "en", 3);
  assert.equal(one.length, 1, "a single valid note survives");
  const zero = validateNotes([], text, "en", 3);
  assert.deepEqual(zero, [], "zero notes is a valid outcome — an empty array, not an error");
}

// invariant 18 — two notes on the same sentence → one survives.
{
  const text = t(["The market was crowded with many friendly people."]);
  const notes = validateNotes(
    [
      { type: "lexis", anchor: "crowded", body: "full of people, busy" },
      { type: "structure", anchor: "was crowded", body: "the passive voice in the past" },
    ],
    text,
    "en",
    5,
  );
  assert.equal(notes.length, 1, "one note per sentence maximum");
}

// invariant 18 — priority: a culture note and a lexis note with a cap of 1 → the
// lexis one.
{
  const text = t(["The market sold tapas and fresh bread."]);
  const notes = validateNotes(
    [
      { type: "culture", anchor: "tapas", body: "a Spanish custom of small plates" },
      { type: "lexis", anchor: "fresh bread", body: "bread that was baked today" },
    ],
    text,
    "en",
    1,
  );
  assert.equal(notes.length, 1, "the cap keeps one");
  assert.equal(notes[0].type, "lexis", "lexis outranks culture");
}

// invariant 19 — schema separation: notes.ts and reading.ts must not mention
// Talk's correction schema, and notes.ts must not import prompts.ts. The source
// scan above is the whole guard — a set-length comparison between NoteType and
// CorrectionCategory can never fail (both are five members), so it is not
// asserted here.
{
  const notesSrc = readFileSync(new URL("./notes.ts", import.meta.url), "utf8");
  const readingSrc = readFileSync(new URL("./reading.ts", import.meta.url), "utf8");
  for (const forbidden of ["Correction", "severity", "fixed", "original"]) {
    assert(!notesSrc.includes(forbidden), `notes.ts must not mention "${forbidden}"`);
    assert(!readingSrc.includes(forbidden), `reading.ts must not mention "${forbidden}"`);
  }
  assert(!notesSrc.includes("prompts.ts"), "notes.ts must not import prompts.ts");
}

console.log("notes.check OK");

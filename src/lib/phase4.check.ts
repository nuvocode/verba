// Runnable self-check for the Verba-shell logic: correction gating, card strength,
// word normalisation, and the Coach's metric round-trip.
// Run: node --experimental-strip-types src/lib/phase4.check.ts
import assert from "node:assert";
import { shouldShowInline, parseTurn, partialReply } from "./prompts.ts";
import { strength, newCard, schedule } from "./srs.ts";
import { bareWord, parseReading } from "./reading.ts";
import { computeMetrics, estimateLevelV2, metricsFromRow } from "./metrics.ts";

// --- correction gating: adaptive only interrupts for a real error ---
assert(shouldShowInline("adaptive", "severe") === true, "adaptive interrupts on severe");
assert(shouldShowInline("adaptive", "minor") === false, "adaptive holds minor back for the reflection");
assert(shouldShowInline("live", "minor") === true, "live shows everything");
assert(shouldShowInline("delayed", "severe") === false, "delayed never interrupts");
assert(shouldShowInline("adaptive", undefined) === false, "no correction, nothing to show");

// A model that omits severity must not be able to escalate an interruption.
const turn = parseTurn(
  JSON.stringify({
    reply: "¿Y de comer?",
    corrections: [{ original: "yo querer", fixed: "yo quiero", note: "conjugate the verb" }],
    suggestions: ["Un café, por favor."],
  }),
);
assert(turn.corrections[0].severity === "minor", "missing severity defaults to minor");
assert(shouldShowInline("adaptive", turn.corrections[0].severity) === false, "…so adaptive stays quiet");

// A model that nests the whole fenced answer inside "reply" must still be unwrapped.
const nested = parseTurn(
  JSON.stringify({
    reply:
      '```json\n{ "reply": "That sounds fun!", "corrections": [{ "original": "I played Uncharted video game", "fixed": "I played the Uncharted video game", "note": "artikel", "severity": "minor" }], "suggestions": ["It was Uncharted 4."] }\n```',
  }),
);
assert(nested.reply === "That sounds fun!", "nested reply is unwrapped, not printed raw");
assert(nested.corrections[0].fixed === "I played the Uncharted video game", "nested corrections survive");
assert(nested.suggestions[0] === "It was Uncharted 4.", "nested suggestions survive");

// --- streaming: the reply is readable long before the object closes ---
const full = JSON.stringify({
  reply: 'Wie geht\'s? Ich sagte "hallo".\nUnd du?',
  corrections: [{ original: "ein Kaffee", fixed: "einen Kaffee", note: "akkusatif", severity: "minor" }],
  suggestions: ["Mir geht es gut."],
});
// Every prefix must be safe to render: the parser is fed a growing string, and a chunk
// boundary can fall anywhere — including inside \" or halfway through \uXXXX.
for (let i = 0; i < full.length; i++) {
  const seen = partialReply(full.slice(0, i));
  assert(parseTurn(full).reply.startsWith(seen), `prefix ${i} shows only real reply text, got ${JSON.stringify(seen)}`);
}
assert(partialReply(full) === parseTurn(full).reply, "the closed reply matches what parseTurn lands on");
assert(partialReply('{"reply": "Guten T') === "Guten T", "an open reply streams as far as it got");
assert(partialReply('{"corrections": []') === "", "no reply key yet, nothing to show");
assert(partialReply('```json\n{"reply": "Hallo') === "Hallo", "a code fence does not hide the reply");
assert(partialReply('{"reply": "\\u00e4h') === "äh", "a completed unicode escape decodes");
assert(partialReply('{"reply": "gut\\u00e') === "gut", "a half-arrived escape waits rather than printing garbage");
assert(partialReply('{"reply": "{ \\"reply\\": \\"nested') === "", "a nested object is never flashed at the learner");

// Verbatim from glm-5.2: a stray quote in the suggestions array, so the object will not
// parse. The reply is still in there, and printing the raw JSON at the learner instead —
// which is what the fallback used to do — is the worse answer.
const malformed =
  '{\n  "reply": "Okay, ein Kaffee kommt sofort!",\n  "corrections": [],\n  "suggestions": [\n    "Einen normalen Kaffee, bitte.",\n    " "Ich möchte einen Espresso, bitte."\n  ]\n}';
assert(parseTurn(malformed).reply === "Okay, ein Kaffee kommt sofort!", "unparseable turn still yields its reply");
assert(!parseTurn(malformed).reply.includes('"corrections"'), "…and never shows the learner raw JSON");

// The cloze front these assertions covered is gone: its own fallback — appending a
// blank to a complete sentence when the term was inflected — made a card that asked
// nothing, which is exactly what a separable verb ("walk you through") always hit.
// Memory now tests the term against its meaning. See vocab.check.ts for the gate that
// decides what becomes a card at all.

// --- card strength tracks the SRS interval ---
assert(strength(newCard) < 0.4, "a brand-new card reads weak");
const mature = schedule(schedule(schedule(newCard, 2, 0), 2, 0), 2, 0);
assert(strength(mature) > strength(newCard), "reviews make a card read stronger");
assert(strength({ interval: 999 }) === 1, "strength is capped at 1");

// --- word normalisation for reading taps ---
assert(bareWord("¿Cuánto?") === "cuánto", "leading/trailing punctuation stripped");
assert(bareWord("mercado,") === bareWord("Mercado"), "same word, same key");

// --- reading notes: only some sentences carry one, and null is not a note ---
const text = parseReading(
  JSON.stringify({
    title: "El mercado",
    sentences: [
      { target: "Los puestos abren temprano.", native: "The stalls open early.", note: null },
      { target: "No va por necesidad, sino por costumbre.", native: "Not out of need, but habit.", note: "“sino”, not “pero”." },
    ],
  }),
);
assert(text.sentences.length === 2, "both sentences parsed");
assert(text.sentences[0].note === undefined, "null note is dropped, not rendered as 'null'");
assert(text.sentences[1].note === "“sino”, not “pero”.", "a real note survives");

// --- Coach round-trip: stored row → metrics → the same components ---
const m = computeMetrics(["Quisiera un café con leche, por favor.", "¿Puedo pagar con tarjeta?"], {
  corrections: 1,
  deckSize: 40,
});
const row = {
  messages: m.messages,
  words: m.words,
  unique_words: m.uniqueWords,
  avg_sentence_len: m.avgSentenceLen,
  avg_word_len: m.avgWordLen,
  corrections: m.corrections,
  deck_size: m.deckSize,
};
const back = metricsFromRow(row);
assert(
  Math.abs(back.typeTokenRatio - m.typeTokenRatio) < 1e-9 && Math.abs(back.errorRate - m.errorRate) < 1e-9,
  "derived ratios rebuild exactly from the stored columns",
);
assert(
  estimateLevelV2(back).score === estimateLevelV2(m).score,
  "the Coach re-derives the same composite it saved — no drift between write and read",
);

console.log("phase4 ok");

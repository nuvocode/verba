// Runnable self-check for the Verba-shell logic: correction gating, cloze recall,
// card strength, word normalisation, and the Coach's metric round-trip.
// Run: node --experimental-strip-types src/lib/phase4.check.ts
import assert from "node:assert";
import { shouldShowInline, parseTurn } from "./prompts.ts";
import { cloze, strength, newCard, schedule } from "./srs.ts";
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

// --- cloze: recall in context, and a safe fallback when the term is inflected ---
assert(
  cloze("marchando", "¡Marchando! ¿Algo de comer?") === "¡‗‗‗‗‗! ¿Algo de comer?",
  "the term is blanked out of its own sentence, case-insensitively",
);
assert(cloze("regatear", "A veces regatea el precio.").endsWith("— ‗‗‗‗‗"), "an inflected term appends the blank");
assert(cloze("x", "") === "‗‗‗‗‗", "no example still gives something to recall");
// Regex metacharacters in a term must not blow up the RegExp.
assert(cloze("¿qué?", "Dijo ¿qué? otra vez.") === "Dijo ‗‗‗‗‗ otra vez.", "punctuation in the term is escaped");

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

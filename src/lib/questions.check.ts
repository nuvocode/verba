// Runnable self-check for the shared question layer — the model, the parse, and the
// scoring both activities lean on.
// Run: node --experimental-strip-types src/lib/questions.check.ts
import assert from "node:assert";
import { parseQuestions, scoreAnswer, questionInstructions, questionsShape } from "./questions.ts";

// --- the quality bar lives in the instructions, so assert it is actually stated ---
const instr = questionInstructions("Spanish", "English", 3);
assert(instr.includes("3 comprehension questions"), "the count reaches the prompt");
assert(/load-bearing/.test(instr), "questions are told to hang on the load-bearing detail");
assert(/wasted/.test(instr), "…and a question you could answer without listening is called out as wasted");
assert(instr.includes("multiple_choice") && instr.includes("fill_blank"), "both kinds are asked for by name");

// --- parse: labels come the human way, the app names them the short way ---
const qs = parseQuestions([
  { type: "multiple_choice", prompt: "Who paid?", options: ["Ana", "Luis", "Marta"], answer: "Luis", line: "Luis pagó la cuenta." },
  { type: "fill_blank", prompt: "Luis pagó la ___.", answer: "cuenta", line: "Luis pagó la cuenta." },
]);
assert(qs.length === 2, "both questions survive a clean parse");
assert(qs[0].kind === "mcq" && qs[1].kind === "cloze", "type labels map to the short kinds");
assert(qs[0].line === "Luis pagó la cuenta.", "the source line is kept for the miss view");

// A multiple choice whose answer is not among its options is unanswerable — dropped.
const bad = parseQuestions([{ type: "multiple_choice", prompt: "?", options: ["a", "b"], answer: "c", line: "" }]);
assert(bad.length === 0, "an mcq whose answer is not an option is dropped");
// A question missing its prompt or answer is nothing to ask — dropped.
assert(parseQuestions([{ type: "fill_blank", answer: "x" }]).length === 0, "no prompt, no question");
assert(parseQuestions("not an array" as any).length === 0, "a non-array parses to nothing, never throws");

// --- scoring: exact for mcq, forgiving of case and punctuation for cloze ---
assert(scoreAnswer(qs[0], "Luis"), "the right option scores");
assert(!scoreAnswer(qs[0], "Ana"), "a wrong option does not");
assert(scoreAnswer(qs[1], "  Cuenta. "), "cloze ignores case, padding and trailing punctuation");
assert(!scoreAnswer(qs[1], ""), "a blank answer never counts as correct");

// --- the JSON shape names both source-language slots so the model fills them right ---
const shape = questionsShape("Spanish", "English");
assert(shape.includes("multiple_choice") && shape.includes("fill_blank"), "the shape carries both kinds");
assert(shape.includes("source sentence") && shape.includes('"line"'), "…and asks for the source-sentence line");

console.log("questions.check.ts — all assertions passed");

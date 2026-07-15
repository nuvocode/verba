// The comprehension check, built once and shared. A listening chapter or a read
// passage is just text; this layer turns text into questions and scores the
// answers, and stays honest about what the input is. Two kinds today — multiple
// choice and a fill-in-the-blank cloze — held in a tagged union so a third kind
// is a new case, not a rewrite.
//
// The whole quality bar for the feature lives in questionInstructions(): a
// question you could answer without having followed the passage is a wasted
// question. It has to hang on the load-bearing detail — who agreed to what, why
// the plan changed, the number that decides the outcome — never on trivia.

export type QuestionKind = "mcq" | "cloze";

export interface Question {
  kind: QuestionKind;
  prompt: string; // mcq: the question (in NATIVE). cloze: the line with ___ (in TARGET).
  options?: string[]; // mcq only — the correct answer is one of these
  answer: string; // mcq: the exact correct option. cloze: the removed word.
  line: string; // the source sentence the answer sits in (TARGET) — shown on a miss
}

/** Trim + lowercase + drop punctuation, so "Mercado." and "mercado" score alike. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\p{P}/gu, "").replace(/\s+/g, " ").trim();
}

/** Did the answer land? Exact for mcq, punctuation/case-insensitive for cloze. */
export function scoreAnswer(q: Question, given: string): boolean {
  const g = norm(given);
  return !!g && g === norm(q.answer);
}

/**
 * The instructions that make the questions worth asking. Shared by every activity
 * that wants a comprehension check — the source text is the caller's business;
 * this only ever says what a good question is.
 */
export function questionInstructions(targetLang: string, nativeLang: string, n = 3): string {
  return [
    `After the passage, write ${n} comprehension questions a listener could only answer if they understood what happened.`,
    `Each question must hang on a load-bearing detail — who did or agreed to what, why something changed, a name or number that decides the outcome. Never on trivia, phrasing, or a detail that does not matter. If a question could be answered without having followed the passage, it is wasted — replace it.`,
    `Mix the types. At least one "multiple_choice": the question and every option in ${nativeLang}, one correct option plus 2-3 wrong ones that someone who only half-listened might pick. At least one "fill_blank": take one real sentence from the passage and remove a single meaningful word (never "the", "a", or filler) — the listener types it back.`,
    `For every question include "line": the exact sentence from the passage in ${targetLang} the answer sits in, so a listener who missed it can be shown where it was.`,
  ].join("\n");
}

/** The JSON shape for the questions array, dropped into whatever the caller asks for. */
export function questionsShape(targetLang: string, nativeLang: string): string {
  return (
    `"questions": [ ` +
    `{ "type": "multiple_choice", "prompt": "the question in ${nativeLang}", "options": ["option in ${nativeLang}", "..."], "answer": "the exact text of the correct option", "line": "the source sentence in ${targetLang}" }, ` +
    `{ "type": "fill_blank", "prompt": "the source sentence in ${targetLang} with the removed word written as ___", "answer": "the removed word in ${targetLang}", "line": "the same source sentence, complete, in ${targetLang}" } ` +
    `]`
  );
}

// The model labels kinds the human way ("multiple_choice"); the app names them the
// short way. Accept both so a parse never turns on the label.
const KIND: Record<string, QuestionKind> = {
  multiple_choice: "mcq",
  multiple: "mcq",
  mcq: "mcq",
  fill_blank: "cloze",
  fill: "cloze",
  cloze: "cloze",
};

/** Parse a questions array (already pulled out of the model's JSON) into the model. */
export function parseQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q: any): Question | null => {
      if (!q) return null;
      const kind = KIND[String(q.type ?? q.kind ?? "").toLowerCase()];
      const prompt = String(q.prompt ?? "").trim();
      const answer = String(q.answer ?? "").trim();
      if (!kind || !prompt || !answer) return null;
      const line = String(q.line ?? "").trim();
      if (kind === "mcq") {
        const options = Array.isArray(q.options) ? q.options.map((o: any) => String(o).trim()).filter(Boolean) : [];
        // A multiple choice whose answer is not among its options is unanswerable — drop it.
        if (options.length < 2 || !options.some((o: string) => norm(o) === norm(answer))) return null;
        return { kind, prompt, options, answer, line };
      }
      return { kind, prompt, answer, line };
    })
    .filter((q): q is Question => q !== null);
}

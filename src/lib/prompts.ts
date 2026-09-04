import type { CoachStyle, Settings } from "./settings.ts";
import { levelOf } from "./model.ts";
import type { Persona, Scenario } from "./scenarios";
import { packGuidance, type LanguagePack } from "./packs/schema.ts";
import { worthLearning } from "./vocab.ts";
import { BREAKDOWN_MEANING_SIGNALS } from "./breakdown.ts";
import { axisGuidance, DIFFICULTY_NO_ANNOUNCE, type Axis } from "./difficulty.ts";

/**
 * The most cards one conversation may offer.
 *
 * It was eight, and eight a session is how a deck reaches seventy-eight entries
 * nobody chose. Five is a ceiling, not a target — the prompt asks for fewer.
 */
export const MAX_VOCAB_PER_SESSION = 5;

export type { Scenario } from "./scenarios";
export { packGuidance } from "./packs/schema.ts";

/**
 * The difficulty a session was picked with (PLAN-031). `axis` is null for a
 * session that deliberately manufactures none (a fresh learner, a recovered
 * learner, or one who asked for ease); when it is set, `buildSystem` folds the
 * axis guidance and the no-announce rule into the system prompt.
 */
export interface SystemDifficulty {
  axis: Axis | null;
  step: number;
}

/** System prompt for a normal conversational turn. Model must return the turn JSON. */
export function buildSystem(
  s: Settings,
  scenario: Scenario,
  persona: Persona,
  pack?: LanguagePack,
  memories: Memory[] = [],
  difficulty: SystemDifficulty = { axis: null, step: 0 },
  corrections: string[] = [],
  opening: Memory | null = null,
): string {
  return [
    `You are Verba, a warm and encouraging ${s.profile.targetLanguage} conversation tutor.`,
    `For this session you are ${persona.name}, ${persona.role}. This persona is fixed for the whole session — stay in it throughout.`,
    styleGuidance(s.coachStyle),
    `The learner's native language is ${s.profile.nativeLanguage}. Their self-reported level is ${levelOf(s.profile)}.`,
    `Scenario: ${scenario.setup}`,
    scenario.goals?.length ? `Help the learner practise these goals: ${scenario.goals.join("; ")}.` : "",
    packGuidance(pack),
    memoryBrief(memories),
    memories.length
      ? `${memoryStance} The scenario is what you talk about. Never read the list back, and never volunteer that you keep notes on them.`
      : "",
    // PLAN-033: the one exception to the stance, and only when a detail was
    // supplied. The stance forbids reaching into the list; this hands the model
    // one fact, already chosen and checked, and permits one question about it.
    // The fact is named inline — a general "you may open on something you
    // remember" would re-open the door the stance closes. No detail → no sentence.
    opening
      ? `You may open by asking after this one thing the learner told you: "${opening.fact}". Ask about it once, and only if it fits the moment — do not reach for anything else on the list.`
      : "",
    // PLAN-033: the honesty clause. If the learner asks how the coach knows
    // something, the answer is the truth — Verba keeps notes, and they can read
    // and delete all of them. Never deny, deflect, or claim to have guessed.
    memories.length
      ? `If the learner asks how you know something, answer honestly: Verba keeps notes of what they have said, and they can read and delete all of them on the Memory screen. Never deny it, deflect, or claim to have guessed.`
      : "",
    ``,
    `Hold a natural conversation in ${s.profile.targetLanguage}. Match your vocabulary and sentence length to a ${levelOf(s.profile)} learner. Always keep the conversation going by ending your reply with a question or prompt.`,
    ``,
    // PLAN-031: when a session has a difficulty axis, the model is told how to
    // apply it and, beside it, that it must never announce the difficulty — §5.2's
    // last line, at the prompt level where it can hold.
    difficulty.axis ? axisGuidance(difficulty.axis, difficulty.step) : "",
    difficulty.axis ? DIFFICULTY_NO_ANNOUNCE : "",
    // PLAN-032: the praise rule, in the same register as the "do NOT correct the
    // learner inside reply" rule. Praise without a cited record is a fabrication,
    // and the record it may cite is the list of things this learner has been
    // corrected on before — the only things they could have "just got right".
    // The praise sentence goes in the "praise" object's "text", never in "reply":
    // "reply" must stand on its own without it, so a dropped praise really drops.
    `Do not praise the learner's language. Do not write "great", "well done", "excellent", "perfect", "nice job", or any equivalent. When the learner produces a correct sentence, the correct response is to answer what they said and keep the conversation moving. Praise is allowed **only** when you can point at something specific in the record below that they used to get wrong and just got right, and you must say what that thing was. When you do praise, put the praise sentence in "praise"."text" — never inside "reply". "reply" must read naturally and completely without the praise, because the praise may be dropped.`,
    corrections.length
      ? `Things this learner has been corrected on before (the record you may cite): ${corrections.join("; ")}.`
      : `This learner has no correction record yet — so there is nothing to cite, and no praise is allowed.`,
    `You MUST answer with ONLY a valid JSON object, no prose outside it, in this exact shape:`,
    `{`,
    `  "reply": "your natural conversational reply in ${s.profile.targetLanguage} (1-3 sentences)",`,
    `  "corrections": [ { "original": "the learner's exact wording that was wrong", "fixed": "the corrected version", "note": "a short explanation written in ${s.profile.nativeLanguage}", "severity": "minor or severe", "category": "grammar | vocabulary | wordOrder | register | pronunciation" } ],`,
    `  "suggestions": [ "a short example reply the learner could send next, in ${s.profile.targetLanguage}", "another option" ],`,
    `  "goalsMet": [0, 2],`,
    `  "repair": { "category": "HOLD | REPEAT | SLOW | CLARIFY | CONFIRM | PARAPHRASE", "variant": "the learner's exact words" },`,
    `  "missed": ["keyWordMissing", "topicChange"],`,
    `  "keyWord": "the one word in YOUR OWN last line that carried the meaning",`,
    `  "praise": { "for": "the exact record referred to", "text": "the praise sentence, in ${s.profile.targetLanguage}" },`,
    `  "ease": false`,
    `}`,
    ``,
    `Rules:`,
    `- Do NOT correct the learner inside "reply". Put every correction only in the "corrections" array.`,
    `- Only add a correction for a real grammar, word-choice, or spelling mistake. If the learner's message was fine, return "corrections": [].`,
    `- Correct ONLY the learner's LAST message. Never re-correct wording from an earlier turn — it was already shown, and repeating it wastes the wrap-up.`,
    `- "severity" is "severe" when the mistake breaks meaning or grammar rules, "minor" when it is understandable but unnatural.`,
    `- "category" is which kind of mistake it is: grammar, vocabulary, wordOrder, register, or pronunciation. Pick the one that fits best.`,
    `- Give 2-3 "suggestions". Keep them natural and at the learner's level.`,
    `- "goalsMet" lists the index of every scenario goal the learner has JUST satisfied with their last message. An empty list is the normal answer. Never re-list a goal already met, and never credit a goal the learner only asked about.`,
    `- "repair" is filled ONLY when the learner's last message actually performed one of the six repair moves (HOLD, REPEAT, SLOW, CLARIFY, CONFIRM, PARAPHRASE). Set "variant" to the learner's own wording, copied verbatim, never rephrased. Omit the field otherwise — that is the normal answer. Never report a category with a variant the learner did not literally write.`,
    `- "missed" lists which of these were observably true of the learner's LAST message: disconnected (did not answer what was asked), overGeneral ("yes", "maybe", "sure" and nothing else), apologyThenOn (said "sorry"/"pardon" and carried on regardless), keyWordMissing (the key word in YOUR last line appears nowhere in the reply), topicChange (the reply starts a different subject). An empty list is the normal answer. Never guess at what the learner was thinking.`,
    `- "keyWord" is the one word in your OWN last line that carried the meaning — the word "keyWordMissing" is verified against.`,
    `- "ease" is true when in ANY wording the learner asked for an easier session — for example, "make it a bit easier", "let's take it slow", "this is too hard today", "I'm not in the mood for a challenge". It is false (the normal answer) otherwise. Report it even if the learner only hinted; the request is honoured unconditionally.`,
    `- Never mention that you are returning JSON.`,
  ].join("\n");
}

/**
 * Ceiling on one conversational turn.
 *
 * A turn measures around 280 tokens — a two-sentence reply, a correction or two,
 * three suggestions — so this is roughly two and a half times what the prompt asks
 * for. It is not there to shape the answer but to end a model that has stopped
 * answering and started rambling: without it, a turn that goes wrong goes wrong for
 * as long as the model feels like it, and the learner watches a spinner throughout.
 */
export const TURN_MAX_TOKENS = 700;

export type Severity = "minor" | "severe";

/**
 * Correction policy: does this break the conversation open now, or wait for the
 * reflection? "adaptive" is the default — only a meaning-breaking mistake is
 * worth interrupting a learner mid-flow for.
 */
export function shouldShowInline(timing: "adaptive" | "live" | "delayed", severity?: Severity): boolean {
  if (!severity) return false;
  if (timing === "live") return true;
  if (timing === "delayed") return false;
  return severity === "severe";
}

export interface Correction {
  original: string;
  fixed: string;
  note: string;
  severity: Severity;
  /** Which kind of mistake this is — decided by the coach in the turn reply. */
  category: CorrectionCategory;
}

/**
 * The closed set of correction kinds. Talk's own schema — Read (PLAN-023) defines
 * its own and the two never share a type (invariant 19). An unknown or missing
 * category maps to "grammar" on parse: a wrong bucket is recoverable, an invented
 * bucket per session is not.
 */
export type CorrectionCategory = "grammar" | "vocabulary" | "wordOrder" | "register" | "pronunciation";

const CORRECTION_CATEGORIES: CorrectionCategory[] = [
  "grammar",
  "vocabulary",
  "wordOrder",
  "register",
  "pronunciation",
];

export interface TurnResult {
  reply: string;
  corrections: Correction[];
  suggestions: string[];
  /** Indices into the scenario's goals that this turn just satisfied. */
  goalsMet: number[];
  /**
   * A reported repair move, shape-checked only. `parseTurn` has no access to the
   * learner's message, so it cannot verify the variant — `verifyRepair` (repair.ts)
   * does that in `useTalk.send`, and nothing is recorded if the variant was never
   * actually written. `null` when the model reported nothing (the normal answer)
   * or the shape is wrong.
   */
  repair: { category: string; variant: string } | null;
  /**
   * Model-reported breakdown signals (PLAN-028), shape-checked only. Only the five
   * meaning judgements (`disconnected`, `overGeneral`, `apologyThenOn`,
   * `keyWordMissing`, `topicChange`) survive; `breakdown.ts` verifies the observable
   * ones on its own side before any turn is believed.
   */
  missed: string[];
  /**
   * The one word in the coach's own last line that carries the meaning — the key
   * `keyWordMissing` is checked against (PLAN-028). Empty when the model did not
   * name one.
   */
  keyWord: string;
  /**
   * Whether the learner asked for an easier session in any wording (PLAN-031).
   * `false` is the normal answer. The request is honoured unconditionally and
   * never announced.
   */
  ease: boolean;
  /**
   * A model-reported praise, shape-checked only. `for` is the record the praise
   * claims to cite; `text` is the praise sentence, kept **outside** `reply` so a
   * dropped praise really drops. `praiseGate` (patience.ts) decides whether it
   * is believed — `for` must match a real correction record exactly, and the
   * session cap is enforced there too. `null` when the model reported nothing
   * (the normal answer) or the shape is wrong.
   */
  praise: { for: string; text: string } | null;
}

/** The JSON escapes worth decoding mid-stream; `\uXXXX` is handled separately. */
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };

/**
 * The reply so far, read out of a turn JSON that is still arriving.
 *
 * "reply" is the first key the model writes, and it is about a fifth of the bytes in
 * a finished turn — the rest is corrections and suggestions the learner is not reading
 * yet. Pulling the reply out as it lands is what turns a four-second wait into a
 * one-second one; `parseTurn` still has the last word once the object closes.
 *
 * Returns "" when there is nothing showable yet, which is also the answer for a model
 * that nested its real object inside "reply" — `parseTurn` unwraps that, and
 * half-rendered JSON should never reach the learner in the meantime.
 */
export function partialReply(raw: string): string {
  const key = raw.indexOf('"reply"');
  if (key < 0) return "";
  const colon = raw.indexOf(":", key + 7);
  if (colon < 0) return "";
  const open = raw.indexOf('"', colon + 1);
  if (open < 0) return "";

  let out = "";
  for (let i = open + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') break; // the reply is closed; the rest of the object is not ours
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const esc = raw[i + 1];
    if (esc === undefined) break; // escape split across chunks — wait for the rest
    if (esc === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (hex.length < 4) break; // ditto, mid-codepoint
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ESCAPES[esc] ?? esc;
    i += 1;
  }
  return out.trimStart().startsWith("{") || out.includes('"reply"') ? "" : out;
}

/** Defensive parse: models sometimes wrap JSON in prose or code fences. */
export function parseTurn(raw: string): TurnResult {
  let obj = extractJson(raw);
  // A small model under a JSON grammar (Ollama format:"json") can satisfy it by
  // nesting the real answer — fences and all — inside "reply". Unwrap one level.
  if (typeof obj?.reply === "string" && obj.reply.includes('"reply"')) obj = extractJson(obj.reply) ?? obj;
  return {
    // When the object won't parse — a stray quote in the suggestions array is the
    // common one — the reply is still sitting in the text, and reading it out beats
    // showing the learner the raw JSON the fallback used to print.
    reply: typeof obj?.reply === "string" ? obj.reply : partialReply(raw) || raw.trim(),
    corrections: Array.isArray(obj?.corrections)
      ? obj.corrections
          .filter((c: any) => c && c.original && c.fixed)
          .map((c: any) => ({
            original: String(c.original),
            fixed: String(c.fixed),
            note: String(c.note ?? ""),
            // Unknown / missing severity is treated as minor: never escalate an
            // interruption the model didn't actually ask for.
            severity: c.severity === "severe" ? ("severe" as const) : ("minor" as const),
            // Unknown / missing category maps to grammar — a wrong bucket is
            // recoverable, an invented bucket per session is not.
            category: CORRECTION_CATEGORIES.includes(c.category) ? c.category : ("grammar" as const),
          }))
      : [],
    suggestions: Array.isArray(obj?.suggestions)
      ? obj.suggestions.map((x: any) => String(x)).filter(Boolean).slice(0, 3)
      : [],
    // Indices into the scenario's goals. Only non-negative integers count; a
    // model that hands back strings or floats is read as having met nothing.
    goalsMet: Array.isArray(obj?.goalsMet)
      ? obj.goalsMet
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isInteger(n) && n >= 0)
      : [],
    // A reported repair move, shape-checked only. `category` must be a string and
    // `variant` a non-empty string for the field to survive — anything else is
    // dropped, because `parseTurn` is not the gate that decides whether the move
    // is believable. That gate lives in `verifyRepair` (repair.ts), which holds
    // the learner's message.
    repair:
      obj?.repair &&
      typeof obj.repair === "object" &&
      typeof obj.repair.category === "string" &&
      typeof obj.repair.variant === "string" &&
      obj.repair.variant.trim() !== ""
        ? { category: obj.repair.category, variant: obj.repair.variant }
        : null,
    // A model-reported breakdown (PLAN-028), shape-checked only. Only the five
    // meaning judgements known to breakdown.ts survive; an unknown string is
    // dropped here so nothing invented travels further. Deduplicated, order
    // preserved: one observation is one signal, and a label reported twice must
    // not satisfy PLAN-029's two-signal condition on a single observation.
    missed: (() => {
      if (!Array.isArray(obj?.missed)) return [];
      const kept: string[] = [];
      for (const x of obj.missed) {
        const s = String(x);
        if (!BREAKDOWN_MEANING_SIGNALS.includes(s as any)) continue;
        if (kept.includes(s)) continue; // one observation is one signal
        kept.push(s);
      }
      return kept;
    })(),
    // The key word the coach's last line carried — empty when the model named none.
    keyWord: typeof obj?.keyWord === "string" ? obj.keyWord : "",
    // Whether the learner asked for an easier session (PLAN-031). Any truthy
    // reading counts — the model reports it in wording, not in a literal.
    ease: obj?.ease === true,
    // A model-reported praise (PLAN-032), shape-checked only. `for` must be a
    // non-empty string and `text` a non-empty string for the field to survive —
    // the belief gate lives in `praiseGate` (patience.ts), which holds the
    // correction record and the session cap.
    praise:
      obj?.praise &&
      typeof obj.praise === "object" &&
      typeof obj.praise.for === "string" &&
      obj.praise.for.trim() !== "" &&
      typeof obj.praise.text === "string" &&
      obj.praise.text.trim() !== ""
        ? { for: obj.praise.for, text: obj.praise.text }
        : null,
  };
}

/**
 * The gate that turns reported corrections into believed ones — the same bargain as
 * `verifyRepair` (repair.ts): the model may say what was wrong with the learner's
 * words, but it may never correct words the learner did not just write. `parseTurn`
 * only checks shape; it cannot see the message. A correction whose `original` is not
 * literally in this turn's message — after case, punctuation and whitespace folding —
 * is a re-correction of an earlier turn, and is dropped. Repeats within one turn are
 * dropped too: one mistake is one correction.
 */
export function verifyCorrections(reported: Correction[], msg: string, locale: string): Correction[] {
  // The same folding as `repairNorm` (repair.ts) and `norm` (questions.ts).
  const fold = (s: string) => s.toLocaleLowerCase(locale).replace(/\p{P}/gu, "").replace(/\s+/g, " ").trim();
  const said = fold(msg);
  const seen = new Set<string>();
  const kept: Correction[] = [];
  for (const c of reported) {
    const original = fold(c.original);
    if (!original || !said.includes(original)) continue; // never written this turn → not a correction of it
    const key = `${original}→${fold(c.fixed)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(c);
  }
  return kept;
}

// ---- the rewind (PLAN-030) ----------------------------------------------------

/**
 * The "own" step's prompt: one short line from the coach, taking the blame for
 * pace. It must not attribute the failure to the learner in any language — the
 * produced line is gated on our side by `bannedShape` (rewind.ts), and a line
 * that matches is replaced by the pack's fixed fallback rather than shown.
 */
export function rewindOwnPrompt(s: Settings, pack?: LanguagePack): string {
  return [
    `You spoke too fast. Own it, in one short line, in ${s.profile.targetLanguage}, in the coach's voice.`,
    `Take the blame for the pace yourself — say you went too fast, or that you will say it again more slowly.`,
    `Never say or imply that the learner did not understand, missed anything, or got anything wrong.`,
    `Do not ask a question and do not add anything else.`,
    packGuidance(pack),
    styleGuidance(s.coachStyle),
    `Answer with ONLY a JSON object: { "line": "your one short line in ${s.profile.targetLanguage}" }.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The "own" line, or "" when the model gave nothing usable. */
export function parseOwnLine(raw: string): string {
  const obj = extractJson(raw);
  const line = typeof obj?.line === "string" ? obj.line.trim() : "";
  return line;
}

/**
 * The "unpack" step's prompt: break the coach's previous line into parts, isolate
 * the one word carrying the meaning, and give that word in the learner's native
 * language. Reached only after a second miss — the same sentence was already
 * repeated slower, so now the meaning is handed over.
 */
export function rewindUnpackPrompt(s: Settings, line: string, keyWord: string, pack?: LanguagePack): string {
  return [
    `The learner still did not follow. Break your last line into parts and give the one word that carried the meaning.`,
    `Your last line was: "${line}"`,
    keyWord ? `The word that carried the meaning is "${keyWord}".` : `Name the one word in that line that carried the meaning.`,
    `Do not say the learner did not understand. Do not correct them.`,
    packGuidance(pack),
    styleGuidance(s.coachStyle),
    `Answer with ONLY a JSON object: { "parts": ["a short chunk of the line", "another"], "keyWord": "the one word", "gloss": "that word's meaning in ${s.profile.nativeLanguage}" }.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The unpack result: the line broken up, the key word, and its native gloss. */
export interface UnpackResult {
  parts: string[];
  keyWord: string;
  gloss: string;
}

/** Parse the unpack step's JSON. Empty parts and an empty gloss are dropped. */
export function parseUnpack(raw: string): UnpackResult {
  const obj = extractJson(raw);
  const parts = Array.isArray(obj?.parts) ? obj.parts.map((x: any) => String(x)).filter(Boolean) : [];
  return {
    parts,
    keyWord: typeof obj?.keyWord === "string" ? obj.keyWord : "",
    gloss: typeof obj?.gloss === "string" ? obj.gloss : "",
  };
}

/** Prompt to pull useful vocabulary out of a finished/ongoing conversation. */
export function vocabPrompt(s: Settings, pack?: LanguagePack): string {
  return [
    `From the conversation so far, pick at most 5 ${s.profile.targetLanguage} words or short phrases that a ${levelOf(s.profile)} learner should study.`,
    packGuidance(pack),
    `Answer with ONLY a JSON object: { "items": [ { "term": "the ${s.profile.targetLanguage} word/phrase in its dictionary form", "translation": "its meaning in ${s.profile.nativeLanguage}", "example": "a short example sentence in ${s.profile.targetLanguage} that uses the term", "type": "word | phrase | phrasalVerb | idiom | collocation | pronunciation", "level": "the CEFR band of the item itself: A1, A2, B1, B2, C1 or C2" } ] }.`,
    `"level" is the difficulty of the item, not of the learner. Judge it honestly — a word far below their level will be left out rather than studied.`,
    `Prefer words that actually appeared in the conversation. Skip trivial words (the, a, is).`,
    // Fewer, better cards. The deck used to take eight a session and fill with things
    // the learner already used correctly, or with details of what was said rather
    // than with language — and a deck like that stops being worth opening.
    `Pick fewer than 5 — or none at all — rather than padding the list. Skip anything the learner already used correctly.`,
    `Never pick a proper name, a number, a time, a date, or a price: those are details of the conversation, not vocabulary.`,
    `Every "translation" must be a real meaning in ${s.profile.nativeLanguage}. Never leave it empty and never repeat the term back.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The candidates a conversation offers. Held to the same gate the deck is, here
 * rather than at the write, so the wrap-up shows the learner exactly the cards that
 * would be kept — never a chip that would silently fail to save.
 */
const VOCAB_TYPES = ["word", "phrase", "phrasalVerb", "idiom", "collocation", "pronunciation"];
const BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function parseVocab(raw: string): {
  term: string;
  translation: string;
  example: string;
  type: string;
  levelBand: string | null;
}[] {
  const obj = extractJson(raw);
  if (!Array.isArray(obj?.items)) return [];
  return obj.items
    .filter((v: any) => v && v.term)
    .map((v: any) => ({
      term: String(v.term).trim(),
      translation: String(v.translation ?? "").trim(),
      example: String(v.example ?? "").trim(),
      type: VOCAB_TYPES.includes(String(v.type)) ? String(v.type) : "word",
      levelBand: BANDS.includes(String(v.level)) ? String(v.level) : null,
    }))
    .filter((v: { term: string; translation: string; example: string }) => worthLearning(v).ok)
    .slice(0, MAX_VOCAB_PER_SESSION);
}

/** Prompt for an end-of-session summary. */
export function summaryPrompt(s: Settings, pack?: LanguagePack): string {
  return [
    `Summarise this ${s.profile.targetLanguage} practice session for the learner.`,
    packGuidance(pack),
    styleGuidance(s.coachStyle),
    `Answer with ONLY a JSON object: { "summary": "2-3 sentences on what was practised, written in ${s.profile.nativeLanguage}", "strengths": ["short point", ...], "focus": ["short thing to work on next", ...] }.`,
    `Base "strengths" and "focus" on the learner's actual messages. Keep each point under 12 words.`,
    // One voice, across all history (PLAN-020 §2.2): the summary is a constraint,
    // not a suggestion. Second person singular, past tense, one paragraph, no
    // praise that is not tied to something in the transcript, never the learner's
    // name. Old and new records must read alike.
    `Write the "summary" in the second person singular ("you"), in the past tense, as one paragraph.`,
    `Praise only what the transcript actually shows — never a general compliment, and never the learner's name.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface SessionSummary {
  summary: string;
  strengths: string[];
  focus: string[];
}

/**
 * `null` when the model did not return a usable summary. There is no fallback text.
 *
 * A failed summary writes nothing: the whole raw model reply must never become the
 * summary (invariant 22). Returns `null` unless `obj.summary` is a string of ≥ 20
 * characters that is not itself JSON-looking (no leading `{` or `[`).
 */
export function parseSummary(raw: string): SessionSummary | null {
  const obj = extractJson(raw);
  const s = typeof obj?.summary === "string" ? obj.summary.trim() : "";
  if (s.length < 20) return null;
  if (s.startsWith("{") || s.startsWith("[")) return null;
  return {
    summary: s,
    strengths: Array.isArray(obj.strengths) ? obj.strengths.map(String) : [],
    focus: Array.isArray(obj.focus) ? obj.focus.map(String) : [],
  };
}

/**
 * Prompt for the short name a conversation carries in the history list.
 *
 * Called twice: "opening" right after the first exchange, so the entry has a name
 * the moment it appears, and "settled" once the subject has actually emerged. The
 * second call is told it is replacing a guess — otherwise a model handed a title
 * it already wrote tends to just hand it back.
 */
export function titlePrompt(s: Settings, stage: "opening" | "settled" = "opening"): string {
  return [
    stage === "opening"
      ? `Name this conversation, going on what it opened with.`
      : `The conversation has found its subject. Re-name it for what it actually turned out to be about — do not keep the earlier guess unless it still fits.`,
    `Answer with ONLY a JSON object: { "title": "the name, written in ${s.profile.nativeLanguage}" }.`,
    `The title is a label in a list, not a sentence: 2-5 words, no final punctuation, no quotes.`,
    `Name the subject, not the exercise — "Cooking and eating out", "Booking a late check-in". Never "${s.profile.targetLanguage} practice" or the scenario's name.`,
  ].join("\n");
}

/** The title, or "" if the model gave us nothing usable — the old title then stands. */
export function parseTitle(raw: string): string {
  // Models like to quote the label, and to end it with a full stop.
  const clean = (s: string) =>
    s.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”.]+$/g, "").trim();

  const obj = extractJson(raw);
  if (typeof obj?.title === "string") return clean(obj.title).slice(0, 60).trim();

  // No JSON came back. A bare one-liner is still a usable title; a paragraph of
  // prose is a failed call, and a failed call leaves the standing title alone.
  const bare = clean(raw ?? "");
  return !bare || bare.length > 60 ? "" : bare;
}

// ---- long-term memory: what the coach knows about the learner ----
//
// Not the vocabulary deck — that is the "Memory" space in the nav, and it keeps
// the name. This is the learner themselves: who they are, what they do, what they
// are learning the language for. Written at the end of a session, read back at the
// start of the next one, and on show in Settings → About me, where the learner
// can strike out anything that is wrong or none of the machine's business.

/**
 * One durable fact, in the learner's own language, with the day it was learned.
 * The date is part of the record: it is what lets the coach say "you mentioned a
 * few weeks ago…", and what lets a fact that has gone stale be spotted.
 *
 * `kind` is the classification made once at write time (PLAN-033): `"state"` is a
 * closed attribute ("has two cats"), `"event"` is something that can be asked
 * about again ("interviewing next week"). `null` means unclassified — every fact
 * recorded before this plan — and an unclassified fact is **not** an opening.
 *
 * `asked_at` is stamped when a session opens with this fact as its one detail, so
 * the same question is never asked twice.
 */
export interface Memory {
  id: number;
  fact: string;
  created_at: number;
  kind: "state" | "event" | null;
  asked_at: number | null;
}

/**
 * How old a fact may be and still open a session. Older than this is an archive,
 * not an opening — a coach that opens on something from two months ago is
 * performing recall, which is exactly what the stance forbids.
 */
export const OPENING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The one detail a session may open with, or `null` when there is none.
 *
 * Four rules, in order: recent (not older than 30 days), open-ended (`kind ===
 * "event"`), unasked (`asked_at` is null), and told not derived (it takes
 * `Memory[]` and nothing else, so no statistic can reach it). Returns `null`
 * freely — a learner with only stale, stative, already-asked or unclassified
 * facts gets an opening with no personal detail, which is fine. It is one detail
 * **at most**, never a requirement, and never the least-bad candidate.
 */
export function openingDetail(memories: Memory[], now: number): Memory | null {
  for (const m of memories) {
    if (now - m.created_at > OPENING_MAX_AGE_MS) continue; // stale — an archive, not an opening
    if (m.kind !== "event") continue; // stative or unclassified — not open-ended
    if (m.asked_at !== null) continue; // already asked once
    return m;
  }
  return null;
}

/**
 * The paragraph that pins the coach's voice to a style (PLAN-033 §6.4). Appended
 * to the prompts the learner hears the coach through — Talk, the weekly report,
 * the Read notes. `direct` means fewer softeners, not harder content; difficulty
 * is owned by PLAN-031 and nothing here touches it.
 */
export function styleGuidance(style: CoachStyle): string {
  switch (style) {
    case "direct":
      return `Speak directly: fewer softeners, no padding, no "maybe you could". Say what you mean plainly.`;
    case "neutral":
      return `Keep a steady, plain tone: neither effusive nor clipped. Say what you mean without flourish.`;
    case "warm":
    default:
      return `Keep a warm, encouraging tone: friendly, supportive, and unhurried.`;
  }
}

/**
 * The prompts the learner hears the coach through — really, the ones that carry
 * the **coach's style**. Every `export function …Prompt(` in `src/lib`, plus
 * `buildSystem`, appears in exactly one of this list or `STRUCTURED_PROMPTS`;
 * `prompts.check.ts` asserts the completeness.
 *
 * `rehearsalSystem` (PLAN-034) is the one prompt that is spoken by the coach's
 * voice but must **not** carry `styleGuidance`: in role there is no coach — the
 * register is the brief's — so it lives in the other list, with the reason
 * written beside its entry.
 *
 * Each entry is a `file:name` key, so two prompts that share a name in different
 * files (e.g. `listening.ts:outlinePrompt` and `reading.ts:outlinePrompt`) are
 * distinct rows and are classified independently.
 */
export const SPOKEN_PROMPTS = [
  "prompts.ts:buildSystem",
  "prompts.ts:rewindOwnPrompt",
  "prompts.ts:rewindUnpackPrompt",
  "prompts.ts:summaryPrompt",
  "coach.ts:weeklyReportPrompt",
  "coach.ts:drillPrompt",
  "learn.ts:recapPrompt",
  "reading.ts:notesPrompt",
  "reading.ts:explainWordPrompt",
  // PLAN-034: the debrief is the coach, out of role, talking to the learner —
  // the coach's voice applies here, and nowhere in the role.
  "rehearsal.ts:debriefPrompt",
  // PLAN-035: the brought discussion is the coach reading the learner's own
  // text with them — the coach is the coach, so the style applies. The opposite
  // call from `rehearsalSystem`, for the opposite reason.
  "brought.ts:discussionSystem",
] as const;

/**
 * The prompts that extract structured data or speak **without the coach's
 * voice** — a JSON schema has no voice to be consistent in, and a tone paragraph
 * there is noise the learner never reads. Must **not** carry `styleGuidance`.
 */
export const STRUCTURED_PROMPTS = [
  "prompts.ts:vocabPrompt",
  "prompts.ts:titlePrompt",
  "prompts.ts:memoryPrompt",
  "placement.ts:placementPrompt",
  "listening.ts:outlinePrompt",
  "listening.ts:chapterPrompt",
  "reading.ts:outlinePrompt",
  "reading.ts:storyPrompt",
  "reading.ts:continueReadingPrompt",
  "reading.ts:draftPrompt",
  "reading.ts:rewritePrompt",
  "reading.ts:comprehensionPrompt",
  // PLAN-034: in role there is no coach — the register is the brief's formality
  // and the other party's own voice. Spoken, but deliberately not styled.
  "rehearsal.ts:rehearsalSystem",
] as const;

/** The date as the record carries it, and as Settings shows it: "14 Jul 2026". */
export const memoryDate = (ts: number): string =>
  new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * At most this many facts out of any one conversation. A session that yields ten
 * durable facts has stopped telling durable facts from small talk, and the cap is
 * cheaper than trusting the model not to.
 */
const MEMORY_PER_SESSION = 6;

/**
 * The memory as every prompt sees it — the knowledge only. What to *do* with it
 * differs by caller (the coach converses, the reader picks topics, the report
 * refers back), so each one adds its own instruction after this block.
 *
 * An empty list gives an empty string: a first-time learner's prompt should not
 * carry a "you know nothing about them" preamble.
 */
export function memoryBrief(memories: Memory[]): string {
  if (!memories.length) return "";
  return [
    `What you know about the learner, from earlier sessions:`,
    ...memories.map((m) => `- ${m.fact} · ${memoryDate(m.created_at)}`),
  ].join("\n");
}

/**
 * The caveat that travels with the facts, wherever they are read.
 *
 * A model handed a list of facts reads it as a list of things to bring in, and
 * then every opening line asks after the superhero and every passage is set in
 * Metropolis. The memory is there so the coach is not surprised by the learner's
 * own world when it comes up — not so it has something to talk about. Sessions
 * where none of it surfaces are the normal case, not a failure to personalise.
 */
export const memoryStance = [
  `Those facts are background you happen to know, not material to work in and not a checklist.`,
  `Do not steer towards them, do not open on them, and do not reach for one to show that you remembered.`,
  `Most of what you write should not touch them at all; lean on a fact only where the learner's own words or the task in front of you have already led there.`,
].join(" ");

/** Prompt to pull durable facts about the learner out of a finished conversation. */
export function memoryPrompt(s: Settings, known: Memory[]): string {
  return [
    `You keep the long-term memory of this learner — the handful of things a good tutor would still know about them in a month.`,
    known.length
      ? [`Already recorded:`, ...known.map((m) => `${m.id}. ${m.fact}`)].join("\n")
      : `Nothing is recorded yet.`,
    ``,
    `From this conversation, record only what is durable: who they are, what they do, why they are learning ${s.profile.targetLanguage}, the people and places that recur in their life, what they have said they like and dislike.`,
    `Not what happened today, not what they practised, not how well they did — that is measured elsewhere.`,
    ``,
    `Answer with ONLY a JSON object: { "facts": [ { "fact": "one short fact, written in ${s.profile.nativeLanguage}", "replaces": null, "kind": "state | event" } ] }.`,
    `Rules:`,
    `- Never say the same thing twice. If a fact is already recorded above, leave it out entirely.`,
    `- If this conversation changed a recorded fact — they moved city, changed job, took up something new — write the fact as it now stands and set "replaces" to that fact's number. The old one is dropped, not kept beside it.`,
    `- "replaces" is null for anything genuinely new.`,
    `- A fact is a short third-person phrase, under 12 words: "Works as a backend developer", "Cooks most evenings, eats out at weekends".`,
    `- "kind" is "event" when the fact is something that can be asked about again — an upcoming interview, a move, a trip, a new job. It is "state" when it is a closed attribute — a job title, a pet, a preference.`,
    `- Record nothing you are not sure of. { "facts": [] } is the right answer for a conversation that revealed nothing durable.`,
  ].join("\n");
}

/** A fact on its way into the record, and the fact it supersedes — if it supersedes one. */
export interface MemoryWrite {
  fact: string;
  /** The id of the recorded fact this one replaces, or null when it is new. */
  replaces: number | null;
  /**
   * The classification made once at write time (PLAN-033): `"event"` is
   * open-ended, `"state"` is a closed attribute. Anything else — a missing or
   * unrecognised value — parses to `null`, and a `null` kind is never an opening.
   */
  kind: "state" | "event" | null;
}

export function parseMemory(raw: string): MemoryWrite[] {
  const obj = extractJson(raw);
  if (!Array.isArray(obj?.facts)) return [];
  return obj.facts
    .filter((f: any) => f && typeof f.fact === "string" && f.fact.trim())
    .map((f: any) => {
      // Models hand back "3" as often as 3, and null / undefined / "" as often as
      // neither. Anything that is not a positive whole number means "this is new".
      const r = Number(f.replaces);
      // `kind` is gated to the two values; anything else becomes null — an
      // unclassified fact has not been shown to be open-ended, and a coach that
      // opens on "has two cats" is the failure §6.3 describes.
      const k = f.kind;
      return {
        fact: String(f.fact).replace(/\s+/g, " ").trim().slice(0, 120),
        replaces: Number.isInteger(r) && r > 0 ? r : null,
        kind: k === "event" || k === "state" ? k : null,
      };
    });
}

/** Two facts are one fact when only case, punctuation or spacing separates them. */
const factKey = (fact: string) =>
  fact
    .toLowerCase()
    .replace(/\p{P}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * What actually gets written, given what is already on file. The model is asked to
 * dedupe and supersede itself and mostly does; this is the half that does not
 * depend on it having behaved.
 *
 * - a fact already on file is dropped — told twice is not two bullets
 * - "replaces" is honoured only when it names a fact that exists: a hallucinated
 *   number would otherwise delete a row the learner never contradicted
 * - a "new" fact whose wording is already recorded is dropped whatever it claims
 *   to replace, because the safe read of that confusion is that nothing changed
 */
export function planMemory(known: Memory[], incoming: MemoryWrite[]): MemoryWrite[] {
  const ids = new Set(known.map((m) => m.id));
  const seen = new Set(known.map((m) => factKey(m.fact)));
  const out: MemoryWrite[] = [];

  for (const w of incoming) {
    if (out.length >= MEMORY_PER_SESSION) break;
    const key = factKey(w.fact);
    if (!key || seen.has(key)) continue; // …and `seen` grows as we go, so not twice within one batch either
    out.push({
      fact: w.fact,
      replaces: w.replaces != null && ids.has(w.replaces) ? w.replaces : null,
      // The classification rides through unchanged — it was gated at parse.
      kind: w.kind,
    });
    seen.add(key);
  }
  return out;
}

/** Find the first {...} JSON object in a string and parse it. Returns null on failure. */
function extractJson(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // strip code fences / surrounding prose and try the outermost braces
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

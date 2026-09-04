// Brought content (PLAN-035): the learner's own text, used as material.
//
// The other half of "material from your own life". Read generates its own
// passage, Listen its own chapter; this is the learner's email, article or
// transcript, brought in and talked about. Two rules make it Verba rather than
// a translator:
//
//   - it stays local — the text is processed on the machine by default and
//     stored no further than the machine;
//   - it is conversation material, not a translation job — the coach reads it,
//     talks about it, asks the learner to say what it means in their own words.
//
// Pure by contract, the same contract rehearsal.ts and difficulty.ts hold: no
// provider, no ./db.ts, no React, no settings screen. It takes a text and
// values and returns a validated record, a synthetic scenario and a system
// prompt.
import type { Settings } from "./settings.ts";
import type { Scenario } from "./scenarios.ts";
import type { LanguagePack } from "./packs/schema.ts";
import { levelOf } from "./model.ts";
import { styleGuidance, type SystemDifficulty } from "./prompts.ts";
import { packGuidance } from "./packs/schema.ts";
import { axisGuidance, DIFFICULTY_NO_ANNOUNCE } from "./difficulty.ts";

/** The learner's own text, as the record carries it. */
export interface BroughtText {
  id: number;
  lang: string;
  title: string; // the learner's own, or the first line
  body: string;
  createdAt: number;
  /** The provider the learner approved for this text, or "" — see below. */
  sentTo: string;
}

/**
 * The most characters one brought text may hold. Longer than this and the
 * learner is asked to choose a part — Read already deals in passages, and a
 * 40-page document is not one. The limit is stated before they paste, not after.
 */
export const BROUGHT_MAX_CHARS = 8000;

/** The most characters a derived title may hold — a label in a list, not a sentence. */
const TITLE_MAX_CHARS = 60;

/**
 * The first line of a body, as a title. Never empty, never the whole first
 * paragraph: the first line, capped, with a fallback for a body that opens on
 * nothing.
 */
function firstLine(body: string): string {
  const line = body.split(/\r?\n/, 1)[0].trim();
  const capped = line.slice(0, TITLE_MAX_CHARS).trim();
  return capped || "Untitled";
}

/**
 * Validate a pasted or opened text into a `BroughtText`.
 *
 * The body is preserved byte for byte — newlines, tabs, non-ASCII, all of it.
 * The learner's text is not ours to normalise. The title is derived from the
 * first line when the learner gives none, and never comes out empty.
 *
 * Throws when the text is over `BROUGHT_MAX_CHARS`, with a message naming the
 * limit so the learner is asked to choose a part rather than told "no".
 */
export function ingest(raw: string, lang: string, title = ""): BroughtText {
  if (raw.length > BROUGHT_MAX_CHARS) {
    throw new Error(
      `That text is ${raw.length} characters — the limit is ${BROUGHT_MAX_CHARS}. Choose a part of it.`,
    );
  }
  return {
    id: 0, // assigned by the store on save
    lang,
    title: title.trim() || firstLine(raw),
    body: raw,
    createdAt: Date.now(),
    sentTo: "",
  };
}

/**
 * The synthetic scenario a brought discussion runs in. It is never saved to the
 * catalogue and carries no `formatVersion` — that field marks a stored,
 * importable scenario, and this is neither. `id: "brought"` is fixed.
 *
 * The title rides the scenario (it is the label the session shows); the body
 * does not — it rides the system prompt once, not twice, and a scenario is
 * written to no store here.
 */
export function broughtScenario(text: BroughtText): Scenario {
  return {
    id: "brought",
    title: `Brought — ${text.title}`,
    emoji: "📄",
    setup: `The learner has brought their own text to read with you, titled "${text.title}". Read it with them and talk about it.`,
    persona: { name: "Marta", role: "your coach, reading this with you", emoji: "🧑‍🏫" },
  };
}

/**
 * The system prompt for a brought discussion. The coach has read the text, and:
 *
 *   - asks before it explains — the opening move is a question about the text,
 *     not a summary of it;
 *   - asks for the learner's own words — "tell me what this part is asking for"
 *     is the shape of the session;
 *   - translates a word when asked, not a paragraph — a request for the whole
 *     thing in the native language gets one honest sentence of gist and a
 *     question back;
 *   - stays in the target language except for single-word glosses.
 *
 * The body rides here once, in full. It carries `styleGuidance` — unlike
 * `rehearsalSystem` — because here the coach is the coach, reading the
 * learner's email with them.
 */
export function discussionSystem(
  s: Settings,
  text: BroughtText,
  scenario: Scenario,
  pack?: LanguagePack,
  difficulty: SystemDifficulty = { axis: null, step: 0 },
  corrections: string[] = [],
): string {
  return [
    `You are Verba, a warm and encouraging ${s.profile.targetLanguage} conversation tutor.`,
    `For this session you are ${scenario.persona.name}, ${scenario.persona.role}. This persona is fixed for the whole session — stay in it throughout.`,
    styleGuidance(s.coachStyle),
    `The learner's native language is ${s.profile.nativeLanguage}. Their self-reported level is ${levelOf(s.profile)}.`,
    `The learner has brought their own text to read with you. Its title is "${text.title}". Here it is, in full:`,
    ``,
    text.body,
    ``,
    `This is the learner's own material — an email, an article, a transcript. It is conversation material, not a translation job.`,
    `Ask before you explain: your opening move is a question about the text, never a summary of it.`,
    `Ask for the learner's own words: "tell me what this part is asking for" is the shape of the session.`,
    `Translate a word when asked, never a paragraph: a request for the whole thing in ${s.profile.nativeLanguage} gets one honest sentence of gist and a question back.`,
    `Stay in ${s.profile.targetLanguage} except for single-word glosses.`,
    packGuidance(pack),
    ``,
    `Hold a natural conversation in ${s.profile.targetLanguage}. Match your vocabulary and sentence length to a ${levelOf(s.profile)} learner. Always keep the conversation going by ending your reply with a question or prompt.`,
    ``,
    // PLAN-031: when a session has a difficulty axis, the model is told how to
    // apply it and, beside it, that it must never announce the difficulty — the
    // same two lines `buildSystem` carries. The axis governs the coach's own
    // replies, not the text, and the learner's difficult email is not made easier
    // by the coach also being careful.
    difficulty.axis ? axisGuidance(difficulty.axis, difficulty.step) : "",
    difficulty.axis ? DIFFICULTY_NO_ANNOUNCE : "",
    // PLAN-032: the praise rule, in the same register as `buildSystem`'s. Praise
    // without a cited record is a fabrication, and the record it may cite is the
    // list of things this learner has been corrected on before. The praise
    // sentence goes in "praise"."text", never in "reply".
    `Do not praise the learner's language. Do not write "great", "well done", "excellent", "perfect", "nice job", or any equivalent. When the learner produces a correct sentence, the correct response is to answer what they said and keep the conversation moving. Praise is allowed **only** when you can point at something specific in the record below that they used to get wrong and just got right, and you must say what that thing was. When you do praise, put the praise sentence in "praise"."text" — never inside "reply". "reply" must read naturally and completely without the praise, because the praise may be dropped.`,
    corrections.length
      ? `Things this learner has been corrected on before (the record you may cite): ${corrections.join("; ")}.`
      : `This learner has no correction record yet — so there is nothing to cite, and no praise is allowed.`,
    `You MUST answer with ONLY a valid JSON object, no prose outside it, in this exact shape:`,
    `{`,
    `  "reply": "your natural conversational reply in ${s.profile.targetLanguage} (1-3 sentences)",`,
    `  "corrections": [ { "original": "the learner's exact wording that was wrong", "fixed": "the corrected version", "note": "a short explanation written in ${s.profile.nativeLanguage}", "severity": "minor or severe", "category": "grammar | vocabulary | wordOrder | register | pronunciation" } ],`,
    `  "suggestions": [ "a short example reply the learner could send next, in ${s.profile.targetLanguage}", "another option" ],`,
    `  "goalsMet": [],`,
    `  "repair": { "category": "HOLD | REPEAT | SLOW | CLARIFY | CONFIRM | PARAPHRASE", "variant": "the learner's exact words" },`,
    `  "missed": ["keyWordMissing", "topicChange"],`,
    `  "keyWord": "the one word in YOUR OWN last line that carried the meaning",`,
    `  "praise": { "for": "the exact record referred to", "text": "the praise sentence, in ${s.profile.targetLanguage}" },`,
    `  "ease": false`,
    `}`,
    ``,
    `Rules:`,
    `- Do NOT correct the learner inside "reply". Put every correction only in the "corrections" array.`,
    `- Only add a correction for a real grammar, word-choice, or spelling mistake in the learner's own replies — never grade the text they brought; it is theirs, not yours to mark.`,
    `- "severity" is "severe" when the mistake breaks meaning or grammar rules, "minor" when it is understandable but unnatural.`,
    `- "category" is which kind of mistake it is: grammar, vocabulary, wordOrder, register, or pronunciation. Pick the one that fits best.`,
    `- Give 2-3 "suggestions". Keep them natural and at the learner's level.`,
    `- "goalsMet" is always [] — a brought discussion has no goals sheet.`,
    `- "repair" is filled ONLY when the learner's last message actually performed one of the six repair moves (HOLD, REPEAT, SLOW, CLARIFY, CONFIRM, PARAPHRASE). Set "variant" to the learner's own wording, copied verbatim, never rephrased. Omit the field otherwise — that is the normal answer.`,
    `- "missed" lists which of these were observably true of the learner's LAST message: disconnected (did not answer what was asked), overGeneral ("yes", "maybe", "sure" and nothing else), apologyThenOn (said "sorry"/"pardon" and carried on regardless), keyWordMissing (the key word in YOUR last line appears nowhere in the reply), topicChange (the reply starts a different subject). An empty list is the normal answer.`,
    `- "keyWord" is the one word in your OWN last line that carried the meaning — the word "keyWordMissing" is verified against.`,
    `- "ease" is true when in ANY wording the learner asked for an easier session. It is false (the normal answer) otherwise.`,
    `- Never mention that you are returning JSON.`,
  ]
    .filter(Boolean)
    .join("\n");
}

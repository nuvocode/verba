// Rehearsal (PLAN-034): the coach plays the other side, then steps out.
//
// Two rules hold the mode together, and both are about *not* being a lesson:
//   - the difficulty axes are off (manufacturing a breakdown in a dress
//     rehearsal for practice is sabotage), and
//   - role-play and feedback are separated — the coach is the other party in
//     role, without teaching, and then stops, steps out, and talks about it.
//
// Pure by contract, the same contract difficulty.ts and patience.ts hold: no
// provider, no ./db.ts, no React, no settings screen. It takes a brief and
// values and returns a scenario, a system prompt, a parsed turn, a debrief
// prompt and a parsed debrief.
import type { Settings } from "./settings.ts";
import type { Scenario } from "./scenarios.ts";
import type { LanguagePack } from "./packs/schema.ts";
import { styleGuidance } from "./prompts.ts";

/**
 * The brief: three short questions, one screen. Free text, no list of scenarios
 * to pick from — the whole premise is that the conversation the learner needs is
 * not in our catalogue. All three fields are required text; `formality` is the
 * register the other party speaks in (not the coach's `coachStyle`, which is how
 * the *coach* talks to the learner and is silent in role).
 */
export interface RehearsalBrief {
  who: string; // "my landlord", "a customer at work"
  about: string; // "the boiler that has not been fixed"
  formality: "casual" | "neutral" | "formal";
}

/** The one word each formality value is pinned by in the system prompt. */
const FORMALITY_WORD = {
  casual: "casually",
  neutral: "neutrally",
  formal: "formally",
} as const;

/**
 * The synthetic scenario a rehearsal runs in. It is never saved to the catalogue
 * and carries no `formatVersion` — that field marks a stored, importable
 * scenario, and this is neither. `id: "rehearsal"` is fixed: Talk matches the
 * day's blocks on it, and a rehearsal closes none of them.
 */
export function rehearsalScenario(brief: RehearsalBrief): Scenario {
  const who = brief.who.trim() || "someone you know";
  const about = brief.about.trim() || "something you need to sort out";
  return {
    id: "rehearsal",
    title: `Rehearsal — ${who}`,
    emoji: "🎭",
    setup: `You are ${who}, in your own life, and the learner has to talk to you about ${about}. You are not a tutor and not a helper: you are this person, having the real conversation — you may be busy, brisk or unhelpful the way a real person is, but you are never testing them and you never ask trick questions. Speak ${FORMALITY_WORD[brief.formality]}, the way ${who} would.`,
    persona: { name: who, role: `the person you are rehearsing with`, emoji: "🎭" },
  };
}

/**
 * The in-role JSON turn. Teaching is dropped, observation is kept: PLAN-028's
 * breakdown detection and PLAN-027's repair inventory run on `missed`,
 * `keyWord` and `repair` — those three are Verba watching, and the debrief is
 * later made of them. What is dropped is everything the coach says *to* the
 * learner: `corrections`, `suggestions`, `goalsMet`, `praise` and `ease`.
 */
export interface RoleTurn {
  reply: string;
  /** The reported repair move, shape-checked only — `verifyRepair` believes it. */
  repair: { category: string; variant: string } | null;
  /** The reported breakdown signals, narrowed to the five meaning judgements. */
  missed: string[];
  /** The one word in the coach's last line that carried the meaning. */
  keyWord: string;
}

/**
 * The in-role system prompt. Emphatically not the tutor prompt:
 *   - the coach **is** the other party, and stays in role;
 *   - no corrections, no suggestions, no goals, no praise;
 *   - difficulty guidance is absent from the prompt entirely (not set low —
 *     absent) and the caller holds `axis === null` in rehearsal mode;
 *   - the other party is realistic — they may be brisk or unhelpful, but they
 *     are never a test.
 *
 * Deliberately without `styleGuidance`: in role there is no coach, and the
 * register comes from `brief.formality` and who the other party is. The
 * persona is read from the scenario `rehearsalScenario` built, the same way
 * every other session reads its persona.
 */
export function rehearsalSystem(
  s: Settings,
  brief: RehearsalBrief,
  scenario: Scenario,
  _pack?: LanguagePack,
): string {
  const who = brief.who.trim() || "someone you know";
  const about = brief.about.trim() || "something you need to sort out";
  return [
    `For this session you are ${who} — ${scenario.persona.role}. You are not a tutor and never a helper. You are a real person: busy, with your own concerns, and you do not exist to teach ${s.profile.targetLanguage}.`,
    `The learner needs to rehearse this conversation before they have it for real: ${about}. Hold the conversation they would actually walk into.`,
    `Stay in role from your first word to your last. Never step out of it, never comment on the learner's language, never teach, never offer to help, and never say anything a real ${who} would not say.`,
    `You may be brisk or unhelpful — real people are — but you are never a test: no trick questions, no deliberate obscurity, nothing set up to catch the learner out.`,
    `Keep the conversation going in ${s.profile.targetLanguage} by being the person you are: ask what you would actually ask, react as you would actually react, and end your reply the way a real person would.`,
    `Speak ${FORMALITY_WORD[brief.formality]} — the register is this conversation's, and nothing about it is graded.`,
    ``,
    `You MUST answer with ONLY a valid JSON object, no prose outside it, in this exact shape:`,
    `{`,
    `  "reply": "what you say, in ${s.profile.targetLanguage} (1-3 sentences)",`,
    `  "repair": { "category": "HOLD | REPEAT | SLOW | CLARIFY | CONFIRM | PARAPHRASE", "variant": "the learner's exact words" },`,
    `  "missed": ["keyWordMissing", "topicChange"],`,
    `  "keyWord": "the one word in YOUR OWN last line that carried the meaning"`,
    `}`,
    ``,
    `Rules:`,
    `- NEVER put a correction, a suggestion, a grammar note or an explanation of any kind in "reply". You are not teaching; you are being the other person.`,
    `- "repair" is filled ONLY when the learner's last message actually performed one of the six repair moves (HOLD, REPEAT, SLOW, CLARIFY, CONFIRM, PARAPHRASE). Set "variant" to the learner's own wording, copied verbatim, never rephrased. Omit the field otherwise — that is the normal answer.`,
    `- "missed" lists which of these were observably true of the learner's LAST message: disconnected (did not answer what was asked), overGeneral ("yes", "maybe", "sure" and nothing else), apologyThenOn (said "sorry"/"pardon" and carried on regardless), keyWordMissing (the key word in YOUR last line appears nowhere in the reply), topicChange (the reply starts a different subject). An empty list is the normal answer.`,
    `- "keyWord" is the one word in your OWN last line that carried the meaning — the word "keyWordMissing" is verified against.`,
    `- Never mention that you are returning JSON.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The five meaning judgements `missed` may carry — the same set breakdown.ts owns. */
const MEANING_SIGNALS = ["disconnected", "overGeneral", "apologyThenOn", "keyWordMissing", "topicChange"];

/** The in-role parser. A model that sends the teaching fields anyway has them ignored, not shown. */
export function parseRole(raw: string): RoleTurn {
  let obj: any = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        obj = JSON.parse(raw.slice(start, end + 1));
      } catch {
        obj = null;
      }
    }
  }
  // A small model under a JSON grammar can nest the real answer inside "reply".
  if (typeof obj?.reply === "string" && obj.reply.includes('"reply"')) {
    try {
      const inner = JSON.parse((obj.reply.match(/\{[\s\S]*\}/) ?? [])[0] ?? "");
      if (inner && typeof inner.reply === "string") obj = inner;
    } catch {
      /* the outer reply stands */
    }
  }
  const missed: string[] = [];
  if (Array.isArray(obj?.missed)) {
    for (const x of obj.missed) {
      const label = String(x);
      if (!MEANING_SIGNALS.includes(label)) continue;
      if (missed.includes(label)) continue; // one observation is one signal
      missed.push(label);
    }
  }
  return {
    reply: typeof obj?.reply === "string" ? obj.reply : raw.trim(),
    repair:
      obj?.repair &&
      typeof obj.repair === "object" &&
      typeof obj.repair.category === "string" &&
      typeof obj.repair.variant === "string" &&
      obj.repair.variant.trim() !== ""
        ? { category: obj.repair.category, variant: obj.repair.variant }
        : null,
    missed,
    keyWord: typeof obj?.keyWord === "string" ? obj.keyWord : "",
  };
}

/**
 * The debrief prompt. The coach steps out ("okay, out of role") and talks about
 * what happened — **this** prompt carries `styleGuidance`, because out of role
 * the coach is the coach again.
 *
 * `turns` is the transcript the debrief must point at: every `stuck` entry names
 * a turn index into it, and a report that cannot point at the record is dropped
 * at parse (the same rule PLAN-032 applies to praise and PLAN-027 to a claimed
 * repair). The transcript is handed over as plain text, one numbered line per
 * learner turn, so the model's indices mean something.
 */
export function debriefPrompt(
  s: Settings,
  brief: RehearsalBrief,
  transcript: string[],
  _pack?: LanguagePack,
): string {
  const about = brief.about.trim() || "something you need to sort out";
  const who = brief.who.trim() || "someone you know";
  return [
    `The role-play is over. You were ${who} and the learner was rehearsing ${about} in ${s.profile.targetLanguage}; now step out of the role and talk to them as their coach.`,
    styleGuidance(s.coachStyle),
    `The learner's turns, numbered:`,
    transcript.map((t, i) => `${i}. ${t}`).join("\n") || "(the learner never spoke)",
    ``,
    `Answer with ONLY a JSON object, in this exact shape:`,
    `{`,
    `  "stuck": [ { "turn": 0, "moment": "where in that turn they ran aground, in ${s.profile.nativeLanguage}", "why": "what made it hard, in ${s.profile.nativeLanguage}" } ],`,
    `  "phrases": [ "phrase in ${s.profile.targetLanguage}", "another", "another", "another", "a fifth" ]`,
    `}`,
    ``,
    `Rules:`,
    `- "stuck" names the turns where they actually ran aground — a long silence, a very short answer, a turn that changed the subject or gave up. Only name turns that exist in the numbered list above; "turn" is the number itself.`,
    `- Two or three "stuck" entries is plenty. An empty list is the right answer for a rehearsal that went smoothly.`,
    `- "phrases" is exactly five phrases in ${s.profile.targetLanguage} that would have helped *in that conversation* — words for the actual subject of the rehearsal, not five generic phrases about the topic. Each is short enough to say in one breath.`,
    `- Give fewer than five rather than padding. Never a proper name, a number, a time, a date, or a price.`,
    `- Never mention that you are returning JSON.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Five is the ceiling, and the same ceiling the deck holds: fewer parse fine. */
export const DEBRIEF_PHRASES_MAX = 5;

/** One "ran aground" moment, pointing at the learner turn it came from. */
export interface StuckMoment {
  turn: number;
  moment: string;
  why: string;
}

export interface Debrief {
  stuck: StuckMoment[];
  phrases: string[];
}

/**
 * The debrief parser. Two rules, both about reports that cannot point at the
 * record:
 *   - a `stuck` entry whose `turn` is not a learner turn in the transcript is
 *     dropped — one just past the end drops exactly like a negative one;
 *   - `phrases` is capped at five; fewer pass through unchanged.
 */
export function parseDebrief(raw: string, turnCount: number): Debrief {
  let obj: any = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        obj = JSON.parse(raw.slice(start, end + 1));
      } catch {
        obj = null;
      }
    }
  }
  const stuck: StuckMoment[] = [];
  if (Array.isArray(obj?.stuck)) {
    for (const e of obj.stuck) {
      const turn = Number(e?.turn);
      const moment = typeof e?.moment === "string" ? e.moment.trim() : "";
      const why = typeof e?.why === "string" ? e.why.trim() : "";
      if (!moment && !why) continue;
      // An index the transcript cannot answer for is not shown — same rule as
      // praise without a receipt and a repair with no variant.
      if (!Number.isInteger(turn) || turn < 0 || turn >= turnCount) continue;
      stuck.push({ turn, moment, why });
    }
  }
  const phrases = Array.isArray(obj?.phrases)
    ? obj.phrases.map((x: any) => String(x).trim()).filter(Boolean).slice(0, DEBRIEF_PHRASES_MAX)
    : [];
  return { stuck, phrases };
}
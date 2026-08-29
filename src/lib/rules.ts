// The rules a settings change has to pass, and the reason every closed control
// owes the learner.
//
// One door: `applyPatch` is the only way Settings is written, so a rule written
// here holds in setup and in Settings alike — there is no second path that can
// disagree with it. Spec: docs/plans/2-verba-ana-ekran-ve-ayarlar-spec.md §3
// (the value model), §5.2 (instant apply, consequence, undo), §6, §7 (the state
// table). Issues #33, #35, #42, #43.
import { defaultSettings, isLocalProvider, type ProviderId, type Settings } from "./settings.ts";
import { isRemoteModel } from "./models.ts";

/**
 * Where a fix lives, as an in-app hash the shell already routes.
 *
 * Every href in this file comes from here: #31 renames these panels to the
 * spec's five sections, and when it does, this object is the whole edit.
 */
export const AT = {
  learning: "#settings/learning",
  speech: "#settings/speech",
  privacy: "#settings/privacy",
  about: "#settings/about",
  advanced: "#settings/advanced",
} as const;

/** A way out. Never a dead end — §7: "Hiçbir durum kullanıcıyı çıkışsız bırakmaz." */
export interface Exit {
  label: string;
  href: string;
}

/** Why a control is closed right now. A disabled control without one is a bug (#42). */
export interface Gate {
  /** One sentence: which setting closed this, in the learner's language. */
  why: string;
  /** The setting that closed it. */
  exit: Exit;
}

/** A change that was not applied, and the ways forward from it (#35, §7). */
export interface Refusal {
  reason: string;
  exits: Exit[];
}

export interface Applied {
  /** What to persist. Identical to the input settings when the change was refused. */
  next: Settings;
  refused?: Refusal;
  /**
   * One sentence under the row, for a change whose reach goes past its own
   * control (§5.2). A narrow change confirms itself by showing its new state —
   * it does not need a sentence, and one on every row would train the learner
   * to stop reading them.
   */
  consequence?: string;
  /** Puts every key this change touched back. Offered alongside a consequence. */
  undo?: Partial<Settings>;
}

/** The provider a machine falls to when the network is taken away. */
const LOCAL_FALLBACK: ProviderId = "ollama";

/** Two language names are the same language if they differ only in case or padding. */
const sameLanguage = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * §3: the native language and the target language can never be equal, by any
 * route. The change does not apply and the learner is asked which one they
 * meant — guessing for them would silently move a language they did not touch.
 */
function languageClash(next: Settings): Refusal | undefined {
  const { targetLanguage, nativeLanguage } = next.profile;
  if (!sameLanguage(targetLanguage, nativeLanguage)) return undefined;
  return {
    reason: `You can't learn the language you already speak. Both are set to ${targetLanguage.trim()} — change one of them.`,
    exits: [
      { label: "Pick another language to learn", href: AT.learning },
      { label: "Pick another native language", href: AT.learning },
    ],
  };
}

/**
 * §7 row 1: the offline lock and a cloud provider can never stand side by side.
 * Which way the contradiction is resolved depends on which half moved:
 *
 * - the lock going on carries the provider with it, and says so (a consequence);
 * - a cloud provider picked while the lock is on is refused, and the lock is
 *   named as what closed it.
 */
function resolveOffline(before: Settings, next: Settings, patch: Partial<Settings>): Refusal | undefined {
  if (!next.offline) return undefined;

  if (patch.offline === true && !before.offline) {
    // The lock is what moved. Take the cloud selections down with it rather than
    // leaving a contradiction on screen for the learner to find later.
    if (!isLocalProvider(next.provider)) next.provider = LOCAL_FALLBACK;
    if (next.ttsTier === "cloud") next.ttsTier = "auto";
    if (next.sttTier === "cloud") next.sttTier = "auto";
    // A model that only *reaches* Ollama locally. Left alone it would keep
    // sending every turn to Ollama's servers under a lock that says nothing
    // leaves this machine — the one contradiction §5.5 will not have on screen.
    // The fallback is a guess and may not be pulled here; a wrong model is a
    // visible problem with a fix one list away, and a broken promise is not.
    if (isRemoteModel(next.ollamaModel)) next.ollamaModel = defaultSettings.ollamaModel;
    return undefined;
  }

  const cloudPick =
    !isLocalProvider(next.provider) ||
    next.ttsTier === "cloud" ||
    next.sttTier === "cloud" ||
    // The list hides these while the lock is on, but the "any other model" field
    // still takes anything typed into it — so the rule, not the list, is what
    // actually closes the door.
    isRemoteModel(next.ollamaModel);
  if (!cloudPick) return undefined;
  return {
    reason: "This one works over the network, and you've asked Verba to stay on this machine.",
    exits: [{ label: "Offline lock", href: AT.privacy }],
  };
}

/** The sentence a wide change writes under its row, or nothing for a narrow one. */
function consequenceOf(before: Settings, after: Settings): string | undefined {
  if (after.profile.targetLanguage !== before.profile.targetLanguage)
    return `Now learning ${after.profile.targetLanguage}. Your words, your streak and what the coach knows about you are kept per language — nothing from ${before.profile.targetLanguage} was deleted.`;
  if (after.profile.level !== before.profile.level)
    // Not "today's plan was rebuilt": the plan is level-independent by
    // construction — lib/learn never reads the level, so rebuilding it would
    // produce the same day back. What the level actually steers is every piece of
    // material generated from here on, and that is what the sentence says.
    return `Level is ${after.profile.level}. Everything written from here on — passages, corrections, role-plays — is pitched there.`;
  if (after.profile.nativeLanguage !== before.profile.nativeLanguage)
    return `Explanations and corrections will be written in ${after.profile.nativeLanguage}.`;
  if (after.offline !== before.offline)
    return after.offline
      ? after.ollamaModel !== before.ollamaModel
        ? `Only this machine from now on. ${before.ollamaModel} runs on Ollama's servers, so the model is now ${after.ollamaModel} — check it is one you have pulled.`
        : "Only this machine from now on. Anything that needed the network was switched off."
      : "Network options can be chosen again. Nothing has been sent anywhere yet.";
  if (after.dailyMinutes !== before.dailyMinutes)
    return `Days are built to about ${after.dailyMinutes} minutes from now on.`;
  return undefined;
}

/** The patch that puts back every key this change moved. */
function undoOf(before: Settings, after: Settings): Partial<Settings> {
  const undo: Partial<Settings> = {};
  for (const key of Object.keys(after) as (keyof Settings)[])
    // Reference equality is the right test: `profile` is rebuilt on every write,
    // so a nested edit shows up here and the whole previous object goes back.
    if (after[key] !== before[key]) Object.assign(undo, { [key]: before[key] });
  return undo;
}

/**
 * Run a patch past the rules. Nothing here asks; a refusal is returned so the
 * caller can show it, and `next` is left exactly as it was.
 */
export function applyPatch(before: Settings, patch: Partial<Settings>): Applied {
  const next: Settings = { ...before, ...patch };

  const refused = languageClash(next) ?? resolveOffline(before, next, patch);
  if (refused) return { next: before, refused };

  const consequence = consequenceOf(before, next);
  // Undo rides with the consequence: the changes that need taking back are the
  // ones whose reach the learner could not see from the control they touched.
  return consequence ? { next, consequence, undo: undoOf(before, next) } : { next };
}

/**
 * Why a network-shaped option is closed, or null when it is open (#42).
 * A closed option stays on screen — a missing one reads as a missing feature,
 * a closed one reads as a switch you flipped.
 */
export function cloudGate(s: Pick<Settings, "offline">): Gate | null {
  if (!s.offline) return null;
  return {
    why: "Off while Verba stays on this machine",
    exit: { label: "Offline lock", href: AT.privacy },
  };
}

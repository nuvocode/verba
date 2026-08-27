// What models this machine can actually run, and whether the chosen one answers.
//
// Spec: docs/plans/2-verba-ana-ekran-ve-ayarlar-spec.md §5.7 — the model is
// picked from a list rather than typed, every row says what it is like to use,
// and a row too big for this machine says so.
import type { ProviderId, Settings } from "./settings.ts";

// Both reached lazily, so this module's pure half — the sizing rules and the
// cloud lists — stays loadable by plain node (models.check.ts). Import either
// statically and the check can't open the file at all.
const http = async () => (await import("@tauri-apps/plugin-http")).fetch;
const provider = async () => (await import("./providers/index.ts")).getProvider;

/** Local servers we can interrogate for a model list. Cloud providers are listed by hand below. */
export type LocalProvider = "ollama" | "lmstudio";

/** A model a local server is serving. `bytes` is 0 when the server doesn't say. */
export interface Installed {
  id: string;
  bytes: number;
}

/**
 * What a local server is actually serving. `null` means it never answered — that is a
 * different thing from an empty list (running, but no models pulled), and onboarding
 * says a different sentence for each.
 */
export async function listModels(provider: LocalProvider, host: string): Promise<Installed[] | null> {
  const base = host.replace(/\/$/, "");
  try {
    const res = await (await http())(provider === "ollama" ? `${base}/api/tags` : `${base}/models`, { method: "GET" });
    if (!res.ok) return null;
    const data = await res.json();
    // Ollama reports a size per model; LM Studio's OpenAI-compatible list does
    // not, so those rows carry 0 and simply get no size-shaped opinion.
    const raw: { id: unknown; bytes: unknown }[] =
      provider === "ollama"
        ? (data.models ?? []).map((m: any) => ({ id: m?.name, bytes: m?.size }))
        : (data.data ?? []).map((m: any) => ({ id: m?.id, bytes: 0 }));
    return raw
      .filter((m): m is { id: string; bytes: unknown } => typeof m.id === "string" && !!m.id)
      .map((m) => ({ id: m.id, bytes: typeof m.bytes === "number" && m.bytes > 0 ? m.bytes : 0 }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return null;
  }
}

/**
 * Is an OpenAI-compatible server answering at all? Used for the speech servers,
 * where — unlike a chat provider — we never pick from the model list, so a plain
 * yes/no is the whole question. A wrong URL must fail fast, not hang the settings
 * page, hence the timeout.
 */
export async function reachable(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  if (!baseUrl.trim()) return false;
  try {
    const res = await (await http())(`${baseUrl.replace(/\/$/, "")}/models`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- how much machine there is ----

/** Total memory, in bytes. 0 when nobody could be asked — and then no size claim is made. */
export async function machineRam(): Promise<number> {
  try {
    return await (await import("@tauri-apps/api/core")).invoke<number>("machine_ram");
  } catch {
    return 0; // a browser dev server has no Tauri to ask
  }
}

const GB = 1024 ** 3;

export const gb = (bytes: number) => `${(bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0)} GB`;

/**
 * Below this, a reported size is not a local model's weights.
 *
 * Ollama lists its hosted models (`…:cloud`) alongside the pulled ones and gives
 * them a token size — a few hundred bytes of manifest. Rendered honestly that
 * reads "0.0 GB", which is worse than saying nothing: it invites the learner to
 * pick the row that looks free. No model that can hold a conversation is under
 * a hundred megabytes, so anything smaller is treated as a size we do not know.
 */
const REAL_MODEL = 100 * 1024 * 1024;

/**
 * A model as the picker shows it: what it is, what it is like, and what is wrong
 * with it here. Everything a row needs, decided in one pure function so the
 * rules are readable in one place rather than spread through JSX.
 */
export interface Choice {
  id: string;
  /** Speed and quality, in words a learner can act on. Empty when nothing is known. */
  hint: string;
  /** At most one row carries this — see `localChoices`. */
  recommended?: boolean;
  /** Why this one will struggle on this machine, or absent when it won't. */
  warning?: string;
}

/**
 * A model is loaded whole and the rest of the machine still needs room, so the
 * ceiling is not the RAM figure itself. 70% is a rule of thumb rather than a
 * measurement — the honest claim it supports is only "this is bigger than what
 * you have", which stays true whatever the exact headroom turns out to be.
 */
const HEADROOM = 0.7;

function sizeHint(bytes: number): string {
  if (!bytes) return "";
  const size = gb(bytes);
  if (bytes < 3 * GB) return `Quick, plainer answers · ${size}`;
  if (bytes < 10 * GB) return `An even trade of speed and nuance · ${size}`;
  return `Slower, subtler answers · ${size}`;
}

/**
 * Is this "installed" model actually somewhere else?
 *
 * Ollama serves its own hosted models through the same local API and the same
 * list — `qwen3.5:cloud`, `gemma4:31b-cloud`. Nothing about the address they
 * arrive at says so; only the name does. They are a cloud provider wearing a
 * local provider's coat, which matters twice: the list claims to be what is on
 * this machine, and the offline lock promises nothing leaves it.
 *
 * The test is the suffix, anchored: a model genuinely called `nimbus-cloud-7b`
 * is not matched, and neither is anything with `cloud` in the middle.
 */
export const isRemoteModel = (id: string) => /[:-]cloud$/i.test(id.trim());

/**
 * The installed models, ranked and annotated.
 *
 * "Recommended" is computed rather than curated: the largest model that still
 * fits in this machine's memory is the best it can actually run, and a list
 * hardcoded here would be wrong the week after it was written. Exactly one row
 * gets the badge, and none does when no size is known — a badge on a guess is
 * worse than no badge.
 */
export function localChoices(models: Installed[], ram: number, offline = false): Choice[] {
  const room = ram > 0 ? ram * HEADROOM : 0;
  const sizeOf = (m: Installed) => (m.bytes >= REAL_MODEL ? m.bytes : 0);
  // While the lock is on these cannot be used at all, so they are gone rather
  // than greyed. The exception to "a closed option stays on screen" is earned:
  // a greyed row teaches the learner about a Verba feature they could switch on,
  // and these are not that — they are somebody else's list leaking through. The
  // panel says how many went and why, so a list that got shorter is never a
  // mystery.
  const offered = offline ? models.filter((m) => !isRemoteModel(m.id)) : models;
  const best = room
    ? offered
        .filter((m) => sizeOf(m) > 0 && sizeOf(m) <= room)
        .reduce<Installed | null>((b, m) => (!b || sizeOf(m) > sizeOf(b) ? m : b), null)
    : null;

  return offered.map((m) => ({
    id: m.id,
    // Named for what it is, lock or no lock: this row is not on your disk, and
    // "Installed models" would otherwise be saying it is.
    hint: isRemoteModel(m.id) ? "Runs on Ollama's servers, not on this machine" : sizeHint(sizeOf(m)),
    recommended: !!best && m.id === best.id,
    warning:
      room && sizeOf(m) > room
        ? `Bigger than this machine's ${gb(ram)} of memory. It will load off the disk instead, one slow word at a time.`
        : undefined,
  }));
}

/**
 * The cloud lists, by hand, because there is nothing to interrogate: a provider
 * will not enumerate its models without a key, and a learner choosing a provider
 * does not have one yet. Short on purpose — these are the models worth pointing
 * a language coach at, not a catalogue.
 */
export const CLOUD_MODELS: Partial<Record<ProviderId, Choice[]>> = {
  anthropic: [
    { id: "claude-sonnet-5", hint: "The most careful corrections", recommended: true },
    { id: "claude-haiku-4-5-20251001", hint: "Quicker and cheaper, still fluent" },
  ],
  openai: [
    { id: "gpt-4o-mini", hint: "Quick and inexpensive", recommended: true },
    { id: "gpt-4o", hint: "Slower, better at nuance" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", hint: "Quick, and generous on the free tier", recommended: true },
    { id: "gemini-2.5-pro", hint: "Slower, better at nuance" },
  ],
  openrouter: [
    { id: "openai/gpt-4o-mini", hint: "Quick and inexpensive", recommended: true },
    { id: "anthropic/claude-sonnet-5", hint: "The most careful corrections" },
  ],
};

/** Where a key comes from, so nobody has to go looking for the console (§5.7). */
export const KEY_SOURCE: Partial<Record<ProviderId, string>> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  openrouter: "https://openrouter.ai/keys",
};

// ---- does it answer? ----

/** The result of actually talking to the model — §5.7's "Bağlantıyı sına". */
export interface Probe {
  ok: boolean;
  /** How long the round trip took. The number is the point: a model that answers in 40s is a broken one. */
  ms: number;
  /** What it said, when it said anything. */
  reply?: string;
  error?: string;
}

/**
 * One real request to the configured model.
 *
 * Real rather than a `/models` ping: a server can be up, listed and still fail
 * on the first actual turn — a model that was deleted, a key without credit, a
 * context window the request does not fit. The only test worth showing a learner
 * is the one that does what the app does.
 */
export async function testConnection(s: Settings): Promise<Probe> {
  const started = Date.now();
  try {
    const reply = await (await provider())(s).chat([{ role: "user", content: "Say hello in one short sentence." }], {
      maxTokens: 40,
    });
    return { ok: true, ms: Date.now() - started, reply: reply.trim() };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - started, error: String(e?.message ?? e) };
  }
}

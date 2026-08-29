// What models this machine can actually run, and whether the chosen one answers.
//
// Spec: docs/plans/2-verba-ana-ekran-ve-ayarlar-spec.md §5.7 — the model is
// picked from a list rather than typed, every row says what it is like to use,
// and a row too big for this machine says so.
import { defaultSettings, isLocalProvider, type ProviderId, type Settings } from "./settings.ts";

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
 * Every provider, and which settings field holds its model, key and host.
 *
 * One table rather than two: Advanced renders it as the picker, and `modelTrouble`
 * reads it to work out whether there is anything to talk to at all. A second copy
 * of this mapping is a second copy that can be wrong.
 */
export const PROVIDERS: {
  id: ProviderId;
  name: string;
  desc: string;
  model: keyof Settings;
  key?: keyof Settings;
  host?: keyof Settings;
}[] = [
  {
    id: "ollama",
    name: "Ollama",
    desc: "Runs on this machine. Private, free, works on a plane.",
    model: "ollamaModel",
    host: "ollamaHost",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    desc: "Local OpenAI-compatible server. No key needed.",
    model: "lmstudioModel",
    host: "lmstudioHost",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    desc: "Deeper conversation and subtler corrections. API key required.",
    model: "anthropicModel",
    key: "anthropicKey",
  },
  {
    id: "openai",
    name: "OpenAI",
    desc: "Alternative cloud provider. API key required.",
    model: "openaiModel",
    key: "openaiKey",
  },
  { id: "gemini", name: "Gemini", desc: "Google's models. API key required.", model: "geminiModel", key: "geminiKey" },
  {
    id: "openrouter",
    name: "OpenRouter",
    desc: "One key, many models. API key required.",
    model: "openrouterModel",
    key: "openrouterKey",
  },
];

/** What screen 3a offers when no provider is running. Sizes and times are written
 *  as ranges rather than figures: the installer's exact size changes with every
 *  release, and a number that is wrong is worse than a range that is right. */
export interface Install {
  id: LocalProvider;
  name: string;
  what: string; // one sentence: what this thing is
  url: string; // where to download it
  size: string; // how big the download is
  time: string; // how long it takes
  steps: string[]; // what to do after installing, in order
}

export const INSTALLS: Install[] = [
  {
    id: "ollama",
    name: "Ollama",
    what: "A small app that runs language models on your own machine. Free, and it starts itself.",
    url: "https://ollama.com/download",
    size: "A few hundred megabytes for the app. The model you then download is the bigger part — usually 2 to 5 GB.",
    time: "A couple of minutes to install, longer for the model — that part depends on your connection.",
    steps: [
      "Download Ollama and open it. It puts an icon in your menu bar and keeps running.",
      "Download a model — Ollama's own window can do it, or paste the command below into a terminal.",
      "Come back here. Verba is watching, and this screen moves on by itself.",
    ],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    what: "A desktop app for downloading and running models, with a window for browsing them.",
    url: "https://lmstudio.ai",
    size: "Around half a gigabyte for the app, plus the model you choose — usually 2 to 5 GB.",
    time: "A few minutes to install, longer for the model.",
    steps: [
      "Download LM Studio and open it.",
      "Search for a model in its Discover tab and download it.",
      "Open the Developer tab and start the local server.",
      "Come back here. Verba is watching, and this screen moves on by itself.",
    ],
  },
];

/**
 * Is there anything to talk to? §7 row 2 — "Model yanıt vermiyor → ana ekranda
 * uyarı + sına düğmesi + model değiştir yolu".
 *
 * Everything here is free to find out. A local server is a GET to a port on this
 * machine, and a missing key is a string length — neither spends a token, which is
 * why Today can ask on the way in. What it deliberately does *not* do is send a
 * real request to a cloud provider to see whether the key works: that costs money
 * to answer a question nobody asked, and the Test connection button in Advanced is
 * where a learner asks it on purpose.
 *
 * `served` is what the local server answered with — `null` for "never answered",
 * which is a different sentence from "running, nothing pulled".
 */
export function modelTrouble(s: Settings, served: Installed[] | null): string | null {
  const p = PROVIDERS.find((x) => x.id === s.provider);
  if (!p) return null;
  const model = String(s[p.model] ?? "").trim();

  if (isLocalProvider(s.provider)) {
    const host = String(s[p.host!] ?? "");
    if (served === null) return `${p.name} is not answering at ${host}. Nothing can be practised until it is running.`;
    if (!served.length) return `${p.name} is running but has no models pulled, so there is nothing to answer with.`;
    if (model && !served.some((m) => m.id === model))
      return `${p.name} is running, but it is not serving ${model} — the model this app is set to use.`;
    return null;
  }

  if (p.key && !String(s[p.key] ?? "").trim())
    return `${p.name} needs an API key, and there is not one saved. Nothing can be practised until there is.`;
  return null;
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

// ---- what a bare machine is told, and how a failed probe reads -------

/** The model setup tells a bare machine to download.
 *  ponytail: it is `defaultSettings.ollamaModel` rather than a second list, so the
 *  suggestion and the app's own default can never disagree. Change one, both move. */
export const suggestedModel = (): string => defaultSettings.ollamaModel;

/** The command that downloads it. Shown to be copied, never run by the app. */
export const pullCommand = (model = suggestedModel()): string => `ollama pull ${model}`;

export interface PullProgress {
  /** Ollama's own word for what it is doing ("pulling manifest", "downloading…"). */
  status: string;
  done: number; // bytes so far, 0 when it does not say
  total: number; // bytes in all, 0 when it does not say
}

/**
 * Ask Ollama to download a model, reporting progress as it arrives.
 *
 * The whole reason this exists: §5 3b promises a learner with no terminal a way
 * through, and a copyable command is not one. LM Studio has no equivalent API, so
 * that provider gets the command alone.
 */
export async function pullModel(
  host: string,
  model: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await (await http())(`${host.replace(/\/$/, "")}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama refused the download (${res.status}).`);
  // A stream that is not a stream still means the download happened — there was
  // just nothing to report, so drain it and move on.
  if (!res.body || !res.body.getReader) {
    await res.text();
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // the trailing partial line stays for the next chunk
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue; // a line that is not JSON is skipped, never fatal
      }
      if (obj?.error) throw new Error(String(obj.error));
      onProgress({
        status: String(obj?.status ?? ""),
        done: Number(obj?.completed) || 0,
        total: Number(obj?.total) || 0,
      });
    }
  }
}

/** "gemma4:e2b-mlx" → "Gemma 4 · e2b-mlx". The raw id is never lost — the picker
 *  keeps it in a title attribute — but it is not what a learner should have to read. */
export function prettyModel(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return id;
  const [familyRaw, ...rest] = trimmed.split(":");
  const tag = rest.join(":");
  const family = familyRaw
    .replace(/[-_]/g, " ")
    .replace(/([a-z])(\d)/gi, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return tag ? `${family} · ${tag}` : family;
}

export interface Trouble {
  why: string; // what went wrong, in the learner's words
  next: string; // what to do about it — never absent
}

/** Turn a failed probe into a cause and a next action. `null` when the probe passed. */
export function troubleFrom(probe: Probe, providerName: string, host: string, model: string): Trouble | null {
  if (probe.ok) return null;
  const err = (probe.error ?? "").toLowerCase();
  if (/timeout|abort/.test(err))
    return { why: "The model did not answer in time.", next: "It may still be loading. Try again, or choose a smaller model." };
  if (/refused|network|failed to fetch|connect/.test(err))
    return { why: `${providerName} stopped answering at ${host}.`, next: "Check that it is still running, then try again." };
  if (/404|not found|no such model/.test(err))
    return {
      why: `${providerName} is running, but it is not serving ${model}.`,
      next: "Choose another model from the list, or download this one first.",
    };
  return { why: probe.error ?? "", next: "Try again, or choose another model." };
}

/** A probe that passed but took long enough to change the experience. "" when it didn't. */
export function slowNote(ms: number): string {
  if (ms < 10000) return "";
  return `That took ${Math.round(ms / 1000)} seconds. It will feel like this in every conversation — a smaller model is worth trying.`;
}

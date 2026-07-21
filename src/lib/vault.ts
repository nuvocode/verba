/**
 * The sync folder — "keep my Verba in iCloud Drive and pick it up on the laptop".
 *
 * ponytail: the SQLite file is **not** moved into that folder, though the plumbing
 * would allow it (tauri-plugin-sql joins an absolute path straight through). A
 * live SQLite database on iCloud Drive or Google Drive is a known way to lose one:
 * the daemon syncs `.db`, `-wal` and `-shm` independently and out of order, iCloud
 * evicts files it thinks are cold, and two machines with the app open at once
 * produce "verba 2.db" instead of a merge. The failure mode is not a bad sync, it
 * is `database disk image is malformed` — a year of history, gone, with no
 * warning and no earlier good copy.
 *
 * So the database stays local, where it is fast and safe, and what lives in the
 * folder is a **snapshot**: one JSON file, written whole, replaced atomically.
 * That is a file a sync daemon is actually good at. The cost is honest — sync is
 * session-granular rather than keystroke-granular, and a machine that dies before
 * its push loses the last few seconds — and for a single learner moving between
 * two machines, that is the right trade.
 *
 * The snapshot is the same envelope the manual export writes (lib/backup.ts), so
 * a folder is just a backup that keeps itself up to date, and either can be fed
 * to the other.
 */

import { parseBackup, restore, collect, deviceId, type Backup } from "./backup.ts";

/** Reached lazily so this module's pure half stays runnable outside Tauri (vault.check.ts). */
const rust = async () => (await import("@tauri-apps/api/core")).invoke;

const DIR_KEY = "verba.vault";
const STATE_KEY = "verba.vaultState";

/** The header beside the data, small enough to read on every launch. */
export interface Meta {
  app: "verba";
  format: number;
  /** When the folder was last written. This is the whole sync clock. */
  updatedAt: number;
  device: string;
  appVersion: string;
}

/**
 * What this machine believes about the folder.
 *
 * `syncedAt` is the folder's `updatedAt` as of the last time the two agreed —
 * set by a push (to what we just wrote) or a pull (to what we just took). It is
 * deliberately the remote's clock and not a local timestamp: comparing two
 * machines' wall clocks across a timezone change or a dead CMOS battery is how
 * sync bugs are born, and this way only one clock is ever read.
 */
export interface State {
  syncedAt: number;
  /** Local changes since `syncedAt` that the folder has not been told about. */
  dirty: boolean;
}

const NO_STATE: State = { syncedAt: 0, dirty: false };

export function vaultDir(): string {
  return localStorage.getItem(DIR_KEY) ?? "";
}

export function state(): State {
  try {
    return { ...NO_STATE, ...JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}") };
  } catch {
    return { ...NO_STATE };
  }
}

function setState(s: State): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
}

/** Something was written locally. Cheap enough to call from every DB write. */
export function markDirty(): void {
  if (!vaultDir()) return;
  const s = state();
  if (!s.dirty) setState({ ...s, dirty: true });
  schedulePush();
}

// ---- the decision ----

export type Plan =
  /** Local is ahead — publish it. */
  | "push"
  /** The folder is ahead — take it. */
  | "pull"
  /** Both moved since they last agreed. Only the learner can choose. */
  | "conflict"
  /** Nothing to do. */
  | "idle";

/**
 * The whole sync policy, as one pure function.
 *
 * It reads two facts: has the folder changed since we last agreed with it
 * (`remote.updatedAt !== syncedAt`), and have we changed since then (`dirty`).
 * Four combinations, four answers, no clocks compared and no heuristics — which
 * is the point. Everything that could go subtly wrong about this feature is
 * decided here, in eight lines that a check file can exhaust.
 */
export function decide(s: State, remote: Meta | null): Plan {
  if (!remote) return "push"; // an empty folder is always ours to fill
  const remoteMoved = remote.updatedAt !== s.syncedAt;
  if (remoteMoved && s.dirty) return "conflict";
  if (remoteMoved) return "pull";
  return s.dirty ? "push" : "idle";
}

/** `parseBackup`'s counterpart for the header — a folder holding somebody else's JSON must not read as a vault. */
export function parseMeta(text: string | null): Meta | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text);
    if (m?.app !== "verba" || typeof m.updatedAt !== "number") return null;
    return {
      app: "verba",
      format: typeof m.format === "number" ? m.format : 1,
      updatedAt: m.updatedAt,
      device: typeof m.device === "string" ? m.device : "another machine",
      appVersion: typeof m.appVersion === "string" ? m.appVersion : "unknown",
    };
  } catch {
    return null;
  }
}

// ---- talking to the folder ----

/** The header, which is all any decision needs. Cheap enough for every launch and every push. */
async function remoteMeta(dir: string): Promise<Meta | null> {
  return parseMeta(await (await rust())<string | null>("vault_meta", { dir }));
}

/** Header *and* data — only when something is about to be restored or described. */
async function load(dir: string): Promise<{ meta: Meta | null; backup: Backup | null }> {
  const meta = await remoteMeta(dir);
  const data = await (await rust())<string | null>("vault_data", { dir });
  // A header with no data beside it is a folder that was copied half-way. Read as
  // empty: pushing over it is right, pulling from it would restore nothing.
  if (!meta || !data) return { meta: null, backup: null };
  try {
    return { meta, backup: parseBackup(data) };
  } catch {
    return { meta, backup: null };
  }
}

/** Hand this machine's whole state to the folder. */
export async function push(appVersion: string): Promise<Meta> {
  const dir = vaultDir();
  const backup = await collect(appVersion);
  const meta: Meta = {
    app: "verba",
    format: backup.format,
    updatedAt: backup.exportedAt,
    device: deviceId(),
    appVersion,
  };
  await (await rust())("vault_save", { dir, meta: JSON.stringify(meta), data: JSON.stringify(backup) });
  setState({ syncedAt: meta.updatedAt, dirty: false });
  return meta;
}

/**
 * Become what the folder holds. The caller reloads the window afterwards —
 * settings, packs and every screen's state were just replaced underneath it,
 * and re-reading them one hook at a time is not something to get right by hand.
 */
export async function pull(): Promise<void> {
  const { meta, backup } = await load(vaultDir());
  if (!meta || !backup) throw new Error("That folder has no Verba data in it yet.");
  await restore(backup);
  setState({ syncedAt: meta.updatedAt, dirty: false });
}

/** Park a copy of what is about to be overwritten. Returns the file it wrote. */
async function park(dir: string, data: string, label: string): Promise<string> {
  return (await rust())<string>("vault_conflict", { dir, data, label });
}

export interface Conflict {
  /** Who wrote the folder's version, and when. */
  remote: Meta;
}

export interface SyncResult {
  plan: Plan;
  /** Set when `plan` is "conflict" — the app has to ask before anything is touched. */
  conflict?: Conflict;
}

/**
 * One round of sync. Safe to call on launch, on a timer, and from a button.
 *
 * A conflict is *reported*, never resolved here. Two machines' worth of work is
 * not something a background task gets to pick between.
 */
export async function sync(appVersion: string): Promise<SyncResult> {
  const dir = vaultDir();
  if (!dir) return { plan: "idle" };

  const meta = await remoteMeta(dir);
  const plan = decide(state(), meta);
  if (plan === "push") await push(appVersion);
  if (plan === "pull") await pull();
  if (plan === "conflict") {
    const conflict = { remote: meta! };
    // Reported *and* announced: a clash found by the Sync-now button deserves the
    // same dialog as one found at launch, and the dialog belongs to the app shell
    // rather than to whichever screen happened to ask.
    onConflict?.(conflict);
    return { plan, conflict };
  }
  return { plan };
}

/**
 * The learner's answer to a conflict. Whichever side loses is written to the
 * folder as `verba-conflict-<device>-<date>.json` first — the losing side is
 * still a real day of someone's work, and it stays importable by hand.
 */
export async function resolve(choice: "mine" | "theirs", appVersion: string): Promise<void> {
  const dir = vaultDir();
  const stamp = new Date().toISOString().slice(0, 16).replace(":", "");

  if (choice === "mine") {
    const { meta, backup } = await load(dir);
    if (backup) await park(dir, JSON.stringify(backup), `${meta?.device ?? "folder"}-${stamp}`);
    await push(appVersion);
    return;
  }
  await park(dir, JSON.stringify(await collect(appVersion)), `${deviceId()}-${stamp}`);
  await pull();
}

/**
 * Point at a folder, and report what is already there so the caller can ask the
 * only question that matters — "there is data on both sides, which one wins?".
 *
 * Nothing is written and nothing is restored here. Attaching to a folder is not
 * itself a sync; the app is left in a state where the next `sync()` would pull,
 * which is what a learner picking up an existing folder wants, and what the
 * caller overrides by pushing if they chose the other way.
 */
export async function attach(dir: string): Promise<{ meta: Meta | null; summary: Backup | null }> {
  await (await rust())("vault_check", { dir });
  const { meta, backup } = await load(dir);
  localStorage.setItem(DIR_KEY, dir);
  setState({ syncedAt: 0, dirty: true }); // both sides unproven until the caller says which wins
  return { meta, summary: backup };
}

/** The folder picker, here rather than in a view so setup and Settings open the same one. */
export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

/** Stop syncing. The folder keeps its file — detaching is not a delete. */
export function detach(): void {
  localStorage.removeItem(DIR_KEY);
  localStorage.removeItem(STATE_KEY);
}

// ---- when a push happens ----

/**
 * Writes are bursty — a finished conversation is a session row, a dozen messages,
 * a metrics row and a handful of cards inside a second — and each push serialises
 * the entire database. Coalescing them costs a few seconds of staleness and turns
 * twenty snapshots into one.
 */
const PUSH_DELAY_MS = 4000;

let timer: ReturnType<typeof setTimeout> | null = null;
let version = "0.0.0";
let onError: ((e: unknown) => void) | null = null;
let onConflict: ((c: Conflict) => void) | null = null;

/** Wire the module to the running app: which version stamps a snapshot, and where a failure or a clash surfaces. */
export function configure(
  appVersion: string,
  handlers: { error: (e: unknown) => void; conflict: (c: Conflict) => void },
): void {
  version = appVersion;
  onError = handlers.error;
  onConflict = handlers.conflict;
}

function schedulePush(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, PUSH_DELAY_MS);
}

/**
 * Push now if there is anything to push.
 *
 * Called on the debounce, and again when the window is hidden — closing the lid
 * on a finished session should not cost the session.
 *
 * It re-reads the folder's header first, and that check is not ceremony: the app
 * can sit open for hours, and the other machine can publish at any point during
 * them. Without it, a push here would be a blind overwrite of work that arrived
 * after launch — the one way this feature could actually destroy something. It
 * costs one small file read per push, and it routes the clash to the same
 * conflict dialog a launch would.
 */
export async function flush(): Promise<void> {
  const dir = vaultDir();
  if (!dir || !state().dirty) return;
  try {
    const meta = await remoteMeta(dir);
    if (decide(state(), meta) === "conflict") return onConflict?.({ remote: meta! });
    await push(version);
  } catch (e) {
    onError?.(e);
  }
}

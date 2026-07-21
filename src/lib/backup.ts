/**
 * Everything the learner has, as one file.
 *
 * Verba keeps its data in two places — SQLite for history and cards, localStorage
 * for settings, imported packs and scenarios — and neither is portable on its own.
 * This module folds both into a single versioned envelope, and puts it back.
 *
 * The same envelope serves both features that need it: the manual "Export my
 * data" file, and the file a synced folder holds (lib/vault.ts). One format, one
 * code path — a backup taken by hand on one machine is exactly what the other
 * machine's sync would have written, so the two can never drift apart.
 *
 * What is deliberately *not* in here: downloaded speech models. They are hundreds
 * of megabytes, they are re-downloadable by id, and the ids that name them travel
 * in the settings — so a restored machine knows which voice it had and can fetch
 * it again. Copying them would turn a 2 MB file into a 700 MB one to save a
 * download the learner may not even want on this machine.
 */

// The database is reached through a dynamic import, and that is load-bearing: it
// keeps this module's top level free of Tauri, which is what lets the pure half —
// validation, column matching, summaries — be run and checked by plain node
// (backup.check.ts). Import it statically and the checks can't load the file at all.
const db = async () => (await import("./db.ts")).getDb();

/** Bump only for a change that an older Verba could not read. Additive changes don't. */
export const BACKUP_FORMAT = 1;

/**
 * Every table in the schema (see lib/db.ts). Listed explicitly rather than read
 * from `sqlite_master`, so a table that appears in the schema without being
 * considered here — is it the learner's data, or is it a cache? — shows up as a
 * failing check rather than as silently-missing history.
 */
export const TABLES = [
  "sessions",
  "messages",
  "vocab",
  "reading_sessions",
  "listening_sessions",
  "level_signals",
  "daily_sessions",
  "session_metrics",
  "review_log",
  "memories",
] as const;

/**
 * localStorage is taken wholesale — every `verba.*` key except these.
 *
 * The default is "carry it": the promise this feature makes is that pointing a
 * second machine at the same folder needs no reconfiguration, and an allow-list
 * would break that promise every time someone adds a setting and forgets to
 * list it here. So the burden is on *not* carrying something, and the three
 * exceptions are exactly the things that describe this machine rather than this
 * learner — where its vault is, how far it has synced, which Settings tab was
 * last open. Sync those and every machine would fight over the others' paths.
 */
const MACHINE_LOCAL = ["verba.vault", "verba.vaultState", "verba.settingsTab", "verba.device"];

export type Row = Record<string, unknown>;

export interface Backup {
  format: number;
  app: "verba";
  /** The Verba that wrote it — shown when restoring, never enforced. */
  appVersion: string;
  exportedAt: number;
  /** Which machine wrote it, so a conflict can name the other side. */
  device: string;
  /** localStorage: key → the raw JSON string it held. */
  local: Record<string, string>;
  tables: Record<string, Row[]>;
}

/**
 * A stable name for this machine, made up on first use.
 *
 * There is no hostname in a webview and asking for one would mean a permission
 * prompt for something purely cosmetic. What a conflict message actually needs
 * is "the other one", not the truth about anyone's laptop — so a random word
 * pair, written once, is the whole requirement.
 */
export function deviceId(): string {
  const existing = localStorage.getItem("verba.device");
  if (existing) return existing;
  const id = `${navigator.platform.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "") || "machine"}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  localStorage.setItem("verba.device", id);
  return id;
}

/** The `verba.*` keys worth carrying, in a stable order so two exports of an unchanged app match byte for byte. */
export function syncedKeys(store: Pick<Storage, "length" | "key"> = localStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith("verba.") && !MACHINE_LOCAL.includes(k)) keys.push(k);
  }
  return keys.sort();
}

/** Read the whole app into an envelope. */
export async function collect(appVersion: string): Promise<Backup> {
  const sql = await db();
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) tables[t] = await sql.select<Row[]>(`SELECT * FROM ${t}`);

  const local: Record<string, string> = {};
  for (const k of syncedKeys()) local[k] = localStorage.getItem(k) ?? "";

  return {
    format: BACKUP_FORMAT,
    app: "verba",
    appVersion,
    exportedAt: Date.now(),
    device: deviceId(),
    local,
    tables,
  };
}

/** What a file claims to hold, for the confirm dialog — nobody replaces a year of history off a filename. */
export interface Summary {
  conversations: number;
  words: number;
  passages: number;
  listening: number;
  days: number;
  memories: number;
}

export function summarize(b: Backup): Summary {
  const n = (t: string) => b.tables[t]?.length ?? 0;
  return {
    conversations: n("sessions"),
    words: n("vocab"),
    passages: n("reading_sessions"),
    listening: n("listening_sessions"),
    days: n("daily_sessions"),
    memories: n("memories"),
  };
}

/**
 * Parse a file into a backup, or say why it isn't one.
 *
 * Throws rather than returning null: every caller has a place to show the
 * reason, and "this is a Verba backup from a *newer* Verba" is a very different
 * thing to tell someone than "this is not a Verba backup".
 */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't JSON.");
  }
  const b = raw as Partial<Backup>;
  if (!b || typeof b !== "object" || b.app !== "verba" || typeof b.format !== "number")
    throw new Error("That file isn't a Verba backup.");
  if (b.format > BACKUP_FORMAT)
    throw new Error(`That backup was written by a newer Verba (format ${b.format}). Update Verba and try again.`);
  if (!b.tables || typeof b.tables !== "object" || Array.isArray(b.tables))
    throw new Error("That backup has no data in it.");
  for (const [name, rows] of Object.entries(b.tables))
    if (!Array.isArray(rows)) throw new Error(`That backup is damaged — "${name}" is not a list of rows.`);
  if (b.local && (typeof b.local !== "object" || Array.isArray(b.local)))
    throw new Error("That backup is damaged — its settings are not readable.");

  return {
    format: b.format,
    app: "verba",
    appVersion: typeof b.appVersion === "string" ? b.appVersion : "unknown",
    exportedAt: typeof b.exportedAt === "number" ? b.exportedAt : 0,
    device: typeof b.device === "string" ? b.device : "unknown",
    local: (b.local as Record<string, string>) ?? {},
    tables: b.tables as Record<string, Row[]>,
  };
}

/**
 * Which of a backup's columns this schema can still take.
 *
 * A backup outlives the app version that wrote it, in both directions: an old
 * file restored into today's Verba is missing columns that have since been added
 * (they take their schema defaults), and today's file restored into an old Verba
 * — a learner who hasn't updated the second machine yet — carries columns that
 * don't exist there. Dropping the unknown ones costs that machine one field
 * until it updates; refusing the whole restore would cost it everything.
 */
export function usableColumns(rowKeys: string[], schemaColumns: string[]): string[] {
  const known = new Set(schemaColumns);
  return rowKeys.filter((k) => known.has(k));
}

/**
 * One value, as SQL text.
 *
 * The restore inlines its values instead of binding them, which needs saying:
 * bound parameters are the right default everywhere else in this codebase, and
 * the reason they are wrong *here* is in `restore` below — the whole restore has
 * to be one `execute` call, and one call cannot carry tens of thousands of
 * parameters. This is the same shape `sqlite3 .dump` writes.
 *
 * Escaping a SQLite string literal is one rule: double the single quotes.
 * Backslashes are not escapes in SQLite, so there is no second case to get
 * wrong. A NUL byte is the exception — SQLite truncates text at one — and a
 * backup is a file that may have come from anywhere, so it is dropped rather
 * than silently cutting a passage in half.
 */
export function lit(v: unknown): string {
  if (v == null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/\0/g, "").replace(/'/g, "''")}'`;
}

/** The statements a restore is made of, as one script. Pure, so a check can read it. */
export function restoreScript(tables: Record<string, Row[]>, schema: Record<string, string[]>): string {
  const out = ["BEGIN IMMEDIATE"];
  for (const t of TABLES) {
    out.push(`DELETE FROM ${t}`);
    const rows = tables[t] ?? [];
    if (!rows.length) continue;
    const cols = usableColumns(Object.keys(rows[0]), schema[t] ?? []);
    if (!cols.length) continue;
    // One INSERT per table, every row a tuple: ten statements for a whole
    // database rather than one per row.
    const tuples = rows.map((r) => `(${cols.map((c) => lit(r[c])).join(",")})`);
    out.push(`INSERT INTO ${t} (${cols.join(", ")}) VALUES ${tuples.join(",")}`);
  }
  out.push("COMMIT");
  return out.join(";\n") + ";";
}

/**
 * Replace everything with the contents of a backup.
 *
 * Replace, not merge. Merging two divergent histories means reconciling
 * autoincrement ids across ten tables that reference each other, and getting it
 * subtly wrong shows up as a conversation quoting someone else's messages. The
 * honest operation is the one the learner is actually asking for — "make this
 * machine be that machine" — and the divergent side is never destroyed silently:
 * both the Settings import and the vault write the current state out first.
 *
 * The whole thing is **one** `execute` call, and that is the load-bearing
 * detail rather than an optimisation.
 *
 * tauri-plugin-sql takes a connection from a pool per call, so a transaction
 * spread over many calls is only a transaction if the pool happens to hand back
 * the same connection every time. It usually does, which is worse than if it
 * never did: a three-statement probe passes, and the real restore then dies
 * mid-way with `(code: 517) database is locked` — SQLite refusing to upgrade a
 * transaction whose snapshot another connection has already written past. That
 * is exactly what happened here the first time this ran against real data.
 *
 * One call is one connection by construction, so `BEGIN IMMEDIATE … COMMIT`
 * inside the script is a real transaction: the restore either replaces
 * everything or leaves the existing data untouched. The cost is that values are
 * inlined rather than bound (see `lit`) — a single call cannot carry a
 * parameter per field — and the script is one string, which for a heavy year of
 * use is a few megabytes and crosses the same bridge the export already does.
 */
export async function restore(b: Backup): Promise<void> {
  const sql = await db();

  // Read the schema *before* the transaction opens: these are the only other
  // statements involved, and leaving them outside keeps the script itself the
  // single call it has to be.
  const schema: Record<string, string[]> = {};
  for (const t of TABLES)
    schema[t] = (await sql.select<{ name: string }[]>(`PRAGMA table_info(${t})`)).map((c) => c.name);

  try {
    await sql.execute(restoreScript(b.tables, schema));
  } catch (e) {
    // A statement that fails stops the script with its transaction still open on
    // that connection. This is the next call, so it lands on the same one and
    // closes it; if it somehow doesn't, the transaction dies with the app rather
    // than committing anything.
    await sql.execute("ROLLBACK").catch(() => {});
    throw e;
  }

  // Settings last, and only once the tables are committed: they are what the app
  // reloads itself from, and a reload onto half-restored history would be worse
  // than a failed restore.
  applyLocal(b.local);
}

/**
 * Put the settings back.
 *
 * Every synced key is cleared first, so a *removed* pack or scenario stays
 * removed — otherwise "make this machine be that machine" would quietly leave
 * behind whatever this machine had extra.
 */
export function applyLocal(local: Record<string, string>): void {
  for (const k of syncedKeys()) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(local)) {
    if (!k.startsWith("verba.") || MACHINE_LOCAL.includes(k)) continue; // never let a file rewrite this machine's identity
    localStorage.setItem(k, v);
  }
}

/** `verba-backup-2026-07-21.json` — the date is what anyone scanning a Downloads folder actually reads. */
export function suggestedFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `verba-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

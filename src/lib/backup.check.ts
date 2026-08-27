// Runnable check: `node --experimental-strip-types src/lib/backup.check.ts`
//
// Data portability: the backup envelope (backup.ts) and the sync decision
// (vault.ts). Both files keep their Tauri imports behind `await import(...)`
// precisely so this can run on plain node — everything checked here is the half
// that decides whether a learner keeps their history.
import assert from "node:assert";

// A localStorage that behaves like the real one, installed before the modules
// are loaded so their top level sees it.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  get length() {
    return store.size;
  },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as any).navigator ??= { platform: "MacIntel" };

const {
  parseBackup,
  summarize,
  usableColumns,
  syncedKeys,
  applyLocal,
  suggestedFilename,
  lit,
  restoreScript,
  wipeScript,
  TABLES,
  BACKUP_FORMAT,
} = await import("./backup.ts");
const { decide, parseMeta, statusLine } = await import("./vault.ts");
type Meta = import("./vault.ts").Meta;
type State = import("./vault.ts").State;

// ---- the envelope is validated, not trusted ----

const good = JSON.stringify({
  app: "verba",
  format: 1,
  appVersion: "0.2.0",
  exportedAt: 1_700_000_000_000,
  device: "mac-ab12c",
  local: { "verba.settings": '{"targetLang":"Spanish"}' },
  tables: { vocab: [{ id: 1, lang: "es", term: "gato" }], sessions: [] },
});

const b = parseBackup(good);
assert.equal(b.appVersion, "0.2.0");
assert.equal(b.tables.vocab.length, 1);

assert.throws(() => parseBackup("not json at all"), /isn't JSON/);
assert.throws(() => parseBackup('{"hello":1}'), /isn't a Verba backup/);
assert.throws(() => parseBackup('{"app":"verba","format":1}'), /no data in it/);
// A table that is not a list is a damaged file, not an empty one — restoring it
// would silently drop that table instead of saying so.
assert.throws(() => parseBackup('{"app":"verba","format":1,"tables":{"vocab":"gato"}}'), /damaged/);
// A backup from a newer Verba is refused rather than half-read: the whole point
// of the version is that this build cannot know what it would be dropping.
assert.throws(
  () => parseBackup(JSON.stringify({ app: "verba", format: BACKUP_FORMAT + 1, tables: {} })),
  /newer Verba/,
);
// Missing optional fields degrade; they never throw. An old file still restores.
const bare = parseBackup('{"app":"verba","format":1,"tables":{}}');
assert.equal(bare.appVersion, "unknown");
assert.equal(bare.exportedAt, 0);

// ---- the summary the confirm dialog is written from ----

const s = summarize(parseBackup(good));
assert.equal(s.words, 1);
assert.equal(s.conversations, 0);
assert.equal(s.passages, 0);

// ---- schema drift in both directions ----

// Today's file into an older app: the columns that machine doesn't have are
// dropped, and the rest of the row still lands.
assert.deepEqual(usableColumns(["id", "term", "cefr"], ["id", "term"]), ["id", "term"]);
// An older file into today's app: nothing to drop, the new column takes its default.
assert.deepEqual(usableColumns(["id", "term"], ["id", "term", "cefr"]), ["id", "term"]);
// Order follows the row, not the schema — the INSERT builds its placeholders from this list.
assert.deepEqual(usableColumns(["term", "id"], ["id", "term"]), ["term", "id"]);

// ---- which localStorage keys travel ----

store.clear();
localStorage.setItem("verba.settings", "{}");
localStorage.setItem("verba.packs", "[]");
localStorage.setItem("verba.vault", "/Users/x/iCloud/Verba"); // this machine's, not this learner's
localStorage.setItem("verba.vaultState", '{"syncedAt":1}');
localStorage.setItem("verba.settingsTab", "speech");
localStorage.setItem("verba.device", "mac-ab12c");
localStorage.setItem("unrelated.app", "leave me alone");
assert.deepEqual(syncedKeys(), ["verba.packs", "verba.settings"]);

// Restoring must not let a file rewrite where *this* machine syncs, or it would
// point every restored machine at the folder of whichever one wrote the backup.
applyLocal({ "verba.settings": '{"targetLang":"Japanese"}', "verba.vault": "/somebody/elses/folder" });
assert.equal(localStorage.getItem("verba.settings"), '{"targetLang":"Japanese"}');
assert.equal(localStorage.getItem("verba.vault"), "/Users/x/iCloud/Verba");
// A pack removed on the other machine stays removed here — "make this machine be
// that machine" cannot mean "and also keep whatever this one had extra".
assert.equal(localStorage.getItem("verba.packs"), null);
assert.equal(localStorage.getItem("unrelated.app"), "leave me alone");

assert.equal(suggestedFilename(new Date(2026, 6, 21)), "verba-backup-2026-07-21.json");

// ---- values are inlined, so the escaping is the whole safety story ----

assert.equal(lit(null), "NULL");
assert.equal(lit(undefined), "NULL");
assert.equal(lit(42), "42");
assert.equal(lit(2.5), "2.5");
assert.equal(lit(NaN), "NULL"); // NaN is not SQL; a bad number must not become bare `NaN`
assert.equal(lit(Infinity), "NULL");
assert.equal(lit(true), "1");
assert.equal(lit("gato"), "'gato'");
// The one escape SQLite has. A passage full of apostrophes is the common case,
// not the attack — but the attack is closed by the same line.
assert.equal(lit("it's"), "'it''s'");
assert.equal(lit("'; DROP TABLE vocab; --"), "'''; DROP TABLE vocab; --'");
// Backslashes are literal in SQLite: escaping them would corrupt the text.
assert.equal(lit("a\\b"), "'a\\b'");
// Newlines and unicode ride through untouched.
assert.equal(lit("iki\nsatır · 日本語"), "'iki\nsatır · 日本語'");
// A NUL would truncate the column's text at that byte, quietly losing the rest.
assert.equal(lit("before\u0000after"), "'beforeafter'");

// ---- the restore script ----

const script = restoreScript(
  { vocab: [{ id: 1, lang: "es", term: "it's", junk: "dropped" }], sessions: [] },
  { vocab: ["id", "lang", "term"], sessions: ["id"] },
);
assert.ok(script.startsWith("BEGIN IMMEDIATE;"), script.slice(0, 40));
assert.ok(script.trimEnd().endsWith("COMMIT;"));
assert.ok(script.includes("INSERT INTO vocab (id, lang, term) VALUES (1,'es','it''s');"));
// A column the file has and this schema doesn't never reaches the SQL.
assert.ok(!script.includes("junk"));
// Every table is cleared, including the ones the backup says nothing about —
// "make this machine be that machine" has to mean the empty tables too.
for (const t of ["vocab", "sessions", "memories", "review_log"]) assert.ok(script.includes(`DELETE FROM ${t};`), t);
// An empty table contributes a DELETE and no INSERT.
assert.ok(!/INSERT INTO sessions/.test(script));

// ---- the sync decision ----

const meta = (updatedAt: number): Meta => ({
  app: "verba",
  format: 1,
  updatedAt,
  device: "other",
  appVersion: "0.2.0",
});
const st = (syncedAt: number, dirty: boolean): State => ({ syncedAt, dirty });

// An empty folder is always ours to fill, whatever we think we've synced.
assert.equal(decide(st(0, false), null), "push");
assert.equal(decide(st(500, true), null), "push");

// Nobody moved.
assert.equal(decide(st(500, false), meta(500)), "idle");
// Only we moved.
assert.equal(decide(st(500, true), meta(500)), "push");
// Only they moved — the other machine finished a session, this one has nothing to lose.
assert.equal(decide(st(500, false), meta(900)), "pull");
// Both moved. This is the only case a human gets asked about, and it is the only
// case where guessing would destroy a day of work.
assert.equal(decide(st(500, true), meta(900)), "conflict");

// A freshly attached folder that already holds data reads as "they moved": the
// learner pointed at an existing vault, so its data is the candidate, not ours.
assert.equal(decide(st(0, false), meta(900)), "pull");

// The comparison is equality, never ordering: a folder rolled back by a restore
// from an older copy is still *different*, so it is still a real event and not
// something to ignore because its number went down.
assert.equal(decide(st(900, false), meta(500)), "pull");

// ---- a folder full of somebody else's files is not a vault ----

assert.equal(parseMeta(null), null);
assert.equal(parseMeta("{}"), null);
assert.equal(parseMeta('{"app":"notverba","updatedAt":1}'), null);
assert.equal(parseMeta('{"app":"verba","updatedAt":"soon"}'), null);
assert.equal(parseMeta("{ truncated"), null);
assert.equal(parseMeta('{"app":"verba","updatedAt":42}')?.device, "another machine");

// ---- state 6: a folder that cannot be reached still says when it last worked ----
// §7 row 6 — "Son başarılı yazma zamanı + neden". The reason on its own is a dead
// end; the last good write is what tells the learner how much is actually at risk.

const reachable: State = { syncedAt: Date.parse("2026-08-20T09:15:00Z"), dirty: true, bytes: 3_200_000, error: "" };
assert.match(statusLine(reachable), /Last written/, "a folder that has been written names when");
assert.match(statusLine(reachable), /3\.1 MB/, "…and how big the copy is");
assert.match(statusLine(reachable), /changes waiting/, "…and whether this machine is ahead of it");

const broken: State = { ...reachable, error: "No such file or directory (os error 2)" };
assert.match(statusLine(broken), /Last written/, "a broken folder still names the last write it managed");
assert.match(statusLine(broken), /os error 2/, "…and the reason it cannot be reached now");
assert(
  !/changes waiting|up to date/.test(statusLine(broken)),
  "a folder that cannot be reached is neither waiting nor up to date — saying both contradicts §6",
);

// A folder nobody has written yet is a different sentence from a broken one.
assert.match(statusLine({ syncedAt: 0, dirty: false, bytes: 0, error: "" }), /Nothing written yet/);

// ---- state 7: an invalid file is refused before it can touch anything ----
// §7 row 7 — "Ne beklendiği yazılır, mevcut veri korunur". The second half is
// structural rather than a message: this file runs in plain node with no Tauri
// and no database, so every rejection above happened without a connection
// existing. A parse that could reach the data would have thrown a different
// error here, not a readable one.

for (const [junk, expected] of [
  ["not json at all", /isn't JSON/],
  ['{"hello":1}', /isn't a Verba backup/],
  ['{"app":"verba","format":1}', /no data in it/],
] as const)
  assert.throws(() => parseBackup(junk), expected, "a rejection says what was expected instead");

// ---- delete everything empties every table, or none ----
// The confirm dialog counts what is lost out of `summarize`, so a table missing
// from the wipe is data the learner was told they were deleting and still has.
const emptying = wipeScript();
for (const t of TABLES) assert.match(emptying, new RegExp(`DELETE FROM ${t}\\b`), `wipe must empty ${t}`);
assert(emptying.startsWith("BEGIN IMMEDIATE"), "a half-deleted database is worse than a full one");
assert(emptying.trimEnd().endsWith("COMMIT;"), "…so the deletes are one transaction");

console.log("backup.check.ts ok");

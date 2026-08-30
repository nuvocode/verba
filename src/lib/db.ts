import Database, { type QueryResult } from "@tauri-apps/plugin-sql";
import { newCard, schedule, DAILY_REVIEW_CAP, type Grade } from "./srs";
import { worthLearning, tooEasyToAutoAdd } from "./vocab";
import { planMemory, type Memory, type MemoryWrite } from "./prompts";
import { markDirty } from "./vault";
import type { Signal, SignalKind } from "./model";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = init();
  return dbPromise;
}

/**
 * Every write to the learner's data goes through here.
 *
 * Not for the SQL's sake — `db.execute` was fine — but because a sync folder has
 * to know that something changed, and the only honest place to learn that is the
 * statement that changed it. A screen that remembers to announce its own writes
 * is a screen that will eventually forget, and the symptom would be a session
 * that never reaches the other machine. One door, and `markDirty` is behind it.
 *
 * Schema migrations in `init` deliberately do *not* come through here: they run
 * before `getDb` has resolved, and a table shape is not the learner's data.
 */
async function write(sql: string, params: unknown[] = []): Promise<QueryResult> {
  const db = await getDb();
  const r = await db.execute(sql, params);
  markDirty();
  return r;
}

async function init(): Promise<Database> {
  const db = await Database.load("sqlite:verba.db");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      summary TEXT,
      title TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vocab (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      term TEXT NOT NULL,
      translation TEXT,
      example TEXT,
      ease REAL NOT NULL,
      interval INTEGER NOT NULL,
      due INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'word',       -- §1.4 VocabItem.type
      captured_by TEXT NOT NULL DEFAULT 'learner',
      source_surface TEXT NOT NULL DEFAULT '', -- §1.4 sourceRef.surface
      level_band TEXT,                         -- CEFR band of the item; NULL = never measured
      created_at INTEGER NOT NULL,
      UNIQUE(lang, term)     -- the same spelling is a different card in a different language
    );
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,        -- JSON ReadingText
      created_at INTEGER NOT NULL,
      length TEXT,               -- what was asked for: short | medium | long
      topic TEXT                 -- what the reader asked it to be about; NULL when they left it to the day's plan
    );
    CREATE TABLE IF NOT EXISTS listening_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      title TEXT NOT NULL,
      piece TEXT NOT NULL,       -- JSON ListeningPiece (chapters + questions + transcript)
      answers TEXT NOT NULL,     -- JSON: per-question { given, correct }
      accuracy REAL NOT NULL,    -- 0..1 comprehension over the whole piece
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS level_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      estimate TEXT NOT NULL,
      confidence TEXT NOT NULL,
      rationale TEXT,
      created_at INTEGER NOT NULL
    );
    -- Phase 3: learning engine + metrics v2 + coaching
    CREATE TABLE IF NOT EXISTS daily_sessions (
      date TEXT PRIMARY KEY,          -- YYYY-MM-DD, one plan per day
      lang TEXT NOT NULL,
      plan TEXT NOT NULL,             -- JSON DailyPlan
      done TEXT NOT NULL,             -- JSON string[] of completed block kinds
      recap TEXT,                     -- JSON DayRecap once finished
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      messages INTEGER NOT NULL,
      words INTEGER NOT NULL,
      unique_words INTEGER NOT NULL,
      avg_sentence_len REAL NOT NULL,
      corrections INTEGER NOT NULL,
      deck_size INTEGER NOT NULL,
      score INTEGER NOT NULL,         -- metrics-v2 composite 0-100
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL
    );
    -- What the coach knows about the learner: durable facts, dated, one per row.
    -- Scoped to a language like every other table here — the record belongs to the
    -- learner as a learner of that language, and switching language starts a fresh one.
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      fact TEXT NOT NULL,
      source_session_id INTEGER,   -- the conversation it was learned in; NULL if the DB row was gone
      created_at INTEGER NOT NULL,
      UNIQUE(lang, fact)           -- the same sentence twice is still one fact
    );
    -- §1.3 Signals: what a finished activity observed about the learner. Coach
    -- groups these into weaknesses, so they are scoped to a language like every
    -- other table here — evidence from one language may not argue about another.
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,           -- SignalId (a uuid, not a rowid)
      lang TEXT NOT NULL,
      activity_id TEXT NOT NULL,     -- ActivityId within that day's plan
      kind TEXT NOT NULL,            -- SignalKind
      payload TEXT NOT NULL,         -- JSON; only ever read through signalLabel
      observed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS signals_lang_time ON signals (lang, observed_at);
  `);
  // Added after the first release: the Coach breaks the composite back out into
  // its components, and that needs avg word length. Existing DBs get it here.
  await db.execute("ALTER TABLE session_metrics ADD COLUMN avg_word_len REAL NOT NULL DEFAULT 0").catch(() => {});
  // Conversations name themselves now. Older sessions keep a NULL title and fall
  // back to their scenario's name in the history list.
  await db.execute("ALTER TABLE sessions ADD COLUMN title TEXT").catch(() => {});
  // The reader can now ask for a length and a topic before a passage is written.
  // Passages generated before that keep NULLs — "we didn't ask", not "they wanted nothing".
  await db.execute("ALTER TABLE reading_sessions ADD COLUMN length TEXT").catch(() => {});
  await db.execute("ALTER TABLE reading_sessions ADD COLUMN topic TEXT").catch(() => {});
  // The level a passage was written at, so the library can be filtered by it. Older
  // rows keep NULL — their level wasn't recorded — and only show under "All".
  await db.execute("ALTER TABLE reading_sessions ADD COLUMN cefr TEXT").catch(() => {});
  // A failed card and a card that has never been failed used to look the same:
  // the schedule tracked reps but threw the lapses away (§2.5). Existing decks
  // start at 0 — that is "not recorded", and it is the only honest starting count.
  await db.execute("ALTER TABLE vocab ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0").catch(() => {});
  // §1.4: a card knows what kind of thing it is, where it was met, who kept it and
  // roughly how hard it is. Rows written before this keep the defaults — "a word,
  // kept by the learner, from nowhere in particular" — which is what they were.
  await db.execute("ALTER TABLE vocab ADD COLUMN type TEXT NOT NULL DEFAULT 'word'").catch(() => {});
  await db.execute("ALTER TABLE vocab ADD COLUMN captured_by TEXT NOT NULL DEFAULT 'learner'").catch(() => {});
  await db.execute("ALTER TABLE vocab ADD COLUMN source_surface TEXT NOT NULL DEFAULT ''").catch(() => {});
  await db.execute("ALTER TABLE vocab ADD COLUMN level_band TEXT").catch(() => {});
  await migrateVocabToPerLanguage(db);
  return db;
}

/**
 * v1 stored vocabulary as `term TEXT UNIQUE` with no language at all, so every
 * language shared one deck: switching from Spanish to Japanese resurfaced the
 * Spanish cards, and a term that exists in two languages (fr "pain", en "pain")
 * silently kept only whichever was captured first. SQLite cannot drop a
 * column-level UNIQUE, so the table has to be rebuilt.
 *
 * Existing rows are backfilled with the language the learner was actually
 * studying (Settings.targetLang) — that is the language those cards came from.
 */
async function migrateVocabToPerLanguage(db: Database): Promise<void> {
  const cols = await db.select<{ name: string }[]>("PRAGMA table_info(vocab)");
  if (!cols.length || cols.some((c) => c.name === "lang")) return; // fresh DB, or already migrated

  let lang = "";
  try {
    // Both shapes, because this migration is one-shot and irreversible: it is gated on
    // the `lang` column being absent, so a run that reads "" orphans the whole deck for
    // good — the rows survive, but every query is language-scoped and none of them match.
    // Settings moved targetLang under `profile` (see lib/settings migrateProfile), and
    // saveSettings can write the new shape before the DB is ever opened.
    const raw = JSON.parse(localStorage.getItem("verba.settings") ?? "{}");
    lang = raw.profile?.targetLanguage ?? raw.targetLang ?? "";
  } catch {
    /* no settings to read — the cards land under "" and the learner recaptures them */
  }

  await db.execute(`
    ALTER TABLE vocab RENAME TO vocab_v1;
    CREATE TABLE vocab (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      term TEXT NOT NULL,
      translation TEXT,
      example TEXT,
      ease REAL NOT NULL,
      interval INTEGER NOT NULL,
      due INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(lang, term)
    );
    INSERT INTO vocab (lang, term, translation, example, ease, interval, due, reps, created_at)
      SELECT '${lang.replace(/'/g, "''")}', term, translation, example, ease, interval, due, reps, created_at FROM vocab_v1;
    DROP TABLE vocab_v1;
  `);
}

// ---- sessions & messages ----

export async function createSession(scenario: string): Promise<number> {
  const r = await write("INSERT INTO sessions (scenario, started_at) VALUES ($1, $2)", [scenario, Date.now()]);
  return r.lastInsertId as number;
}

export async function addMessage(sessionId: number, role: string, content: string): Promise<void> {
  await write("INSERT INTO messages (session_id, role, content, created_at) VALUES ($1, $2, $3, $4)", [
    sessionId,
    role,
    content,
    Date.now(),
  ]);
}

export interface SessionRow {
  id: number;
  scenario: string;
  started_at: number;
  summary: string | null;
  /** Written by the coach. NULL on sessions that predate titles, or whose title call failed. */
  title: string | null;
}

/** Past conversations, newest first. Sessions that never got a message are noise — skip them. */
export async function listSessions(limit = 50): Promise<SessionRow[]> {
  const db = await getDb();
  return db.select<SessionRow[]>(
    `SELECT s.id, s.scenario, s.started_at, s.summary, s.title,
            (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS n
     FROM sessions s WHERE n > 1 ORDER BY s.started_at DESC LIMIT $1`,
    [limit],
  );
}

export async function sessionMessages(sessionId: number): Promise<{ role: string; content: string }[]> {
  const db = await getDb();
  return db.select<{ role: string; content: string }[]>(
    "SELECT role, content FROM messages WHERE session_id = $1 ORDER BY id ASC",
    [sessionId],
  );
}

export async function setSummary(sessionId: number, summary: string): Promise<void> {
  await write("UPDATE sessions SET summary = $1 WHERE id = $2", [summary, sessionId]);
}

export async function setTitle(sessionId: number, title: string): Promise<void> {
  await write("UPDATE sessions SET title = $1 WHERE id = $2", [title, sessionId]);
}

// ---- vocabulary / SRS ----

export interface VocabRow {
  id: number;
  term: string;
  translation: string;
  example: string;
  ease: number;
  interval: number;
  due: number;
  reps: number;
  lapses: number;
  type: string;
  captured_by: string;
  source_surface: string;
  level_band: string | null;
}

// Every read and write below is scoped to one language: a deck belongs to the
// language it was met in, and switching language must not resurface the old one.

/**
 * Add a card, if it is one.
 *
 * Every write goes through `worthLearning` here rather than at each call site, so
 * there is exactly one door into the deck and no surface can quietly widen it.
 *
 * Returns whether a new row was actually written — false covers both "not
 * vocabulary" and "already captured", which is what a caller wanting to say
 * "added" or "already in Memory" needs to know.
 */
export async function addVocab(
  lang: string,
  item: { term: string; translation: string; example: string; type?: string; levelBand?: string | null },
  origin: { capturedBy: "learner" | "coach"; surface: string; learnerLevel: string },
): Promise<boolean> {
  if (!worthLearning(item).ok) return false;
  // invariant 16: the tutor does not put words two bands below the learner in
  // their deck. They may still add one themselves — that is what asking is.
  if (origin.capturedBy === "coach" && tooEasyToAutoAdd(item.levelBand, origin.learnerLevel)) return false;
  // INSERT OR IGNORE keeps existing SRS progress if the term was already captured.
  const r = await write(
    `INSERT OR IGNORE INTO vocab (lang, term, translation, example, ease, interval, due, reps, lapses,
                                  type, captured_by, source_surface, level_band, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      lang,
      item.term.trim(),
      item.translation.trim(),
      item.example,
      newCard.ease,
      newCard.interval,
      Date.now(),
      newCard.reps,
      newCard.lapses,
      item.type ?? "word",
      origin.capturedBy,
      origin.surface,
      item.levelBand ?? null,
      Date.now(),
    ],
  );
  return (r.rowsAffected ?? 0) > 0;
}

/** The learner dropping a card. A deck they cannot prune is a deck they stop opening. */
export async function deleteVocab(id: number): Promise<void> {
  await write("DELETE FROM vocab WHERE id = $1", [id]);
}

/**
 * Drop a card by its term — the conversation wrap-up's undo, which never saw a row id.
 *
 * Safe there because the wrap-up only offers cards that conversation actually
 * inserted; a term that was already in the deck is never on that list, so this
 * cannot reach a card carrying weeks of review history.
 */
export async function deleteVocabTerm(lang: string, term: string): Promise<void> {
  await write("DELETE FROM vocab WHERE lang = $1 AND term = $2", [lang, term]);
}

/**
 * The SQL half of `suspect()` — the two rules that can be expressed in SQLite, and
 * between them the two that produced every junk card the old capture let through: a
 * row with nothing on its back, and a term that is really a number, time or date.
 *
 * Counting has to agree with reviewing. Memory refuses to queue these, so a plan
 * block promising "3 cards due" that opens onto nothing would be the app lying to
 * the learner about their own day. The finer rules in `suspect()` (a term that
 * echoes its meaning, a term the length of a clause) are left out: they cost a
 * handful of over-counted rows, and only until the learner clears the group.
 */
const REVIEWABLE = "TRIM(COALESCE(translation, '')) <> '' AND term NOT GLOB '*[0-9]*'";

export async function dueVocab(lang: string, now = Date.now(), limit = DAILY_REVIEW_CAP): Promise<VocabRow[]> {
  const db = await getDb();
  return db.select<VocabRow[]>(
    `SELECT * FROM vocab WHERE lang = $1 AND due <= $2 AND ${REVIEWABLE} ORDER BY due ASC LIMIT $3`,
    [lang, now, limit],
  );
}

export async function allVocab(lang: string): Promise<VocabRow[]> {
  const db = await getDb();
  return db.select<VocabRow[]>("SELECT * FROM vocab WHERE lang = $1 ORDER BY created_at DESC", [lang]);
}

/**
 * What the deck owes and what the learner is asked for. `due` is the whole
 * backlog; `today` is the capped ask — the number every call to action shows,
 * because "112 due" is the number that makes a learner close the app (§2.5).
 */
export async function vocabCounts(
  lang: string,
  now = Date.now(),
): Promise<{ total: number; due: number; today: number }> {
  const db = await getDb();
  const total = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM vocab WHERE lang = $1 AND ${REVIEWABLE}`,
    [lang],
  );
  const due = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM vocab WHERE lang = $1 AND due <= $2 AND ${REVIEWABLE}`,
    [lang, now],
  );
  return { total: total[0]?.n ?? 0, due: due[0]?.n ?? 0, today: Math.min(due[0]?.n ?? 0, DAILY_REVIEW_CAP) };
}

export async function reviewVocab(card: VocabRow, grade: Grade): Promise<void> {
  const next = schedule(
    { ease: card.ease, interval: card.interval, reps: card.reps, lapses: card.lapses },
    grade,
    Date.now(),
  );
  await write("UPDATE vocab SET ease = $1, interval = $2, reps = $3, due = $4, lapses = $5 WHERE id = $6", [
    next.ease,
    next.interval,
    next.reps,
    next.due,
    next.lapses,
    card.id,
  ]);
  // Log the review so weekly stats can count activity (no per-review timestamp on vocab).
  await write("INSERT INTO review_log (created_at) VALUES ($1)", [Date.now()]);
}

// ---- reading sessions ----

/** `asked` is what the reader requested, not what came back — a reading history wants both. */
export async function saveReading(
  lang: string,
  title: string,
  text: unknown,
  asked: { length?: string; topic?: string; cefr?: string } = {},
): Promise<void> {
  await write(
    "INSERT INTO reading_sessions (lang, title, text, created_at, length, topic, cefr) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [lang, title, JSON.stringify(text), Date.now(), asked.length ?? null, asked.topic?.trim() || null, asked.cefr ?? null],
  );
}

/** One row for the reading library — the passage text is fetched lazily by `getReading`. */
export interface ReadingRow {
  id: number;
  title: string;
  created_at: number;
  length: string | null;
  topic: string | null;
  cefr: string | null;
}

export async function listReadings(lang: string): Promise<ReadingRow[]> {
  const db = await getDb();
  return db.select<ReadingRow[]>(
    "SELECT id, title, created_at, length, topic, cefr FROM reading_sessions WHERE lang = $1 ORDER BY created_at DESC",
    [lang],
  );
}

/** The full passage for one saved reading. Returns a parsed ReadingText (typed by the caller). */
export async function getReading(id: number): Promise<unknown | null> {
  const db = await getDb();
  const rows = await db.select<{ text: string }[]>("SELECT text FROM reading_sessions WHERE id = $1", [id]);
  return rows[0] ? JSON.parse(rows[0].text) : null;
}

// ---- listening sessions ----

/** Store a finished listening piece with the learner's answers and comprehension accuracy. */
export async function saveListening(
  lang: string,
  title: string,
  piece: unknown,
  answers: unknown,
  accuracy: number,
): Promise<void> {
  await write(
    "INSERT INTO listening_sessions (lang, title, piece, answers, accuracy, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [lang, title, JSON.stringify(piece), JSON.stringify(answers), accuracy, Date.now()],
  );
}

// ---- Phase 3: level metrics v2 ----

export async function saveMetrics(
  lang: string,
  m: {
    messages: number;
    words: number;
    uniqueWords: number;
    avgSentenceLen: number;
    avgWordLen: number;
    corrections: number;
    deckSize: number;
  },
  score: number,
): Promise<void> {
  await write(
    `INSERT INTO session_metrics (lang, messages, words, unique_words, avg_sentence_len, avg_word_len, corrections, deck_size, score, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [lang, m.messages, m.words, m.uniqueWords, m.avgSentenceLen, m.avgWordLen, m.corrections, m.deckSize, score, Date.now()],
  );
}

export interface MetricsRow {
  messages: number;
  words: number;
  unique_words: number;
  avg_sentence_len: number;
  avg_word_len: number;
  corrections: number;
  deck_size: number;
  score: number;
}

/** The last n sessions' raw metrics, newest first — the Coach re-derives its components from these. */
export async function recentMetrics(lang: string, n = 2): Promise<MetricsRow[]> {
  const db = await getDb();
  return db.select<MetricsRow[]>(
    `SELECT messages, words, unique_words, avg_sentence_len, avg_word_len, corrections, deck_size, score
     FROM session_metrics WHERE lang = $1 ORDER BY created_at DESC LIMIT $2`,
    [lang, n],
  );
}

export async function latestMetricScore(lang: string): Promise<number | null> {
  const db = await getDb();
  const rows = await db.select<{ score: number }[]>(
    "SELECT score FROM session_metrics WHERE lang = $1 ORDER BY created_at DESC LIMIT 1",
    [lang],
  );
  return rows[0]?.score ?? null;
}

/** Composite scores of the last n sessions, oldest first — the Coach momentum line. */
export async function recentMetricScores(lang: string, n = 12): Promise<number[]> {
  const db = await getDb();
  const rows = await db.select<{ score: number }[]>(
    "SELECT score FROM session_metrics WHERE lang = $1 ORDER BY created_at DESC LIMIT $2",
    [lang, n],
  );
  return rows.map((r) => r.score).reverse();
}

/**
 * Which of the last 7 days had any activity. Index 0 = 6 days ago, index 6 = today.
 * Reads local-midnight boundaries, so "today" means the learner's today.
 */
export async function activeDays(now = Date.now()): Promise<boolean[]> {
  const db = await getDb();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime() - 6 * 24 * 60 * 60 * 1000;
  const rows = await db.select<{ t: number }[]>(
    `SELECT started_at AS t FROM sessions WHERE started_at >= $1
     UNION ALL SELECT created_at AS t FROM review_log WHERE created_at >= $1`,
    [start],
  );
  const days = [false, false, false, false, false, false, false];
  for (const r of rows) {
    const i = Math.floor((r.t - start) / (24 * 60 * 60 * 1000));
    if (i >= 0 && i < 7) days[i] = true;
  }
  return days;
}

// ---- Phase 3: daily learning sessions ----

export interface DailyRow {
  date: string;
  lang: string;
  plan: string; // JSON
  done: string; // JSON string[]
  recap: string | null; // JSON
}

export async function getDailySession(date: string): Promise<DailyRow | null> {
  const db = await getDb();
  const rows = await db.select<DailyRow[]>("SELECT * FROM daily_sessions WHERE date = $1", [date]);
  return rows[0] ?? null;
}

/** Upsert the day's plan/progress. Keyed by date so a day has exactly one plan. */
export async function saveDailySession(
  date: string,
  lang: string,
  plan: unknown,
  done: string[],
  recap: unknown | null,
): Promise<void> {
  await write(
    `INSERT INTO daily_sessions (date, lang, plan, done, recap, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(date) DO UPDATE SET plan = excluded.plan, done = excluded.done, recap = excluded.recap`,
    [date, lang, JSON.stringify(plan), JSON.stringify(done), recap ? JSON.stringify(recap) : null, Date.now()],
  );
}

/**
 * Write a batch of signals. Empty is a no-op on purpose: a surface that observed
 * nothing should not have to say so, and every caller wrapping this in an
 * `if (signals.length)` would be the same check written six times.
 *
 * `payload` is carried through as opaque JSON — this door stores it, it never
 * looks inside (signals.check.ts holds that line).
 */
export async function saveSignals(lang: string, signals: Signal[]): Promise<void> {
  for (const s of signals) {
    await write(
      `INSERT INTO signals (id, lang, activity_id, kind, payload, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [s.id, lang, s.activityId, s.kind, JSON.stringify(s.payload), s.observedAt],
    );
  }
}

interface SignalRow {
  id: string;
  activity_id: string;
  kind: string;
  payload: string;
  observed_at: number;
}

/** Signals for one language, newest first — the evidence Coach reasons over. */
export async function recentSignals(lang: string, n = 200): Promise<Signal[]> {
  const db = await getDb();
  const rows = await db.select<SignalRow[]>(
    `SELECT id, activity_id, kind, payload, observed_at FROM signals
     WHERE lang = $1 ORDER BY observed_at DESC LIMIT $2`,
    [lang, n],
  );
  return rows.map((r) => ({
    id: r.id,
    activityId: r.activity_id,
    kind: r.kind as SignalKind,
    observedAt: r.observed_at,
    // Unparseable JSON reads as no payload rather than throwing: one bad row
    // must not cost the learner the rest of their evidence. signalLabel says null.
    payload: parseJson(r.payload),
  }));
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * How many days the learner has shown up in this language — the "Day 41" on the
 * Today screen.
 *
 * Scoped to the language like every other table here (§3): the streak belongs to
 * the learner as a learner of *that* language, so switching does not inherit a
 * number that was never earned there, and switching back finds the old one intact.
 */
export async function dayNumber(lang: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM daily_sessions WHERE lang = $1", [lang]);
  return rows[0]?.n ?? 1;
}

/**
 * Days shown up and words saved, per language, in two queries rather than two per
 * language. This is what a language row in Settings shows: the proof that
 * switching language deletes nothing, which a sentence promising it cannot give.
 */
export async function progressByLang(): Promise<Record<string, { days: number; words: number }>> {
  const db = await getDb();
  const out: Record<string, { days: number; words: number }> = {};
  const at = (lang: string) => (out[lang] ??= { days: 0, words: 0 });
  for (const r of await db.select<{ lang: string; n: number }[]>(
    "SELECT lang, COUNT(*) AS n FROM daily_sessions GROUP BY lang",
  ))
    at(r.lang).days = r.n;
  for (const r of await db.select<{ lang: string; n: number }[]>(
    "SELECT lang, COUNT(*) AS n FROM vocab GROUP BY lang",
  ))
    at(r.lang).words = r.n;
  return out;
}

/**
 * The last day before this one that was actually opened — §4.2's "dünün izi".
 *
 * Deliberately not filtered on `recap IS NOT NULL` the way latestRecap is: a day
 * the learner abandoned halfway is exactly the day worth reminding them about, and
 * it never got a recap.
 */
export async function previousDay(
  lang: string,
  before: string,
): Promise<{ date: string; theme: string; done: number; total: number } | null> {
  const db = await getDb();
  const rows = await db.select<DailyRow[]>(
    "SELECT * FROM daily_sessions WHERE lang = $1 AND date < $2 ORDER BY date DESC LIMIT 1",
    [lang, before],
  );
  if (!rows[0]) return null;
  try {
    const plan = JSON.parse(rows[0].plan);
    const done: unknown[] = JSON.parse(rows[0].done);
    return {
      date: rows[0].date,
      theme: String(plan?.theme ?? ""),
      done: Array.isArray(done) ? done.length : 0,
      total: Array.isArray(plan?.activities) ? plan.activities.length : 0,
    };
  } catch {
    return null; // a row we cannot read is a row with nothing to say
  }
}

/** The most recent day's recap — its nextFocus seeds the next plan's weak-area drills. */
export async function latestRecap(lang: string, before: string): Promise<{ recap: string; nextFocus: string[] } | null> {
  const db = await getDb();
  const rows = await db.select<{ recap: string }[]>(
    "SELECT recap FROM daily_sessions WHERE lang = $1 AND date < $2 AND recap IS NOT NULL ORDER BY date DESC LIMIT 1",
    [lang, before],
  );
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].recap);
  } catch {
    return null;
  }
}

// ---- long-term memory (Settings → About me) ----

export interface MemoryRow extends Memory {
  lang: string;
  source_session_id: number | null;
}

/**
 * How many facts ride along in a prompt.
 *
 * The list grows without bound and a local 3B model has very little context to
 * spare, so the rule is: **the 20 most recently learned facts, newest first**.
 * Recency, not relevance — there is no embedding index to rank against offline,
 * and recency is not arbitrary here: a fact that superseded another is always the
 * newer of the two, so the cut can only ever drop the oldest and most settled
 * facts, which are the ones the coach is least likely to need to bring up.
 *
 * Deduplication does *not* use this budget — it runs against the whole table (a
 * local SELECT is free), so a fact that fell past the cut can never come back as
 * a second bullet.
 */
export const MEMORY_BUDGET = 20;

/** The facts the prompts get: newest first, capped at the budget. */
export async function recentMemories(lang: string, limit = MEMORY_BUDGET): Promise<MemoryRow[]> {
  const db = await getDb();
  return db.select<MemoryRow[]>(
    "SELECT id, lang, fact, source_session_id, created_at FROM memories WHERE lang = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
    [lang, limit],
  );
}

/** Every fact on file — the Settings list, and what deduplication is checked against. */
export async function allMemories(lang: string): Promise<MemoryRow[]> {
  const db = await getDb();
  return db.select<MemoryRow[]>(
    "SELECT id, lang, fact, source_session_id, created_at FROM memories WHERE lang = $1 ORDER BY created_at DESC, id DESC",
    [lang],
  );
}

/**
 * Commit what a conversation taught us about the learner.
 *
 * Superseding deletes the old row rather than hiding it behind a flag: Settings →
 * User Memory is the learner's account of what the machine believes about them,
 * and a fact the coach no longer believes has no business sitting in the table
 * invisibly. What is left is exactly what steers the prompts — which is the whole
 * point of showing it.
 */
export async function saveMemories(lang: string, writes: MemoryWrite[], sessionId: number | null): Promise<void> {
  if (!writes.length) return;
  const plan = planMemory(await allMemories(lang), writes);

  for (const w of plan) {
    if (w.replaces != null)
      await write("DELETE FROM memories WHERE id = $1 AND lang = $2", [w.replaces, lang]);
    // OR IGNORE, because UNIQUE(lang, fact) is the last word on "told twice": the
    // normalised check in planMemory catches the re-wordings, this catches the rest.
    await write(
      "INSERT OR IGNORE INTO memories (lang, fact, source_session_id, created_at) VALUES ($1, $2, $3, $4)",
      [lang, w.fact, sessionId, Date.now()],
    );
  }
}

/** The learner striking a line out. Nothing else in the app deletes a memory. */
export async function deleteMemory(id: number): Promise<void> {
  await write("DELETE FROM memories WHERE id = $1", [id]);
}

/** The learner rewriting a line. The fact is what steers the prompts, so the
 *  edit is a replace of the fact text, not a new row — the date stays the
 *  original one, because that is when the coach learned it. */
export async function updateMemory(id: number, fact: string): Promise<void> {
  await write("UPDATE memories SET fact = $1 WHERE id = $2", [fact, id]);
}

/** The learner adding a line by hand. No source session — it was not learned in
 *  a conversation, it was told outright. Same shape as a learned fact, so it
 *  steers sessions identically.
 *
 *  Returns the rows affected: 1 when the line is new, 0 when it is already on
 *  file (UNIQUE(lang, fact) is the last word on "told twice"). The caller shows
 *  the difference — a silent no-op reads as a lost keystroke. */
export async function addMemory(lang: string, fact: string): Promise<number> {
  const r = await write("INSERT OR IGNORE INTO memories (lang, fact, source_session_id, created_at) VALUES ($1, $2, NULL, $3)", [
    lang,
    fact,
    Date.now(),
  ]);
  return r.rowsAffected;
}

/** The learner wiping the whole record for a language. Counts nothing here —
 *  the caller shows what is lost before this runs. */
export async function clearMemories(lang: string): Promise<void> {
  await write("DELETE FROM memories WHERE lang = $1", [lang]);
}

// ---- Phase 3: weekly coaching stats ----

export async function weekStats(
  lang: string,
  since: number,
): Promise<{ sessions: number; messages: number; wordsPracticed: number; vocabLearned: number; vocabReviewed: number; avgLevelScore: number | null }> {
  const db = await getDb();
  const one = async (sql: string, params: any[]) => (await db.select<{ n: number }[]>(sql, params))[0]?.n ?? 0;

  const sessions = await one(
    "SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1",
    [since],
  );
  const messages = await one(
    "SELECT COUNT(*) AS n FROM messages WHERE role = 'user' AND created_at >= $1",
    [since],
  );
  const vocabLearned = await one("SELECT COUNT(*) AS n FROM vocab WHERE lang = $1 AND created_at >= $2", [lang, since]);
  const vocabReviewed = await one("SELECT COUNT(*) AS n FROM review_log WHERE created_at >= $1", [since]);
  const wordsPracticed = await one(
    "SELECT COALESCE(SUM(words),0) AS n FROM session_metrics WHERE lang = $1 AND created_at >= $2",
    [lang, since],
  );
  const avgRows = await db.select<{ avg: number | null }[]>(
    "SELECT AVG(score) AS avg FROM session_metrics WHERE lang = $1 AND created_at >= $2",
    [lang, since],
  );
  const avg = avgRows[0]?.avg;
  return {
    sessions,
    messages,
    wordsPracticed,
    vocabLearned,
    vocabReviewed,
    avgLevelScore: avg == null ? null : Math.round(avg),
  };
}

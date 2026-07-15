import Database from "@tauri-apps/plugin-sql";
import { newCard, schedule, type Grade } from "./srs";
import { planMemory, type Memory, type MemoryWrite } from "./prompts";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = init();
  return dbPromise;
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
    -- learner as a Spanish learner, and switching language starts a fresh one.
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      fact TEXT NOT NULL,
      source_session_id INTEGER,   -- the conversation it was learned in; NULL if the DB row was gone
      created_at INTEGER NOT NULL,
      UNIQUE(lang, fact)           -- the same sentence twice is still one fact
    );
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
    lang = JSON.parse(localStorage.getItem("verba.settings") ?? "{}").targetLang ?? "";
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
  const db = await getDb();
  const r = await db.execute(
    "INSERT INTO sessions (scenario, started_at) VALUES ($1, $2)",
    [scenario, Date.now()],
  );
  return r.lastInsertId as number;
}

export async function addMessage(sessionId: number, role: string, content: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO messages (session_id, role, content, created_at) VALUES ($1, $2, $3, $4)",
    [sessionId, role, content, Date.now()],
  );
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
  const db = await getDb();
  await db.execute("UPDATE sessions SET summary = $1 WHERE id = $2", [summary, sessionId]);
}

export async function setTitle(sessionId: number, title: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sessions SET title = $1 WHERE id = $2", [title, sessionId]);
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
}

// Every read and write below is scoped to one language: a deck belongs to the
// language it was met in, and switching language must not resurface the old one.

export async function addVocab(
  lang: string,
  item: { term: string; translation: string; example: string },
): Promise<void> {
  const db = await getDb();
  // INSERT OR IGNORE keeps existing SRS progress if the term was already captured.
  await db.execute(
    `INSERT OR IGNORE INTO vocab (lang, term, translation, example, ease, interval, due, reps, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [lang, item.term, item.translation, item.example, newCard.ease, newCard.interval, Date.now(), newCard.reps, Date.now()],
  );
}

export async function dueVocab(lang: string, now = Date.now()): Promise<VocabRow[]> {
  const db = await getDb();
  return db.select<VocabRow[]>("SELECT * FROM vocab WHERE lang = $1 AND due <= $2 ORDER BY due ASC", [lang, now]);
}

export async function allVocab(lang: string): Promise<VocabRow[]> {
  const db = await getDb();
  return db.select<VocabRow[]>("SELECT * FROM vocab WHERE lang = $1 ORDER BY created_at DESC", [lang]);
}

export async function vocabCounts(lang: string, now = Date.now()): Promise<{ total: number; due: number }> {
  const db = await getDb();
  const total = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM vocab WHERE lang = $1", [lang]);
  const due = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM vocab WHERE lang = $1 AND due <= $2",
    [lang, now],
  );
  return { total: total[0]?.n ?? 0, due: due[0]?.n ?? 0 };
}

export async function reviewVocab(card: VocabRow, grade: Grade): Promise<void> {
  const db = await getDb();
  const next = schedule({ ease: card.ease, interval: card.interval, reps: card.reps }, grade, Date.now());
  await db.execute(
    "UPDATE vocab SET ease = $1, interval = $2, reps = $3, due = $4 WHERE id = $5",
    [next.ease, next.interval, next.reps, next.due, card.id],
  );
  // Log the review so weekly stats can count activity (no per-review timestamp on vocab).
  await db.execute("INSERT INTO review_log (created_at) VALUES ($1)", [Date.now()]);
}

// ---- reading sessions ----

/** `asked` is what the reader requested, not what came back — a reading history wants both. */
export async function saveReading(
  lang: string,
  title: string,
  text: unknown,
  asked: { length?: string; topic?: string; cefr?: string } = {},
): Promise<void> {
  const db = await getDb();
  await db.execute(
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
  const db = await getDb();
  await db.execute(
    "INSERT INTO listening_sessions (lang, title, piece, answers, accuracy, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [lang, title, JSON.stringify(piece), JSON.stringify(answers), accuracy, Date.now()],
  );
}

// ---- level signals ----

export async function saveLevelSignal(
  lang: string,
  sig: { estimate: string; confidence: string; rationale: string },
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO level_signals (lang, estimate, confidence, rationale, created_at) VALUES ($1, $2, $3, $4, $5)",
    [lang, sig.estimate, sig.confidence, sig.rationale, Date.now()],
  );
}

export async function latestLevelSignal(
  lang: string,
): Promise<{ estimate: string; confidence: string; rationale: string; created_at: number } | null> {
  const db = await getDb();
  const rows = await db.select<{ estimate: string; confidence: string; rationale: string; created_at: number }[]>(
    "SELECT estimate, confidence, rationale, created_at FROM level_signals WHERE lang = $1 ORDER BY created_at DESC LIMIT 1",
    [lang],
  );
  return rows[0] ?? null;
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
  const db = await getDb();
  await db.execute(
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
  const db = await getDb();
  await db.execute(
    `INSERT INTO daily_sessions (date, lang, plan, done, recap, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(date) DO UPDATE SET plan = excluded.plan, done = excluded.done, recap = excluded.recap`,
    [date, lang, JSON.stringify(plan), JSON.stringify(done), recap ? JSON.stringify(recap) : null, Date.now()],
  );
}

/** How many days the learner has shown up — the "Day 41" on the Today screen. */
export async function dayNumber(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM daily_sessions");
  return rows[0]?.n ?? 1;
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

// ---- long-term memory (Settings → User Memory) ----

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
  const db = await getDb();
  const plan = planMemory(await allMemories(lang), writes);

  for (const w of plan) {
    if (w.replaces != null)
      await db.execute("DELETE FROM memories WHERE id = $1 AND lang = $2", [w.replaces, lang]);
    // OR IGNORE, because UNIQUE(lang, fact) is the last word on "told twice": the
    // normalised check in planMemory catches the re-wordings, this catches the rest.
    await db.execute(
      "INSERT OR IGNORE INTO memories (lang, fact, source_session_id, created_at) VALUES ($1, $2, $3, $4)",
      [lang, w.fact, sessionId, Date.now()],
    );
  }
}

/** The learner striking a line out. Nothing else in the app deletes a memory. */
export async function deleteMemory(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM memories WHERE id = $1", [id]);
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

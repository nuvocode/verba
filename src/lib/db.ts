import Database from "@tauri-apps/plugin-sql";
import { newCard, schedule, type Grade } from "./srs";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = init();
  return dbPromise;
}

async function init(): Promise<Database> {
  const db = await Database.load("sqlite:speaksy.db");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      summary TEXT
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
      term TEXT NOT NULL UNIQUE,
      translation TEXT,
      example TEXT,
      ease REAL NOT NULL,
      interval INTEGER NOT NULL,
      due INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reading_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lang TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,        -- JSON ReadingText
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
  `);
  return db;
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

export async function setSummary(sessionId: number, summary: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE sessions SET summary = $1 WHERE id = $2", [summary, sessionId]);
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

export async function addVocab(item: { term: string; translation: string; example: string }): Promise<void> {
  const db = await getDb();
  // INSERT OR IGNORE keeps existing SRS progress if the term was already captured.
  await db.execute(
    `INSERT OR IGNORE INTO vocab (term, translation, example, ease, interval, due, reps, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [item.term, item.translation, item.example, newCard.ease, newCard.interval, Date.now(), newCard.reps, Date.now()],
  );
}

export async function dueVocab(now = Date.now()): Promise<VocabRow[]> {
  const db = await getDb();
  return db.select<VocabRow[]>("SELECT * FROM vocab WHERE due <= $1 ORDER BY due ASC", [now]);
}

export async function allVocab(): Promise<VocabRow[]> {
  const db = await getDb();
  return db.select<VocabRow[]>("SELECT * FROM vocab ORDER BY created_at DESC");
}

export async function vocabCounts(now = Date.now()): Promise<{ total: number; due: number }> {
  const db = await getDb();
  const total = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM vocab");
  const due = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM vocab WHERE due <= $1", [now]);
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

export async function saveReading(lang: string, title: string, text: unknown): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO reading_sessions (lang, title, text, created_at) VALUES ($1, $2, $3, $4)",
    [lang, title, JSON.stringify(text), Date.now()],
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
  m: { messages: number; words: number; uniqueWords: number; avgSentenceLen: number; corrections: number; deckSize: number },
  score: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO session_metrics (lang, messages, words, unique_words, avg_sentence_len, corrections, deck_size, score, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [lang, m.messages, m.words, m.uniqueWords, m.avgSentenceLen, m.corrections, m.deckSize, score, Date.now()],
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
  const vocabLearned = await one("SELECT COUNT(*) AS n FROM vocab WHERE created_at >= $1", [since]);
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

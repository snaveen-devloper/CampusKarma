'use strict';
const Database = require('better-sqlite3');
const path = require('path');

let _wrapper = null;

/**
 * Creates a Promise-based wrapper around a better-sqlite3 Database instance.
 * This makes the API compatible with the old async `sqlite` package so no
 * route files need to change.
 */
function createWrapper(db) {
  return {
    run(sql, ...args) {
      try {
        const info = db.prepare(sql).run(...args.flat());
        return Promise.resolve({ lastID: info.lastInsertRowid, changes: info.changes });
      } catch (e) {
        return Promise.reject(e);
      }
    },
    get(sql, ...args) {
      try {
        return Promise.resolve(db.prepare(sql).get(...args.flat()));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    all(sql, ...args) {
      try {
        return Promise.resolve(db.prepare(sql).all(...args.flat()));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    exec(sql) {
      try {
        db.exec(sql);
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    }
  };
}

function initDB() {
  if (_wrapper) return Promise.resolve(_wrapper);

  const db = new Database(path.join(__dirname, 'campuskarma.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      school TEXT NOT NULL,
      cls TEXT NOT NULL,
      kp INTEGER DEFAULT 100,
      xp INTEGER DEFAULT 20,
      streak INTEGER DEFAULT 0,
      last_active TEXT DEFAULT '',
      subjects TEXT DEFAULT '[]',
      level INTEGER DEFAULT 1,
      ratings TEXT DEFAULT '[]',
      sess_count INTEGER DEFAULT 0,
      strikes INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      is_new INTEGER DEFAULT 1,
      color TEXT DEFAULT '#10b981',
      pub_key TEXT DEFAULT '',
      teaching_score REAL DEFAULT 0,
      rep_score REAL DEFAULT 0,
      native_lang TEXT DEFAULT 'en',
      joined_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      from_uid TEXT NOT NULL,
      to_uid TEXT NOT NULL,
      subject TEXT NOT NULL,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      ts INTEGER NOT NULL,
      FOREIGN KEY(from_uid) REFERENCES users(uid),
      FOREIGN KEY(to_uid) REFERENCES users(uid)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      peer1 TEXT NOT NULL,
      peer2 TEXT NOT NULL,
      subject TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT DEFAULT 'upcoming',
      room_code TEXT NOT NULL,
      role1 TEXT DEFAULT 'teach',
      rated INTEGER DEFAULT 0,
      rating INTEGER DEFAULT 0,
      booked_at INTEGER NOT NULL,
      FOREIGN KEY(peer1) REFERENCES users(uid),
      FOREIGN KEY(peer2) REFERENCES users(uid)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender_uid TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      ts INTEGER NOT NULL,
      FOREIGN KEY(sender_uid) REFERENCES users(uid)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, ts);

    CREATE TABLE IF NOT EXISTS pub_keys (
      uid TEXT NOT NULL,
      peer_uid TEXT NOT NULL,
      pub_key TEXT NOT NULL,
      PRIMARY KEY(uid, peer_uid)
    );

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      correct_index INTEGER NOT NULL,
      asked_at INTEGER,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS quiz_answers (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      student_uid TEXT NOT NULL,
      answer_index INTEGER NOT NULL,
      is_correct INTEGER NOT NULL,
      answered_at INTEGER NOT NULL,
      FOREIGN KEY(question_id) REFERENCES quiz_questions(id),
      FOREIGN KEY(student_uid) REFERENCES users(uid)
    );

    CREATE TABLE IF NOT EXISTS ai_feedback (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      teacher_uid TEXT NOT NULL,
      student_uid TEXT NOT NULL,
      clarity_score REAL NOT NULL,
      engagement_score REAL NOT NULL,
      feedback_text TEXT NOT NULL,
      rep_delta REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      icon TEXT DEFAULT 'gift',
      description TEXT NOT NULL,
      sub TEXT DEFAULT '',
      amount INTEGER NOT NULL,
      type TEXT DEFAULT 'earn',
      date TEXT DEFAULT 'Today',
      ts INTEGER NOT NULL,
      FOREIGN KEY(uid) REFERENCES users(uid)
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      msg TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      from_uid TEXT NOT NULL,
      target_uid TEXT NOT NULL,
      reason TEXT NOT NULL,
      detail TEXT DEFAULT '',
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS boosts (
      uid TEXT NOT NULL,
      item_id TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      bought_at INTEGER NOT NULL,
      PRIMARY KEY(uid, item_id)
    );

    CREATE TABLE IF NOT EXISTS quests (
      uid TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      progress TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      author_uid TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_public INTEGER DEFAULT 0,
      forks INTEGER DEFAULT 0,
      ts INTEGER NOT NULL,
      FOREIGN KEY(author_uid) REFERENCES users(uid)
    );
  `);

  // Run migrations for columns added later — errors ignored if column already exists
  const migrations = [
    `ALTER TABLE users ADD COLUMN native_lang TEXT DEFAULT 'English'`,
    `ALTER TABLE users ADD COLUMN rep_score REAL DEFAULT 1.0`,
    `ALTER TABLE users ADD COLUMN teaching_score REAL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN pub_key TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN color TEXT DEFAULT '#10b981'`,
    `ALTER TABLE users ADD COLUMN strikes INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`,
    `ALTER TABLE sessions ADD COLUMN role1 TEXT DEFAULT 'teach'`,
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!e.message.includes('duplicate column')) console.error('Migration skipped:', e.message);
    }
  }

  _wrapper = createWrapper(db);
  return Promise.resolve(_wrapper);
}

module.exports = { initDB };

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// RenderでSQLiteを使う場合は、このdataフォルダをPersistent Diskに載せると
// 再デプロイ・再起動後もデータを残せます。
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "mako_match.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  birth_date TEXT NOT NULL DEFAULT '2000-01-01',
  gender TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  terms_agreed_at TEXT,
  privacy_agreed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS likes (
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (from_user_id, to_user_id),
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user1_id INTEGER NOT NULL,
  user2_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user1_id, user2_id),
  FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  reported_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);
`);

// 既存DBへの安全な追加（以前のバージョンから更新するため）
const columns = db.prepare("PRAGMA table_info(users)").all();
const has = name => columns.some(c => c.name === name);
if (!has("birth_date")) db.exec("ALTER TABLE users ADD COLUMN birth_date TEXT NOT NULL DEFAULT '2000-01-01'");
if (!has("gender")) db.exec("ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT ''");
if (!has("area")) db.exec("ALTER TABLE users ADD COLUMN area TEXT NOT NULL DEFAULT ''");
if (!has("bio")) db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
if (!has("terms_agreed_at")) db.exec("ALTER TABLE users ADD COLUMN terms_agreed_at TEXT");
if (!has("privacy_agreed_at")) db.exec("ALTER TABLE users ADD COLUMN privacy_agreed_at TEXT");

const reportColumns = db.prepare("PRAGMA table_info(reports)").all();
const reportHas = name => reportColumns.some(c => c.name === name);
if (!reportHas("status")) db.exec("ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open'");
if (!reportHas("admin_note")) db.exec("ALTER TABLE reports ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''");
if (!reportHas("resolved_at")) db.exec("ALTER TABLE reports ADD COLUMN resolved_at TEXT");

module.exports = db;

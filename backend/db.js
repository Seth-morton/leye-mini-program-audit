const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrate');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'leye.sqlite');
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  audience TEXT NOT NULL,
  price_text TEXT NOT NULL DEFAULT '费用咨询',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_name TEXT NOT NULL,
  guardian_name TEXT,
  phone TEXT NOT NULL,
  course_id INTEGER NOT NULL,
  preferred_date TEXT,
  preferred_time TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','confirmed','declined','completed')),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(course_id) REFERENCES courses(id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_status_created ON bookings(status, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_phone_created ON bookings(phone, created_at);
`);

runMigrations(db);

const n = db.prepare('SELECT COUNT(*) AS n FROM courses').get().n;
if (n === 0) {
  const insert = db.prepare(`INSERT INTO courses(name,category,description,audience,price_text,sort_order)
    VALUES(?,?,?,?,?,?)`);
  const seed = [
    ['声乐基础课','声乐','呼吸、发声、音准与音乐表现，循序建立科学发声基础。','零基础 / 少儿 / 成人','费用咨询',1],
    ['艺考声乐课','艺考','围绕艺考目标开展作品、技巧与舞台表现训练。','音乐艺考生','费用咨询',2],
    ['钢琴辅助课','钢琴','钢琴基础、视唱练耳与音乐素养辅助训练。','音乐学习者','费用咨询',3],
    ['成人声乐课','声乐','以兴趣、演唱技巧和音乐表达为重点。','成人兴趣','费用咨询',4]
  ];
  const tx = db.transaction(rows => rows.forEach(row => insert.run(...row)));
  tx(seed);
}
module.exports = db;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../migrate');

test('core migration creates teaching schema while retaining legacy tables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leye-migration-'));
  const db = new Database(path.join(dir, 'test.sqlite'));
  try {
    db.exec('CREATE TABLE courses(id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE bookings(id INTEGER PRIMARY KEY, student_name TEXT)');
    db.exec("INSERT INTO courses(name) VALUES('legacy course')");
    db.exec("INSERT INTO bookings(student_name) VALUES('legacy student')");
    runMigrations(db);
    assert.equal(db.prepare('SELECT name FROM courses').get().name, 'legacy course');
    assert.equal(db.prepare('SELECT student_name FROM bookings').get().student_name, 'legacy student');
    for (const table of ['families','students','lesson_series','lessons','orders','payments','entitlement_lots','entitlement_transactions','refunds','audit_logs']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

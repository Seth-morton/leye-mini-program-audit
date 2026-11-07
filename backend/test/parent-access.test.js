const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { runMigrations } = require('../migrate');
const { createParentRouter } = require('../routes/parent');

test('家长端越权与逐项权限对抗测试', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leye-parent-audit-'));
  const db = new Database(path.join(dir, 'test.sqlite'));
  runMigrations(db);

  const familyA = db.prepare("INSERT INTO families(name) VALUES('甲家庭')").run().lastInsertRowid;
  const familyB = db.prepare("INSERT INTO families(name) VALUES('乙家庭')").run().lastInsertRowid;
  const studentA = db.prepare("INSERT INTO students(family_id,name) VALUES(?,'甲家庭孩子')").run(familyA).lastInsertRowid;
  const studentB = db.prepare("INSERT INTO students(family_id,name) VALUES(?,'乙家庭孩子')").run(familyB).lastInsertRowid;
  const guardianA = db.prepare("INSERT INTO users(phone,display_name,role) VALUES('15550000001','甲家长','guardian')").run().lastInsertRowid;
  const guardianB = db.prepare("INSERT INTO users(phone,display_name,role) VALUES('15550000002','乙家长','guardian')").run().lastInsertRowid;

  db.prepare(`INSERT INTO student_guardians(student_id,user_id,status,can_view_schedule,can_view_finance,can_view_growth)
    VALUES(?,?,'approved',1,0,0)`).run(studentA, guardianA);
  db.prepare(`INSERT INTO student_guardians(student_id,user_id,status,can_view_schedule,can_view_finance,can_view_growth)
    VALUES(?,?,'approved',1,1,1)`).run(studentB, guardianB);

  const app = express();
  app.use((req, res, next) => {
    req.user = { id: Number(req.get('x-test-user-id')), role: 'guardian', displayName: '测试家长' };
    next();
  });
  app.use('/api/parent', createParentRouter(db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/parent';
  const get = (userId, route) => fetch(base + route, { headers: { 'x-test-user-id': String(userId) } });

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const ownStudents = await (await get(guardianA, '/students')).json();
  assert.deepEqual(ownStudents.map(x => x.id), [studentA], '家长只能看到自己已获授权的孩子');

  const foreignSchedule = await get(guardianA, '/students/' + studentB + '/schedule');
  assert.equal(foreignSchedule.status, 404, '不得通过猜测其他孩子 ID 读取课表');

  const noFinance = await get(guardianA, '/students/' + studentA + '/entitlements');
  assert.equal(noFinance.status, 404, '关闭财务权限后不得读取课时余额');

  const noGrowth = await get(guardianA, '/students/' + studentA + '/growth');
  assert.equal(noGrowth.status, 404, '关闭成长权限后不得读取成长记录');

  const allowedSchedule = await get(guardianA, '/students/' + studentA + '/schedule');
  assert.equal(allowedSchedule.status, 200, '有课表权限时可以查看自己的课表');
  assert.deepEqual(await allowedSchedule.json(), []);

  db.prepare('UPDATE student_guardians SET can_view_finance=1 WHERE student_id=? AND user_id=?').run(studentA, guardianA);
  const allowedFinance = await get(guardianA, '/students/' + studentA + '/entitlements');
  assert.equal(allowedFinance.status, 200, '负责人开放财务权限后才可以查看课时余额');
  assert.deepEqual(await allowedFinance.json(), []);

  db.prepare("UPDATE student_guardians SET status='revoked' WHERE student_id=? AND user_id=?").run(studentA, guardianA);
  const revokedAccess = await get(guardianA, '/students/' + studentA + '/schedule');
  assert.equal(revokedAccess.status, 404, '撤销监护人关联后应立即失去孩子数据访问权');
});

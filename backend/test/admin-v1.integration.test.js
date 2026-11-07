const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { runMigrations } = require('../migrate');
const { createAdminV1Router } = require('../routes/admin-v1');

test('管理端对抗演练：容量、课程模式、授课确认和线下退款状态', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leye-admin-audit-'));
  const db = new Database(path.join(dir, 'test.sqlite'));
  runMigrations(db);
  db.prepare("INSERT INTO families(name) VALUES('测试家庭')").run();
  const familyId = db.prepare('SELECT id FROM families').get().id;
  const addStudent = db.prepare("INSERT INTO students(family_id,name) VALUES(?,?)");
  const studentA = addStudent.run(familyId, '测试学员甲').lastInsertRowid;
  const studentB = addStudent.run(familyId, '测试学员乙').lastInsertRowid;
  const courseId = db.prepare("INSERT INTO courses_catalog(name,mode) VALUES('声乐小班','small_group')").run().lastInsertRowid;
  const teacherId = db.prepare("INSERT INTO teachers(name) VALUES('测试教师')").run().lastInsertRowid;
  const roomId = db.prepare("INSERT INTO rooms(name,capacity) VALUES('小教室',1)").run().lastInsertRowid;

  const app = express();
  app.use(express.json());
  app.use('/api/admin/v1', (req, res, next) => next(), createAdminV1Router(db));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/admin/v1';
  const call = (route, body) => fetch(base + route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const overCapacity = await call('/lessons', {
    courseId, teacherId, roomId, studentIds: [studentA, studentB], mode: 'small_group',
    startsAtUtc: '2030-01-01T16:00:00.000Z', endsAtUtc: '2030-01-01T17:00:00.000Z'
  });
  assert.equal(overCapacity.status, 409, '教室容量不足时必须拒绝排课');

  const wrongMode = await call('/lessons', {
    courseId, teacherId, roomId, studentIds: [studentA], mode: 'one_to_one',
    startsAtUtc: '2030-01-01T16:00:00.000Z', endsAtUtc: '2030-01-01T17:00:00.000Z'
  });
  assert.equal(wrongMode.status, 400, '排课模式必须与课程目录匹配');

  const scheduled = await call('/lessons', {
    courseId, teacherId, roomId, studentIds: [studentA], mode: 'small_group',
    startsAtUtc: '2030-01-01T16:00:00.000Z', endsAtUtc: '2030-01-01T17:00:00.000Z'
  });
  assert.equal(scheduled.status, 201);
  const lesson = await scheduled.json();
  const earlyConfirm = await call('/lessons/' + lesson.id + '/students/' + studentA + '/confirm', {});
  assert.equal(earlyConfirm.status, 409, '课程尚未结束不得确认实际授课');

  const orderId = db.prepare("INSERT INTO orders(student_id,status,total_cents,received_cents) VALUES(?,'paid',10000,10000)").run(studentA).lastInsertRowid;
  db.prepare("INSERT INTO order_items(order_id,course_id,product_name_snapshot,price_cents,paid_lessons,bonus_lessons) VALUES(?,?,?,?,?,?)")
    .run(orderId, courseId, '10节声乐课', 10000, 10, 0);
  const approved = await call('/orders/' + orderId + '/refund', {
    requestedCents: 10000, approvedCents: 10000, reason: '测试退款'
  });
  assert.equal(approved.status, 201);
  const refund = db.prepare('SELECT status,actual_refunded_cents,refunded_at FROM refunds WHERE order_id=?').get(orderId);
  assert.equal(refund.status, 'approved', '审批退款不能伪记为线下退款已到账');
  assert.equal(refund.actual_refunded_cents, 0);
  assert.equal(refund.refunded_at, null);

  const completed = await call('/orders/' + orderId + '/refund/complete', {
    actualRefundedCents: 9000, adjustmentReason: '线下实际退回金额少于批准金额'
  });
  assert.equal(completed.status, 200);
  const paidRefund = db.prepare('SELECT status,actual_refunded_cents FROM refunds WHERE order_id=?').get(orderId);
  assert.equal(paidRefund.status, 'paid');
  assert.equal(paidRefund.actual_refunded_cents, 9000);
});

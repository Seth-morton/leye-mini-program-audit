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
  const overlap = await call('/lessons', {
    courseId, teacherId, roomId, studentIds: [studentA], mode: 'small_group',
    startsAtUtc: '2030-01-01T16:30:00.000Z', endsAtUtc: '2030-01-01T17:30:00.000Z'
  });
  assert.equal(overlap.status, 409, '教师、教室或学员时间重叠时必须拒绝排课');
  const dayResponse = await fetch(base + '/lessons/day?date=2030-01-01');
  assert.equal(dayResponse.status, 200);
  const dayData = await dayResponse.json();
  assert.equal(dayData.timezone, 'America/Chicago');
  assert.ok(dayData.lessons.some(x => x.id === lesson.id), '每日工作台必须按芝加哥本地日期列出课次');

  const guardianId=db.prepare("INSERT INTO users(phone,display_name,role) VALUES('15555550123','测试家长','guardian')").run().lastInsertRowid;
  const membershipId=db.prepare("INSERT INTO family_members(family_id,user_id,status) VALUES(?,?,'pending')").run(familyId,guardianId).lastInsertRowid;
  const approval=await call('/family-members/'+membershipId+'/approve',{});
  assert.equal(approval.status,200,'负责人审核应成功');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_guardians WHERE user_id=? AND status=\'approved\'').get(guardianId).n,2,'审核后应关联该家庭全部现有学员');
  const permissions=await fetch(base+'/family-members/'+membershipId+'/permissions',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({canViewSchedule:true,canViewFinance:false,canViewGrowth:true})});
  assert.equal(permissions.status,200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM student_guardians WHERE user_id=? AND can_view_finance=1').get(guardianId).n,0,'关闭财务权限后，所有孩子都不应显示课时余额权限');
  const revoked=await call('/family-members/'+membershipId+'/revoke',{reason:'测试撤销'});
  assert.equal(revoked.status,200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM student_guardians WHERE user_id=? AND status='approved'").get(guardianId).n,0,'撤销家庭监护权后所有孩子访问都应撤销');

  const earlyConfirm = await call('/lessons/' + lesson.id + '/students/' + studentA + '/confirm', {});
  assert.equal(earlyConfirm.status, 409, '课程尚未结束不得确认实际授课');

  db.prepare("UPDATE lessons SET ends_at_utc='2020-01-01T17:00:00.000Z' WHERE id=?").run(lesson.id);
  const confirmed = await call('/lessons/' + lesson.id + '/students/' + studentA + '/confirm', {});
  assert.equal(confirmed.status, 200, '已结束的正常课次可以确认授课');
  const duplicateConfirm = await call('/lessons/' + lesson.id + '/students/' + studentA + '/confirm', {});
  assert.equal(duplicateConfirm.status, 409, '重复确认授课必须拒绝');
  db.prepare("UPDATE lessons SET status='cancelled' WHERE id=?").run(lesson.id);
  const cancelledConsume = await call('/lessons/' + lesson.id + '/students/' + studentA + '/consume', { quantity: 1 });
  assert.equal(cancelledConsume.status, 409, '已取消课次即使存在确认标记也不得消课');

  const leaveLessonResponse=await call('/lessons',{
    courseId,teacherId,roomId,studentIds:[studentB],mode:'small_group',
    startsAtUtc:'2030-01-02T16:00:00.000Z',endsAtUtc:'2030-01-02T17:00:00.000Z'
  });
  assert.equal(leaveLessonResponse.status,201);
  const leaveLesson=await leaveLessonResponse.json();
  const markLeave=await fetch(base+'/lessons/'+leaveLesson.id+'/students/'+studentB+'/attendance',{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:'student_leave'})
  });
  assert.equal(markLeave.status,200,'负责人应能记录学员请假');
  db.prepare("UPDATE lessons SET ends_at_utc='2020-01-02T17:00:00.000Z' WHERE id=?").run(leaveLesson.id);
  const confirmLeave=await call('/lessons/'+leaveLesson.id+'/students/'+studentB+'/confirm',{});
  assert.equal(confirmLeave.status,409,'请假学员不得被确认为实际授课');

  const cancelledLessonResponse=await call('/lessons',{
    courseId,teacherId,roomId,studentIds:[studentA],mode:'small_group',
    startsAtUtc:'2030-01-03T16:00:00.000Z',endsAtUtc:'2030-01-03T17:00:00.000Z'
  });
  assert.equal(cancelledLessonResponse.status,201);
  const cancelledLesson=await cancelledLessonResponse.json();
  const stopLesson=await fetch(base+'/lessons/'+cancelledLesson.id+'/status',{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:'studio_cancelled',reason:'工作室临时停课'})
  });
  assert.equal(stopLesson.status,200,'负责人应能记录工作室停课');
  const stopConsume=await call('/lessons/'+cancelledLesson.id+'/students/'+studentA+'/consume',{quantity:1});
  assert.equal(stopConsume.status,409,'工作室停课不得消课');

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
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status, 'paid', '线下实际退款前订单不能提前标记为已退款');
  const blockedPayment = await call('/orders/' + orderId + '/payments', { amountCents: 100, method: 'cash' });
  assert.equal(blockedPayment.status, 409, '退款处理中不能继续收款');

  const completed = await call('/orders/' + orderId + '/refund/complete', {
    actualRefundedCents: 9000, adjustmentReason: '线下实际退回金额少于批准金额'
  });
  assert.equal(completed.status, 200);
  const paidRefund = db.prepare('SELECT status,actual_refunded_cents FROM refunds WHERE order_id=?').get(orderId);
  assert.equal(paidRefund.status, 'paid');
  assert.equal(paidRefund.actual_refunded_cents, 9000);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(orderId).status, 'refunded');
});

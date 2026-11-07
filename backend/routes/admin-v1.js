const express = require('express');

function createAdminV1Router(db) {
  const router = express.Router();
  const audit = db.prepare(`INSERT INTO audit_logs(action,entity_type,entity_id,after_json,reason)
    VALUES(?,?,?,?,?)`);
  const record = (action, type, id, after, reason = '') =>
    audit.run(action, type, String(id), JSON.stringify(after), reason);

  router.get('/overview', (req, res) => {
    const count = table => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    res.json({
      families: count('families'), students: count('students'),
      teachers: count('teachers'), rooms: count('rooms'),
      lessons: count('lessons'), orders: count('orders')
    });
  });

  router.get('/families', (req, res) => {
    res.json(db.prepare(`SELECT f.*, COUNT(DISTINCT s.id) AS student_count
      FROM families f LEFT JOIN students s ON s.family_id=f.id
      GROUP BY f.id ORDER BY f.id DESC LIMIT 500`).all());
  });

  router.post('/families', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: '请填写家庭名称' });
    const result = db.prepare('INSERT INTO families(name,notes) VALUES(?,?)')
      .run(name, String(req.body?.notes || '').trim().slice(0, 1000));
    record('family.create', 'family', result.lastInsertRowid, { name });
    res.status(201).json({ id: result.lastInsertRowid, name });
  });

  router.get('/students', (req, res) => {
    const rows = db.prepare(`SELECT s.id,s.name,s.family_id AS familyId,f.name AS familyName,
      s.birth_date AS birthDate,s.status,s.notes,s.created_at AS createdAt
      FROM students s JOIN families f ON f.id=s.family_id
      ORDER BY s.id DESC LIMIT 1000`).all();
    res.json(rows);
  });

  router.post('/students', (req, res) => {
    const familyId = Number(req.body?.familyId);
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (!Number.isInteger(familyId) || familyId < 1 || !name)
      return res.status(400).json({ error: '家庭和学员姓名为必填项' });
    if (!db.prepare('SELECT id FROM families WHERE id=? AND status=?').get(familyId, 'active'))
      return res.status(404).json({ error: '家庭不存在或已归档' });
    const result = db.prepare('INSERT INTO students(family_id,name,birth_date,notes) VALUES(?,?,?,?)')
      .run(familyId, name, req.body?.birthDate || null, String(req.body?.notes || '').slice(0, 1000));
    record('student.create', 'student', result.lastInsertRowid, { familyId, name });
    res.status(201).json({ id: result.lastInsertRowid, familyId, name });
  });

  router.get('/teachers', (req, res) => res.json(db.prepare('SELECT * FROM teachers ORDER BY name').all()));
  router.post('/teachers', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: '请填写教师姓名' });
    const result = db.prepare('INSERT INTO teachers(name,phone,notes) VALUES(?,?,?)')
      .run(name, String(req.body?.phone || '').trim().slice(0, 30), String(req.body?.notes || '').slice(0, 1000));
    record('teacher.create', 'teacher', result.lastInsertRowid, { name });
    res.status(201).json({ id: result.lastInsertRowid, name });
  });

  router.get('/rooms', (req, res) => res.json(db.prepare('SELECT * FROM rooms ORDER BY name').all()));
  router.post('/rooms', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    const capacity = Number(req.body?.capacity || 1);
    if (!name || !Number.isInteger(capacity) || capacity < 1 || capacity > 100)
      return res.status(400).json({ error: '教室名称或容量无效' });
    try {
      const result = db.prepare('INSERT INTO rooms(name,capacity,notes) VALUES(?,?,?)')
        .run(name, capacity, String(req.body?.notes || '').slice(0, 1000));
      record('room.create', 'room', result.lastInsertRowid, { name, capacity });
      res.status(201).json({ id: result.lastInsertRowid, name, capacity });
    } catch (error) {
      if (String(error.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: '教室名称已存在' });
      throw error;
    }
  });

  router.get('/courses', (req, res) => res.json(db.prepare('SELECT * FROM courses_catalog ORDER BY id DESC').all()));
  router.post('/courses', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const mode = req.body?.mode;
    if (!name || !['one_to_one','small_group','collective','exam'].includes(mode))
      return res.status(400).json({ error: '课程名称或教学模式无效' });
    const result = db.prepare('INSERT INTO courses_catalog(name,category,mode,description) VALUES(?,?,?,?)')
      .run(name, String(req.body?.category || '声乐').slice(0, 40), mode, String(req.body?.description || '').slice(0, 1000));
    record('course.create', 'course', result.lastInsertRowid, { name, mode });
    res.status(201).json({ id: result.lastInsertRowid, name, mode });
  });

  router.post('/courses/:id/products', (req, res) => {
    const courseId = Number(req.params.id);
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const priceCents = Number(req.body?.priceCents);
    const paidLessons = Number(req.body?.paidLessons);
    const bonusLessons = Number(req.body?.bonusLessons || 0);
    const validityDays = req.body?.validityDays == null || req.body.validityDays === '' ? null : Number(req.body.validityDays);
    if (!db.prepare('SELECT id FROM courses_catalog WHERE id=?').get(courseId))
      return res.status(404).json({ error: '课程不存在' });
    if (!name || !Number.isSafeInteger(priceCents) || priceCents < 0 ||
        !Number.isInteger(paidLessons) || paidLessons < 0 ||
        !Number.isInteger(bonusLessons) || bonusLessons < 0 ||
        (validityDays !== null && (!Number.isInteger(validityDays) || validityDays < 1)))
      return res.status(400).json({ error: '商品价格、课时或有效期无效（金额单位为分）' });
    const result = db.prepare(`INSERT INTO course_products
      (course_id,name,price_cents,paid_lessons,bonus_lessons,validity_days) VALUES(?,?,?,?,?,?)`)
      .run(courseId, name, priceCents, paidLessons, bonusLessons, validityDays);
    record('course_product.create', 'course_product', result.lastInsertRowid, { courseId, name, priceCents, paidLessons, bonusLessons, validityDays });
    res.status(201).json({ id: result.lastInsertRowid });
  });

  router.post('/families/:id/guardian-requests', (req, res) => {
    const familyId = Number(req.params.id);
    const phone = String(req.body?.phone || '').trim();
    const displayName = String(req.body?.displayName || '').trim().slice(0, 80);
    if (!/^\\+?[0-9 -]{7,20}$/.test(phone)) return res.status(400).json({ error: '家长手机号格式无效' });
    const family = db.prepare('SELECT id FROM families WHERE id=?').get(familyId);
    if (!family) return res.status(404).json({ error: '家庭不存在' });
    const create = db.transaction(() => {
      let user = db.prepare('SELECT id FROM users WHERE phone=? AND role=?').get(phone, 'guardian');
      if (!user) {
        const id = db.prepare('INSERT INTO users(phone,display_name,role) VALUES(?,?,?)')
          .run(phone, displayName, 'guardian').lastInsertRowid;
        user = { id };
      }
      const result = db.prepare(`INSERT INTO family_members(family_id,user_id,relationship,status)
        VALUES(?,?,?,'pending') ON CONFLICT(family_id,user_id) DO UPDATE SET status='pending'`)
        .run(familyId, user.id, String(req.body?.relationship || 'guardian').slice(0, 30));
      return { userId: user.id, membershipId: result.lastInsertRowid };
    });
    const result = create();
    record('guardian.binding_request', 'family', familyId, { phone, userId: result.userId });
    res.status(201).json({ ...result, status: 'pending', message: '已建立待审核监护人关联；家长完成微信身份验证后方可开放查看' });
  });

  router.post('/family-members/:id/approve', (req, res) => {
    const id = Number(req.params.id);
    const member = db.prepare('SELECT id,family_id,user_id FROM family_members WHERE id=? AND status=?').get(id, 'pending');
    if (!member) return res.status(404).json({ error: '待审核关联不存在' });
    db.prepare(`UPDATE family_members SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);
    db.prepare(`INSERT OR IGNORE INTO student_guardians(student_id,user_id,status)
      SELECT id,?,'approved' FROM students WHERE family_id=?`).run(member.user_id, member.family_id);
    record('guardian.binding_approved', 'family_member', id, { familyId: member.family_id, userId: member.user_id });
    res.json({ ok: true });
  });

  return router;
}
module.exports = { createAdminV1Router };

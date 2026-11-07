require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('node:path');
const db = require('./db');
const { validateBooking } = require('./validation');
const { createAdminV1Router } = require('./routes/admin-v1');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
const allowed = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: allowed === '*' ? '*' : allowed.split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '20kb' }));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN || ADMIN_TOKEN === 'replace-with-a-long-random-secret-before-starting') {
    return res.status(503).json({ error: '管理后台尚未配置安全令牌' });
  }
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: '未授权' });
  next();
}

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/courses', (req, res) => {
  res.json(db.prepare('SELECT id,name,category,description,audience,price_text AS priceText FROM courses WHERE active=1 ORDER BY sort_order,id').all());
});
app.post('/api/bookings', (req, res) => {
  const result = validateBooking(req.body || {}, db);
  if (result.error) return res.status(400).json({ error: result.error });
  const b = result.value;
  const inserted = db.prepare(`INSERT INTO bookings
    (student_name,guardian_name,phone,course_id,preferred_date,preferred_time,note)
    VALUES(@studentName,@guardianName,@phone,@courseId,@preferredDate,@preferredTime,@note)`).run(b);
  res.status(201).json({ id: inserted.lastInsertRowid, status: 'pending', message: '预约意向已提交，工作室将联系您确认。' });
});

// 按手机号查询本人预约（演示用途：仅凭手机号即可查询，正式上线应改为登录后本人授权）
app.get('/api/bookings/search', (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) return res.status(400).json({ error: '请输入有效的手机号' });
  const rows = db.prepare(`SELECT b.id,b.student_name AS studentName,b.guardian_name AS guardianName,
    b.phone,c.name AS courseName,b.preferred_date AS preferredDate,b.preferred_time AS preferredTime,
    b.note,b.status,b.admin_note AS adminNote,
    strftime('%Y-%m-%d %H:%M', b.created_at, '+8 hours') AS createdAt
    FROM bookings b JOIN courses c ON c.id=b.course_id
    WHERE b.phone=? ORDER BY b.created_at DESC, b.id DESC`).all(phone);
  res.json(rows);
});

// 演示用：以预约编号 + 电话后四位查询。正式上线应改为登录后本人授权查询。
app.get('/api/bookings/:id', (req, res) => {
  const last4 = String(req.query.phoneLast4 || '');
  if (!/^\d{4}$/.test(last4)) return res.status(400).json({ error: '请输入联系电话后四位' });
  const row = db.prepare(`SELECT b.id,b.student_name AS studentName,b.course_id AS courseId,
    c.name AS courseName,b.preferred_date AS preferredDate,b.preferred_time AS preferredTime,
    b.status,strftime('%Y-%m-%d %H:%M', b.created_at, '+8 hours') AS createdAt
    FROM bookings b JOIN courses c ON c.id=b.course_id
    WHERE b.id=? AND substr(b.phone,-4)=?`).get(Number(req.params.id), last4);
  if (!row) return res.status(404).json({ error: '未找到预约记录' });
  res.json(row);
});

app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const status = req.query.status;
  const rows = status && ['pending','confirmed','declined','completed'].includes(status)
    ? db.prepare(`SELECT b.id,b.student_name AS studentName,b.guardian_name AS guardianName,b.phone,
      c.name AS courseName,b.preferred_date AS preferredDate,b.preferred_time AS preferredTime,
      b.note,b.status,b.admin_note AS adminNote,strftime('%Y-%m-%d %H:%M', b.created_at, '+8 hours') AS createdAt
      FROM bookings b JOIN courses c ON c.id=b.course_id WHERE b.status=? ORDER BY b.created_at DESC`).all(status)
    : db.prepare(`SELECT b.id,b.student_name AS studentName,b.guardian_name AS guardianName,b.phone,
      c.name AS courseName,b.preferred_date AS preferredDate,b.preferred_time AS preferredTime,
      b.note,b.status,b.admin_note AS adminNote,strftime('%Y-%m-%d %H:%M', b.created_at, '+8 hours') AS createdAt
      FROM bookings b JOIN courses c ON c.id=b.course_id ORDER BY b.created_at DESC LIMIT 300`).all();
  res.json(rows);
});
app.patch('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const status = req.body && req.body.status;
  const adminNote = typeof (req.body && req.body.adminNote) === 'string' ? req.body.adminNote.trim().slice(0,500) : '';
  if (!['pending','confirmed','declined','completed'].includes(status)) return res.status(400).json({ error: '无效状态' });
  const result = db.prepare('UPDATE bookings SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(status, adminNote, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: '预约不存在' });
  res.json({ ok: true });
});

app.use('/api/admin/v1', requireAdmin, createAdminV1Router(db));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});
const port = Number(process.env.PORT || 3000);
if (require.main === module) app.listen(port, () => console.log(`乐也 API listening on :${port}`));
module.exports = app;

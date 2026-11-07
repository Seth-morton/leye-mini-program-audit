require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('node:path');
const db = require('./db');
const { createAdminV1Router } = require('./routes/admin-v1');
const { createAuthRouter } = require('./routes/auth');
const { createParentRouter } = require('./routes/parent');
const { requireAuth, requireGuardian } = require('./middleware/auth');

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
// 历史预约数据只保留给负责人查询；新版本不再开放家长自主预约或手机号查询。
app.post('/api/bookings', (req,res) => res.status(410).json({error:'当前版本不支持线上预约，请联系乐也工作室'}));
app.get('/api/bookings/search', (req,res) => res.status(410).json({error:'历史预约查询已关闭，请联系工作室核实'}));
app.get('/api/bookings/:id', (req,res) => res.status(410).json({error:'历史预约查询已关闭，请联系工作室核实'}));

app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const status = req.query.status;
  const rows = status && ['pending','confirmed','declined','completed'].includes(status)
    ? db.prepare(`SELECT b.id,b.student_name AS studentName,b.guardian_name AS guardianName,b.phone,
      c.name AS courseName,b.preferred_date AS preferredDate,b.preferred_time AS preferredTime,
      b.note,b.status,b.admin_note AS adminNote,strftime('%Y-%m-%d %H:%M', b.created_at) AS createdAt
      FROM bookings b JOIN courses c ON c.id=b.course_id WHERE b.status=? ORDER BY b.created_at DESC`).all(status)
    : db.prepare(`SELECT b.id,b.student_name AS studentName,b.guardian_name AS guardianName,b.phone,
      c.name AS courseName,b.preferred_date AS preferredDate,b.preferred_time AS preferredTime,
      b.note,b.status,b.admin_note AS adminNote,strftime('%Y-%m-%d %H:%M', b.created_at) AS createdAt
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

app.use('/api/auth', createAuthRouter(db));
app.use('/api/parent', requireAuth(db), requireGuardian, createParentRouter(db));
app.use('/api/admin/v1', requireAdmin, createAdminV1Router(db));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});
const port = Number(process.env.PORT || 3000);
if (require.main === module) app.listen(port, () => console.log(`乐也 API listening on :${port}`));
module.exports = app;

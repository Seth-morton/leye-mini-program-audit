const crypto = require('node:crypto');

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requireAuth(db) {
  return (req, res, next) => {
    const token = String(req.get('authorization') || '').replace(/^Bearer\\s+/i, '');
    if (!token) return res.status(401).json({ error: '请先登录' });
    const session = db.prepare(`SELECT u.id,u.openid,u.phone,u.display_name AS displayName,u.role,u.status
      FROM auth_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).get(tokenHash(token), new Date().toISOString());
    if (!session || session.status !== 'active') return res.status(401).json({ error: '登录已过期，请重新登录' });
    req.user = session;
    next();
  };
}

function requireGuardian(req, res, next) {
  if (!req.user || req.user.role !== 'guardian') return res.status(403).json({ error: '当前账号无家长端权限' });
  next();
}

module.exports = { tokenHash, requireAuth, requireGuardian };

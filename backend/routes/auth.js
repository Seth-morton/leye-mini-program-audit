const express = require('express');
const crypto = require('node:crypto');
const { tokenHash, requireAuth } = require('../middleware/auth');

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/wechat-login', async (req, res) => {
    const code = String(req.body?.code || '').trim();
    const appId = process.env.WX_APP_ID;
    const appSecret = process.env.WX_APP_SECRET;
    if (!appId || !appSecret) return res.status(503).json({ error: '服务端尚未配置微信登录参数' });
    if (!code) return res.status(400).json({ error: '缺少微信登录 code' });
    try {
      const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
      url.search = new URLSearchParams({ appid:appId,secret:appSecret,js_code:code,grant_type:'authorization_code' });
      const wx = await fetch(url);
      const result = await wx.json();
      if (!wx.ok || result.errcode || !result.openid) return res.status(401).json({ error:'微信登录验证失败', code:result.errcode || 'WECHAT_LOGIN_FAILED' });
      let user = db.prepare('SELECT * FROM users WHERE openid=?').get(result.openid);
      if (!user) {
        const id = db.prepare("INSERT INTO users(openid,role,display_name) VALUES(?,'guardian','家长')").run(result.openid).lastInsertRowid;
        user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      }
      if (user.status !== 'active') return res.status(403).json({ error:'账号已停用，请联系工作室' });
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(new Date().toISOString());
      db.prepare('INSERT INTO auth_sessions(user_id,token_hash,expires_at) VALUES(?,?,?)')
        .run(user.id,tokenHash(token),expiresAt);
      res.json({ token,expiresAt,user:{id:user.id,displayName:user.display_name,role:user.role,phone:user.phone} });
    } catch (error) {
      res.status(502).json({ error:'暂时无法连接微信登录服务' });
    }
  });

  router.post('/phone', requireAuth(db), async (req, res) => {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error:'缺少微信手机号授权 code' });
    const appId = process.env.WX_APP_ID;
    const appSecret = process.env.WX_APP_SECRET;
    if (!appId || !appSecret) return res.status(503).json({ error:'服务端尚未配置微信手机号验证参数' });
    try {
      const tokenUrl = new URL('https://api.weixin.qq.com/cgi-bin/token');
      tokenUrl.search = new URLSearchParams({ grant_type:'client_credential',appid:appId,secret:appSecret });
      const tokenResponse = await fetch(tokenUrl);
      const access = await tokenResponse.json();
      if (!tokenResponse.ok || access.errcode || !access.access_token) return res.status(502).json({ error:'获取微信服务凭证失败' });
      const phoneResponse = await fetch('https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token='+encodeURIComponent(access.access_token),{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})
      });
      const phoneResult = await phoneResponse.json();
      const phoneInfo = phoneResult.phone_info || {};
      const phone = phoneInfo.countryCode === '86' ? phoneInfo.purePhoneNumber : (phoneInfo.countryCode && phoneInfo.purePhoneNumber ? '+'+phoneInfo.countryCode+phoneInfo.purePhoneNumber : phoneInfo.phoneNumber);
      if (!phoneResponse.ok || phoneResult.errcode || !phone) return res.status(400).json({ error:'微信手机号验证失败' });
      const current = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
      const existing = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
      if (existing && existing.id !== current.id) {
        if (existing.role !== 'guardian' || (existing.openid && existing.openid !== current.openid))
          return res.status(409).json({ error:'该手机号已关联其他账号，请联系负责人处理' });
        const merge = db.transaction(() => {
          db.prepare('UPDATE users SET openid=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(current.openid,existing.id);
          db.prepare('INSERT OR IGNORE INTO family_members(family_id,user_id,relationship,can_view_schedule,can_view_finance,can_view_growth,status,reviewed_by,reviewed_at) SELECT family_id,?,relationship,can_view_schedule,can_view_finance,can_view_growth,status,reviewed_by,reviewed_at FROM family_members WHERE user_id=?').run(existing.id,current.id);
          db.prepare('DELETE FROM family_members WHERE user_id=?').run(current.id);
          db.prepare('INSERT OR IGNORE INTO student_guardians(student_id,user_id,can_view_schedule,can_view_finance,can_view_growth,status,approved_by,approved_at) SELECT student_id,?,can_view_schedule,can_view_finance,can_view_growth,status,approved_by,approved_at FROM student_guardians WHERE user_id=?').run(existing.id,current.id);
          db.prepare('DELETE FROM student_guardians WHERE user_id=?').run(current.id);
          db.prepare('UPDATE auth_sessions SET user_id=? WHERE user_id=?').run(existing.id,current.id);
          db.prepare('DELETE FROM users WHERE id=?').run(current.id);
        });
        merge();
        res.json({ ok:true,phone,linkedExistingGuardian:true });
      } else {
        db.prepare('UPDATE users SET phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(phone,current.id);
        res.json({ ok:true,phone,linkedExistingGuardian:false });
      }
    } catch (error) {
      res.status(502).json({ error:'手机号验证服务暂不可用' });
    }
  });

  router.post('/logout', requireAuth(db), (req,res) => {
    const token = String(req.get('authorization') || '').replace(/^Bearer\\s+/i,'');
    db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(token));
    res.json({ ok:true });
  });
  return router;
}
module.exports = { createAuthRouter };

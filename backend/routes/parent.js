const express = require('express');
const { balanceForLot } = require('../domain/ledger');
const { utcToLocalDateTime } = require('../domain/time');

function createParentRouter(db) {
  const router = express.Router();

  router.use((req,res,next)=>{ req.parentUserId=req.user.id; next(); });

  function requireStudent(req,res,permission) {
    const row = db.prepare(`SELECT s.id,s.name,s.family_id FROM students s
      JOIN student_guardians sg ON sg.student_id=s.id
      WHERE s.id=? AND sg.user_id=? AND sg.status='approved' AND sg.${permission}=1 AND s.status='active'`)
      .get(Number(req.params.studentId),req.parentUserId);
    return row;
  }

  router.get('/profile',(req,res)=>res.json({id:req.user.id,displayName:req.user.displayName,phone:req.user.phone}));
  router.get('/students',(req,res)=>{
    const rows=db.prepare(`SELECT s.id,s.name,s.family_id AS familyId,sg.can_view_schedule AS canViewSchedule,
      sg.can_view_finance AS canViewFinance,sg.can_view_growth AS canViewGrowth
      FROM students s JOIN student_guardians sg ON sg.student_id=s.id
      WHERE sg.user_id=? AND sg.status='approved' AND s.status='active' ORDER BY s.name`).all(req.parentUserId);
    res.json(rows);
  });

  router.get('/students/:studentId/schedule',(req,res)=>{
    const student=requireStudent(req,res,'can_view_schedule');
    if(!student)return res.status(404).json({error:'未找到有权查看的学员'});
    const from=String(req.query.from||new Date().toISOString());
    const to=String(req.query.to||new Date(Date.now()+60*24*60*60*1000).toISOString());
    if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)<=Date.parse(from))return res.status(400).json({error:'时间范围无效'});
    const rows=db.prepare(`SELECT l.id,l.starts_at_utc AS startsAtUtc,l.ends_at_utc AS endsAtUtc,l.timezone,
      l.status,c.name AS courseName,t.name AS teacherName,r.name AS roomName,ls.attendance_status AS attendanceStatus
      FROM lesson_students ls JOIN lessons l ON l.id=ls.lesson_id
      JOIN courses_catalog c ON c.id=l.course_id JOIN teachers t ON t.id=l.teacher_id JOIN rooms r ON r.id=l.room_id
      WHERE ls.student_id=? AND l.starts_at_utc>=? AND l.starts_at_utc<? ORDER BY l.starts_at_utc`).all(student.id,from,to);
    res.json(rows.map(row=>({...row,startsAtLocal:utcToLocalDateTime(row.startsAtUtc),endsAtLocal:utcToLocalDateTime(row.endsAtUtc)})));
  });

  router.get('/students/:studentId/entitlements',(req,res)=>{
    const student=requireStudent(req,res,'can_view_finance');
    if(!student)return res.status(404).json({error:'未找到有权查看的学员'});
    const lots=db.prepare(`SELECT el.*,c.name AS course_name FROM entitlement_lots el
      JOIN courses_catalog c ON c.id=el.course_id WHERE el.student_id=? ORDER BY el.id DESC`).all(student.id);
    const result=lots.map(lot=>{
      const rows=db.prepare('SELECT * FROM entitlement_transactions WHERE lot_id=? ORDER BY id').all(lot.id);
      const balance=balanceForLot(rows);
      return {id:lot.id,courseName:lot.course_name,paidRemaining:balance.paid,bonusRemaining:balance.bonus,
        totalRemaining:balance.paid+balance.bonus,expiresOn:lot.expires_on,status:lot.status};
    });
    res.json(result);
  });

  router.get('/students/:studentId/growth',(req,res)=>{
    const student=requireStudent(req,res,'can_view_growth');
    if(!student)return res.status(404).json({error:'未找到有权查看的学员'});
    const rows=db.prepare(`SELECT id,lesson_id AS lessonId,parent_summary AS summary,
      practice_tasks AS practiceTasks,published_at AS publishedAt,created_at AS createdAt
      FROM lesson_notes WHERE student_id=? AND status='published' ORDER BY published_at DESC LIMIT 200`).all(student.id);
    res.json(rows);
  });

  router.get('/notifications',(req,res)=>{
    res.json(db.prepare('SELECT id,type,title,body,payload_json AS payload,read_at AS readAt,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.parentUserId));
  });
  router.post('/notifications/:id/read',(req,res)=>{
    const result=db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(Number(req.params.id),req.parentUserId);
    if(!result.changes)return res.status(404).json({error:'通知不存在'});
    res.json({ok:true});
  });
  return router;
}
module.exports={createParentRouter};

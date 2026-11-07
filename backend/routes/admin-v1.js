const express = require('express');
const { localToUtc, utcToLocalDate, addLocalDays, weekdayOf, TIME_ZONE } = require('../domain/time');

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


  router.get('/products', (req,res) => {
    res.json(db.prepare(`SELECT p.*,c.name AS course_name FROM course_products p JOIN courses_catalog c ON c.id=p.course_id ORDER BY p.id DESC`).all());
  });
  router.get('/orders', (req,res) => {
    res.json(db.prepare(`SELECT o.*,s.name AS student_name FROM orders o JOIN students s ON s.id=o.student_id ORDER BY o.id DESC LIMIT 500`).all());
  });
  router.get('/family-members', (req,res) => {
    const status=String(req.query.status||'pending');
    if(!['pending','approved','revoked'].includes(status))return res.status(400).json({error:'状态无效'});
    res.json(db.prepare(`SELECT fm.id,fm.family_id AS familyId,f.name AS familyName,fm.user_id AS userId,u.phone,u.display_name AS displayName,fm.relationship,fm.can_view_schedule AS canViewSchedule,fm.can_view_finance AS canViewFinance,fm.can_view_growth AS canViewGrowth,fm.status
      FROM family_members fm JOIN families f ON f.id=fm.family_id JOIN users u ON u.id=fm.user_id
      WHERE fm.status=? ORDER BY fm.id DESC`).all(status));
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
    const result = db.transaction(() => {
      const studentId = db.prepare('INSERT INTO students(family_id,name,birth_date,notes) VALUES(?,?,?,?)')
        .run(familyId, name, req.body?.birthDate || null, String(req.body?.notes || '').slice(0, 1000)).lastInsertRowid;
      db.prepare("INSERT OR IGNORE INTO student_guardians(student_id,user_id,status,can_view_schedule,can_view_finance,can_view_growth) SELECT ?,user_id,'approved',can_view_schedule,can_view_finance,can_view_growth FROM family_members WHERE family_id=? AND status='approved'").run(studentId,familyId);
      return studentId;
    })();
    record('student.create', 'student', result, { familyId, name });
    res.status(201).json({ id: result, familyId, name });
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
    const phone = String(req.body?.phone || '').trim().replace(/[\s()-]/g,'');
    const displayName = String(req.body?.displayName || '').trim().slice(0, 80);
    if (!/^\+?[0-9]{7,20}$/.test(phone)) return res.status(400).json({ error: '家长手机号格式无效' });
    const family = db.prepare('SELECT id FROM families WHERE id=?').get(familyId);
    if (!family) return res.status(404).json({ error: '家庭不存在' });
    const existingUser = db.prepare('SELECT id,role FROM users WHERE phone=?').get(phone);
    if (existingUser && existingUser.role !== 'guardian') return res.status(409).json({error:'该手机号已关联非家长账号，请先核实账号归属'});
    const create = db.transaction(() => {
      let user = existingUser;
      if (!user) {
        const id = db.prepare('INSERT INTO users(phone,display_name,role) VALUES(?,?,?)')
          .run(phone, displayName, 'guardian').lastInsertRowid;
        user = { id };
      }
      const result = db.prepare(`INSERT INTO family_members(family_id,user_id,relationship,can_view_schedule,can_view_finance,can_view_growth,status)
        VALUES(?,?,?,?,?,?,'pending') ON CONFLICT(family_id,user_id) DO UPDATE SET status='pending',can_view_schedule=excluded.can_view_schedule,can_view_finance=excluded.can_view_finance,can_view_growth=excluded.can_view_growth`)
        .run(familyId, user.id, String(req.body?.relationship || 'guardian').slice(0, 30), req.body?.canViewSchedule === false ? 0 : 1, req.body?.canViewFinance === false ? 0 : 1, req.body?.canViewGrowth === false ? 0 : 1);
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
    db.transaction(()=>{
      db.prepare(`UPDATE family_members SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);
      db.prepare(`INSERT INTO student_guardians(student_id,user_id,status,can_view_schedule,can_view_finance,can_view_growth)
        SELECT s.id,fm.user_id,'approved',fm.can_view_schedule,fm.can_view_finance,fm.can_view_growth
        FROM students s JOIN family_members fm ON fm.family_id=s.family_id WHERE fm.id=?
        ON CONFLICT(student_id,user_id) DO UPDATE SET status='approved',can_view_schedule=excluded.can_view_schedule,can_view_finance=excluded.can_view_finance,can_view_growth=excluded.can_view_growth`).run(id);
      record('guardian.binding_approved', 'family_member', id, { familyId: member.family_id, userId: member.user_id });
    })();
    res.json({ ok: true });
  });



  router.patch('/family-members/:id/permissions',(req,res)=>{
    const id=Number(req.params.id);
    const member=db.prepare('SELECT id,family_id,user_id,status FROM family_members WHERE id=?').get(id);
    if(!member)return res.status(404).json({error:'监护人关联不存在'});
    if(member.status!=='approved')return res.status(409).json({error:'只有已审核关联可以调整权限'});
    const keys=['canViewSchedule','canViewFinance','canViewGrowth'];
    if(keys.some(k=>typeof req.body?.[k]!=='boolean'))return res.status(400).json({error:'必须明确提交课表、课时财务、成长记录三项权限'});
    const values=keys.map(k=>req.body[k]?1:0);
    db.transaction(()=>{
      db.prepare('UPDATE family_members SET can_view_schedule=?,can_view_finance=?,can_view_growth=? WHERE id=?').run(...values,id);
      db.prepare('UPDATE student_guardians SET can_view_schedule=?,can_view_finance=?,can_view_growth=? WHERE user_id=? AND student_id IN (SELECT id FROM students WHERE family_id=?)')
        .run(...values,member.user_id,member.family_id);
      record('guardian.permissions_updated','family_member',id,{canViewSchedule:!!values[0],canViewFinance:!!values[1],canViewGrowth:!!values[2]});
    })();
    res.json({ok:true,permissions:{canViewSchedule:!!values[0],canViewFinance:!!values[1],canViewGrowth:!!values[2]}});
  });

  router.post('/family-members/:id/revoke',(req,res)=>{
    const id=Number(req.params.id);
    const member=db.prepare('SELECT id,family_id,user_id,status FROM family_members WHERE id=?').get(id);
    if(!member)return res.status(404).json({error:'监护人关联不存在'});
    if(member.status==='revoked')return res.status(409).json({error:'该监护人关联已经撤销'});
    const reason=String(req.body?.reason||'').trim().slice(0,500);
    if(!reason)return res.status(400).json({error:'撤销授权必须填写原因'});
    db.transaction(()=>{
      db.prepare("UPDATE family_members SET status='revoked',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      db.prepare("UPDATE student_guardians SET status='revoked' WHERE user_id=? AND student_id IN (SELECT id FROM students WHERE family_id=?)").run(member.user_id,member.family_id);
      record('guardian.binding_revoked','family_member',id,{familyId:member.family_id,userId:member.user_id},reason);
    })();
    res.json({ok:true});
  });

  function buildSeriesLessons(series, studentIds, fromDate, count) {
    let date = fromDate;
    while (weekdayOf(date) !== series.weekday) date = addLocalDays(date,1);
    const occurrences = [];
    for (let i=0;i<count;i++) {
      if (series.ends_on && date > series.ends_on) break;
      const startsAtUtc = localToUtc(date,series.start_time,TIME_ZONE);
      const endsAtUtc = new Date(Date.parse(startsAtUtc)+series.duration_minutes*60000).toISOString();
      const overlap = db.prepare(`SELECT l.id FROM lessons l WHERE l.status IN ('scheduled','rescheduled')
        AND l.starts_at_utc < ? AND l.ends_at_utc > ?
        AND (l.teacher_id=? OR l.room_id=? OR EXISTS(
          SELECT 1 FROM lesson_students ls WHERE ls.lesson_id=l.id AND ls.student_id IN (${studentIds.map(()=>'?').join(',')})
        )) LIMIT 1`).get(endsAtUtc,startsAtUtc,series.teacher_id,series.room_id,...studentIds);
      if (overlap) throw Object.assign(new Error(`排课冲突：${date}，冲突课次 #${overlap.id}`),{status:409});
      occurrences.push({date,startsAtUtc,endsAtUtc});
      date = addLocalDays(date,7);
    }
    return occurrences;
  }

  router.post('/lesson-series', (req,res) => {
    const courseId=Number(req.body?.courseId),teacherId=Number(req.body?.teacherId),roomId=Number(req.body?.roomId);
    const studentIds=Array.isArray(req.body?.studentIds)?[...new Set(req.body.studentIds.map(Number))]:[];
    const weekday=Number(req.body?.weekday),startTime=String(req.body?.startTime||''),duration=Number(req.body?.durationMinutes);
    const startsOn=String(req.body?.startsOn||''),endsOn=req.body?.endsOn?String(req.body.endsOn):null,mode=req.body?.mode;
    if (![courseId,teacherId,roomId].every(x=>Number.isInteger(x)&&x>0)||!studentIds.length||
        studentIds.some(x=>!Number.isInteger(x)||x<1)||!Number.isInteger(weekday)||weekday<0||weekday>6||
        !Number.isInteger(duration)||duration<10||duration>360||!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)||
        !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)||(endsOn&&!/^\d{4}-\d{2}-\d{2}$/.test(endsOn))||
        (endsOn&&endsOn<startsOn)||!['one_to_one','small_group','collective','exam'].includes(mode))
      return res.status(400).json({error:'固定排课参数无效'});
    if(mode==='one_to_one'&&studentIds.length!==1)return res.status(400).json({error:'一对一课程只能安排一名学员'});
    const refs=db.prepare('SELECT (SELECT mode FROM courses_catalog WHERE id=? AND active=1) AS courseMode,(SELECT COUNT(*) FROM teachers WHERE id=? AND active=1) AS t,(SELECT capacity FROM rooms WHERE id=? AND active=1) AS capacity').get(courseId,teacherId,roomId);
    if(!refs.courseMode||!refs.t||!refs.capacity)return res.status(400).json({error:'课程、教师或教室不可用'});
    if(refs.courseMode!==mode)return res.status(400).json({error:'排课教学模式必须与课程目录设置一致'});
    if(studentIds.length>refs.capacity)return res.status(409).json({error:'学员人数（'+studentIds.length+'）超过教室容量（'+refs.capacity+'）'});
    const students=db.prepare(`SELECT COUNT(*) AS n FROM students WHERE id IN (${studentIds.map(()=>'?').join(',')}) AND status='active'`).get(...studentIds).n;
    if(students!==studentIds.length)return res.status(400).json({error:'学员不存在或不可用'});
    try{
      const result=db.transaction(()=>{
        const seriesId=db.prepare(`INSERT INTO lesson_series(student_id,class_name,course_id,teacher_id,room_id,mode,weekday,start_time,duration_minutes,starts_on,ends_on)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(studentIds.length===1?studentIds[0]:null,String(req.body?.className||'').slice(0,80)||null,courseId,teacherId,roomId,mode,weekday,startTime,duration,startsOn,endsOn).lastInsertRowid;
        const series={weekday,start_time:startTime,duration_minutes:duration,teacher_id:teacherId,room_id:roomId,ends_on:endsOn};
        const today=utcToLocalDate(new Date().toISOString(),TIME_ZONE);
        const generationStart=startsOn<today?today:startsOn;
        if(endsOn&&endsOn<generationStart)throw Object.assign(new Error('结束日期早于可生成的未来日期'),{status:400});
        const occurrences=buildSeriesLessons(series,studentIds,generationStart,12);
        if(!occurrences.length)throw Object.assign(new Error('当前日期范围内没有可生成的课次'),{status:400});
        const addLesson=db.prepare(`INSERT INTO lessons(series_id,course_id,teacher_id,room_id,mode,starts_at_utc,ends_at_utc,timezone)
          VALUES(?,?,?,?,?,?,?,?)`);
        const addStudent=db.prepare('INSERT INTO lesson_students(lesson_id,student_id) VALUES(?,?)');
        const ids=[];
        for(const item of occurrences){
          const overlap=db.prepare(`SELECT l.id FROM lessons l
            WHERE l.status IN ('scheduled','rescheduled') AND l.starts_at_utc < ? AND l.ends_at_utc > ?
            AND (l.teacher_id=? OR l.room_id=? OR EXISTS(
              SELECT 1 FROM lesson_students ls WHERE ls.lesson_id=l.id AND ls.student_id IN (${studentIds.map(()=>'?').join(',')})
            )) LIMIT 1`).get(item.endsAtUtc,item.startsAtUtc,teacherId,roomId,...studentIds);
          if(overlap)throw Object.assign(new Error('固定排课与已有课次冲突，冲突课次 ID：'+overlap.id),{status:409});
          const lessonId=addLesson.run(seriesId,courseId,teacherId,roomId,mode,item.startsAtUtc,item.endsAtUtc,TIME_ZONE).lastInsertRowid;
          studentIds.forEach(studentId=>addStudent.run(lessonId,studentId));
          ids.push(lessonId);
        }
        record('lesson_series.create','lesson_series',seriesId,{studentIds,occurrences:occurrences.length,startsOn,endsOn});
        return {seriesId,lessonIds:ids,generated:ids.length,timezone:TIME_ZONE};
      })();
      res.status(201).json(result);
    }catch(error){res.status(error.status||400).json({error:error.message||'固定排课创建失败'});}
  });

  router.post('/lesson-series/:id/extend', (req,res) => {
    const seriesId=Number(req.params.id);
    try{
      const result=db.transaction(()=>{
        const series=db.prepare('SELECT * FROM lesson_series WHERE id=? AND status=?').get(seriesId,'active');
        if(!series)throw Object.assign(new Error('固定排课不存在或已停用'),{status:404});
        const last=db.prepare('SELECT MAX(starts_at_utc) AS last FROM lessons WHERE series_id=?').get(seriesId).last;
        const fromDate=last?addLocalDays(utcToLocalDate(last,TIME_ZONE),1):series.starts_on;
        const students=series.student_id?[series.student_id]:db.prepare('SELECT student_id FROM lesson_students ls JOIN lessons l ON l.id=ls.lesson_id WHERE l.series_id=? GROUP BY student_id').all(seriesId).map(x=>x.student_id);
        if(!students.length)throw new Error('固定排课尚未配置学员');
        const occurrences=buildSeriesLessons(series,students,fromDate,12);
        const addLesson=db.prepare(`INSERT INTO lessons(series_id,course_id,teacher_id,room_id,mode,starts_at_utc,ends_at_utc,timezone)
          VALUES(?,?,?,?,?,?,?,?)`);
        const addStudent=db.prepare('INSERT INTO lesson_students(lesson_id,student_id) VALUES(?,?)');
        const ids=[];
        for(const item of occurrences){
          const overlap=db.prepare(`SELECT l.id FROM lessons l
            WHERE l.status IN ('scheduled','rescheduled') AND l.starts_at_utc < ? AND l.ends_at_utc > ?
            AND (l.teacher_id=? OR l.room_id=? OR EXISTS(
              SELECT 1 FROM lesson_students ls WHERE ls.lesson_id=l.id AND ls.student_id IN (${students.map(()=>'?').join(',')})
            )) LIMIT 1`).get(item.endsAtUtc,item.startsAtUtc,series.teacher_id,series.room_id,...students);
          if(overlap)throw Object.assign(new Error('滚动补课与已有课次冲突，冲突课次 ID：'+overlap.id),{status:409});
          const lessonId=addLesson.run(seriesId,series.course_id,series.teacher_id,series.room_id,series.mode,item.startsAtUtc,item.endsAtUtc,TIME_ZONE).lastInsertRowid;
          students.forEach(studentId=>addStudent.run(lessonId,studentId));
          ids.push(lessonId);
        }
        record('lesson_series.extend','lesson_series',seriesId,{generated:ids.length,fromDate});
        return {seriesId,lessonIds:ids,generated:ids.length,timezone:TIME_ZONE};
      })();
      res.json(result);
    }catch(error){res.status(error.status||409).json({error:error.message||'续排失败'});}
  });

  router.patch('/lessons/:lessonId/students/:studentId/attendance',(req,res)=>{
    const lessonId=Number(req.params.lessonId),studentId=Number(req.params.studentId);
    const status=String(req.body?.status||'');
    if(!['pending','student_absent','student_leave'].includes(status))return res.status(400).json({error:'考勤状态无效'});
    try{
      const result=db.transaction(()=>{
        const lesson=db.prepare("SELECT status FROM lessons WHERE id=?").get(lessonId);
        if(!lesson)throw Object.assign(new Error('课次不存在'),{status:404});
        if(!['scheduled','rescheduled'].includes(lesson.status))throw Object.assign(new Error('已关闭课次不能修改考勤'),{status:409});
        const row=db.prepare('SELECT attendance_status FROM lesson_students WHERE lesson_id=? AND student_id=?').get(lessonId,studentId);
        if(!row)throw Object.assign(new Error('课次学员记录不存在'),{status:404});
        const consumed=db.prepare("SELECT COUNT(*) AS n FROM entitlement_transactions WHERE lesson_id=? AND student_id=? AND transaction_type IN ('consume_paid','consume_bonus')").get(lessonId,studentId).n;
        if(consumed)throw Object.assign(new Error('该学员已有消课流水，不能直接改写考勤；请走课时冲正更正流程'),{status:409});
        db.prepare('UPDATE lesson_students SET attendance_status=?,teacher_confirmed=0,actual_teacher_id=NULL,confirmed_at=NULL WHERE lesson_id=? AND student_id=?').run(status,lessonId,studentId);
        record('lesson.attendance_updated','lesson_student',lessonId+':'+studentId,{status});
        return {ok:true,status};
      })();
      res.json(result);
    }catch(error){res.status(error.status||500).json({error:error.message||'考勤更新失败'});}
  });

  router.patch('/lessons/:lessonId/status',(req,res)=>{
    const lessonId=Number(req.params.lessonId),status=String(req.body?.status||''),reason=String(req.body?.reason||'').trim().slice(0,500);
    if(!['teacher_unavailable','studio_cancelled'].includes(status)||!reason)return res.status(400).json({error:'停课状态和原因必填'});
    try{
      const result=db.transaction(()=>{
        const lesson=db.prepare('SELECT status FROM lessons WHERE id=?').get(lessonId);
        if(!lesson)throw Object.assign(new Error('课次不存在'),{status:404});
        if(!['scheduled','rescheduled'].includes(lesson.status))throw Object.assign(new Error('该课次已关闭，不能再次停课'),{status:409});
        const consumed=db.prepare("SELECT COUNT(*) AS n FROM entitlement_transactions WHERE lesson_id=? AND transaction_type IN ('consume_paid','consume_bonus')").get(lessonId).n;
        if(consumed)throw Object.assign(new Error('该课次已有消课流水，必须先完成课时冲正更正'),{status:409});
        const attendance=status==='teacher_unavailable'?'teacher_unavailable':'studio_cancelled';
        db.prepare('UPDATE lessons SET status=? WHERE id=?').run(status,lessonId);
        db.prepare('UPDATE lesson_students SET attendance_status=?,teacher_confirmed=0,actual_teacher_id=NULL,confirmed_at=NULL WHERE lesson_id=?').run(attendance,lessonId);
        record('lesson.status_changed','lesson',lessonId,{status,reason},reason);
        return {ok:true,status,reason,noAutomaticConsumption:true};
      })();
      res.json(result);
    }catch(error){res.status(error.status||500).json({error:error.message||'课次状态更新失败'});}
  });

  router.get('/growth-notes',(req,res)=>{
    const status=String(req.query.status||'all');
    if(!['all','draft','pending_review','published'].includes(status))return res.status(400).json({error:'成长记录状态无效'});
    const where=status==='all'?'':'WHERE n.status=?';
    const rows=db.prepare(`SELECT n.id,n.lesson_id AS lessonId,n.student_id AS studentId,s.name AS studentName,
      l.starts_at_utc AS lessonStartsAtUtc,n.internal_note AS internalNote,n.parent_summary AS parentSummary,
      n.practice_tasks AS practiceTasks,n.status,n.published_at AS publishedAt,n.created_at AS createdAt
      FROM lesson_notes n JOIN students s ON s.id=n.student_id JOIN lessons l ON l.id=n.lesson_id
      ${where} ORDER BY n.id DESC LIMIT 300`).all(...(status==='all'?[]:[status]));
    res.json(rows);
  });

  router.post('/lessons/:lessonId/students/:studentId/growth-notes',(req,res)=>{
    const lessonId=Number(req.params.lessonId),studentId=Number(req.params.studentId);
    const internalNote=String(req.body?.internalNote||'').trim().slice(0,4000);
    const parentSummary=String(req.body?.parentSummary||'').trim().slice(0,4000);
    const practiceTasks=String(req.body?.practiceTasks||'').trim().slice(0,4000);
    if(!internalNote&&!parentSummary&&!practiceTasks)return res.status(400).json({error:'至少填写一项课堂记录、家长反馈或练习任务'});
    const relation=db.prepare('SELECT l.id,l.status,ls.student_id FROM lessons l JOIN lesson_students ls ON ls.lesson_id=l.id WHERE l.id=? AND ls.student_id=?').get(lessonId,studentId);
    if(!relation)return res.status(404).json({error:'课次或该课次学员不存在'});
    if(!['scheduled','rescheduled','completed','archived'].includes(relation.status))return res.status(409).json({error:'停课课次不能创建成长记录'});
    const id=db.prepare("INSERT INTO lesson_notes(lesson_id,student_id,internal_note,parent_summary,practice_tasks,status) VALUES(?,?,?,?,?,'draft')")
      .run(lessonId,studentId,internalNote,parentSummary,practiceTasks).lastInsertRowid;
    record('growth_note.created','lesson_note',id,{lessonId,studentId,status:'draft'});
    res.status(201).json({id,status:'draft'});
  });

  router.patch('/growth-notes/:id',(req,res)=>{
    const id=Number(req.params.id);
    const current=db.prepare('SELECT * FROM lesson_notes WHERE id=?').get(id);
    if(!current)return res.status(404).json({error:'成长记录不存在'});
    if(current.status==='published')return res.status(409).json({error:'已发布记录不能直接覆盖；请使用更正流程保留历史'});
    const internalNote=String(req.body?.internalNote??current.internal_note).trim().slice(0,4000);
    const parentSummary=String(req.body?.parentSummary??current.parent_summary).trim().slice(0,4000);
    const practiceTasks=String(req.body?.practiceTasks??current.practice_tasks).trim().slice(0,4000);
    const status=String(req.body?.status||current.status);
    if(!['draft','pending_review'].includes(status))return res.status(400).json({error:'只能保存草稿或提交审核'});
    db.prepare('UPDATE lesson_notes SET internal_note=?,parent_summary=?,practice_tasks=?,status=? WHERE id=?')
      .run(internalNote,parentSummary,practiceTasks,status,id);
    record('growth_note.updated','lesson_note',id,{status,internalNote,parentSummary,practiceTasks});
    res.json({ok:true,id,status});
  });

  router.post('/growth-notes/:id/publish',(req,res)=>{
    const id=Number(req.params.id);
    const note=db.prepare('SELECT * FROM lesson_notes WHERE id=?').get(id);
    if(!note)return res.status(404).json({error:'成长记录不存在'});
    if(note.status==='published')return res.status(409).json({error:'该成长记录已经发布'});
    if(!note.parent_summary.trim()&&!note.practice_tasks.trim())return res.status(400).json({error:'发布前必须填写家长可见的课堂反馈或练习任务'});
    const publishedAt=new Date().toISOString();
    db.transaction(()=>{
      db.prepare("UPDATE lesson_notes SET status='published',published_at=? WHERE id=?").run(publishedAt,id);
      const guardians=db.prepare("SELECT sg.user_id FROM student_guardians sg WHERE sg.student_id=? AND sg.status='approved' AND sg.can_view_growth=1").all(note.student_id);
      const title='新的成长记录';
      const body=note.parent_summary.trim()||'老师发布了新的练习任务，请查看孩子的成长记录。';
      const payload=JSON.stringify({studentId:note.student_id,growthNoteId:id});
      const insert=db.prepare("INSERT INTO notifications(user_id,type,title,body,payload_json) VALUES(?,'growth_note_published',?,?,?)");
      guardians.forEach(g=>insert.run(g.user_id,title,body,payload));
      record('growth_note.published','lesson_note',id,{status:'published',guardianNotifications:guardians.length});
    })();
    res.json({ok:true,id,status:'published',notificationsCreated:db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type='growth_note_published' AND json_extract(payload_json,'$.growthNoteId')=?").get(id).n});
  });

  router.get('/lessons/day', (req,res) => {
    const date=String(req.query.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'请提供芝加哥本地日期 YYYY-MM-DD'});
    try {
      const from=localToUtc(date,'00:00',TIME_ZONE);
      const next=addLocalDays(date,1);
      const to=localToUtc(next,'00:00',TIME_ZONE);
      const rows=db.prepare(`SELECT l.id,l.status,l.mode,l.starts_at_utc,l.ends_at_utc,
        t.name AS teacher_name,r.name AS room_name,c.name AS course_name,
        ls.student_id,s.name AS student_name,ls.attendance_status,ls.teacher_confirmed,
        COALESCE((SELECT SUM(et.quantity) FROM entitlement_transactions et
          WHERE et.lesson_id=l.id AND et.student_id=ls.student_id
          AND et.transaction_type IN ('consume_paid','consume_bonus')),0) AS consumed_quantity,
        ls.actual_teacher_id,at.name AS actual_teacher_name
        FROM lessons l JOIN teachers t ON t.id=l.teacher_id
        JOIN rooms r ON r.id=l.room_id JOIN courses_catalog c ON c.id=l.course_id
        JOIN lesson_students ls ON ls.lesson_id=l.id JOIN students s ON s.id=ls.student_id
        LEFT JOIN teachers at ON at.id=ls.actual_teacher_id
        WHERE l.starts_at_utc>=? AND l.starts_at_utc<? ORDER BY l.starts_at_utc,l.id,s.name`).all(from,to);
      res.json({date,timezone:TIME_ZONE,lessons:rows});
    } catch(error) {res.status(400).json({error:error.message||'日期转换失败'});}
  });

  router.get('/lessons', (req, res) => {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(to) <= Date.parse(from))
      return res.status(400).json({ error: '请提供有效的 from / to UTC 时间范围' });
    const rows = db.prepare(`SELECT l.*,t.name AS teacher_name,r.name AS room_name,c.name AS course_name,
      GROUP_CONCAT(s.name, '、') AS student_names
      FROM lessons l JOIN teachers t ON t.id=l.teacher_id JOIN rooms r ON r.id=l.room_id
      JOIN courses_catalog c ON c.id=l.course_id
      LEFT JOIN lesson_students ls ON ls.lesson_id=l.id LEFT JOIN students s ON s.id=ls.student_id
      WHERE l.starts_at_utc >= ? AND l.starts_at_utc < ?
      GROUP BY l.id ORDER BY l.starts_at_utc`).all(from, to);
    res.json(rows);
  });

  router.post('/lessons', (req, res) => {
    const courseId = Number(req.body?.courseId);
    const teacherId = Number(req.body?.teacherId);
    const roomId = Number(req.body?.roomId);
    const studentIds = Array.isArray(req.body?.studentIds) ? [...new Set(req.body.studentIds.map(Number))] : [];
    const start = String(req.body?.startsAtUtc || '');
    const end = String(req.body?.endsAtUtc || '');
    const mode = req.body?.mode;
    if (![courseId,teacherId,roomId].every(x => Number.isInteger(x) && x > 0) ||
        !studentIds.length || studentIds.some(x => !Number.isInteger(x) || x < 1) ||
        !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start) ||
        !['one_to_one','small_group','collective','exam'].includes(mode))
      return res.status(400).json({ error: '课程、教师、教室、学员、时间或教学模式无效' });
    const exists = db.prepare('SELECT (SELECT mode FROM courses_catalog WHERE id=? AND active=1) AS courseMode,(SELECT COUNT(*) FROM teachers WHERE id=? AND active=1) AS t,(SELECT capacity FROM rooms WHERE id=? AND active=1) AS capacity').get(courseId,teacherId,roomId);
    if (!exists.courseMode || !exists.t || !exists.capacity) return res.status(400).json({ error: '课程、教师或教室不存在/不可用' });
    if (exists.courseMode !== mode) return res.status(400).json({ error: '排课教学模式必须与课程目录设置一致' });
    if (studentIds.length > exists.capacity) return res.status(409).json({ error: '学员人数（'+studentIds.length+'）超过教室容量（'+exists.capacity+'）' });
    const studentCount = db.prepare(`SELECT COUNT(*) AS n FROM students WHERE id IN (${studentIds.map(() => '?').join(',')}) AND status='active'`).get(...studentIds).n;
    if (studentCount !== studentIds.length) return res.status(400).json({ error: '学员不存在或不可用' });
    if (mode === 'one_to_one' && studentIds.length !== 1) return res.status(400).json({ error: '一对一课程只能安排一名学员' });
    const overlap = db.prepare(`SELECT l.id FROM lessons l
      WHERE l.status IN ('scheduled','rescheduled') AND l.starts_at_utc < ? AND l.ends_at_utc > ?
      AND (l.teacher_id=? OR l.room_id=? OR EXISTS(
        SELECT 1 FROM lesson_students ls WHERE ls.lesson_id=l.id AND ls.student_id IN (${studentIds.map(() => '?').join(',')})
      )) LIMIT 1`).get(end,start,teacherId,roomId,...studentIds);
    if (overlap) return res.status(409).json({ error: '教师、教室或学员时间冲突', conflictingLessonId: overlap.id });
    const create = db.transaction(() => {
      const lessonId = db.prepare(`INSERT INTO lessons(course_id,teacher_id,room_id,mode,starts_at_utc,ends_at_utc)
        VALUES(?,?,?,?,?,?)`).run(courseId,teacherId,roomId,mode,start,end).lastInsertRowid;
      const insert = db.prepare('INSERT INTO lesson_students(lesson_id,student_id) VALUES(?,?)');
      studentIds.forEach(studentId => insert.run(lessonId,studentId));
      record('lesson.create','lesson',lessonId,{courseId,teacherId,roomId,studentIds,start,end,mode});
      return lessonId;
    });
    res.status(201).json({ id:create(), status:'scheduled' });
  });

  router.post('/lessons/:lessonId/students/:studentId/confirm', (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const studentId = Number(req.params.studentId);
    const lesson = db.prepare('SELECT teacher_id,status,ends_at_utc FROM lessons WHERE id=?').get(lessonId);
    if (!lesson) return res.status(404).json({error:'课次不存在'});
    if (!['scheduled','rescheduled'].includes(lesson.status)) return res.status(409).json({error:'已取消、归档或完成的课次不能再次确认授课'});
    if (Date.parse(lesson.ends_at_utc) > Date.now()) return res.status(409).json({error:'课程尚未结束，不能确认实际完成授课'});
    const studentLesson=db.prepare('SELECT teacher_confirmed,attendance_status FROM lesson_students WHERE lesson_id=? AND student_id=?').get(lessonId,studentId);
    if(!studentLesson)return res.status(404).json({error:'课次学员记录不存在'});
    if(studentLesson.teacher_confirmed)return res.status(409).json({error:'该学员已确认实际授课；如需更正请走负责人更正流程'});
    if(!['pending','present'].includes(studentLesson.attendance_status))return res.status(409).json({error:'该学员已标记请假或缺勤，不能确认实际授课'});
    const actualTeacherId = Number(req.body?.actualTeacherId || lesson.teacher_id);
    if (!db.prepare('SELECT id FROM teachers WHERE id=? AND active=1').get(actualTeacherId))
      return res.status(400).json({error:'实际授课教师不存在或不可用'});
    const result = db.prepare(`UPDATE lesson_students SET attendance_status='present',
      teacher_confirmed=1,actual_teacher_id=?,confirmed_at=CURRENT_TIMESTAMP WHERE lesson_id=? AND student_id=? AND teacher_confirmed=0`).run(actualTeacherId,lessonId,studentId);
    if (!result.changes) return res.status(404).json({ error: '课次学员记录不存在' });
    record('lesson.confirmed','lesson_student',lessonId+':'+studentId,{attendanceStatus:'present',teacherConfirmed:true,actualTeacherId});
    res.json({ ok:true, teacherConfirmed:true });
  });

  router.post('/lessons/:lessonId/students/:studentId/consume', (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const studentId = Number(req.params.studentId);
    const quantity = Number(req.body?.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
      return res.status(400).json({ error: '消课数量必须为 1–10 的整数' });
    try {
      const consume = db.transaction(() => {
        const attendance = db.prepare(`SELECT ls.teacher_confirmed,ls.attendance_status,l.course_id,l.status AS lesson_status,l.ends_at_utc
          FROM lesson_students ls JOIN lessons l ON l.id=ls.lesson_id
          WHERE ls.lesson_id=? AND ls.student_id=?`).get(lessonId,studentId);
        if (!attendance) throw Object.assign(new Error('课次学员记录不存在'),{status:404});
        if (!['scheduled','rescheduled'].includes(attendance.lesson_status))
          throw Object.assign(new Error('已取消或已关闭的课次不能消课'),{status:409});
        if (Date.parse(attendance.ends_at_utc)>Date.now())
          throw Object.assign(new Error('课程尚未结束，不能消课'),{status:409});
        if (!attendance.teacher_confirmed || attendance.attendance_status !== 'present')
          throw Object.assign(new Error('必须先确认实际完成授课，才能消课'),{status:409});
        const prior = db.prepare(`SELECT COUNT(*) AS n FROM entitlement_transactions c
          WHERE c.lesson_id=? AND c.student_id=? AND c.transaction_type IN ('consume_paid','consume_bonus')
          AND NOT EXISTS (SELECT 1 FROM entitlement_transactions r
            WHERE r.transaction_type='reverse' AND r.reference_transaction_id=c.id
            GROUP BY r.reference_transaction_id HAVING SUM(r.quantity)>=c.quantity)`).get(lessonId,studentId).n;
        if (prior) throw Object.assign(new Error('该课次仍存在有效消课流水，禁止重复操作'),{status:409});
        const localToday=utcToLocalDate(new Date().toISOString(),TIME_ZONE);
        const lots = db.prepare(`SELECT * FROM entitlement_lots WHERE student_id=? AND course_id=?
          AND status='active' AND (expires_on IS NULL OR expires_on>=?) ORDER BY id`).all(studentId,attendance.course_id,localToday);
        const { balanceForLot } = require('../domain/ledger');
        const entries = lots.map(lot => {
          const rows = db.prepare('SELECT * FROM entitlement_transactions WHERE lot_id=? ORDER BY id').all(lot.id);
          return { lot, balance:balanceForLot(rows) };
        });
        const total = entries.reduce((sum,x)=>sum+x.balance.bonus+x.balance.paid,0);
        if (total < quantity) throw Object.assign(new Error('可用课时不足，不能消课'),{status:409});
        let remaining = quantity;
        const insert = db.prepare(`INSERT INTO entitlement_transactions
          (lot_id,student_id,lesson_id,transaction_type,bucket,quantity,note)
          VALUES(?,?,?,?,?,?,?)`);
        for (const item of entries) {
          const use = Math.min(remaining,item.balance.bonus);
          if (use) { insert.run(item.lot.id,studentId,lessonId,'consume_bonus','bonus',use,'实际授课消课'); remaining-=use; }
        }
        for (const item of entries) {
          const current = balanceForLot(db.prepare('SELECT * FROM entitlement_transactions WHERE lot_id=? ORDER BY id').all(item.lot.id));
          const use = Math.min(remaining,current.paid);
          if (use) { insert.run(item.lot.id,studentId,lessonId,'consume_paid','paid',use,'实际授课消课'); remaining-=use; }
          if (!remaining) break;
        }
        const unconsumed = db.prepare(`SELECT COUNT(*) AS n FROM lesson_students ls WHERE ls.lesson_id=? AND NOT EXISTS (SELECT 1 FROM entitlement_transactions et WHERE et.lesson_id=ls.lesson_id AND et.student_id=ls.student_id AND et.transaction_type IN ('consume_paid','consume_bonus'))`).get(lessonId).n;
        if (!unconsumed) db.prepare("UPDATE lessons SET status='completed' WHERE id=?").run(lessonId);
        record('lesson.consume','lesson',lessonId,{studentId,quantity,lessonCompleted:!unconsumed});
        return { consumed:quantity, lessonCompleted:!unconsumed };
      });
      res.json(consume());
    } catch (error) { res.status(error.status || 500).json({ error:error.message || '消课失败' }); }
  });


  function activateOrder(orderId, actorId = null) {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!order) throw new Error('订单不存在');
    if (order.early_activation && db.prepare('SELECT COUNT(*) AS n FROM entitlement_lots WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=?)').get(orderId).n) return;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
    for (const item of items) {
      const startsOn = utcToLocalDate(new Date().toISOString(),TIME_ZONE);
      const expiry = item.validity_days ? addLocalDays(startsOn,item.validity_days) : null;
      const lotId = db.prepare(`INSERT INTO entitlement_lots
        (student_id,order_item_id,course_id,paid_lessons,bonus_lessons,starts_on,expires_on)
        VALUES(?,?,?,?,?,?,?)`).run(order.student_id,item.id,item.course_id,item.paid_lessons,item.bonus_lessons,startsOn,expiry).lastInsertRowid;
      const grant = db.prepare(`INSERT INTO entitlement_transactions
        (lot_id,student_id,transaction_type,bucket,quantity,note,actor_user_id,idempotency_key)
        VALUES(?,?,?,?,?,?,?,?)`);
      if (item.paid_lessons) grant.run(lotId,order.student_id,'grant_paid','paid',item.paid_lessons,'订单开通',actorId,`order-${orderId}-item-${item.id}-paid`);
      if (item.bonus_lessons) grant.run(lotId,order.student_id,'grant_bonus','bonus',item.bonus_lessons,'订单赠送课时',actorId,`order-${orderId}-item-${item.id}-bonus`);
    }
  }

  router.post('/orders', (req, res) => {
    const studentId = Number(req.body?.studentId);
    const productId = Number(req.body?.productId);
    const product = db.prepare(`SELECT p.*,c.id AS course_id,c.name AS course_name
      FROM course_products p JOIN courses_catalog c ON c.id=p.course_id
      WHERE p.id=? AND p.active=1`).get(productId);
    if (!Number.isInteger(studentId) || !db.prepare('SELECT id FROM students WHERE id=? AND status=?').get(studentId,'active'))
      return res.status(404).json({ error:'学员不存在或不可用' });
    if (!product) return res.status(404).json({ error:'课程商品不存在或已停用' });
    const create = db.transaction(() => {
      const orderId = db.prepare('INSERT INTO orders(student_id,total_cents) VALUES(?,?)').run(studentId,product.price_cents).lastInsertRowid;
      const itemId = db.prepare(`INSERT INTO order_items
        (order_id,course_id,product_id,product_name_snapshot,price_cents,paid_lessons,bonus_lessons,validity_days)
        VALUES(?,?,?,?,?,?,?,?)`).run(orderId,product.course_id,product.id,product.name,product.price_cents,product.paid_lessons,product.bonus_lessons,product.validity_days).lastInsertRowid;
      record('order.create','order',orderId,{studentId,productId,itemId,totalCents:product.price_cents});
      return orderId;
    });
    res.status(201).json({ id:create(),status:'unpaid',totalCents:product.price_cents });
  });

  router.post('/orders/:id/payments', (req, res) => {
    const orderId = Number(req.params.id);
    const amount = Number(req.body?.amountCents);
    const method = String(req.body?.method || '').trim().slice(0,40);
    if (!Number.isSafeInteger(amount) || amount < 1 || !method) return res.status(400).json({error:'收款金额（分）和方式必填'});
    try {
      const result = db.transaction(() => {
        const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
        if (!order || ['refunded','cancelled'].includes(order.status)) throw Object.assign(new Error('订单不存在或已关闭'),{status:404});
        if (db.prepare('SELECT id FROM refunds WHERE order_id=?').get(orderId)) throw Object.assign(new Error('该订单正在退款处理中，不能继续收款'),{status:409});
        if (order.received_cents + amount > order.total_cents) throw Object.assign(new Error('收款金额超过订单未收金额'),{status:409});
        db.prepare('INSERT INTO payments(order_id,amount_cents,method,received_at,reference_note) VALUES(?,?,?,?,?)')
          .run(orderId,amount,method,req.body?.receivedAt || new Date().toISOString(),String(req.body?.note || '').slice(0,500));
        const received = order.received_cents + amount;
        const status = received === order.total_cents ? 'paid' : 'partially_paid';
        db.prepare('UPDATE orders SET received_cents=?,status=? WHERE id=?').run(received,status,orderId);
        const activated = db.prepare('SELECT COUNT(*) AS n FROM entitlement_lots WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=?)').get(orderId).n;
        if (status === 'paid' && !activated) activateOrder(orderId);
        record('order.payment','order',orderId,{amountCents:amount,receivedCents:received,status});
        return {receivedCents:received,unpaidCents:order.total_cents-received,status,activated:status==='paid' && !activated};
      })();
      res.status(201).json(result);
    } catch(error) { res.status(error.status || 500).json({error:error.message || '登记收款失败'}); }
  });

  router.post('/orders/:id/early-activate', (req, res) => {
    const orderId = Number(req.params.id);
    const reason = String(req.body?.reason || '').trim().slice(0,500);
    if (!reason) return res.status(400).json({error:'提前开通必须填写授权原因'});
    try {
      const result = db.transaction(() => {
        const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
        if (!order || order.status === 'refunded' || order.status === 'cancelled') throw Object.assign(new Error('订单不可开通'),{status:404});
        if (db.prepare('SELECT id FROM refunds WHERE order_id=?').get(orderId)) throw Object.assign(new Error('该订单正在退款处理中，不能开通课时'),{status:409});
        const exists = db.prepare('SELECT COUNT(*) AS n FROM entitlement_lots WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=?)').get(orderId).n;
        if (exists) throw Object.assign(new Error('该订单课时权益已经开通'),{status:409});
        db.prepare(`UPDATE orders SET early_activation=1,early_activation_reason=?,activated_at=CURRENT_TIMESTAMP WHERE id=?`).run(reason,orderId);
        activateOrder(orderId);
        record('order.early_activate','order',orderId,{reason,receivedCents:order.received_cents});
        return {ok:true,earlyActivation:true,receivedCents:order.received_cents,unpaidCents:order.total_cents-order.received_cents};
      })();
      res.json(result);
    } catch(error) { res.status(error.status || 500).json({error:error.message || '提前开通失败'}); }
  });

  router.post('/orders/:id/refund', (req, res) => {
    const orderId = Number(req.params.id);
    const reason = String(req.body?.reason || '').trim().slice(0,500);
    const approvedCents = Number(req.body?.approvedCents);
    const requestedCents = req.body && req.body.requestedCents != null ? Number(req.body.requestedCents) : approvedCents;
    const adjustmentReason = String(req.body && req.body.adjustmentReason || '').trim().slice(0,500);
    if (!reason || !Number.isSafeInteger(approvedCents) || approvedCents < 0 || !Number.isSafeInteger(requestedCents) || requestedCents < 0)
      return res.status(400).json({error:'退款原因和有效退款金额（分）必填'});
    if (requestedCents !== approvedCents && !adjustmentReason)
      return res.status(400).json({error:'调整退款金额必须填写调整原因'});
    try {
      const result = db.transaction(() => {
        const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
        if (!order || order.status === 'refunded' || order.status === 'cancelled') throw Object.assign(new Error('订单不可退款'),{status:409});
        if (db.prepare('SELECT id FROM refunds WHERE order_id=?').get(orderId)) throw Object.assign(new Error('每个订单只允许一次退款'),{status:409});
        const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
        const lots = db.prepare('SELECT * FROM entitlement_lots WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=?)').all(orderId);
        const paidLessons = items.reduce((n,x)=>n+x.paid_lessons,0);
        let consumedPaid = 0;
        const { balanceForLot, refundCap } = require('../domain/ledger');
        const balances = lots.map(lot => {
          const rows = db.prepare('SELECT * FROM entitlement_transactions WHERE lot_id=? ORDER BY id').all(lot.id);
          const consumed = rows.filter(x=>x.transaction_type==='consume_paid').reduce((n,x)=>n+x.quantity,0);
          const reversed = rows.filter(x=>x.transaction_type==='reverse').reduce((n,x)=>{const target=rows.find(y=>y.id===x.reference_transaction_id);return n+(target && target.transaction_type==='consume_paid'?x.quantity:0)},0);
          consumedPaid += Math.max(0,consumed-reversed);
          return {lot,balance:balanceForLot(rows)};
        });
        const cap = refundCap({receivedCents:order.received_cents,paidLessons,consumedPaidLessons:consumedPaid});
        if (approvedCents > cap) throw Object.assign(new Error(`退款金额超过可退上限 ${cap} 分`),{status:409});
        const refundId = db.prepare(`INSERT INTO refunds(order_id,requested_cents,approved_cents,actual_refunded_cents,reason,status,refunded_at)
          VALUES(?,?,?,0,?,'approved',NULL)`).run(orderId,requestedCents,approvedCents,reason).lastInsertRowid;
        const cancel = db.prepare(`INSERT INTO entitlement_transactions
          (lot_id,student_id,transaction_type,bucket,quantity,note,idempotency_key)
          VALUES(?,?,'refund_cancel',?,?,?,?)`);
        for (const item of balances) {
          if (item.balance.paid > 0) cancel.run(item.lot.id,item.lot.student_id,'paid',item.balance.paid,'退款取消剩余付费课时',`refund-${refundId}-lot-${item.lot.id}-paid`);
          if (item.balance.bonus > 0) cancel.run(item.lot.id,item.lot.student_id,'bonus',item.balance.bonus,'退款取消剩余赠送课时',`refund-${refundId}-lot-${item.lot.id}-bonus`);
          db.prepare("UPDATE entitlement_lots SET status='refunded' WHERE id=?").run(item.lot.id);
        }
        db.prepare('UPDATE refunds SET adjustment_reason=? WHERE id=?').run(adjustmentReason,refundId);
        // 退款批准后先冻结剩余课时权益；只有登记线下实际退款完成后，订单才标记为 refunded。
        record('order.refund','order',orderId,{refundId,requestedCents,approvedCents,adjustmentReason,cap,reason});
        return {refundId,approvedCents,maximumRefundCents:cap};
      })();
      res.status(201).json(result);
    } catch(error) { res.status(error.status || 500).json({error:error.message || '退款处理失败'}); }
  });

  // 退款审批与线下实际退款分开记录，避免审批时伪记为已打款。
  router.post('/orders/:id/refund/complete', (req,res) => {
    const orderId=Number(req.params.id);
    try {
      const result=db.transaction(()=>{
        const refund=db.prepare('SELECT * FROM refunds WHERE order_id=?').get(orderId);
        if(!refund)throw Object.assign(new Error('退款记录不存在'),{status:404});
        if(refund.status!=='approved')throw Object.assign(new Error('该退款不是待完成状态'),{status:409});
        const actual=req.body?.actualRefundedCents==null?refund.approved_cents:Number(req.body.actualRefundedCents);
        const reason=String(req.body?.adjustmentReason||'').trim().slice(0,500);
        if(!Number.isSafeInteger(actual)||actual<0||actual>refund.approved_cents)throw Object.assign(new Error('实际退款金额无效，不能超过批准金额'),{status:400});
        if(actual!==refund.approved_cents&&!reason)throw Object.assign(new Error('实际退款金额与批准金额不一致，必须填写原因'),{status:400});
        db.prepare("UPDATE refunds SET actual_refunded_cents=?,status='paid',refunded_at=CURRENT_TIMESTAMP,adjustment_reason=CASE WHEN ?<>'' THEN ? ELSE adjustment_reason END WHERE id=?")
          .run(actual,reason,reason,refund.id);
        db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(orderId);
        record('order.refund_completed','order',orderId,{refundId:refund.id,approvedCents:refund.approved_cents,actualRefundedCents:actual,adjustmentReason:reason});
        return {refundId:refund.id,status:'paid',actualRefundedCents:actual};
      })();
      res.json(result);
    } catch(error) { res.status(error.status||500).json({error:error.message||'登记实际退款失败'}); }
  });

  return router;
}
module.exports = { createAdminV1Router };

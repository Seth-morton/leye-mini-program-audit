const PHONE_RE = /^1[3-9]\d{9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function validateBooking(body, db) {
  const studentName = cleanText(body.studentName, 40);
  const guardianName = cleanText(body.guardianName, 40);
  const phone = cleanText(body.phone, 20);
  const courseId = Number(body.courseId);
  const preferredDate = cleanText(body.preferredDate, 10);
  const preferredTime = cleanText(body.preferredTime, 5);
  const note = cleanText(body.note, 500);

  if (studentName.length < 1) return { error: '请填写学员姓名' };
  if (!PHONE_RE.test(phone)) return { error: '请填写有效的中国大陆手机号' };
  if (!Number.isInteger(courseId) || courseId < 1) return { error: '请选择课程' };
  if (preferredDate && !DATE_RE.test(preferredDate)) return { error: '日期格式不正确' };
  if (preferredTime && !TIME_RE.test(preferredTime)) return { error: '时间格式不正确' };
  const course = db.prepare('SELECT id FROM courses WHERE id=? AND active=1').get(courseId);
  if (!course) return { error: '课程不存在或暂不可预约' };
  return { value: { studentName, guardianName, phone, courseId, preferredDate, preferredTime, note } };
}
module.exports = { validateBooking };

const { request } = require('../../utils/request');

// van-field 的 change 事件直接回传字符串；兼容额外参数模式下回传 { value } 的情况
function fieldValue(e) {
  const d = e && e.detail;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && d.value !== undefined) return d.value;
  return '';
}

Page({
  data: {
    courses: [], courseNames: [], courseIndex: 0, studentName: '', guardianName: '',
    phone: '', preferredDate: '', preferredTime: '', note: '', submitting: false, today: ''
  },
  onLoad() {
    const d = new Date();
    const today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    this.setData({ today });
    request('/api/courses').then(courses => {
      const names = courses.map(c => c.name);
      const selectedId = wx.getStorageSync('leye_selected_course_id');
      const index = Math.max(0, courses.findIndex(c => c.id === selectedId));
      this.setData({ courses, courseNames: names, courseIndex: index });
      wx.removeStorageSync('leye_selected_course_id');
    }).catch(() => wx.showToast({ title: '课程加载失败', icon: 'none' }));
  },
  chooseCourse(e) { this.setData({ courseIndex: Number(e.detail.value) }); },
  chooseDate(e) { this.setData({ preferredDate: e.detail.value }); },
  chooseTime(e) { this.setData({ preferredTime: e.detail.value }); },
  onStudentName(e) { this.setData({ studentName: fieldValue(e) }); },
  onGuardianName(e) { this.setData({ guardianName: fieldValue(e) }); },
  onPhone(e) { this.setData({ phone: fieldValue(e) }); },
  onNote(e) { this.setData({ note: fieldValue(e) }); },
  submit() {
    const d = this.data;
    if (!d.studentName.trim()) return wx.showToast({ title: '请填写学员姓名', icon: 'none' });
    if (!/^1[3-9]\d{9}$/.test(d.phone)) return wx.showToast({ title: '请填写有效手机号', icon: 'none' });
    if (!d.courses[d.courseIndex]) return wx.showToast({ title: '请选择课程', icon: 'none' });
    this.setData({ submitting: true });
    request('/api/bookings', 'POST', {
      studentName: d.studentName.trim(), guardianName: d.guardianName.trim(),
      phone: d.phone, courseId: d.courses[d.courseIndex].id,
      preferredDate: d.preferredDate, preferredTime: d.preferredTime, note: d.note.trim()
    }).then(result => {
      wx.setStorageSync('userPhone', d.phone);
      wx.showModal({ title: '预约意向已提交', content: `预约编号：${result.id}。工作室将联系您确认时间。`, showCancel: false });
      this.setData({ studentName: '', guardianName: '', phone: '', preferredDate: '', preferredTime: '', note: '' });
    }).catch(err => wx.showModal({ title: '提交失败', content: err.message || '请检查网络后重试。', showCancel: false }))
      .finally(() => this.setData({ submitting: false }));
  }
});

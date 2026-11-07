const { request } = require('../../utils/request');
Page({
  data: { courses: [] },
  onLoad() {
    request('/api/courses').then(courses => this.setData({ courses }))
      .catch(() => wx.showToast({ title: '课程加载失败，请稍后重试', icon: 'none' }));
  },
  bookCourse(e) {
    const id = Number(e.currentTarget.dataset.id);
    wx.setStorageSync('leye_selected_course_id', id);
    wx.switchTab({ url: '/pages/booking/booking' });
  }
});

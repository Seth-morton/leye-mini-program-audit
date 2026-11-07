const { request } = require('../../utils/request');
Page({
  data: { courses: [] },
  onLoad() {
    request('/api/courses').then(courses => this.setData({ courses: courses.slice(0,4) }))
      .catch(() => wx.showToast({ title: '课程加载失败，请稍后重试', icon: 'none' }));
  },
  goBooking() { wx.switchTab({ url: '/pages/booking/booking' }); },
  goCourses() { wx.switchTab({ url: '/pages/courses/courses' }); }
});

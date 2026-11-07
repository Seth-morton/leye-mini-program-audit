Page({
  goToBookings() {
    wx.navigateTo({ url: '/pages/my-bookings/my-bookings' });
  },
  goToAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },
  contactService() {
    wx.makePhoneCall({
      phoneNumber: '13800000000',
      fail: () => { /* 用户取消拨号时静默处理 */ }
    });
  }
});

const { request } = require('../../utils/request');

// 意向时间展示规则：
// - 无日期无时间        → 时间待沟通
// - 有日期、时间为 00:00 或空 → 只显示日期（00:00 视为未选择的默认值）
// - 其余                → 日期 + 时间
function withTimeText(item) {
  const date = item.preferredDate || '';
  const time = item.preferredTime || '';
  let timeText;
  if (!date && !time) timeText = '时间待沟通';
  else if (!time || time === '00:00') timeText = date || '时间待沟通';
  else timeText = (date ? date + ' ' : '') + time;
  return Object.assign({}, item, { timeText });
}

Page({
  data: { list: [], loading: true, hasPhone: false },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh());
  },

  load(done) {
    const phone = wx.getStorageSync('userPhone') || '';
    if (!phone) {
      this.setData({ list: [], loading: false, hasPhone: false });
      if (done) done();
      return;
    }
    this.setData({ loading: true, hasPhone: true });
    request('/api/bookings/search?phone=' + encodeURIComponent(phone))
      .then(list => {
        const rows = Array.isArray(list) ? list : [];
        this.setData({ list: rows.map(withTimeText), loading: false });
      })
      .catch(err => {
        this.setData({ list: [], loading: false });
        wx.showToast({ title: (err && err.message) || '查询失败', icon: 'none' });
      })
      .then(() => { if (done) done(); });
  }
});

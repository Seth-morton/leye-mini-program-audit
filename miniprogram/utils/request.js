const app = getApp();
function request(path, method='GET', data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + path,
      method,
      data,
      timeout: 10000,
      header: { 'content-type': 'application/json' },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.error) || `请求失败 (${res.statusCode})`));
      },
      fail: reject
    });
  });
}
module.exports = { request };

const app = getApp();
function request(path, method='GET', data) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('leye_auth_token') || '';
    wx.request({
      url: app.globalData.apiBase + path,
      method,
      data,
      timeout: 15000,
      header: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else {
          const error = new Error((res.data && res.data.error) || `请求失败 (${res.statusCode})`);
          error.statusCode = res.statusCode;
          reject(error);
        }
      },
      fail: reject
    });
  });
}
module.exports = { request };

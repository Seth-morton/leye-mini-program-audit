const { request } = require('./request');

function ensureSession() {
  const token = wx.getStorageSync('leye_auth_token');
  if (token) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    wx.login({
      success: result => {
        if (!result.code) return reject(new Error('微信登录未取得 code'));
        request('/api/auth/wechat-login','POST',{code:result.code}).then(data=>{
          wx.setStorageSync('leye_auth_token',data.token);
          wx.setStorageSync('leye_user_profile',data.user);
          resolve(data.user);
        }).catch(reject);
      },
      fail: reject
    });
  });
}

function loadStudents() {
  return ensureSession().then(()=>request('/api/parent/students')).then(students=>{
    const currentId=wx.getStorageSync('leye_selected_student_id');
    let index=students.findIndex(item=>item.id===currentId);
    if(index<0)index=0;
    if(students[index])wx.setStorageSync('leye_selected_student_id',students[index].id);
    return {students,selectedIndex:index,selected:students[index]||null};
  });
}

function bindPhoneCode(code) {
  if(!code)return Promise.reject(new Error('未取得手机号授权，请重试'));
  return ensureSession().then(()=>request('/api/auth/phone','POST',{code}));
}

function selectedStudentId(){return wx.getStorageSync('leye_selected_student_id')||0;}
module.exports={ensureSession,loadStudents,bindPhoneCode,selectedStudentId};

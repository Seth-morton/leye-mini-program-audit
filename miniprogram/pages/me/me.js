const {ensureSession,bindPhoneCode}=require('../../utils/parent');
const {request}=require('../../utils/request');
Page({
  data:{profile:{},loading:true},
  onShow(){ensureSession().then(()=>request('/api/parent/profile')).then(profile=>this.setData({profile,loading:false})).catch(()=>this.setData({loading:false}))},
  onGetPhoneNumber(e){const code=e.detail&&e.detail.code;if(!code)return wx.showToast({title:'请完成手机号授权',icon:'none'});bindPhoneCode(code).then(()=>{wx.showToast({title:'手机号验证成功'});this.onShow()}).catch(err=>wx.showModal({title:'验证失败',content:err.message||'请稍后重试',showCancel:false}))},
  goNotifications(){wx.navigateTo({url:'/pages/notifications/notifications'})},
  goAbout(){wx.navigateTo({url:'/pages/about/about'})},
  logout(){wx.showModal({title:'退出登录',content:'退出后需要重新进行微信登录。',success:r=>{if(r.confirm){request('/api/auth/logout','POST',{}).finally(()=>{wx.removeStorageSync('leye_auth_token');wx.removeStorageSync('leye_user_profile');this.onShow()})}}})}
});
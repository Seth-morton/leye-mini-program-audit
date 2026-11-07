const {request}=require('../../utils/request');
Page({
 data:{courses:[]},
 onLoad(){request('/api/courses').then(courses=>this.setData({courses})).catch(()=>wx.showToast({title:'课程加载失败',icon:'none'}));},
 bookCourse(){wx.showModal({title:'课程咨询',content:'课程安排与续费请直接联系乐也声乐工作室。',showCancel:false});}
});
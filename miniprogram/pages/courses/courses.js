const {request}=require('../../utils/request');
const modeLabels={one_to_one:'一对一',small_group:'小班',collective:'集体',exam:'艺考'};
Page({
 data:{courses:[],loading:true,error:''},
 onShow(){this.load()},
 load(){this.setData({loading:true,error:''});request('/api/catalog/courses').then(rows=>this.setData({courses:rows.map(x=>({...x,modeLabel:modeLabels[x.mode]||'课程'})),loading:false})).catch(err=>this.setData({loading:false,error:err.message||'课程加载失败'}));},
 bookCourse(){wx.showModal({title:'课程咨询',content:'课程安排、价格与续费由工作室负责人线下沟通确认。',showCancel:false});}
});

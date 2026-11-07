const { request } = require('../../utils/request');
const { loadStudents, bindPhoneCode } = require('../../utils/parent');
Page({
  data:{students:[],studentIndex:0,studentName:'',lessons:[],notifications:[],needsBinding:false,loading:true,error:''},
  onShow(){this.load()},
  load(){
    this.setData({loading:true});
    loadStudents().then(({students,selectedIndex,selected,profile})=>{
      this.setData({students,studentIndex:selectedIndex,studentName:selected?.name||'',needsBinding:students.length===0,phoneVerified:!!(profile&&profile.phone),loading:false,error:''});
      if(selected)this.loadStudentData(selected.id);
      request('/api/parent/notifications').then(rows=>this.setData({notifications:rows.slice(0,3)})).catch(()=>{});
    }).catch(err=>this.setData({loading:false,needsBinding:true,error:err.message}));
  },
  loadStudentData(id){request('/api/parent/students/'+id+'/schedule').then(rows=>this.setData({lessons:rows.slice(0,3)})).catch(()=>this.setData({lessons:[]}));},
  chooseStudent(e){const index=Number(e.detail.value),student=this.data.students[index];if(!student)return;wx.setStorageSync('leye_selected_student_id',student.id);this.setData({studentIndex:index,studentName:student.name});this.loadStudentData(student.id);},
  onGetPhoneNumber(e){const code=e.detail&&e.detail.code;if(!code)return wx.showToast({title:'请完成手机号授权',icon:'none'});bindPhoneCode(code).then(()=>{wx.showToast({title:'手机号验证成功'});this.load();}).catch(err=>wx.showModal({title:'验证未完成',content:err.message||'请稍后重试',showCancel:false}));},
  openNotifications(){wx.navigateTo({url:'/pages/notifications/notifications'});},
  openAbout(){wx.navigateTo({url:'/pages/about/about'});}
});
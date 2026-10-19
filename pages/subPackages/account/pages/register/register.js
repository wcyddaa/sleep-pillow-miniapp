// 注册页：用户名 + 密码（对接云后端 /auth/register）
const authAPI = require('../../../../../utils/network/api/authAPI');

Page({
  data: {
    username: '',
    password: '',
    confirm: '',
    submitting: false
  },

  onUsernameInput(e) { this.setData({ username: e.detail.value }); },
  onPasswordInput(e) { this.setData({ password: e.detail.value }); },
  onConfirmInput(e) { this.setData({ confirm: e.detail.value }); },

  onSubmit() {
    const { username, password, confirm, submitting } = this.data;
    if (submitting) return;
    if (!username.trim()) return wx.showToast({ title: '请输入用户名', icon: 'none' });
    if (password.length < 6) return wx.showToast({ title: '密码至少 6 位', icon: 'none' });
    if (password !== confirm) return wx.showToast({ title: '两次密码不一致', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '注册中...' });
    authAPI.register({ username: username.trim(), password })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '注册成功，请登录', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  },

  goLogin() {
    wx.navigateBack();
  }
});
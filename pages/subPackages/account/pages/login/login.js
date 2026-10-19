// 登录页：微信一键登录（主）+ 账号密码登录（折叠备选）
const authAPI = require('../../../../../utils/network/api/authAPI');

Page({
  data: {
    // 微信登录
    canWxLogin: true,
    wxSubmitting: false,

    // 账号密码
    username: '',
    password: '',
    submitting: false,
    showPwd: false,
    showPass: false,
  },

  onLoad() {
    if (typeof wx.login !== 'function') {
      this.setData({ canWxLogin: false });
    }
  },

  // ---- 微信一键登录 ----
  onWxLogin() {
    if (this.data.wxSubmitting) return;
    this.setData({ wxSubmitting: true });
    wx.showLoading({ title: '微信登录中...' });
    wx.login({
      success: (res) => {
        if (!res || !res.code) {
          wx.hideLoading();
          this.setData({ wxSubmitting: false });
          return wx.showToast({ title: '微信登录失败，请重试', icon: 'none' });
        }
        authAPI.wxLogin(res.code)
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: '登录成功', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 500);
          })
          .catch((err) => {
            wx.hideLoading();
            this.setData({ wxSubmitting: false });
            const msg = (err && err.message) || '微信登录失败，请稍后重试';
            wx.showToast({ title: msg, icon: 'none' });
          });
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ wxSubmitting: false });
        wx.showToast({ title: '微信未授权，请用账号密码登录', icon: 'none' });
      }
    });
  },

  // ---- 账号密码登录 ----
  onUsernameInput(e) { this.setData({ username: e.detail.value }); },
  onPasswordInput(e) { this.setData({ password: e.detail.value }); },

  togglePwd() {
    this.setData({ showPwd: !this.data.showPwd });
  },

  toggleShowPass() {
    this.setData({ showPass: !this.data.showPass });
  },

  onSubmit() {
    const { username, password, submitting } = this.data;
    if (submitting) return;
    if (!username.trim()) return wx.showToast({ title: '请输入用户名', icon: 'none' });
    if (!password) return wx.showToast({ title: '请输入密码', icon: 'none' });

    this.setData({ submitting: true });
    wx.showLoading({ title: '登录中...' });
    authAPI.login(username.trim(), password)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 500);
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ submitting: false });
        const msg = (err && err.message) || '登录失败，请检查用户名和密码';
        wx.showToast({ title: msg, icon: 'none' });
      });
  }
});

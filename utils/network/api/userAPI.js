/**
 * 用户认证接口（对接云后端）
 * - 真实登录：用户名/密码走 authAPI.login，微信走 authAPI.wxLogin
 * - 资料更新：调 PATCH /auth/me，落到 userStore
 */
const authAPI = require('./authAPI');
const userStore = require('../../store/stores/userStore');

module.exports = {
  /** 用户名 + 密码登录（对齐后端 /auth/login） */
  loginByUsernameAuth(username, password) {
    return authAPI.login(username, password);
  },

  /** 微信登录：传 wx.login() 拿到的 code + chooseAvatar 拿到的 nickname/avatar_url */
  loginByWechat(code, nickname, avatarUrl) {
    return authAPI.wxLogin(code, nickname, avatarUrl);
  },

  register(payload) {
    return authAPI.register(payload);
  },

  getProfile() {
    return authAPI.getProfile();
  },

  /**
   * 更新用户资料（调 PATCH /auth/me）
   * @param {object} patch { nickname?, avatar_url?, full_name?, email? }
   */
  updateProfile(patch) {
    return authAPI.updateProfile(patch);
  },

  logout() {
    return authAPI.logout();
  }
};
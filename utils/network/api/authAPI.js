/**
 * 认证接口（对齐睡眠分析云后端 /api/v1/auth/*）
 */
const http = require('../httpClient');
const userStore = require('../../store/stores/userStore');

/** 后端 UserOut -> 前端 user 对象（兼容：旧字段 + 新 nickname/avatar_url） */
const normalUser = (u) => ({
  id: String(u.id),
  username: u.username,
  // 优先用后端返回的 nickname，其次 full_name，最后 username
  nickname: u.nickname || u.full_name || u.username,
  full_name: u.full_name,
  email: u.email,
  // avatar_url 是字符串（默认头像或微信头像 URL）
  avatar: u.avatar_url || '/assets/images/default/avatar.png',
  avatar_url: u.avatar_url,
  is_active: u.is_active,
  created_at: u.created_at
});

/** 登录态写入 userStore（用户名密码 / 微信一键登录共用） */
const applyLogin = (data) => {
  const user = normalUser(data.user);
  userStore.setLogin(user, data.access_token);
  return { user, token: data.access_token };
};

module.exports = {
  login(username, password) {
    return http.post('/auth/login', { username, password }).then(applyLogin);
  },

  /**
   * 微信一键登录：传 wx.login() 拿到的 code + chooseAvatar 拿到的 nickname/avatar_url
   * 后端用 WECHAT_APPID/SECRET 换 openid，自动建号 + 签发 JWT。
   * 头像/昵称写库（首次注册回填、后续每次同步）。
   */
  wxLogin(code, nickname, avatarUrl) {
    const payload = { code };
    if (nickname) payload.nickname = nickname;
    if (avatarUrl) payload.avatar_url = avatarUrl;
    return http.post('/auth/wx-login', payload).then(applyLogin);
  },

  register(payload) {
    return http.post('/auth/register', payload).then((data) => normalUser(data));
  },

  /** 当前登录用户（需要 token） */
  getProfile() {
    return http.get('/auth/me').then((u) => {
      // 同步刷 store（避免后端字段变了 store 不知道）
      const user = normalUser(u);
      if (userStore.store.state.isLoggedIn) {
        userStore.updateProfile(user);
      }
      return user;
    });
  },

  /**
   * 更新当前用户资料：nickname / avatar_url / full_name / email 任意子集。
   * 成功后写入 userStore + 返回最新 user。
   */
  updateProfile(patch) {
    return http.patch('/auth/me', patch).then((u) => {
      const user = normalUser(u);
      userStore.updateProfile(user);
      return user;
    });
  },

  logout() {
    userStore.logout();
    return Promise.resolve();
  }
};
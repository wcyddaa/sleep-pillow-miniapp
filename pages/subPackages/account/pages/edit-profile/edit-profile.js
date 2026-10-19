// 编辑资料页：昵称 + 头像（用微信 chooseAvatar）
const userStore = require('../../../../../utils/store/stores/userStore');
const userAPI = require('../../../../../utils/network/api/userAPI');

Page({
  data: {
    userId: '',
    nickname: '',
    avatar: '/assets/images/default/avatar.png',
    // 待保存的 patch（仅在 Save 时一起发）
    patch: { nickname: null, avatar_url: null }
  },

  onLoad() {
    const u = userStore.store.state.user;
    if (!u) {
      // 没登录直接跳回登录页（防御性，正常情况由 httpClient 401 兜底）
      wx.reLaunch({ url: '/pages/subPackages/account/pages/login/login' });
      return;
    }
    this.setData({
      userId: u.id,
      nickname: u.nickname || u.username || '',
      avatar: u.avatar || '/assets/images/default/avatar.png'
    });
  },

  /**
   * 微信 chooseAvatar 回调：拿到临时 URL，wx.uploadFile 转永久外链。
   * 这里采用「微信临时 URL」直接存库（30 天有效，足够个人小程序使用）；
   * 真实生产环境应上传到对象存储拿到永久 URL。
   */
  onChooseAvatar(e) {
    const url = e.detail.avatarUrl;
    if (!url) return;
    this.setData({
      avatar: url,
      'patch.avatar_url': url
    });
  },

  onNickInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  onNickBlur(e) {
    const v = (e.detail.value || '').trim();
    if (v) {
      this.setData({ nickname: v, 'patch.nickname': v });
    }
  },

  onSave() {
    const patch = this.data.patch;
    if (!patch.nickname && !patch.avatar_url) {
      // 没改动
      wx.navigateBack();
      return;
    }
    const payload = {};
    if (patch.nickname) payload.nickname = patch.nickname;
    if (patch.avatar_url) payload.avatar_url = patch.avatar_url;

    wx.showLoading({ title: '保存中...' });
    userAPI.updateProfile(payload)
      .then((u) => {
        wx.hideLoading();
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 500);
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
      });
  },

  onCancel() {
    wx.navigateBack();
  }
});

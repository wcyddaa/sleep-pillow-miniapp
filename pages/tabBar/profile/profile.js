// 个人页 - 账号信息
const userStore = require('../../../utils/store/stores/userStore');
const userAPI = require('../../../utils/network/api/userAPI');
const deviceStore = require('../../../utils/store/stores/deviceStore');
const envConfig = require('../../../config/envConfig');
const BLEManager = require('../../../utils/bluetooth/BLEManager');

const MENU = [
  { key: 'devices', icon: '/assets/images/icons/icon-device.png', label: '我的设备', desc: '' },
  { key: 'push', icon: '/assets/images/icons/icon-message.png', label: '鼾声/离床提醒', switch: true },
  { key: 'about', icon: '/assets/images/icons/icon-settings.png', label: '关于应用', desc: 'v' + envConfig.version }
];

Page({
  data: {
    user: null,
    stats: { total: 0, online: 0 },
    menu: MENU,
    pushEnabled: true,
    bleConnected: false
  },

  onLoad() {
    this.applyMenuDesc();
  },

  onShow() {
    const devices = deviceStore.store.state.devices;
    this.setData({
      user: userStore.store.state.user,
      stats: {
        total: devices.length,
        online: devices.filter((d) => d.status === 'online').length
      },
      bleConnected: BLEManager.isConnected()
    });
    this.applyMenuDesc();
  },

  applyMenuDesc() {
    const devices = deviceStore.store.state.devices;
    this.setData({
      menu: MENU.map((m) => (m.key === 'devices'
        ? Object.assign({}, m, { desc: devices.length + ' 台设备 · ' + devices.filter((d) => d.status === 'online').length + ' 台在线' })
        : m))
    });
  },

  onMenuTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'devices') {
      wx.switchTab({ url: '/pages/tabBar/home/home' });
    } else if (key === 'about') {
      wx.showModal({
        title: '智眠 · AI 睡眠守护',
        content: '版本 v' + envConfig.version + '\n环境：' + envConfig.env + (envConfig.useMock ? '（演示数据）' : ''),
        showCancel: false
      });
    } else {
      const item = MENU.find((m) => m.key === key);
      if (item && item.path) wx.navigateTo({ url: item.path });
    }
  },

  onPushSwitch(e) {
    const enabled = e.detail.value;
    this.setData({ pushEnabled: enabled });
    require('../../../utils/network/api/messageAPI').setPushEnabled('all', enabled);
    wx.showToast({ title: enabled ? '已开启推送' : '已关闭推送', icon: 'none' });
  },

  onEditName() {
    // 跳到独立编辑页（昵称 + 头像）
    wx.navigateTo({ url: '/pages/subPackages/account/pages/edit-profile/edit-profile' });
  },

  onLogin() {
    // 微信一键登录需后端实现后启用；当前跳转用户名+密码登录页
    wx.navigateTo({ url: '/pages/subPackages/account/pages/login/login' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (res.confirm) {
          userAPI.logout();
          this.setData({ user: null });
          wx.showToast({ title: '已退出', icon: 'none' });
        }
      }
    });
  }
});

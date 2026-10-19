// 首页 - 头部用户 + 昨晚概览 + 3 大应用入口 + 设备列表
const { bindStore } = require('../../../utils/store/index');
const deviceStore = require('../../../utils/store/stores/deviceStore');
const messageStore = require('../../../utils/store/stores/messageStore');
const userStore = require('../../../utils/store/stores/userStore');
const appStore = require('../../../utils/store/stores/appStore');
const deviceAPI = require('../../../utils/network/api/deviceAPI');
const dataAPI = require('../../../utils/network/api/dataAPI');
const messageAPI = require('../../../utils/network/api/messageAPI');

Page({
  data: {
    statusBarHeight: 24,
    greeting: '',
    todaySub: '点击头像可编辑昵称与头像',
    user: { nickname: '朋友', avatar: '/assets/images/default/avatar.png' },
    devices: [],
    summary: { total: 0, online: 0, alert: 0 },
    unreadCount: 0,
    lastNight: null,
    devicesLoaded: false,
    // ★ 4 大一级入口：睡眠看板 / AI分析（保留原逻辑） / 睡眠报告 / 长期趋势
    apps: [
      {
        key: 'dashboard',
        icon: '/assets/images/icons/icon-dashboard.png',
        bg: 'linear-gradient(135deg, #EEF2FF, #E0E7FF)',
        label: '睡眠看板',
        desc: '7 天综合趋势',
        path: '/pages/subPackages/data/pages/dashboard/dashboard'
      },
      {
        key: 'analysis',
        icon: '/assets/images/icons/icon-ai.png',
        bg: 'linear-gradient(135deg, #F3E8FF, #E9D5FF)',
        label: 'AI 分析',
        desc: '实时帧解读',
        path: '/pages/subPackages/ai/pages/analysis/analysis'
      },
      {
        key: 'report',
        icon: '/assets/images/icons/icon-report.png',
        bg: 'linear-gradient(135deg, #FEF3C7, #FDE68A)',
        label: '睡眠报告',
        desc: '按时间段生成',
        path: '/pages/subPackages/ai/pages/report-range/report-range'
      },
      {
        key: 'history',
        icon: '/assets/images/icons/icon-history.png',
        bg: 'linear-gradient(135deg, #DCFCE7, #BBF7D0)',
        label: '长期趋势',
        desc: '近 7 天对比',
        path: '/pages/subPackages/data/pages/history/history'
      }
    ]
  },

  onLoad() {
    this.applyUser();
    this._unsubUser = bindStore(this, userStore.store, (s) => ({
      user: s.user || { nickname: '朋友', avatar: '/assets/images/default/avatar.png' }
    }));
    this._unsubDevices = bindStore(this, deviceStore.store, (s) => ({
      devices: s.devices,
      summary: {
        total: s.devices.length,
        online: s.devices.filter((d) => d.status === 'online').length,
        alert: s.devices.filter((d) => d.status === 'alert').length
      }
    }));
    this._unsubMsg = bindStore(this, messageStore.store, (s) => ({
      unreadCount: s.messages.filter((m) => !m.read).length
    }));

    this.loadDevices();
    this.loadLastNight();
  },

  onShow() {
    this.setData({ greeting: this.calcGreeting() });
    this.applyUser();
    if (!deviceStore.store.state.loaded) this.loadDevices();
    if (!messageStore.store.state.loaded) messageAPI.fetchList();
  },

  applyUser() {
    const u = userStore.store.state.user;
    this.setData({
      greeting: this.calcGreeting(),
      user: u
        ? Object.assign({ nickname: '朋友', avatar: '/assets/images/default/avatar.png' }, u)
        : { nickname: '朋友', avatar: '/assets/images/default/avatar.png' }
    });
  },

  onUnload() {
    this._unsubDevices && this._unsubDevices();
    this._unsubMsg && this._unsubMsg();
    this._unsubUser && this._unsubUser();
  },

  onPullDownRefresh() {
    Promise.all([this.loadDevices(), this.loadLastNight()]).then(() => wx.stopPullDownRefresh());
  },

  calcGreeting() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 12) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  },

  loadDevices() {
    return deviceAPI.getList().then((list) => {
      deviceStore.setDevices(list);
      this.setData({ devicesLoaded: true });
    });
  },

  loadLastNight() {
    // 拿用户第一个有数据设备的看板数据
    const devices = deviceStore.store.state.devices || [];
    const target = devices.find((d) => d.status === 'online') || devices[0];
    if (!target) return Promise.resolve();
    return dataAPI.getTrendDashboard(target.id, 7).then((d) => {
      if (!d || !d.last_night) {
        this.setData({ lastNight: null });
        return;
      }
      const s = d.last_night.summary || {};
      const score = s.sleep_quality_score != null ? Math.round(s.sleep_quality_score) : null;
      const dur = s.duration_min || 0;
      const h = Math.floor(dur / 60);
      const m = Math.round(dur % 60);
      this.setData({
        lastNight: {
          score: score != null ? score : '--',
          level: score == null ? '无数据' : (score >= 90 ? '优秀' : score >= 75 ? '良好' : score >= 60 ? '一般' : '欠佳'),
          durationText: dur > 0 ? h + 'h' + m + 'm' : '--',
          deepPct: s.deep_pct != null ? Math.round(s.deep_pct * 100) : '--',
          snoreMinutes: s.snore_minutes != null ? Math.round(s.snore_minutes) : 0,
          avgHeartRate: s.avg_heart_rate != null ? Math.round(s.avg_heart_rate) : '--'
        }
      });
    }).catch(() => {
      this.setData({ lastNight: null });
    });
  },

  onAppTap(e) {
    const key = e.currentTarget.dataset.appKey;
    const app = this.data.apps.find((a) => a.key === key);
    if (!app || !app.path) return;
    wx.navigateTo({ url: app.path });
  },

  onDeviceEnter(e) {
    const d = e.detail.device;
    wx.navigateTo({ url: '/pages/subPackages/device/pages/control/control?id=' + d.id });
  },

  goEditProfile() {
    wx.navigateTo({ url: '/pages/subPackages/account/pages/edit-profile/edit-profile' });
  },

  goScan() {
    wx.navigateTo({ url: '/pages/subPackages/device/pages/connect/connect' });
  }
});

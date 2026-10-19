// 消息页 - 通知中心
// 5 类事件源：device_offline / snore_heavy / apnea_high / device_bound / report_ready
const { bindStore } = require('../../../utils/store/index');
const messageStore = require('../../../utils/store/stores/messageStore');
const messageAPI = require('../../../utils/network/api/messageAPI');

const FILTERS = [
  { key: 'all',          text: '全部' },
  { key: 'health',       text: '健康' },
  { key: 'snore_heavy',  text: '鼾声' },
  { key: 'device',       text: '设备' },
  { key: 'system',       text: '系统' }
];

function inFilter(m, key) {
  if (key === 'all') return true;
  if (key === 'health') return m.type === 'apnea_high' || m.type === 'snore_heavy';
  if (key === 'snore_heavy') return m.type === 'snore_heavy';
  if (key === 'device') return m.type === 'device_offline' || m.type === 'device_bound';
  if (key === 'system') return m.type === 'report_ready';
  return true;
}

Page({
  data: {
    filter: 'all',
    filters: FILTERS,
    messages: [],
    filtered: [],
    unreadCount: 0,
    loading: true
  },

  onLoad() {
    this._unsub = bindStore(this, messageStore.store, (s) => ({
      messages: s.messages,
      unreadCount: s.messages.filter((m) => !m.read).length
    }));
    this.applyFilter();
    messageAPI.fetchList().then(() => {
      this.setData({ loading: false });
      this.applyFilter();
    });
  },

  onShow() {
    if (messageStore.store.state.loaded) {
      messageAPI.fetchList().then(() => this.applyFilter());
    }
  },

  onUnload() {
    this._unsub && this._unsub();
  },

  onPullDownRefresh() {
    messageAPI.fetchList().then(() => {
      wx.stopPullDownRefresh();
      this.applyFilter();
    });
  },

  onFilterTap(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ filter: key });
    this.applyFilter();
  },

  applyFilter() {
    const { filter, messages } = this.data;
    this.setData({
      filtered: messages.filter((m) => inFilter(m, filter))
    });
  },

  onMessageTap(e) {
    const msg = e.detail.message;
    if (!msg.read) messageAPI.markRead(msg.id);
    // 不同类型跳转不同页面
    if (msg.type === 'apnea_high') {
      // 健康预警 → AI 分析
      wx.navigateTo({ url: '/pages/subPackages/ai/pages/analysis/analysis' });
    } else if (msg.type === 'snore_heavy' || msg.type === 'report_ready') {
      // 重度鼾声/报告完成 → 按区间报告
      wx.navigateTo({ url: '/pages/subPackages/ai/pages/report-range/report-range' });
    } else if ((msg.type === 'device_offline' || msg.type === 'device_bound') && msg.refDeviceId) {
      // 设备类 → 设备控制页
      wx.navigateTo({ url: '/pages/subPackages/device/pages/control/control?id=' + msg.refDeviceId });
    }
  },

  onMarkAll() {
    if (!this.data.unreadCount) return;
    wx.showModal({
      title: '全部标为已读',
      content: '确定将所有消息标记为已读吗？',
      success: (res) => { if (res.confirm) messageAPI.markAllRead(); }
    });
  }
});

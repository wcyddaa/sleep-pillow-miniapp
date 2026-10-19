// 完整报告：展示「最新一帧 30s 端侧结构化数据」的全部字段 + AI 解读
// 注：不再是整晚睡眠报告；对象就是最近一帧。优先复用 AI 分析页的结果，避免重复调 LLM。
const aiAPI = require('../../../../../utils/network/api/aiAPI');
const deviceStore = require('../../../../../utils/store/stores/deviceStore');

Page({
  data: {
    loading: true,
    report: null,
    errorText: '',
    dataText: ''
  },

  onLoad(query) {
    const devices = deviceStore.store.state.devices || [];
    const deviceId = query.deviceId || (devices.length ? devices[0].id : '');

    if (!deviceId) {
      this.setData({ loading: false, errorText: '尚未绑定设备' });
      return;
    }
    this.deviceId = deviceId;

    // 1) 复用 AI 分析页刚生成的结果（同设备）
    const cached = aiAPI.getLastFrameAnalysis();
    if (cached && String(cached.deviceId) === String(deviceId)) {
      this.applyResult(cached);
      return;
    }
    // 2) 直接进入本页（首页/看板/控制页入口）→ 现拉一次
    aiAPI.analyzeLatestFrame(deviceId)
      .then((r) => {
        if (!r) {
          this.setData({ loading: false, errorText: '该设备暂无 30 秒数据帧' });
          return;
        }
        this.applyResult(r);
      })
      .catch((err) => {
        this.setData({
          loading: false,
          errorText: (err && err.message) || '加载失败，请稍后重试'
        });
      });
  },

  applyResult(r) {
    this.setData({
      loading: false,
      errorText: '',
      report: r,
      dataText: JSON.stringify(r.frame, null, 2)
    });
    wx.setNavigationBarTitle({ title: '本帧完整报告' });
  },

  copyData() {
    wx.setClipboardData({
      data: this.data.dataText,
      success: () => wx.showToast({ title: '已复制 JSON', icon: 'none' })
    });
  },

  copyAnalysis() {
    wx.setClipboardData({
      data: (this.data.report && this.data.report.analysis) || '',
      success: () => wx.showToast({ title: '已复制解读', icon: 'none' })
    });
  },

  goAnalysis() {
    if (!this.deviceId) return;
    wx.navigateTo({
      url: '/pages/subPackages/ai/pages/analysis/analysis?deviceId=' + this.deviceId
    });
  },

  onShareAppMessage() {
    const r = this.data.report;
    return {
      title: r ? ('本帧睡眠分期：' + r.stageLabel) : '睡眠帧报告',
      path: '/pages/subPackages/ai/pages/report/report' + (this.deviceId ? '?deviceId=' + this.deviceId : '')
    };
  }
});

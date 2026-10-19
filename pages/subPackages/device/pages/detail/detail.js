// 设备详情：基础信息、硬件能力、数据链路、原始数据帧、日志、操作
const deviceStore = require('../../../../../utils/store/stores/deviceStore');
const deviceAPI = require('../../../../../utils/network/api/deviceAPI');
const formatter = require('../../../../../utils/common/formatter');

Page({
  data: {
    device: null,
    logs: [],
    lastSeenText: '',
    showRaw: false,
    rawText: '',
    rebooting: false,
    upgrading: false
  },

  onLoad(query) {
    this.deviceId = query.id;
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  refresh() {
    return Promise.all([
      deviceAPI.getDetail(this.deviceId),
      deviceAPI.getLogs(this.deviceId)
    ]).then(([device, logs]) => {
      deviceStore.upsertDevice(device);
      this.setData({
        device,
        logs: logs.map((l) => Object.assign({}, l, { timeText: formatter.formatTime(l.time) })),
        lastSeenText: formatter.formatTime(device.lastSeen)
      });
      wx.setNavigationBarTitle({ title: device.name });
      if (this.data.showRaw) this.loadRaw();
    });
  },

  /**
   * 设备原始上传 JSON 样例。
   * 注意：GET /devices/{id}/raw-json 返回的是 SleepFrameOut 对象本身（不是 {raw:...}），
   *      原始设备载荷在它的 raw_json 字段里（JSON 字符串）。
   */
  loadRaw() {
    deviceAPI.getRawJson(this.deviceId).then((frame) => {
      if (!frame) {
        this.setData({ rawText: '（该设备暂无上报帧）' });
        return;
      }
      let pretty = frame.raw_json;
      try {
        pretty = JSON.stringify(JSON.parse(frame.raw_json), null, 2);
      } catch (e) {
        pretty = frame.raw_json || JSON.stringify(frame, null, 2);
      }
      this.setData({ rawText: pretty });
    }).catch(() => {
      this.setData({ rawText: '（读取失败）' });
    });
  },

  toggleRaw() {
    const show = !this.data.showRaw;
    this.setData({ showRaw: show });
    if (show && !this.data.rawText) this.loadRaw();
  },

  copyRaw() {
    wx.setClipboardData({
      data: this.data.rawText,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    });
  },

  onReboot() {
    wx.showModal({
      title: '重启设备',
      content: '重启期间设备将短暂离线（约 30 秒），确定继续吗？',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ rebooting: true });
        deviceAPI.reboot(this.deviceId).then(() => {
          wx.showToast({ title: '重启指令已下发', icon: 'success' });
        }).finally(() => this.setData({ rebooting: false }));
      }
    });
  },

  onUpgrade() {
    const d = this.data.device;
    wx.showModal({
      title: '固件升级',
      content: '将升级到最新固件 v2.3.1（当前 ' + d.firmware + '），升级期间请保持设备通电。',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ upgrading: true });
        deviceAPI.upgradeFirmware(this.deviceId, 'v2.3.1').then(() => {
          wx.showToast({ title: '升级任务已创建', icon: 'success' });
        }).finally(() => this.setData({ upgrading: false }));
      }
    });
  },

  onUnbind() {
    wx.showModal({
      title: '解绑设备',
      content: '解绑后将清除该设备的所有本地数据，且需重新配网才能使用。',
      confirmText: '解绑',
      confirmColor: '#F0506E',
      success: (res) => {
        if (!res.confirm) return;
        deviceAPI.unbind(this.deviceId).then(() => {
          deviceStore.removeDevice(this.deviceId);
          wx.showToast({ title: '已解绑', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 800);
        });
      }
    });
  }
});

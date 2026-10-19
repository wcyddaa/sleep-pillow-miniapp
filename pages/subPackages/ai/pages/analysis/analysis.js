// AI 分析：拉该设备「最新一帧 30s 端侧结构化数据」→ 交后端 LLM 分析
// 注：不针对整晚 sleep_record，不落库；分析对象就是最近的一帧。
const aiAPI = require('../../../../../utils/network/api/aiAPI');
const deviceStore = require('../../../../../utils/store/stores/deviceStore');

const STAGES = ['拉取最新帧', '整理结构化数据', '模型分析', '生成解读'];

/** 已耗时(秒) → 阶段下标 + 进度百分比。
 *  单帧分析比区间报告快，LLM 一般在 5~15 秒；
 *  进度封顶 92%，避免到 100% 后还在等导致"卡死"感。 */
function progressOf(sec) {
  let stageIdx = 0;
  let pct = 0;
  if (sec < 1) {
    stageIdx = 0;
    pct = (sec / 1) * 20;                    // 0 → 20%
  } else if (sec < 2) {
    stageIdx = 1;
    pct = 20 + (sec - 1) * 15;               // 20 → 35%
  } else if (sec < 12) {
    stageIdx = 2;
    pct = 35 + ((sec - 2) / 10) * 53;        // 35 → 88%（LLM 主力阶段）
  } else {
    stageIdx = 3;
    pct = 88 + Math.min((sec - 12) / 10, 1) * 4;  // 88 → 92%
  }
  return { stageIdx, pct: Math.round(pct) };
}

/** 分期配色：0 清醒 / 1 浅睡 / 2 深睡 / null 未启用 */
function stageColorOf(stage) {
  if (stage === 0) return '#F59E0B';
  if (stage === 1) return '#3D7EFF';
  if (stage === 2) return '#10B981';
  return '#9CA3AF';
}

Page({
  data: {
    devices: [],
    deviceId: '',
    deviceName: '请选择设备',
    analyzing: false,
    stageIdx: 0,
    progressPct: 0,
    elapsedSec: 0,
    result: null,
    errorText: ''
  },

  onLoad(query) {
    const devices = deviceStore.store.state.devices || [];
    const deviceId = query.deviceId || (devices.length ? devices[0].id : '');
    this.setData({
      devices,
      deviceId,
      deviceName: deviceId
        ? ((devices.find((d) => String(d.id) === String(deviceId)) || {}).name || '未知设备')
        : '请选择设备'
    });
  },

  onUnload() {
    if (this.stageTimer) clearInterval(this.stageTimer);
  },

  onDeviceChange(e) {
    const dev = this.data.devices[e.detail.value];
    this.setData({ deviceId: dev.id, deviceName: dev.name, result: null, errorText: '' });
  },

  startAnalysis() {
    if (!this.data.deviceId) {
      return wx.showToast({ title: '请先选择设备', icon: 'none' });
    }
    if (this.data.analyzing) return;

    this.setData({ analyzing: true, stageIdx: 0, progressPct: 0, elapsedSec: 0, result: null, errorText: '' });
    // 阶段推进：按真实已耗时估算（LLM 调用有耗时，给用户过程反馈）
    const began = Date.now();
    this.stageTimer = setInterval(() => {
      const sec = (Date.now() - began) / 1000;
      const { stageIdx, pct } = progressOf(sec);
      this.setData({ stageIdx, progressPct: pct, elapsedSec: Math.floor(sec) });
    }, 400);

    aiAPI.analyzeLatestFrame(this.data.deviceId).then((result) => {
      clearInterval(this.stageTimer);
      if (!result) {
        this.setData({ analyzing: false, errorText: '该设备暂无 30 秒数据帧，请先打开至少一个端侧开关' });
        return;
      }
      result.stageColor = stageColorOf(result.stage);
      this.setData({
        analyzing: false,
        stageIdx: STAGES.length - 1,
        progressPct: 100,
        result
      });
    }).catch((err) => {
      clearInterval(this.stageTimer);
      this.setData({
        analyzing: false,
        progressPct: 0,
        errorText: (err && err.message) || '分析失败，请稍后重试'
      });
    });
  },

  /** 查看完整报告：同一帧的完整字段（不重新调 LLM） */
  goReport() {
    if (!this.data.result) return;
    wx.navigateTo({
      url: '/pages/subPackages/ai/pages/report/report?deviceId=' + this.data.deviceId
    });
  },

  /** 下拉刷新设备列表（配网后设备刚出现时用） */
  onPullDownRefresh() {
    const devices = deviceStore.store.state.devices || [];
    this.setData({
      devices,
      deviceName: this.data.deviceId
        ? ((devices.find((d) => String(d.id) === String(this.data.deviceId)) || {}).name || '未知设备')
        : '请选择设备'
    });
    wx.stopPullDownRefresh();
  }
});

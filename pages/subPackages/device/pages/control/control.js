// 设备实时监测与控制
//   实时区  ：BLE 直连 —— 固件每秒推 {"evt":"rt","hr":..,"rr":..,"motion":..,"snore":..,"stage":..}
//   最近一帧：云端 —— GET /devices/{id}/raw-json 取最近一条 30s 帧（三开关全关时设备不上报，故可能为空）
//   三开关  ：设备本地状态（固件 NVS edge_cfg），BLE 0x04 读 / 0x05 写，**不经云端**
//   最近一天：历史区，走 sleepAPI.list
const { bindStore } = require('../../../../../utils/store/index');
const deviceStore = require('../../../../../utils/store/stores/deviceStore');
const deviceAPI = require('../../../../../utils/network/api/deviceAPI');
const sleepAPI = require('../../../../../utils/network/api/sleepAPI');
const BLEProvisioner = require('../../../../../utils/bluetooth/BLEProvisioner');
const BLEManager = require('../../../../../utils/bluetooth/BLEManager');

const MODE_LABELS = ['关闭', '模拟', '真实'];
const STAGE_LABELS = ['清醒', '浅睡', '深睡'];

/** -1 / null 统一显示为 -- */
const numOrDash = (v, suffix) => (v == null || v < 0 ? '--' : String(v) + (suffix || ''));

Page({
  data: {
    device: null,
    // ---- 实时区（BLE 直连）----
    bleOn: false,
    rtLive: null,      // { hr, rr, motion, snore, stage, time }
    // ---- 最近一帧（云端 30s 帧）----
    frameItems: [],
    frameMeta: '',
    // ---- 三开关（设备本地）----
    cfg: { snore: 0, stage: 0, bcg: 0 },
    modeLabels: MODE_LABELS,
    cfgSyncing: false,
    // ---- 最近一天 ----
    daySummary: { turnCountText: '--', snoreMinText: '--', scoreText: '--', scoreColor: '#9CA3AF' },
    dayMeta: ''
  },

  onLoad(query) {
    this.deviceId = query.id;

    // 本地缓存命中就直接用；**没命中也不判死**。
    // 本页两块数据源是独立的：
    //   蓝牙区（三开关 + 实时帧）—— 只看 BLE，连上就有，与云端无关
    //   云端区（最近一帧 / 最近一天）—— 只看后端，失败就各自显示空态
    // 以前这里是 `if (!device) 报错返回`，等于让"云端有没有数据"决定
    // "能不能开这个页面"，把两条路径耦合在一起了。
    const cached = deviceStore.getDevice(this.deviceId);
    if (cached) {
      this.applyDevice(cached);
    } else {
      this.setData({ device: { id: this.deviceId, name: '设备', status: 'offline' } });
      wx.setNavigationBarTitle({ title: '设备' });
    }

    this.refreshRuntime();   // 云端，失败忽略
    this.loadDaySummary();   // 云端，失败忽略
    this.loadLatestFrame();  // 云端，失败显示空态

    this._unsub = bindStore(this, deviceStore.store, (s) => {
      const d = s.devices.find((x) => String(x.id) === String(this.deviceId));
      if (d) this.applyDevice(d);
    });

    // ---- BLE：连接状态 + 实时帧 + 设备端 cfg ----
    // 注：BLEManager.onConnectStateChange / BLEProvisioner.onRealtime 都是单回调，
    //     离开页面务必清空，否则会和别的页面互相覆盖。
    this._offConn = BLEManager.onConnectStateChange((connected) => {
      this.setData({ bleOn: connected, rtLive: connected ? this.data.rtLive : null });
      if (connected) this.loadCfg();   // 蓝牙连上自动从设备读取三开关
    });
    BLEProvisioner.onRealtime((f) => this.onRealtimeFrame(f));

    const connected = BLEManager.isConnected();
    this.setData({ bleOn: connected });
    if (connected) this.loadCfg();
  },

  onUnload() {
    this._unsub && this._unsub();
    this._offConn && this._offConn();
    BLEProvisioner.onRealtime(null);
    BLEManager.onConnectStateChange(null);
  },

  onPullDownRefresh() {
    Promise.all([this.refreshRuntime(), this.loadLatestFrame(), this.loadDaySummary()])
      .finally(() => wx.stopPullDownRefresh());
  },

  applyDevice(device) {
    if (!device) return;
    this.setData({ device });
    wx.setNavigationBarTitle({ title: device.name });
  },

  /** 拉详情接口拿最新 runtime（设备在线状态等） */
  refreshRuntime() {
    return deviceAPI.getDetail(this.deviceId).then((d) => {
      deviceStore.upsertDevice(d);
      this.applyDevice(d);
    }).catch(() => {});
  },

  // ============================================================
  // 实时区：BLE 直连（固件每秒推一帧）
  // ============================================================
  /**
   * 实时区 = **每秒**的「是否在打鼾 / 是否在床」，由蓝牙每秒推送。
   * 心率、呼吸、分期这些**不属于实时区** —— 它们放在"最近一帧"，从后端读。
   * 字段值 -1 表示该通道开关为 OFF（或数据源未接入），显示为 --。
   */
  onRealtimeFrame(f) {
    if (!f) return;
    const now = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    // -1 / null → null（未接入），0 → false，1 → true
    const tri = (v) => (v == null || v < 0 ? null : !!v);
    this.setData({
      bleOn: true,
      rtLive: {
        snoring: tri(f.snoring),
        inBed: tri(f.in_bed),
        time: pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds())
      }
    });
  },

  // ============================================================
  // 最近一帧：云端 30s 结构化帧
  // ============================================================
  loadLatestFrame() {
    return deviceAPI.getRawJson(this.deviceId).then((frame) => {
      if (!frame) {
        this.setData({ frameItems: [], frameMeta: '暂无数据' });
        return;
      }
      const items = [];
      if (frame.stage >= 0) items.push({ label: '睡眠分期', text: STAGE_LABELS[frame.stage] || '--' });
      if (frame.heart_rate >= 0) items.push({ label: '心率', text: frame.heart_rate + ' bpm' });
      if (frame.resp_rate >= 0) items.push({ label: '呼吸', text: frame.resp_rate + ' 次/分' });
      if (frame.snore_seconds >= 0) items.push({ label: '鼾声', text: frame.snore_seconds + ' 秒' });
      if (frame.motion >= 0) items.push({ label: '体动', text: frame.motion ? '有' : '无' });
      const end = frame.window_end_ts ? new Date(frame.window_end_ts * 1000) : null;
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      this.setData({
        frameItems: items,
        frameMeta: end
          ? '窗口结束 ' + pad(end.getHours()) + ':' + pad(end.getMinutes()) + ':' + pad(end.getSeconds())
          : ''
      });
    }).catch(() => {
      this.setData({ frameItems: [], frameMeta: '暂无数据' });
    });
  },

  // ============================================================
  // 三开关：设备本地状态，走 BLE
  // ============================================================
  /** 从设备读取三开关（NVS） */
  loadCfg() {
    if (!BLEManager.isConnected()) return Promise.resolve();
    this.setData({ cfgSyncing: true });
    return BLEProvisioner.getCfg()
      .then((cfg) => this.setData({ cfg }))
      .catch((err) => {
        wx.showToast({ title: '读取设备配置失败：' + ((err && err.message) || '未知'), icon: 'none' });
      })
      .then(() => this.setData({ cfgSyncing: false }));
  },

  onModeChange(e) {
    const key = e.currentTarget.dataset.key;
    const value = Number(e.detail.value);
    if (!BLEManager.isConnected()) {
      wx.showToast({ title: '请先连接设备蓝牙', icon: 'none' });
      return;
    }
    if (this.data.cfgSyncing) return;

    const prev = this.data.cfg;
    const next = Object.assign({}, prev, { [key]: value });
    // 乐观更新
    this.setData({ cfg: next, cfgSyncing: true });
    BLEProvisioner.setCfg(next)
      .then((saved) => {
        this.setData({ cfg: saved });
        wx.showToast({ title: '已写入设备', icon: 'success' });
      })
      .catch((err) => {
        this.setData({ cfg: prev });   // 回滚到写入前的值
        wx.showToast({ title: '写入失败：' + ((err && err.message) || '未知'), icon: 'none' });
      })
      .then(() => this.setData({ cfgSyncing: false }));
  },

  modeClass(v) {
    return v === 0 ? 'pill-off' : (v === 1 ? 'pill-sim' : 'pill-real');
  },

  // ============================================================
  // 最近一天（历史区）
  // ============================================================
  loadDaySummary() {
    return sleepAPI.list(50, 0).then((list) => {
      const all = list || [];
      const rec = all.find((r) => String(r.device_id) === String(this.deviceId)) || all[0];
      if (!rec) {
        this.setData({
          daySummary: { turnCountText: '--', snoreMinText: '--', scoreText: '--', scoreColor: '#9CA3AF' },
          dayMeta: '近 24 小时暂无数据'
        });
        return;
      }
      const score = rec.sleep_quality_score != null ? Math.round(rec.sleep_quality_score * 100) : null;
      const turnCount = rec.turnover_count != null ? rec.turnover_count : null;
      const snoreMin = rec.snore_minutes != null ? rec.snore_minutes : null;
      const dateLabel = rec.start_time ? this.formatDateLabel(rec.start_time) : '';
      this.setData({
        daySummary: {
          turnCountText: turnCount != null ? turnCount + ' 次' : '--',
          snoreMinText: snoreMin != null ? snoreMin + ' 分' : '--',
          scoreText: score != null ? score + ' 分' : '--',
          scoreColor: score == null ? '#9CA3AF' : (score >= 90 ? '#10B981' : score >= 70 ? '#F59E0B' : '#F0506E')
        },
        dayMeta: dateLabel
      });
    }).catch(() => {});
  },

  formatDateLabel(iso) {
    const d = new Date(iso);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  },

  goDetail() {
    wx.navigateTo({ url: '/pages/subPackages/device/pages/detail/detail?id=' + this.deviceId });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/subPackages/ai/pages/report-range/report-range?deviceId=' + this.deviceId });
  },

  goAnalysis() {
    wx.navigateTo({ url: '/pages/subPackages/ai/pages/analysis/analysis?deviceId=' + this.deviceId });
  }
});

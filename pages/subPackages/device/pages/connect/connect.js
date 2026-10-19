// 蓝牙配网（通用）：扫描全部 BLE 设备 -> 连接 -> 读回设备ID -> 下发 Wi-Fi -> 绑定
const BLEManager = require('../../../../../utils/bluetooth/BLEManager');
const BLEProvisioner = require('../../../../../utils/bluetooth/BLEProvisioner');
const deviceAPI = require('../../../../../utils/network/api/deviceAPI');
const deviceStore = require('../../../../../utils/store/stores/deviceStore');

const STEP = { SCAN: 'scan', FORM: 'form', PROGRESS: 'progress', DONE: 'done' };

Page({
  data: {
    step: STEP.SCAN,
    scanning: false,
    found: [],
    selected: null,
    session: null,       // 连接后发现的通道信息
    ble: { connected: false, name: '', id: '' },   // 当前已连接的 BLE 设备
    ssid: '',
    password: '',
    progress: { step: '', text: '' },
    progressPct: 0,
    result: null
    // 注：不在本页展示云端状态 —— 配网只管把 Wi-Fi 凭据递给设备，
    //     设备是否上云在「设备控制页」的云端区单独呈现，两者互不干扰。
  },

  onLoad(options) {
    if (options && options.deviceId) {
      // 从首页「其他设备」点击进入：直接连接该设备
      this.connect({
        deviceId: options.deviceId,
        name: options.name ? decodeURIComponent(options.name) : ''
      });
    } else {
      this.startScan();
    }
  },

  onShow() {
    // 返回本页时同步「已连接设备」状态
    this.refreshBle();
  },

  onUnload() {
    this.stopWatch();
    BLEManager.stopScan();
    // 离开配网页不主动断开 BLE，保持连接用于实时采集/控制
  },

  /** 同步当前 BLE 连接状态（用于「已连接设备」一行） */
  refreshBle() {
    this.setData({
      ble: {
        connected: BLEManager.isConnected(),
        name: BLEManager.connectedName() || BLEManager.currentDeviceId() || '',
        id: BLEManager.currentDeviceId() || ''
      }
    });
  },

  /** 断开当前 BLE 连接，断开后重新扫描让设备回到「其他设备」 */
  onDisconnectBle() {
    const name = BLEManager.connectedName() || '';
    BLEManager.disconnect().finally(() => {
      this.refreshBle();
      this.startScan();
      wx.showToast({ title: name ? '已断开 ' + name : '已断开蓝牙', icon: 'none' });
    });
  },

  startScan() {
    this.setData({ scanning: true, found: [] });
    BLEManager.startScan((dev) => {
      if (!dev || !dev.deviceId) return;
      const connectedId = BLEManager.currentDeviceId();
      if (connectedId && dev.deviceId === connectedId) return;  // 已连接设备不列入「其他设备」
      const found = this.data.found.filter((d) => d.deviceId !== dev.deviceId).concat(dev);
      found.sort((a, b) => b.rssi - a.rssi);
      this.setData({ found, scanning: BLEManager.isScanning() });
    }).catch(() => {
      this.setData({ scanning: false });
      wx.showModal({
        title: '蓝牙不可用',
        content: '请确认手机蓝牙已开启，且已授权微信使用蓝牙',
        showCancel: false,
        success: () => wx.navigateBack()
      });
    });
    this.stopWatch();
    this._watch = setInterval(() => {
      if (!BLEManager.isScanning()) {
        this.setData({ scanning: false });
        this.stopWatch();
      }
    }, 800);
  },

  stopWatch() {
    if (this._watch) { clearInterval(this._watch); this._watch = null; }
  },

  rescan() { this.startScan(); },

  onDeviceTap(e) {
    const dev = e.currentTarget.dataset.device;
    const doConnect = () => this.connect(dev);
    if (this.data.scanning) BLEManager.stopScan().then(doConnect);
    else doConnect();
  },

  connect(dev) {
    wx.showLoading({ title: '连接并识别...' });
    BLEManager.connect(dev.deviceId, dev.name)
      .then(() => BLEManager.readDeviceId())  // 读回设备身份 ID（IoTDA device_id）
      .then((rawDeviceId) => {
        wx.hideLoading();
        const deviceId = String(rawDeviceId || '').replace(/\0+$/g, '').trim();
        if (!deviceId) {
          wx.showModal({
            title: '无法识别设备',
            content: '未读取到设备身份 ID，请返回重新连接',
            showCancel: false
          });
          return;
        }
        this.setData({
          step: STEP.FORM,
          selected: dev,
          deviceId,
          session: BLEManager.sessionInfo()
        });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showModal({
          title: '连接失败',
          content: (err && err.message) || '无法与该设备建立数据通道，请靠近后重试或换一台设备',
          showCancel: false
        });
      });
  },

  onSsidInput(e) { this.setData({ ssid: e.detail.value }); },
  onPwdInput(e) { this.setData({ password: e.detail.value }); },

  onPickCurrentWifi() {
    wx.getNetworkType({
      success: (res) => {
        if (res.networkType === 'wifi') {
          this.setData({ ssid: this.data.ssid || '当前 Wi-Fi（5G 请用 2.4G）' });
        } else {
          wx.showToast({ title: '请先连接 2.4G Wi-Fi', icon: 'none' });
        }
      }
    });
  },

  submitProvision() {
    const { ssid, password } = this.data;
    if (!ssid.trim()) return wx.showToast({ title: '请输入 Wi-Fi 名称', icon: 'none' });
    if (password.length < 8) return wx.showToast({ title: '密码至少 8 位', icon: 'none' });

    this.setData({ step: STEP.PROGRESS, progressPct: 10, progress: { step: 'start', text: '开始配网...' } });
    const weights = { start: 10, ssid: 30, commit: 65, waiting: 85, done: 100 };
    const name = this.data.selected.name || ('BLE-' + String(this.data.selected.deviceId).slice(-4));
    const deviceId = String(this.data.deviceId || '').trim();
    if (!deviceId) return wx.showToast({ title: '设备 ID 缺失，请重新连接', icon: 'none' });

    BLEProvisioner.provision({ ssid, password }, {
      onProgress: (step, text) => {
        this.setData({ progress: { step, text }, progressPct: weights[step] || 0 });
      }
    }).then(() => {
      // 用 BLE 读回的 device_id 归属（与固件上报/华为云一致）
      console.log('[connect] 凭据已下发, deviceId=', deviceId);
      // ★ 配网到此结束：**不等设备回执、不等云端注册**。
      //   BLE（小程序↔设备）与 Wi-Fi（设备↔云端）是两条独立路径，
      //   配网只负责把凭据递过去；"设备是否上云"由后端 is_online 判定。
      //   云端认领放到后台异步做，不阻塞"配网成功"这个结论。
      this.setData({
        step: STEP.DONE,
        result: { device_id: deviceId, name, model: 'SleepPillow', sn: '' }
      });
      // 云端认领完全后台进行，不阻塞、不显示（云端状态在设备控制页单独呈现）
      this.claimInBackground(deviceId, name);
    }).catch((err) => {
      wx.showModal({
        title: '配网失败',
        content: (err && err.message) || '未知错误，请靠近设备重试',
        showCancel: false,
        success: () => this.setData({ step: STEP.FORM })
      });
    });
  },

  /**
   * 后台认领：等设备在云端注册（IoTDA「设备状态变更」规则异步触发）→ bind 到当前用户
   *
   * 不阻塞配网流程；失败/超时只影响"能否立刻进控制页"，
   * 用户可回首页稍后刷新（那时设备已注册，列表里会出现并可 bind）。
   */
  claimInBackground(deviceId, name) {
    // 完全静默：不改任何 UI。配网（BLE 本地）已经结束了，
    // 云端认领只是"把设备挂到你账号下"，成不成都不影响配网这个结论，
    // 也没必要让用户盯着"连接云端…"。
    return this.waitRegistered(deviceId, { timeoutMs: 90000, intervalMs: 5000 })
      .then(() => deviceAPI.bind(deviceId, name))
      .then((device) => {
        console.log('[connect] 已认领:', device && device.device_id);
        deviceStore.upsertDevice(device);
        this.setData({ result: device });
      })
      .catch((err) => {
        console.log('[connect] 云端认领稍后再试:', err && err.message);
      });
  },

  /**
   * 轮询等待设备在云端注册（间隔 3s）
   *
   * 为什么需要等：设备连上华为云后，平台会推「设备状态变更 ONLINE」事件，
   * IoTDA 规则再转发到后端，后端才把设备写进 devices 表 —— 整条链路是异步的，
   * 配网刚成功时云端通常还没收到。查一次就判死会导致必然失败。
   *
   * @returns {Promise<void>} 已注册则 resolve；超时 reject（带排查提示）
   */
  waitRegistered(deviceId, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 30000;
    const intervalMs = (opts && opts.intervalMs) || 3000;
    const started = Date.now();

    const attempt = () => deviceAPI.checkRegistered(deviceId).then((r) => {
      if (r && r.registered) return true;
      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) {
        throw new Error(
          '设备尚未在云端注册（已等待 ' + Math.round(timeoutMs / 1000) + 's）。请检查：\n' +
          '① 设备是否已连上 Wi-Fi 并能访问外网\n' +
          '② 华为云 IoTDA 里「设备状态变更」规则是否已启用，且转发地址是 ' +
          '.../api/v1/ingest/huawei'
        );
      }
      opts && opts.onWait && opts.onWait(elapsed);
      return new Promise((res) => setTimeout(res, intervalMs)).then(attempt);
    });

    return attempt();
  },

  goControl() {
    const id = this.data.result && this.data.result.id;
    if (!id) {
      wx.showToast({ title: '设备还在连接云端，稍后再进', icon: 'none' });
      return;
    }
    wx.redirectTo({ url: '/pages/subPackages/device/pages/control/control?id=' + id });
  },

  backHome() {
    wx.switchTab({ url: '/pages/tabBar/home/home' });
  }
});

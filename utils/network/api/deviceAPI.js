/**
 * 设备管理接口（对齐睡眠分析云后端 /api/v1/devices）
 * - registerDevice/list/getDetail 由后端 DeviceOut 映射为前端卡片结构
 * - 三开关（snore/stage/bcg）是**设备本地状态**，走 BLE 读写，
 *   不经云端：见 utils/bluetooth/BLEProvisioner.js 的 getCfg/setCfg
 */
const http = require('../httpClient');

/** 缺省通道定义（小程序端展示用，云端暂不下发 channels） */
const defaultChannels = () => ([
  { key: 'heartRate', label: '心率', unit: 'bpm', color: '#F0506E', min: 40, max: 130, base: 62, digits: 0, icon: 'icon-heart' },
  { key: 'breathRate', label: '呼吸频率', unit: '次/分', color: '#3D7EFF', min: 8, max: 30, base: 15, digits: 0, icon: 'icon-breath' },
  { key: 'turnCount', label: '翻身次数', unit: '次', color: '#8B5CF6', min: 0, max: 40, base: 8, digits: 0, icon: 'icon-turn' },
  { key: 'inBed', label: '在床状态', kind: 'state', color: '#10B981', icon: 'icon-bed', onText: '在床', offText: '离床' }
]);

/** 后端 DeviceOut -> 前端设备卡片（metrics 仅来自设备真实上报，无数据时为空） */
function mapDevice(d, index) {
  const chs = defaultChannels();
  const metrics = {};
  // 仅在有真实上报指标时填充，杜绝前端伪造默认值
  if (d.runtime) {
    if (d.runtime.latest_heart_rate != null) metrics.heartRate = d.runtime.latest_heart_rate;
    if (d.runtime.latest_respiratory_rate != null) metrics.breathRate = d.runtime.latest_respiratory_rate;
    if (d.runtime.latest_bed_status != null) metrics.inBed = d.runtime.latest_bed_status === 'out_of_bed' ? 0 : 1;
    if (d.runtime.latest_turnover_count != null) metrics.turnCount = d.runtime.latest_turnover_count;
  }
  return {
    id: String(d.id),
    device_id: d.device_id,
    name: d.name,
    device_type: d.device_type,
    type: d.device_type,
    model: d.device_type || 'sleep_monitor',
    status: d.is_online ? 'online' : 'offline',
    isOnline: d.is_online,
    lastSeen: d.last_seen ? new Date(d.last_seen).getTime() : null,
    lastSeenIso: d.last_seen || null,
    firmware: 'v1.0.0',
    capabilities: ['端侧三模型 · 鼾声/睡眠分期/BCG体动'],
    channels: chs,
    metrics
    // 注：无 control 字段。设备可控项只有「三开关」，且是设备本地状态，走 BLE 读写。
  };
}

module.exports = {
  getList(onlineOnly = false) {
    const url = onlineOnly ? '/devices?online_only=true' : '/devices';
    return http.get(url).then((list) => (list || []).map(mapDevice));
  },

  getDetail(deviceId) {
    // 后端已实现 GET /devices/{id}（含 runtime 实时指标）
    return http.get('/devices/' + deviceId).then(mapDevice);
  },

  registerDevice(info) {
    const deviceId = String(info.device_id || '').trim();
    if (!deviceId) {
      // 设备 ID 缺失时禁止注册，避免用随机 id 造出重复设备
      return Promise.reject(new Error('未能读取设备 ID，无法注册'));
    }
    const payload = {
      device_id: deviceId.slice(0, 64),
      name: info.name || 'SleepPillow',
      device_type: info.model || 'sleep_monitor'
    };
    return http.post('/devices', payload).then(mapDevice);
  },

  /** 设备指令/日志历史 */
  getLogs(deviceId) {
    return http.get('/devices/' + deviceId + '/logs');
  },

  // ★ 最近一帧 30s 结构化数据（详情页/实时区「最近一帧」用）
  getRawJson(deviceId) {
    return http.get('/devices/' + deviceId + '/raw-json');
  },

  /**
   * 显式认领已存在设备（重配网时用）
   *
   * ⚠️ 必须 .then(mapDevice)：后端 DeviceOut 的 id 是 number，
   *    而 getList/getDetail 出来的 id 是 String。不映射的话
   *    deviceStore.upsertDevice 里的 `d.id === device.id` 匹配不上，
   *    会把同一台设备 push 成第二条 —— 列表里就会冒出"两台设备"。
   */
  bind(deviceId, name) {
    return http
      .post('/devices/' + deviceId + '/bind' + (name ? '?name=' + encodeURIComponent(name) : ''))
      .then(mapDevice);
  },

  /**
   * 查询设备是否已在云端注册（webhook 拿到过）
   *
   * 返回统一为 { device_id, registered, owner_bound, online }；
   * 兼容后端历史上返回扁平结构（无 data 壳）的情况 —— 那种情况下
   * http 层会 resolve(undefined)，这里兜底成 { registered: false }，
   * 避免出现"设备明明已注册、前端却一直判定未注册"。
   *
   * 注：/ingest/* 是免登录接口，http.get 第 3 个参数是 mock 数据而非请求选项。
   */
  checkRegistered(deviceId) {
    return http.get('/ingest/devices/' + deviceId + '/registered').then((r) => {
      if (r && typeof r.registered === 'boolean') return r;
      return { device_id: deviceId, registered: false, owner_bound: false, online: false };
    });
  },

  reboot(deviceId) {
    return http.post('/devices/' + deviceId + '/reboot');
  },

  upgradeFirmware(deviceId, version) {
    return http.post('/devices/' + deviceId + '/upgrade', { version: version || null });
  },

  unbind(deviceId) {
    return http.del('/devices/' + deviceId);
  }
};
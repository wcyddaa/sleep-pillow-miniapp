/**
 * 设备 Store：设备列表、实时数据缓存
 */
const { createStore } = require('../index');
const { DEVICE_STATUS } = require('../../common/constants');

const store = createStore({
  devices: [],
  loaded: false,
  realtime: {}   // { [deviceId]: { temperature, humidity, co2, pm25, ts } }
});

/** 列表按 在线 > 告警 > 离线 排序 */
function sortDevices(list) {
  const weight = { online: 0, alert: 1, offline: 2 };
  return list.slice().sort((a, b) => (weight[a.status] || 9) - (weight[b.status] || 9));
}

module.exports = {
  store,

  setDevices(list) {
    store.setState({ devices: sortDevices(list), loaded: true });
  },

  upsertDevice(device) {
    const list = store.state.devices.slice();
    // 用 String() 归一化再比：后端不同接口返回的 id 类型不一致
    // （DeviceOut 是 number，经 mapDevice 后是 string），
    // 严格 === 会匹配失败并把同一台设备 push 成两条（列表里出现"两台设备"）。
    const idx = list.findIndex((d) => String(d.id) === String(device.id));
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], device);
    else list.push(device);
    store.setState({ devices: sortDevices(list) });
  },

  removeDevice(deviceId) {
    store.setState({ devices: store.state.devices.filter((d) => String(d.id) !== String(deviceId)) });
  },

  getDevice(deviceId) {
    return store.state.devices.find((d) => String(d.id) === String(deviceId)) || null;
  },

  /** MQTT / 蓝牙实时数据到达 */
  applyRealtime(deviceId, metrics) {
    const realtime = Object.assign({}, store.state.realtime);
    realtime[deviceId] = Object.assign({}, metrics, { ts: Date.now() });
    const devices = store.state.devices.map((d) => {
      if (d.id !== deviceId) return d;
      const next = Object.assign({}, d, { metrics: Object.assign({}, d.metrics, metrics) });
      if (next.status === 'offline') next.status = DEVICE_STATUS.online.key;
      return next;
    });
    store.setState({ realtime, devices });
  },

  /** 统计：total / online / alert */
  summary() {
    const devices = store.state.devices;
    return {
      total: devices.length,
      online: devices.filter((d) => d.status === 'online').length,
      alert: devices.filter((d) => d.status === 'alert').length
    };
  }
};

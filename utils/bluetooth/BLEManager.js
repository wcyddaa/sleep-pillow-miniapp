/**
 * BLE 管理（sleeppillow ESP32 睡眠枕专用）：
 * 扫描、连接（固定 Nordic-UART 服务 6E400001/2/3）、MTU 协商、裸写二进制、JSON 通知解析
 * - 配网页连接后读 sessionInfo() 展示通道
 * - onData 回调输出设备通知对象（wifi/ctrl/error JSON），或实时睡眠数据帧
 * - useMock=true 时全部行为本地模拟
 */
const appConfig = require('../../config/appConfig');
const envConfig = require('../../config/envConfig');
const logger = require('../common/logger');
const parser = require('./BLEDataParser');
const mock = require('../network/mock/index');

const ble = appConfig.ble;
const state = {
  available: false,
  scanning: false,
  connecting: false,
  connectedDeviceId: null,
  connectedName: null,
  serviceUUID: null,
  writeCharId: null,
  notifyCharId: null,
  notifyParser: null,
  deviceIdValue: null,   // 从 TX 通知流里捕获到的设备身份 ID（原始字符串）
  onDataCb: null,
  onConnectStateCb: null,
  mockFoundTimer: null,
  mockDataTimer: null
};

function resetConnection() {
  state.connectedDeviceId = null;
  state.connectedName = null;
  state.serviceUUID = null;
  state.writeCharId = null;
  state.notifyCharId = null;
  state.notifyParser = null;
  state.deviceIdValue = null;
}

/** 初始化蓝牙适配器 */
function init() {
  if (envConfig.useMock) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    wx.openBluetoothAdapter({
      success: () => { state.available = true; resolve(true); },
      fail: (err) => {
        // 已打开时微信会返回 "already opened"，这不算错误，无需刷错误日志
        const msg = String((err && err.errMsg) || '');
        if (msg.indexOf('already opened') >= 0) {
          state.available = true;
          resolve(true);
          return;
        }
        logger.error('openBluetoothAdapter fail', err);
        state.available = false;
        reject(err);
      }
    });
  });
}

/** 开始扫描：返回发现的 BLE 设备（优先标记 SleepPillow 名称） */
function startScan(onDeviceFound) {
  state.onDeviceFoundCb = onDeviceFound;
  if (envConfig.useMock) {
    state.scanning = true;
    let i = 0;
    state.mockFoundTimer = setInterval(() => {
      if (i >= mock.mockBleDevices.length) return stopScan();
      onDeviceFound && onDeviceFound(mock.mockBleDevices[i++]);
    }, 1100);
    return Promise.resolve(true);
  }
  return init().then(() => {
    state.scanning = true;
    // 先停掉可能残留的扫描，避免刚断开的设备不被重新上报
    const stop = () => new Promise((r) => wx.stopBluetoothDevicesDiscovery({ complete: r }));
    return stop().then(() => new Promise((resolve, reject) => {
      wx.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: true,   // 允许重复上报，保证刚断开/信号抖动的设备也能被扫到
        interval: 0,
        success: resolve,
        fail: reject
      });
    })).then(() => {
      wx.onBluetoothDeviceFound((res) => {
        res.devices.forEach((d) => {
          if (!d.deviceId) return;
          if (!d.name && !ble.showUnnamed) return;
          state.onDeviceFoundCb && state.onDeviceFoundCb({
            deviceId: d.deviceId,
            name: d.name || d.localName || '',
            rssi: d.RSSI || 0,
            serviceNum: (d.advertisServiceUUIDs && d.advertisServiceUUIDs.length) || 0,
            isSleepPillow: (d.name || '').indexOf(ble.deviceName) >= 0
          });
        });
      });
      setTimeout(() => stopScan(), ble.scanDuration);
      return true;
    });
  });
}

function stopScan() {
  state.scanning = false;
  if (state.mockFoundTimer) { clearInterval(state.mockFoundTimer); state.mockFoundTimer = null; }
  if (envConfig.useMock) return Promise.resolve();
  return new Promise((resolve) => wx.stopBluetoothDevicesDiscovery({ complete: resolve }));
}

/** 蓝牙地址取小写便于与固定 UUID 匹配 */
function normUuid(u) { return String(u || '').toLowerCase(); }

/**
 * 连接 sleeppillow：定位固定服务/特征并协商 MTU
 */
function connect(deviceId, name) {
  if (state.connecting) return Promise.reject(new Error('正在连接中'));
  state.connecting = true;
  const finish = (ok) => { state.connecting = false; return ok; };

  if (envConfig.useMock) {
    return new Promise((resolve) => {
      setTimeout(() => {
        state.connectedDeviceId = deviceId;
        state.connectedName = name || 'mock-device';
        state.serviceUUID = ble.serviceUUID;
        state.writeCharId = ble.writeCharUUID;
        state.notifyCharId = ble.notifyCharUUID;
        state.notifyParser = parser.createNotifyParser((obj) => {
          state.onDataCb && state.onDataCb(obj);
        });
        state.mockDataTimer = setInterval(() => {
          state.onDataCb && state.onDataCb({
            evt: 'ctrl', sampling: true,
            heart_rate: 60 + Math.round(Math.random() * 6),
            respiratory_rate: 14 + Math.round(Math.random() * 3),
            bed_status: 'in_bed',
            turnover_count: Math.round(Math.random() * 2)
          });
        }, 5000);
        finish(true);
        resolve({ deviceId, serviceUUID: state.serviceUUID, serviceCount: 1 });
      }, 1500);
    });
  }

  let svcUUID = null, writeUUID = null, notifyUUID = null;
  return new Promise((resolve, reject) => {
    wx.createBLEConnection({ deviceId, timeout: ble.connectTimeout, success: resolve, fail: reject });
  })
    .then(() => stopScan())
    .then(() => new Promise((resolve, reject) => {
      wx.getBLEDeviceServices({ deviceId, success: (res) => resolve(res.services), fail: reject });
    }))
    .then((services) => {
      // 固定服务：6E400001-B5A3-F393-E0A9-E50E24DCCA9E
      const target = services.find((s) => normUuid(s.uuid) === ble.serviceUUID)
        || services.find((s) => !isGenericService(s.uuid));
      if (!target) throw new Error('未发现 sleeppillow 服务（6E400001...）');
      svcUUID = target.uuid;
      return new Promise((resolve, reject) => {
        wx.getBLEDeviceCharacteristics({ deviceId, serviceId: svcUUID, success: (res) => resolve(res.characteristics), fail: reject });
      });
    })
    .then((chars) => {
      const c = chars || [];
      writeUUID = (c.find((x) => normUuid(x.uuid) === ble.writeCharUUID)
        || c.find((x) => x.properties.write || x.properties.writeNoResponse))?.uuid || null;
      notifyUUID = (c.find((x) => normUuid(x.uuid) === ble.notifyCharUUID)
        || c.find((x) => x.properties.notify || x.properties.indicate))?.uuid || null;
      if (!writeUUID) throw new Error('未发现 RX 写特征（6E400002...）');
      if (!notifyUUID) throw new Error('未发现 TX 通知特征（6E400003...）');
      state.connectedDeviceId = deviceId;
      state.connectedName = name || deviceId;
      state.serviceUUID = svcUUID;
      state.writeCharId = writeUUID;
      state.notifyCharId = notifyUUID;
      state.notifyParser = parser.createNotifyParser((obj) => {
        // 降噪：实时帧 {"evt":"rt"} 每秒一条，打日志会刷屏且拖慢渲染层。
        // 其余事件（wifi/cfg/cfg_ok/error/ctrl）仍然打印，便于调试。
        if (obj && obj.evt !== 'rt') {
          logger.debug('[parser] 解析出对象:', JSON.stringify(obj));
        }
        state.onDataCb && state.onDataCb(obj);
      });
      // 协商 MTU（Android 必须，iOS 自动）
      if (wx.setBLEMTU) {
        return new Promise((resolve) => wx.setBLEMTU({ deviceId, mtu: ble.mtu, success: () => resolve(true), fail: () => resolve(false) }));
      }
      return Promise.resolve(true);
    })
    .then(() => new Promise((resolve, reject) => {
      wx.onBLECharacteristicValueChange((res) => {
        // 降噪：这条同样是每帧都打（实时帧 1Hz），改到 debug 级别
        logger.debug('[ble-rx] notify serviceId=', res.serviceId, 'len=', res.value && res.value.byteLength);
        if (res.serviceId && normUuid(res.serviceId) !== normUuid(svcUUID)) return;
        const notifier = state.notifyParser;
        notifier && notifier.feed(res.value);
        // 捕获固件在 TX 通知里下发的原始 device_id（非 JSON 纯字符串，如 42 字节的 device_id）
        if (!state.deviceIdValue) {
          const txt = parser.bytes2str(Array.prototype.slice.call(new Uint8Array(res.value)));
          if (txt && txt.indexOf('{') < 0) {
            state.deviceIdValue = txt.replace(/\0+$/g, '').trim();
          }
        }
      });
      wx.notifyBLECharacteristicValueChange({
        deviceId, serviceId: svcUUID, characteristicId: notifyUUID, state: true,
        success: resolve, fail: reject
      });
    }))
    .then(() => {
      wx.onBLEConnectionStateChange((res) => {
        if (res.characteristicId && normUuid(res.characteristicId) !== normUuid(notifyUUID)) return;
        if (!res.connected) {
          resetConnection();
          state.onConnectStateCb && state.onConnectStateCb(false);
        }
      });
      finish(true);
      return { deviceId, serviceUUID: svcUUID, serviceCount: 1 };
    })
    .catch((err) => { finish(false); throw err; });
}

/**
 * 发送原始二进制到 RX 特征（裸写，不组帧；分片按当前 MTU）
 */
function send(bytes) {
  if (envConfig.useMock) return Promise.resolve(true);
  if (!state.writeCharId) return Promise.reject(new Error('设备无可写通道'));
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes);
  const bytesArr = Array.prototype.slice.call(raw);
  const chunks = [];
  // 固件一次 Write 就是一个完整包（ble_provision 不拼包），这里整包单次写即可；
  // 分片反而会让固件把每一片当独立包、触发 payload too short
  const max = ble.mtu;
  for (let i = 0; i < bytesArr.length; i += max) chunks.push(bytesArr.slice(i, i + max));
  return chunks.reduce((p, chunk) => p.then(() => new Promise((resolve, reject) => {
    wx.writeBLECharacteristicValue({
      deviceId: state.connectedDeviceId,
      serviceId: state.serviceUUID,
      characteristicId: state.writeCharId,
      value: new Uint8Array(chunk).buffer,
      success: () => setTimeout(resolve, 30),
      fail: reject
    });
  })), Promise.resolve());
}

/** 读取设备身份 ID（IoTDA device_id），供前端精确注册/绑定 */
function readDeviceId() {
  if (envConfig.useMock) return Promise.resolve('mock-device-001');
  if (!state.connectedDeviceId) return Promise.reject(new Error('设备未连接'));
  // 固件把 device_id 通过 TX notify（6E400003）下发（日志 [ble-rx] notify len=42），
  // 而微信 readBLECharacteristicValue 的 res.value 通常为 undefined，读值实际也走
  // onBLECharacteristicValueChange。因此优先返回已捕获的 device_id，避免读值恒空导致重复注册。
  if (state.deviceIdValue) return Promise.resolve(state.deviceIdValue);
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (v) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(v);
    };
    // 兜底：若 notify 稍后到达，短时间后返回捕获值
    timer = setTimeout(() => done(state.deviceIdValue || ''), 900);
    // 主动读一次 READ 特征（部分固件把值经 notify 回传，触发上面的捕获）
    wx.readBLECharacteristicValue({
      deviceId: state.connectedDeviceId,
      serviceId: state.serviceUUID,
      characteristicId: ble.deviceIdCharUUID,
      success: () => setTimeout(() => done(state.deviceIdValue || ''), 150),
      fail: () => done(state.deviceIdValue || '')
    });
  });
}

function disconnect() {
  if (state.mockDataTimer) { clearInterval(state.mockDataTimer); state.mockDataTimer = null; }
  if (!state.connectedDeviceId) return Promise.resolve();
  const id = state.connectedDeviceId;
  resetConnection();
  if (envConfig.useMock) return Promise.resolve();
  return new Promise((resolve) => wx.closeBLEConnection({ deviceId: id, complete: resolve }));
}

/** GATT 通用服务（无业务数据通道） */
function isGenericService(uuid) {
  const u = normUuid(uuid);
  return ble.skipServicePrefixes.some((p) => u.indexOf(p.toLowerCase()) >= 0);
}

module.exports = {
  init,
  startScan,
  stopScan,
  connect,
  send,
  readDeviceId,
  disconnect,
  isScanning: () => state.scanning,
  isConnected: () => !!state.connectedDeviceId,
  currentDeviceId: () => state.connectedDeviceId,
  connectedName: () => state.connectedName,
  sessionInfo: () => ({ serviceUUID: state.serviceUUID, serviceCount: 1, hasWrite: !!state.writeCharId, hasNotify: !!state.notifyCharId }),
  onData(cb) { state.onDataCb = cb; },
  onConnectStateChange(cb) { state.onConnectStateCb = cb; }
};
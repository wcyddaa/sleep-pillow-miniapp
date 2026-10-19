/**
 * MQTT 客户端（实时通信）
 * useMock=true：本地定时模拟设备上报，经 deviceStore 分发 + eventBus 通知页面
 * useMock=false：通过 wx.connectSocket 直连 MQTT Broker（WebSocket），按 Broker 鉴权方式补充 username/password/connect 消息
 */
const apiConfig = require('../../config/apiConfig');
const envConfig = require('../../config/envConfig');
const logger = require('../common/logger');
const eventBus = require('../common/eventBus');
const deviceStore = require('../store/stores/deviceStore');
const appStore = require('../store/stores/appStore');
const mock = require('./mock/index');

let task = null;          // wx.connectSocket task
let mockTimer = null;
let connected = false;
const subscriptions = new Set();

function setConnected(v) {
  if (connected === v) return;
  connected = v;
  appStore.store.setState({ mqttConnected: v });
  eventBus.emit('mqtt:state', v);
}

/** 分发一条设备数据 */
function dispatchData(deviceId, metrics) {
  deviceStore.applyRealtime(deviceId, metrics);
  eventBus.emit('realtime:update', { deviceId, metrics });
}

/** mock：每 5 秒模拟在线设备上报 */
function startMockLoop() {
  setConnected(true);
  mockTimer = setInterval(() => {
    deviceStore.store.state.devices
      .filter((d) => d.status === 'online' || d.status === 'alert')
      .forEach((d) => dispatchData(d.id, mock.genRealtime(d)));
  }, 5000);
}

/** 真实 MQTT over WebSocket（云后端暂未提供 Broker 时自动跳过） */
function connectReal() {
  const cfg = apiConfig.mqtt;
  if (!cfg || !cfg.url) {
    logger.info('mqtt broker 未配置，跳过实时通道（使用 REST 轮询兜底）');
    setConnected(false);
    return;
  }
  task = wx.connectSocket({ url: cfg.url, protocols: ['mqtt'] });
  task.onOpen(() => {
    logger.info('mqtt connected:', cfg.url);
    setConnected(true);
    subscriptions.forEach((topic) => subscribeReal(topic));
  });
  task.onMessage((res) => {
    // TODO: 接入 mqtt.js 解析二进制 MQTT 包（见 README「接入真实后端」）
    logger.debug('mqtt raw message:', res.data);
  });
  task.onClose(() => setConnected(false));
  task.onError((err) => {
    logger.error('mqtt error', err);
    setConnected(false);
  });
}

function subscribeReal(topic) {
  if (task && connected) {
    logger.debug('mqtt subscribe:', topic);
    // TODO: 发送 MQTT SUBSCRIBE 报文
  }
}

module.exports = {
  connect() {
    if (envConfig.useMock) {
      if (!mockTimer) startMockLoop();
      return;
    }
    if (!task) connectReal();
  },

  disconnect() {
    if (mockTimer) { clearInterval(mockTimer); mockTimer = null; }
    if (task) { task.close({ code: 1000 }); task = null; }
    setConnected(false);
  },

  /** 订阅设备主题：连接成功后自动补订 */
  subscribeDevice(deviceId) {
    const topic = `${apiConfig.topicPrefix}/${deviceId}/data`;
    subscriptions.add(topic);
    if (envConfig.useMock) return;
    subscribeReal(topic);
  },

  unsubscribeDevice(deviceId) {
    subscriptions.delete(`${apiConfig.topicPrefix}/${deviceId}/data`);
  },

  isConnected() {
    return connected;
  }
};

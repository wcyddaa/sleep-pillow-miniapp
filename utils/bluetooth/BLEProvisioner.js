/**
 * 蓝牙配网 / 三开关配置 / 实时帧分发（sleeppillow ESP32 协议）
 *
 * ⚠️ BLEManager.onData 是**单回调**（重复注册会互相覆盖），
 *    所以本模块独占它，按 evt 分发，外部不要再直接调 BLEManager.onData：
 *
 *   {"evt":"wifi",  "ok":bool, "ssid":..}   → provision() 的等待者
 *   {"evt":"cfg",   "snore":N,"stage":N,"bcg":N} → getCfg() 的等待者
 *   {"evt":"cfg_ok"}                        → setCfg() 的等待者
 *   {"evt":"rt",    "hr":..,"rr":..,...}    → onRealtime(cb) 注册的外部回调
 *   {"evt":"error", "msg":..}               → 通知当前等待者失败
 *
 * 三开关是**设备本地状态**（固件 NVS edge_cfg），不经云端：
 *   读 = [0x04]         → 设备回 {"evt":"cfg",...}
 *   写 = [0x05][JSON]   → 设备回 {"evt":"cfg_ok"}
 */
const appConfig = require('../../config/appConfig');
const envConfig = require('../../config/envConfig');
const parser = require('./BLEDataParser');
const BLEManager = require('./BLEManager');
const logger = require('../common/logger');

const CFG_TIMEOUT = 5000;

/** 当前等待中的请求（同一时刻只允许一个：一次配置/配网操作） */
let pending = null;      // { expect, resolve, reject, timer, tag }
let realtimeCb = null;   // control 页注册的实时帧回调

/** 清掉当前等待者（不触发回调） */
function clearPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
}

/** 结束当前等待者：ok=true 走 resolve，否则 reject */
function settlePending(ok, value) {
  if (!pending) return;
  const p = pending;
  clearPending();
  if (ok) p.resolve(value);
  else p.reject(value instanceof Error ? value : new Error(String(value || '请求失败')));
}

/** 发起一次「发送 → 等指定 evt」的请求 */
function request(packet, expectEvt, timeoutMs, tag) {
  return new Promise((resolve, reject) => {
    clearPending();  // 新请求顶掉旧请求，避免永久挂起
    pending = {
      expect: expectEvt,
      tag,
      resolve,
      reject,
      timer: setTimeout(() => {
        const p = pending;
        clearPending();
        p && p.reject(new Error('设备无响应（' + tag + ' 超时）'));
      }, timeoutMs)
    };
    BLEManager.send(packet).catch((err) => settlePending(false, err));
  });
}

// ---- 单点接管 BLEManager.onData，按 evt 分发 ----
function dispatch(obj) {
  if (!obj || !obj.evt) return;

  if (obj.evt === 'rt') {
    realtimeCb && realtimeCb(obj);
    return;
  }
  if (obj.evt === 'error') {
    settlePending(false, new Error(obj.msg || '设备返回错误'));
    return;
  }
  if (obj.evt === 'wifi') {
    // 配网已不等回执，这里只记录一下设备自报的联网结果（不影响流程）
    logger.debug('provision 设备回执:', JSON.stringify(obj));
    return;
  }
  if (!pending) return;
  if (obj.evt === pending.expect) settlePending(true, obj);
}
dispatch._prov = true;
BLEManager.onData(dispatch);

/**
 * 配网：把加密 Wi-Fi 凭据写进 RX 特征 [0x01][IV12][密文][TAG16]
 *
 * ★ **不等设备回执**。
 *   职责边界：BLE 只是「小程序 ↔ 设备」的本地通道，配网只负责把凭据递过去；
 *   设备随后自己连 Wi-Fi、自己连云端 —— 那是设备 ↔ 云端的路径，与 BLE 独立。
 *   「是否已上云」由后端 is_online 状态判定（connect 页异步轮询），
 *   不要拿设备的 wifi 回执当作配网成败的判据。
 *
 * @param {object} wifi { ssid, password }
 * @param {object} hooks { onProgress(step, text) } step: ssid|commit|done
 * @returns {Promise<{ok:boolean, sent:boolean}>}
 */
function provision(wifi, hooks) {
  const notify = (step, text) => {
    logger.debug('provision:', step, text);
    hooks && hooks.onProgress && hooks.onProgress(step, text);
  };

  if (envConfig.useMock) return mockProvision(wifi, notify);

  notify('ssid', '加密 Wi-Fi 凭据');
  notify('commit', '下发 Wi-Fi 凭据');
  return BLEManager
    .send(parser.buildWifiCmd(wifi.ssid || '', wifi.password || ''))
    .then(() => {
      notify('done', '凭据已下发，设备正在连接网络');
      return { ok: true, sent: true };
    });
}

/**
 * 读三开关（设备本地 NVS）
 * @returns {Promise<{snore:number, stage:number, bcg:number}>} 各 0=OFF 1=SIM 2=REAL
 */
function getCfg() {
  if (envConfig.useMock) return Promise.resolve(mockCfg());
  return request(parser.buildGetCfgCmd(), 'cfg', CFG_TIMEOUT, 'getCfg').then((obj) => ({
    snore: Number(obj.snore) || 0,
    stage: Number(obj.stage) || 0,
    bcg: Number(obj.bcg) || 0
  }));
}

/**
 * 写三开关（设备本地 NVS + 触发固件按新配置启停三个模型）
 * @param {{snore:number, stage:number, bcg:number}} cfg
 * @returns {Promise<{snore:number, stage:number, bcg:number}>} 写入后的值
 */
function setCfg(cfg) {
  const normalized = {
    snore: Number(cfg && cfg.snore) || 0,
    stage: Number(cfg && cfg.stage) || 0,
    bcg: Number(cfg && cfg.bcg) || 0
  };
  if (envConfig.useMock) return Promise.resolve(normalized);
  return request(parser.buildSetCfgCmd(normalized), 'cfg_ok', CFG_TIMEOUT, 'setCfg')
    .then(() => normalized);
}

/**
 * 注册实时帧回调（详情页实时区）。传 null 取消。
 * 帧形如 {"evt":"rt","hr":65,"rr":15,"motion":0,"snore":3,"stage":1}
 *                      -1 表示该通道未启用
 */
function onRealtime(cb) {
  realtimeCb = cb || null;
}

let mockCfgState = { snore: 0, stage: 0, bcg: 0 };
function mockCfg() { return Object.assign({}, mockCfgState); }

function mockProvision(wifi, notify) {
  return new Promise((resolve) => {
    const steps = [
      ['ssid', '加密 Wi-Fi 凭据', 500],
      ['commit', '下发并等待设备接入网络', 700],
      ['waiting', '等待设备接入网络', 1600],
      ['done', '设备联网成功', 400]
    ];
    let idx = 0;
    (function next() {
      if (idx >= steps.length) return resolve({ ok: true });
      const [step, text, delay] = steps[idx++];
      notify(step, text);
      setTimeout(next, delay);
    })();
  });
}

module.exports = { provision, getCfg, setCfg, onRealtime };
